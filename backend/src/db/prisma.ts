import { PrismaClient } from '@prisma/client'
import { OPCOES_DE_TRANSACAO } from './opcoesDeTransacao.js'

// Instância única do Prisma Client. As transações com lock exigidas pela
// RNF02 (ver docs/arquitetura.md seção 4) são abertas a partir daqui — e é
// por isso que os prazos delas são configurados aqui, e não em cada chamada:
// `opcoesDeTransacao.ts` explica os números.
export const prisma = new PrismaClient({ transactionOptions: OPCOES_DE_TRANSACAO })
