import { PrismaClient } from '@prisma/client'

// Instância única do Prisma Client. As transações com lock exigidas pela
// RNF02 (ver docs/arquitetura.md seção 4) são abertas a partir daqui.
export const prisma = new PrismaClient()
