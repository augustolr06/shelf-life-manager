/**
 * Os prazos de transação de `db/opcoesDeTransacao.ts` chegaram ao client?
 *
 * Esta é a única forma de verificar isso: o Prisma não expõe as opções
 * efetivas do client para leitura, então provar que a configuração vale exige
 * **exercer** um prazo que os padrões dele recusariam. É deliberado que a
 * suíte fique ~6s mais lenta por causa disto — a alternativa é uma
 * configuração que pode parar de valer sem que nada acuse, e cujo sintoma
 * aparece na primeira leitura de QR de um dia frio, no balcão.
 *
 * Roda contra PostgreSQL de verdade, porque é o `pg_sleep` do banco que
 * consome o tempo.
 */

import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clienteCompartilhadoDeTeste, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { OPCOES_DE_TRANSACAO } from '../../src/db/opcoesDeTransacao.js'

/** Os padrões do Prisma, que estas opções existem para substituir. */
const PADRAO_PRISMA = { maxWait: 2_000, timeout: 5_000 }

/** Acima do `timeout` padrão de 5s, folgado abaixo do nosso de 15s. */
const SEGUNDOS_DENTRO_DA_TRANSACAO = 6

let prisma: PrismaClient

beforeAll(async () => {
  await prepararBancoDeTeste()
  prisma = clienteCompartilhadoDeTeste()
}, 60_000)

afterAll(async () => {
  await prisma.$disconnect()
})

describe('prazos das transações', () => {
  it('são mais generosos que os padrões do Prisma, nas duas pontas', () => {
    expect(OPCOES_DE_TRANSACAO?.maxWait).toBeGreaterThan(PADRAO_PRISMA.maxWait)
    expect(OPCOES_DE_TRANSACAO?.timeout).toBeGreaterThan(PADRAO_PRISMA.timeout)
  })

  // O que de fato prova que a configuração chegou ao client: com o padrão de
  // 5s, esta transação seria abortada com P2028 antes de terminar.
  it('deixam uma transação passar do limite padrão de 5s sem abortar', async () => {
    const resultado = await prisma.$transaction(async (tx) => {
      // `$executeRawUnsafe`, e não `$queryRawUnsafe`: `pg_sleep` devolve `void`,
      // que o Prisma não sabe desserializar como coluna. O que interessa aqui
      // é o tempo passar dentro da transação, não o retorno.
      await tx.$executeRawUnsafe(`SELECT pg_sleep(${SEGUNDOS_DENTRO_DA_TRANSACAO})`)
      return 'concluiu'
    })

    expect(resultado).toBe('concluiu')
  }, 60_000)
})
