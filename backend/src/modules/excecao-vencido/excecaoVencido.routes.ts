import { Papel } from '@prisma/client'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import {
  autorizarVendaVencida,
  corrigirValidade,
  descartarUnidade,
  type FalhaExcecao,
} from './excecaoVencido.service.js'

/**
 * Os três caminhos da seção 6.1 do PRD, expostos como três endpoints
 * (`docs/arquitetura.md` seção 5).
 *
 * A escolha entre eles é da pessoa no balcão, não da tela nem do servidor: são
 * três ações distintas sobre a mesma unidade, e cada uma tem seu papel mínimo.
 * O servidor não decide qual seguir — só recusa o que é impossível.
 *
 * **O override é o mais restrito de propósito.** Ele não é o botão primário da
 * tela (T12), exige `GESTOR` e exige justificativa: comercializar produto com
 * validade expirada é vedado pela legislação de defesa do consumidor, e o
 * `EventoLog` é imutável — o registro do ato é permanente.
 */

/** A unidade sempre vem pelo `id` que o veredito `EXCECAO_VENCIDO` devolveu. */
const unidadeAlvo = { type: 'string', format: 'uuid' } as const

/** Mesmo agrupador opcional de atendimento de `/saidas/ler` (T09, PRD seção 5). */
const agrupador = { type: 'string', format: 'uuid' } as const

const MAXIMO_MOTIVO = 280

/**
 * Justificativa de override: 10 caracteres é o suficiente para recusar "ok" sem
 * virar redação. O mínimo existe porque este texto é a única explicação
 * permanente de uma venda de produto vencido.
 */
const MINIMO_JUSTIFICATIVA = 10
const MAXIMO_JUSTIFICATIVA = 500

const corpoCorrecao = {
  type: 'object',
  required: ['unidadeId', 'dataValidade'],
  additionalProperties: false,
  properties: {
    unidadeId: unidadeAlvo,
    // `format: 'date'` recusa `2027-02-30` e qualquer coisa que não seja
    // `AAAA-MM-DD`: data de calendário, sem hora (RNF01).
    dataValidade: { type: 'string', format: 'date' },
    sessaoVendaId: agrupador,
  },
} as const

const corpoDescarte = {
  type: 'object',
  required: ['unidadeId'],
  additionalProperties: false,
  properties: {
    unidadeId: unidadeAlvo,
    motivo: { type: 'string', minLength: 1, maxLength: MAXIMO_MOTIVO },
    sessaoVendaId: agrupador,
  },
} as const

const corpoOverride = {
  type: 'object',
  required: ['unidadeId', 'justificativa'],
  additionalProperties: false,
  properties: {
    unidadeId: unidadeAlvo,
    justificativa: {
      type: 'string',
      minLength: MINIMO_JUSTIFICATIVA,
      maxLength: MAXIMO_JUSTIFICATIVA,
    },
    sessaoVendaId: agrupador,
  },
} as const

type CorpoCorrecao = { unidadeId: string; dataValidade: string; sessaoVendaId?: string }
type CorpoDescarte = { unidadeId: string; motivo?: string; sessaoVendaId?: string }
type CorpoOverride = { unidadeId: string; justificativa: string; sessaoVendaId?: string }

export async function rotasExcecaoVencido(app: FastifyInstance): Promise<void> {
  const somenteGestor = { preHandler: [autenticar, exigirPapel(Papel.GESTOR)] }

  // Caminho 1. Mexer na validade cadastrada é ato de gestão: a data é o que
  // ordena o pool inteiro do SKU, e corrigi-la reordena a fila.
  app.post<{ Body: CorpoCorrecao }>(
    '/excecao-vencido/corrigir',
    { ...somenteGestor, schema: { body: corpoCorrecao } },
    async (request, reply) => {
      const resultado = await corrigirValidade(
        request.body.unidadeId,
        request.body.dataValidade,
        request.usuario.id,
        request.body.sessaoVendaId,
      )

      if (!resultado.ok) return recusar(reply, resultado.motivo)

      // 200 e não 201: a correção altera uma unidade que já existia. O que a
      // tela lê é a `revalidacao`, no mesmo contrato de `/saidas/ler` (RNF04).
      return reply.code(200).send({
        correcao: resultado.correcao,
        revalidacao: resultado.revalidacao,
      })
    },
  )

  // Caminho 2. Constatar a perda é atribuição de quem está no balcão — a
  // atendente é quem tem o frasco vencido na mão.
  app.post<{ Body: CorpoDescarte }>(
    '/excecao-vencido/descartar',
    {
      preHandler: [autenticar, exigirPapel(Papel.ATENDENTE, Papel.GESTOR)],
      schema: { body: corpoDescarte },
    },
    async (request, reply) => {
      const resultado = await descartarUnidade(
        request.body.unidadeId,
        request.usuario.id,
        request.body.motivo,
        request.body.sessaoVendaId,
      )

      if (!resultado.ok) return recusar(reply, resultado.motivo)

      // 201: um `Descarte` passou a existir, como em qualquer criação de
      // recurso do sistema (T05). O `ok` interno não vai para o corpo — ele
      // discrimina o resultado no serviço, e o status HTTP já diz o mesmo.
      const { ok: _ok, ...corpo } = resultado
      return reply.code(201).send(corpo)
    },
  )

  // Caminho 3. Só GESTOR, e o papel é conferido antes de qualquer coisa: uma
  // tentativa de override por atendente não deve nem chegar ao banco.
  app.post<{ Body: CorpoOverride }>(
    '/excecao-vencido/override',
    { ...somenteGestor, schema: { body: corpoOverride } },
    async (request, reply) => {
      const resultado = await autorizarVendaVencida(
        request.body.unidadeId,
        // Quem autoriza é quem tem a sessão, nunca um id vindo do corpo: o
        // registro tem peso legal (PRD 6.1) e não pode ser atribuído a
        // terceiro pelo cliente.
        { id: request.usuario.id, nome: request.usuario.nome },
        request.body.justificativa,
        request.body.sessaoVendaId,
      )

      if (!resultado.ok) return recusar(reply, resultado.motivo)

      // 201: a `Saida` criada aqui é tão real quanto a da confirmação de FIFO
      // — a diferença está toda no `vendaDeUnidadeVencida` e na justificativa.
      const { ok: _ok, ...corpo } = resultado
      return reply.code(201).send(corpo)
    },
  )
}

/**
 * Falha de pré-condição é 4xx, e não veredito em 200 como em `/saidas/ler`.
 *
 * A assimetria é proposital. Uma leitura de QR é uma pergunta cuja resposta
 * pode ser "não pode" — isso é resultado, não falha (T08). Aqui a tela
 * **afirma** uma ação sobre uma unidade cujo estado ela julga conhecer; se o
 * estado não é esse, o pedido não se aplica, e 409 é a palavra exata para "o
 * recurso não está no estado que você supôs".
 */
function recusar(reply: FastifyReply, motivo: FalhaExcecao) {
  return reply.code(STATUS[motivo]).send(FALHAS[motivo])
}

const STATUS = {
  UNIDADE_NAO_ENCONTRADA: 404,
  UNIDADE_JA_BAIXADA: 409,
  UNIDADE_NAO_VENCIDA: 409,
  VALIDADE_INALTERADA: 400,
} as const

const FALHAS = {
  UNIDADE_NAO_ENCONTRADA: {
    erro: 'UNIDADE_NAO_ENCONTRADA',
    mensagem: 'Unidade não encontrada. Leia o QR novamente.',
  },
  UNIDADE_JA_BAIXADA: {
    erro: 'UNIDADE_JA_BAIXADA',
    mensagem: 'Esta unidade já saiu do estoque — foi vendida ou descartada. Nada a resolver.',
  },
  UNIDADE_NAO_VENCIDA: {
    erro: 'UNIDADE_NAO_VENCIDA',
    mensagem:
      'Esta unidade não está vencida. Os três caminhos da exceção valem apenas ' +
      'para unidade com validade expirada — a saída dela segue o fluxo normal de leitura.',
  },
  VALIDADE_INALTERADA: {
    erro: 'VALIDADE_INALTERADA',
    mensagem: 'A validade informada é igual à que já está cadastrada. Não há o que corrigir.',
  },
} as const
