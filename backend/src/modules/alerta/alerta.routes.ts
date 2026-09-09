import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import { listarAlertas, marcarAlertaComoLido } from './alerta.service.js'

/**
 * A entrega do alerta proativo (RF08, `docs/arquitetura.md` seção 5).
 *
 * **Só GESTOR**, nas duas rotas, como a configuração de T17 e a fila de T13. A
 * jornada J3 do PRD termina em decisão comercial — promoção, destaque na
 * vitrine —, que não é ato de balcão: alerta para a atendente seria informação
 * sobre a qual ela não pode agir, no meio do atendimento
 * (`tasks/T19-entrega-do-alerta.md`, Decisão 2).
 *
 * `GET` não grava evento: consultar não é ato operacional, como em
 * `/descartes/pendentes`. `POST /:id/lido` grava, porque marcar é ato.
 */

const TAMANHO_PAGINA_PADRAO = 20
const TAMANHO_PAGINA_MAXIMO = 100

const consultaAlertas = {
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
    apenasNaoLidos: { type: 'boolean', default: false },
  },
} as const

const parametrosId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const

const NAO_ENCONTRADO = {
  erro: 'ALERTA_NAO_ENCONTRADO',
  mensagem: 'Alerta não encontrado.',
}

type ConsultaAlertas = { pagina: number; tamanhoPagina: number; apenasNaoLidos: boolean }

export async function rotasAlerta(app: FastifyInstance): Promise<void> {
  const somenteGestor = { preHandler: [autenticar, exigirPapel(Papel.GESTOR)] }

  app.get<{ Querystring: ConsultaAlertas }>(
    '/alertas',
    { ...somenteGestor, schema: { querystring: consultaAlertas } },
    async (request) => {
      // Lista vazia é 200 com `alertas: []`, nunca 404: "nenhuma unidade
      // dentro da janela" é resposta legítima — é, aliás, o estado desejado.
      return listarAlertas({
        pagina: request.query.pagina,
        tamanhoPagina: request.query.tamanhoPagina,
        apenasNaoLidos: request.query.apenasNaoLidos,
      })
    },
  )

  app.post<{ Params: { id: string } }>(
    '/alertas/:id/lido',
    { ...somenteGestor, schema: { params: parametrosId } },
    async (request, reply) => {
      // O autor do `ALERTA_LIDO` é quem está na sessão, não um parâmetro do
      // corpo: quem reconheceu o aviso foi quem clicou.
      const resultado = await marcarAlertaComoLido(request.params.id, request.usuario.id)

      if (!resultado.ok) return reply.code(404).send(NAO_ENCONTRADO)

      // 200 e não 201: marcar como lido não cria recurso, e a segunda chamada
      // devolve o mesmo estado da primeira.
      return { alerta: resultado.alerta }
    },
  )
}
