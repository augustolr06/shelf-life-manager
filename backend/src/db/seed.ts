// Seed mínimo (T02): um usuário de cada papel, para permitir testes manuais
// dos endpoints das próximas tarefas sem cadastrar ninguém à mão.
//
// Não popula produtos nem unidades — isso depende das regras de cadastro
// que só existem a partir de T04/T05.
//
// Idempotente: rodar duas vezes não duplica nem sobrescreve senha alterada.
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { Papel, PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SENHA_PADRAO = 'estoque123'
const CUSTO_BCRYPT = 10

const usuarios = [
  { nome: 'Gestora de Loja', email: 'gestor@estoque.local', papel: Papel.GESTOR },
  { nome: 'Atendente de Balcão', email: 'atendente@estoque.local', papel: Papel.ATENDENTE },
]

async function main() {
  for (const usuario of usuarios) {
    const senhaHash = await bcrypt.hash(SENHA_PADRAO, CUSTO_BCRYPT)

    await prisma.usuario.upsert({
      where: { email: usuario.email },
      update: {},
      create: { ...usuario, senhaHash },
    })

    console.log(`usuário disponível: ${usuario.email} (${usuario.papel})`)
  }

  console.log(`senha de ambos: ${SENHA_PADRAO} — apenas para desenvolvimento`)
}

main()
  .catch((erro) => {
    console.error(erro)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
