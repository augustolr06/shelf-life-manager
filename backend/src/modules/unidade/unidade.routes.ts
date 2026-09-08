import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import { listarEtiquetas } from './etiqueta.service.js'
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

/**
 * Uma folha de impressão cabe um recebimento inteiro: o teto de página é o
 * mesmo `MAXIMO_UNIDADES` do lote, para que quem acabou de cadastrar 500
 * unidades consiga imprimir as 500 etiquetas numa requisição só.
 */
const TAMANHO_FOLHA_PADRAO = 100

const consultaEtiquetas = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pagina: { type: 'integer', minimum: 1, default: 1 },
    tamanhoPagina: {
      type: 'integer',
      minimum: 1,
      maximum: MAXIMO_UNIDADES,
      default: TAMANHO_FOLHA_PADRAO,
    },
    // Repetível na query (`?unidadeIds=a&unidadeIds=b`). Sem ele, a folha é o
    // estoque inteiro do SKU — ver `etiqueta.service.ts`.
    unidadeIds: {
      type: 'array',
      maxItems: MAXIMO_UNIDADES,
      items: { type: 'string', format: 'uuid' },
    },
  },
} as const

type ConsultaEtiquetas = {
  pagina: number
  tamanhoPagina: number
  unidadeIds?: string[]
}

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

  /**
   * As etiquetas imprimíveis do produto (RF04). Também `GESTOR`: etiquetar é a
   * continuação do recebimento, não fluxo de balcão.
   *
   * Consultar não grava evento — mesma leitura de T13 para a fila de descarte.
   * A consequência honesta é que o sistema não sabe quantas vezes uma etiqueta
   * foi reimpressa, dado que interessaria à RNF08; está registrado como
   * limitação em `docs/notas-para-artigo.md`.
   */
  app.get<{ Params: { id: string }; Querystring: ConsultaEtiquetas }>(
    '/produtos/:id/unidades/etiquetas',
    { ...somenteGestor, schema: { params: parametrosId, querystring: consultaEtiquetas } },
    async (request, reply) => {
      const resultado = await listarEtiquetas(request.params.id, {
        pagina: request.query.pagina,
        tamanhoPagina: request.query.tamanhoPagina,
        unidadeIds: request.query.unidadeIds,
      })

      if (!resultado.ok) return reply.code(STATUS[resultado.motivo]).send(FALHAS[resultado.motivo])

      // Produto sem nada a etiquetar é 200 com lista vazia, nunca 404: é o
      // estado de quem já imprimiu tudo.
      return resultado.folha
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
