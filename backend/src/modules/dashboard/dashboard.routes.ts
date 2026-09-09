import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import {
  listarHistoricoDeSaidas,
  montarDashboard,
  resolverPeriodo,
} from './dashboard.service.js'

/**
 * O dashboard e o histórico de saídas (RF13, `docs/arquitetura.md` seção 5).
 *
 * **Só GESTOR**, nas duas rotas. Não é painel de balcão: são os números que
 * sustentam decisão comercial e, no piloto, o resultado da pesquisa. A
 * atendente age sobre uma unidade de cada vez, pela leitura do QR.
 *
 * Nenhuma das duas grava `EventoLog`. Consultar não é ato operacional — e um
 * evento aqui sujaria justamente a tabela de onde o painel lê.
 */

const TAMANHO_PAGINA_PADRAO = 20
const TAMANHO_PAGINA_MAXIMO = 100

/**
 * `de` e `ate` são datas de calendário, no mesmo formato do resto da API
 * (RNF01). `format: 'date'` recusa o dia que não existe (31/02); o `pattern`
 * recusa a forma antes disso, para que a falha seja de formato e não de
 * calendário.
 */
const dataDeCalendario = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  format: 'date',
} as const

const consultaPeriodo = {
  type: 'object',
  additionalProperties: false,
  properties: { de: dataDeCalendario, ate: dataDeCalendario },
} as const

const consultaHistorico = {
  type: 'object',
  additionalProperties: false,
  properties: {
    de: dataDeCalendario,
    ate: dataDeCalendario,
    pagina: { type: 'integer', minimum: 1, default: 1 },
    tamanhoPagina: {
      type: 'integer',
      minimum: 1,
      maximum: TAMANHO_PAGINA_MAXIMO,
      default: TAMANHO_PAGINA_PADRAO,
    },
    // O que dá corpo ao item "overrides autorizados" da RF13: sem ele, o
    // requisito seria um número sem como olhar quais vendas o compõem.
    apenasOverrides: { type: 'boolean', default: false },
  },
} as const

const PERIODO_INVALIDO = {
  erro: 'PERIODO_INVALIDO',
  mensagem: 'A data inicial do período não pode ser posterior à data final.',
}

type ConsultaPeriodo = { de?: string; ate?: string }
type ConsultaHistorico = ConsultaPeriodo & {
  pagina: number
  tamanhoPagina: number
  apenasOverrides: boolean
}

export async function rotasDashboard(app: FastifyInstance): Promise<void> {
  const somenteGestor = { preHandler: [autenticar, exigirPapel(Papel.GESTOR)] }

  app.get<{ Querystring: ConsultaPeriodo }>(
    '/dashboard',
    { ...somenteGestor, schema: { querystring: consultaPeriodo } },
    async (request, reply) => {
      const periodo = resolverPeriodo(request.query.de, request.query.ate)
      if (!periodo.ok) return reply.code(400).send(PERIODO_INVALIDO)

      // Banco vazio responde 200 com tudo zerado, nunca 404: um painel que
      // some quando não há o que contar some justamente no começo do piloto.
      return montarDashboard(periodo.periodo)
    },
  )

  app.get<{ Querystring: ConsultaHistorico }>(
    '/dashboard/saidas',
    { ...somenteGestor, schema: { querystring: consultaHistorico } },
    async (request, reply) => {
      const periodo = resolverPeriodo(request.query.de, request.query.ate)
      if (!periodo.ok) return reply.code(400).send(PERIODO_INVALIDO)

      return listarHistoricoDeSaidas({
        periodo: periodo.periodo,
        pagina: request.query.pagina,
        tamanhoPagina: request.query.tamanhoPagina,
        apenasOverrides: request.query.apenasOverrides,
      })
    },
  )
}
