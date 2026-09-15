import bcrypt from 'bcryptjs'
import { Prisma, type Papel, type Usuario } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { EMAIL_DO_SISTEMA } from '../alerta/usuarioDoSistema.js'
import { TAMANHO_MINIMO_DE_SENHA } from '../auth/auth.service.js'
import { gerarHashDeSenha } from '../auth/hashDeSenha.js'

/**
 * Administração de contas (RF01, a metade que T03 não entregou).
 *
 * Segue a convenção dos outros serviços: descreve o que aconteceu e devolve um
 * motivo; quem escolhe o código HTTP é a rota. Nenhuma decisão de resposta
 * mora aqui.
 */

export type DadosNovoUsuario = {
  nome: string
  email: string
  papel: Papel
  senha: string
}

export type AlteracoesDoUsuario = {
  nome?: string
  papel?: Papel
  ativo?: boolean
}

export type Falha =
  | 'EMAIL_EM_USO'
  | 'USUARIO_NAO_ENCONTRADO'
  | 'SENHA_CURTA'
  | 'CONTA_DE_SISTEMA'
  | 'ALVO_E_VOCE_MESMO'
  | 'SENHA_ATUAL_INCORRETA'

export type Resultado =
  | { ok: true; usuario: Usuario }
  | { ok: false; motivo: Falha }

/**
 * Sem isto, `Gestora@Loja.com` e `gestora@loja.com` são duas contas para o
 * Postgres e a mesma pessoa para a loja — a restrição `@unique` não pega a
 * diferença de caixa. Mesmo argumento do `codigoInterno` em T04.
 */
function normalizarEmail(email: string): string {
  return email.trim().toLowerCase()
}

function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002'
}

/**
 * A conta que assina a varredura automática (T18) não é uma pessoa: não
 * aparece na lista e não aceita escrita nenhuma. O `senhaHash` dela não é hash
 * de senha, e é isso que garante que ela nunca autentique — dar a alguém a
 * chance de "corrigir" isso pela interface seria abrir a única porta que
 * aquele módulo existe para manter fechada.
 */
function ehContaDeSistema(usuario: Usuario): boolean {
  return usuario.email === EMAIL_DO_SISTEMA
}

export async function listarUsuarios(incluirInativos: boolean): Promise<Usuario[]> {
  return prisma.usuario.findMany({
    where: {
      email: { not: EMAIL_DO_SISTEMA },
      ...(incluirInativos ? {} : { ativo: true }),
    },
    orderBy: { nome: 'asc' },
  })
}

export async function criarUsuario(dados: DadosNovoUsuario): Promise<Resultado> {
  if (dados.senha.length < TAMANHO_MINIMO_DE_SENHA) return { ok: false, motivo: 'SENHA_CURTA' }

  try {
    const usuario = await prisma.usuario.create({
      data: {
        nome: dados.nome.trim(),
        email: normalizarEmail(dados.email),
        papel: dados.papel,
        senhaHash: await gerarHashDeSenha(dados.senha),
      },
    })
    return { ok: true, usuario }
  } catch (erro) {
    // Pela restrição do banco, não por consulta prévia: duas criações
    // simultâneas passariam por um `findUnique`.
    if (ehViolacaoDeUnicidade(erro)) return { ok: false, motivo: 'EMAIL_EM_USO' }
    throw erro
  }
}

/**
 * Nome, papel e ativação.
 *
 * `quemEditaId` não é auditoria — é a auto-proteção: o último GESTOR que se
 * rebaixa ou se desativa tranca a loja inteira para fora da gestão, e não
 * existe caminho de volta pela interface. Rebaixar **outro** gestor continua
 * permitido; quem faz isso ainda é gestor e pode desfazer.
 */
export async function atualizarUsuario(
  id: string,
  alteracoes: AlteracoesDoUsuario,
  quemEditaId: string,
): Promise<Resultado> {
  const alvo = await prisma.usuario.findUnique({ where: { id } })
  if (!alvo) return { ok: false, motivo: 'USUARIO_NAO_ENCONTRADO' }
  if (ehContaDeSistema(alvo)) return { ok: false, motivo: 'CONTA_DE_SISTEMA' }

  const mexeNoProprioAcesso =
    id === quemEditaId && (alteracoes.papel !== undefined || alteracoes.ativo !== undefined)
  if (mexeNoProprioAcesso) return { ok: false, motivo: 'ALVO_E_VOCE_MESMO' }

  const usuario = await prisma.usuario.update({
    where: { id },
    data: {
      ...(alteracoes.nome !== undefined ? { nome: alteracoes.nome.trim() } : {}),
      ...(alteracoes.papel !== undefined ? { papel: alteracoes.papel } : {}),
      ...(alteracoes.ativo !== undefined ? { ativo: alteracoes.ativo } : {}),
    },
  })

  return { ok: true, usuario }
}

/**
 * O GESTOR redefine a senha de **outra** pessoa, sem precisar da senha atual.
 * É o caminho de recuperação que o sistema não tinha: até aqui, senha
 * esquecida exigia alguém rodando `npm run usuario:senha` no terminal.
 *
 * A própria senha nunca passa por aqui, mesmo sendo o GESTOR quem pede:
 * trocar a sua exige a atual, e é `trocarPropriaSenha`. A regra vale para
 * todo mundo, o que a torna fácil de explicar — e quem perdeu a própria senha
 * não está logado para chamar esta rota de qualquer forma.
 */
export async function redefinirSenha(
  id: string,
  senhaNova: string,
  quemEditaId: string,
): Promise<Resultado> {
  if (senhaNova.length < TAMANHO_MINIMO_DE_SENHA) return { ok: false, motivo: 'SENHA_CURTA' }
  if (id === quemEditaId) return { ok: false, motivo: 'ALVO_E_VOCE_MESMO' }

  const alvo = await prisma.usuario.findUnique({ where: { id } })
  if (!alvo) return { ok: false, motivo: 'USUARIO_NAO_ENCONTRADO' }
  if (ehContaDeSistema(alvo)) return { ok: false, motivo: 'CONTA_DE_SISTEMA' }

  const usuario = await prisma.usuario.update({
    where: { id },
    data: { senhaHash: await gerarHashDeSenha(senhaNova) },
  })

  return { ok: true, usuario }
}

/** Troca da própria senha, exigindo a atual. Disponível a qualquer papel. */
export async function trocarPropriaSenha(
  id: string,
  senhaAtual: string,
  senhaNova: string,
): Promise<Resultado> {
  if (senhaNova.length < TAMANHO_MINIMO_DE_SENHA) return { ok: false, motivo: 'SENHA_CURTA' }

  const usuario = await prisma.usuario.findUnique({ where: { id } })
  // Sessão válida de usuário que sumiu do banco: trata-se como credencial
  // inválida, não como 404 — quem chama é o dono da sessão, e não há nada
  // que ele possa corrigir sabendo a diferença.
  if (!usuario) return { ok: false, motivo: 'SENHA_ATUAL_INCORRETA' }

  if (!(await bcrypt.compare(senhaAtual, usuario.senhaHash))) {
    return { ok: false, motivo: 'SENHA_ATUAL_INCORRETA' }
  }

  const atualizado = await prisma.usuario.update({
    where: { id },
    data: { senhaHash: await gerarHashDeSenha(senhaNova) },
  })

  return { ok: true, usuario: atualizado }
}
