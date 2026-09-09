import bcrypt from 'bcryptjs'
import { prisma } from '../../db/prisma.js'
import { EMAIL_DO_SISTEMA } from '../alerta/usuarioDoSistema.js'
import { CUSTO_BCRYPT, gerarHashDeSenha } from './hashDeSenha.js'
import type { UsuarioAutenticado } from './tipos.js'

// Hash de uma senha que ninguém usa. Serve apenas para consumir o mesmo tempo
// de CPU quando o e-mail não existe, de modo que o tempo de resposta não
// revele quais e-mails estão cadastrados.
const HASH_INEXISTENTE = bcrypt.hashSync('usuario-inexistente', CUSTO_BCRYPT)

/**
 * Confere e-mail e senha. Retorna `null` para credencial inválida sem
 * distinguir "e-mail não existe" de "senha errada" — quem chama não deve
 * vazar essa diferença na resposta.
 */
export async function autenticarCredenciais(
  email: string,
  senha: string,
): Promise<UsuarioAutenticado | null> {
  const usuario = await prisma.usuario.findUnique({ where: { email } })
  const senhaConfere = await bcrypt.compare(senha, usuario?.senhaHash ?? HASH_INEXISTENTE)

  if (!usuario || !senhaConfere) return null

  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
  }
}

/**
 * Piso de tamanho da senha definida fora do sistema (ver `definirSenha`).
 *
 * Doze, e não oito, por um motivo específico deste projeto: a senha do seed
 * (`estoque123`) tem dez caracteres, e o piso precisa recusá-la. Quem roda o
 * script está justamente saindo dela — deixar passar "estoque1234" seria
 * cerimônia sem efeito.
 */
export const TAMANHO_MINIMO_DE_SENHA = 12

export type ResultadoDaDefinicaoDeSenha =
  | { ok: true; email: string }
  | { ok: false; motivo: 'SENHA_CURTA' | 'USUARIO_NAO_ENCONTRADO' | 'CONTA_NAO_AUTENTICA' }

/**
 * Grava uma senha nova para um usuário existente.
 *
 * **Não é uma rota, e é de propósito.** A gestão de usuário pela interface é
 * T22; enquanto ela não existe, publicar o sistema com a senha do seed é o que
 * não pode acontecer, e um script operado por quem tem acesso ao banco resolve
 * isso sem abrir superfície nova na API. A recusa de trocar a senha da conta de
 * sistema (`usuarioDoSistema.ts`) preserva a propriedade que aquele módulo
 * documenta: ela não autentica, e nada aqui deve poder torná-la autenticável.
 *
 * A lógica mora no serviço, e não no `.cli.ts`, para poder ser testada sem
 * subir processo — o script é só a casca que lê argumento e imprime.
 */
export async function definirSenha(
  email: string,
  senha: string,
): Promise<ResultadoDaDefinicaoDeSenha> {
  if (senha.length < TAMANHO_MINIMO_DE_SENHA) return { ok: false, motivo: 'SENHA_CURTA' }
  if (email === EMAIL_DO_SISTEMA) return { ok: false, motivo: 'CONTA_NAO_AUTENTICA' }

  const usuario = await prisma.usuario.findUnique({ where: { email } })
  if (!usuario) return { ok: false, motivo: 'USUARIO_NAO_ENCONTRADO' }

  await prisma.usuario.update({
    where: { email },
    data: { senhaHash: await gerarHashDeSenha(senha) },
  })

  return { ok: true, email }
}
