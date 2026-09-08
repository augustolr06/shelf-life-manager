import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import { cadastrarUnidades, contarUnidades, type ItemLote } from './unidade.service.js'

/**
 * Tetos do lote. Um recebimento da perfumaria tem dezenas de unidades, não
 * milhares (RNF10); os limites existem para que um engano de digitação não
 * gere quinhentas etiquetas nem segure uma transação longa demais.
 */
const MAXIMO_LINHAS = 50
const MAXIMO_POR_LINHA = 200
const MAXIMO_UNIDADES = 500

const corpoLote = {
  type: 'object',
  required: ['unidades'],
  additionalProperties: false,
  properties: {
    unidades: {
      type: 'array',
      minItems: 1,
      maxItems: MAXIMO_LINHAS,
      items: {
        type: 'object',
        required: ['dataValidade'],
        // Fecha a porta para o cliente propor `status` ou `codigoQr`: os dois
        // são decisão do servidor (status inicial EM_ESTOQUE, código gerado
        // em `codigoQr.ts`).
        additionalProperties: false,
        properties: {
          // `format: 'date'` recusa `2027-02-30` e qualquer coisa que não seja
          // `YYYY-MM-DD`. Data sem hora, como exige a RNF01.
          dataValidade: { type: 'string', format: 'date' },
          quantidade: {
            type: 'integer',
            minimum: 1,
            maximum: MAXIMO_POR_LINHA,
            default: 1,
          },
        },
      },
    },
  },
} as const

const parametrosId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const

export async function rotasUnidade(app: FastifyInstance): Promise<void> {
  // Recebimento de mercadoria é atribuição de gestão (RF03).
  const somenteGestor = { preHandler: [autenticar, exigirPapel(Papel.GESTOR)] }

  app.post<{ Params: { id: string }; Body: { unidades: ItemLote[] } }>(
    '/produtos/:id/unidades',
    { ...somenteGestor, schema: { params: parametrosId, body: corpoLote } },
    async (request, reply) => {
      const { unidades } = request.body

      // O teto do total não é expressável em JSON Schema: ele depende da soma
      // das quantidades, não do tamanho do array.
      if (contarUnidades(unidades) > MAXIMO_UNIDADES) {
        return reply.code(400).send({
          erro: 'LOTE_MUITO_GRANDE',
          mensagem: `Um recebimento aceita no máximo ${MAXIMO_UNIDADES} unidades por vez.`,
        })
      }

      const resultado = await cadastrarUnidades(
        request.params.id,
        unidades,
        // Toda unidade é atribuível a quem a registrou (RF01) — vem da sessão,
        // nunca do corpo da requisição.
        request.usuario.id,
      )

      if (!resultado.ok) return reply.code(STATUS[resultado.motivo]).send(FALHAS[resultado.motivo])

      return reply.code(201).send({ unidades: resultado.unidades, avisos: resultado.avisos })
    },
  )
}

const FALHAS = {
  PRODUTO_NAO_ENCONTRADO: {
    erro: 'PRODUTO_NAO_ENCONTRADO',
    mensagem: 'Produto não encontrado.',
  },
  PRODUTO_INATIVO: {
    erro: 'PRODUTO_INATIVO',
    mensagem: 'Este produto está inativo. Reative-o no catálogo antes de receber unidades.',
  },
  CODIGO_QR_INDISPONIVEL: {
    erro: 'CODIGO_QR_INDISPONIVEL',
    mensagem: 'Não foi possível gerar códigos únicos para o lote. Tente novamente.',
  },
} as const

const STATUS = {
  PRODUTO_NAO_ENCONTRADO: 404,
  PRODUTO_INATIVO: 409,
  // 503, não 500: é uma falha transitória de geração, e repetir a requisição
  // tende a funcionar.
  CODIGO_QR_INDISPONIVEL: 503,
} as const
