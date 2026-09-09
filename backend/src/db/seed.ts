// Seed mínimo (T02): um usuário de cada papel, para permitir testes manuais
// dos endpoints das próximas tarefas sem cadastrar ninguém à mão.
//
// Não popula produtos nem unidades — isso depende das regras de cadastro
// que só existem a partir de T04/T05. Desde T17 popula também a janela de
// antecedência padrão dos alertas (RF08).
//
// Desde T18 popula também a conta de sistema que assina os eventos da
// varredura automática de alertas.
//
// Idempotente: rodar duas vezes não duplica nem sobrescreve senha alterada.
import 'dotenv/config'
import { Papel, PrismaClient } from '@prisma/client'
import { DADOS_DO_USUARIO_DO_SISTEMA } from '../modules/alerta/usuarioDoSistema.js'
import { gerarHashDeSenha } from '../modules/auth/hashDeSenha.js'

const prisma = new PrismaClient()

const SENHA_PADRAO = 'estoque123'

const usuarios = [
  { nome: 'Gestora de Loja', email: 'gestor@estoque.local', papel: Papel.GESTOR },
  { nome: 'Atendente de Balcão', email: 'atendente@estoque.local', papel: Papel.ATENDENTE },
]

/**
 * A janela do exemplo da jornada J3 do PRD. Sem nenhuma configuração, o job de
 * T18 sobe com nada a fazer e a tela de T17 abre vazia na demonstração — o que
 * parece defeito e não é.
 */
const CONFIGURACAO_PADRAO = { diasAntecedencia: 30, canal: 'IN_APP' }

async function main() {
  for (const usuario of usuarios) {
    const senhaHash = await gerarHashDeSenha(SENHA_PADRAO)

    await prisma.usuario.upsert({
      where: { email: usuario.email },
      update: {},
      create: { ...usuario, senhaHash },
    })

    console.log(`usuário disponível: ${usuario.email} (${usuario.papel})`)
  }

  console.log(`senha de ambos: ${SENHA_PADRAO} — apenas para desenvolvimento`)

  // A conta que assina os eventos emitidos por varredura (T18). Ela não
  // autentica: o hash gravado não é hash de senha nenhuma. A varredura a cria
  // sozinha se faltar, mas tê-la desde o seed evita que ela apareça no banco
  // de demonstração só depois do primeiro alerta.
  const sistema = await prisma.usuario.upsert({
    where: { email: DADOS_DO_USUARIO_DO_SISTEMA.email },
    update: {},
    create: { ...DADOS_DO_USUARIO_DO_SISTEMA },
  })

  console.log(`conta de sistema disponível: ${sistema.email} (não autentica)`)

  // Idempotência sem chave natural: a tabela não tem `unique`, então o critério
  // é "já existe alguma configuração?". Rodar o seed de novo não deve
  // sobrescrever a janela que a gestora ajustou.
  const jaConfigurado = await prisma.configuracaoAlerta.count()

  if (jaConfigurado === 0) {
    await prisma.configuracaoAlerta.create({ data: CONFIGURACAO_PADRAO })
    console.log(
      `configuração de alerta padrão: ${CONFIGURACAO_PADRAO.diasAntecedencia} dias / ${CONFIGURACAO_PADRAO.canal}`,
    )
  }
}

main()
  .catch((erro) => {
    console.error(erro)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
