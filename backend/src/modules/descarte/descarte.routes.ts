import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import { listarDescartesPendentes } from './descarte.service.js'

/**
 * A fila de descarte pendente (RF11, `docs/arquitetura.md` seção 5).
 *
 * **Só GESTOR.** Não é fluxo de balcão: é varredura de estoque, feita com
 * tempo e sem cliente esperando. A atendente encontra a unidade vencida pela
 * leitura do QR, uma de cada vez, que é o caminho que a seção 6.1 do PRD
 * descreve.
 *
 * O nome da rota fala do descarte que **ainda não aconteceu**: o que ela lista
 * são unidades vencidas ainda `EM_ESTOQUE`. O histórico do que já foi
 * descartado é outra listagem, e pertence ao dashboard (RF13).
 */

const TAMANHO_PAGINA_PADRAO = 20
const TAMANHO_PAGINA_MAXIMO = 100

const consultaFila = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pagina: { type: 'integer', minimum: 1, default: 1 },
    tamanhoPagina: {
      type: 'integer',
      minimum: 1,
      maximum: TAMANHO_PAGINA_MAXIMO,
      default: TAMANHO_PAGINA_PADRAO,
    },
  },
} as const

type ConsultaFila = { pagina: number; tamanhoPagina: number }

export async function rotasDescarte(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ConsultaFila }>(
    '/descartes/pendentes',
    {
      preHandler: [autenticar, exigirPapel(Papel.GESTOR)],
      schema: { querystring: consultaFila },
    },
    async (request) => {
      // Fila vazia é 200 com lista vazia, nunca 404: "não há nada vencido em
      // estoque" é resposta legítima — é, aliás, o estado que se deseja.
      return listarDescartesPendentes({
        pagina: request.query.pagina,
        tamanhoPagina: request.query.tamanhoPagina,
      })
    },
  )
}
