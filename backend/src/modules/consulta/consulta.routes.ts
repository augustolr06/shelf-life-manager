import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import { buscarNaConsulta, estoqueDoProduto } from './consulta.service.js'

/**
 * A busca da tela Consultar produto (T49). Das duas funções, como a consulta
 * de unidade de T32: saber o que existe na loja é pergunta de balcão.
 */

const consultaBusca = {
  type: 'object',
  required: ['termo'],
  additionalProperties: false,
  // O teto da busca do catálogo (T26).
  properties: { termo: { type: 'string', minLength: 1, maxLength: 120 } },
} as const

const parametrosId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const

export async function rotasConsulta(app: FastifyInstance): Promise<void> {
  const balcao = { preHandler: [autenticar, exigirPapel(Papel.ATENDENTE, Papel.GESTOR)] }

  // 200 sempre: um código de etiqueta achado volta como `UNIDADE`, todo o
  // resto como `PRODUTOS` — inclusive a lista vazia, que é a resposta comum de
  // uma busca que não achou nada, e não um erro.
  app.get<{ Querystring: { termo: string } }>(
    '/consulta/busca',
    { ...balcao, schema: { querystring: consultaBusca } },
    async (request) => buscarNaConsulta(request.query.termo),
  )

  app.get<{ Params: { id: string } }>(
    '/consulta/produtos/:id',
    { ...balcao, schema: { params: parametrosId } },
    async (request, reply) => {
      const estoque = await estoqueDoProduto(request.params.id)
      if (!estoque) {
        return reply
          .code(404)
          .send({ erro: 'PRODUTO_NAO_ENCONTRADO', mensagem: 'Produto não encontrado.' })
      }
      return estoque
    },
  )
}
