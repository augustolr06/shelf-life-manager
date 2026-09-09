import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import { desinscreverDispositivo, inscreverDispositivo } from './push.service.js'
import { chavesVapid } from './vapid.js'

/**
 * A inscrição de aparelhos na notificação push (RF08, T19b,
 * `docs/arquitetura.md` seção 5).
 *
 * **Só GESTOR**, nas três rotas, pela mesma razão de T19: quem recebe o alerta
 * proativo é quem pode agir sobre ele. Nenhuma delas grava `EventoLog` —
 * inscrever um aparelho é configuração de recebimento, não ato de estoque, e a
 * lista de tipos parou em dez (Decisão 5).
 *
 * As três respondem **503 `PUSH_NAO_CONFIGURADO`** quando o servidor não tem
 * chaves VAPID (Decisão 4): sem elas nenhuma inscrição serviria para nada, e é
 * melhor a tela dizer "este servidor não envia notificação" do que aceitar uma
 * inscrição que nunca receberá aviso.
 */

const NAO_CONFIGURADO = {
  erro: 'PUSH_NAO_CONFIGURADO',
  mensagem:
    'Este servidor não está configurado para enviar notificações. Os alertas continuam na lista de alertas do sistema.',
}

const corpoInscricao = {
  type: 'object',
  required: ['endpoint', 'chaves'],
  additionalProperties: false,
  properties: {
    // `maxLength` porque o endpoint vem do navegador e é gravado em coluna
    // única: sem teto, um cliente qualquer poderia enfiar texto arbitrário.
    endpoint: { type: 'string', format: 'uri', minLength: 1, maxLength: 2000 },
    chaves: {
      type: 'object',
      required: ['p256dh', 'auth'],
      additionalProperties: false,
      properties: {
        p256dh: { type: 'string', minLength: 1, maxLength: 255 },
        auth: { type: 'string', minLength: 1, maxLength: 255 },
      },
    },
  },
} as const

const corpoRemocao = {
  type: 'object',
  required: ['endpoint'],
  additionalProperties: false,
  properties: { endpoint: { type: 'string', minLength: 1, maxLength: 2000 } },
} as const

type CorpoInscricao = { endpoint: string; chaves: { p256dh: string; auth: string } }

export async function rotasPush(app: FastifyInstance): Promise<void> {
  const somenteGestor = { preHandler: [autenticar, exigirPapel(Papel.GESTOR)] }

  // A chave **pública**, que o navegador exige para se inscrever. Servida por
  // rota autenticada em vez de embutida no bundle: trocar o par VAPID no
  // servidor da loja passa a ser um reinício, e não um rebuild do frontend.
  app.get('/push/chave-publica', somenteGestor, async (_request, reply) => {
    const chaves = chavesVapid()
    if (!chaves) return reply.code(503).send(NAO_CONFIGURADO)

    return { chavePublica: chaves.chavePublica }
  })

  app.post<{ Body: CorpoInscricao }>(
    '/push/inscricoes',
    { ...somenteGestor, schema: { body: corpoInscricao } },
    async (request, reply) => {
      if (!chavesVapid()) return reply.code(503).send(NAO_CONFIGURADO)

      const { criada, inscricao } = await inscreverDispositivo(request.body, request.usuario.id)

      // 200 na reinscrição do mesmo aparelho: nada foi criado, as chaves só
      // foram trocadas. As duas chaves do aparelho **não** voltam na resposta.
      return reply.code(criada ? 201 : 200).send({ inscricao })
    },
  )

  app.delete<{ Body: { endpoint: string } }>(
    '/push/inscricoes',
    { ...somenteGestor, schema: { body: corpoRemocao } },
    async (request, reply) => {
      if (!chavesVapid()) return reply.code(503).send(NAO_CONFIGURADO)

      await desinscreverDispositivo(request.body.endpoint)

      // 204 também para endpoint desconhecido: o estado desejado ("este
      // aparelho não recebe notificação") já vale, e o navegador pode ter
      // cancelado a inscrição antes de a tela avisar o servidor.
      return reply.code(204).send()
    },
  )
}
