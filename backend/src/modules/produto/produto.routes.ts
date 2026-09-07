import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import {
  atualizarProduto,
  buscarProduto,
  criarProduto,
  inativarProduto,
  listarProdutos,
  type DadosProduto,
} from './produto.service.js'

const TAMANHO_PAGINA_PADRAO = 20
const TAMANHO_PAGINA_MAXIMO = 100

const campoTexto = { type: 'string', minLength: 1, maxLength: 120 } as const

const corpoCriacao = {
  type: 'object',
  required: ['codigoInterno', 'nome', 'marca', 'categoria'],
  additionalProperties: false,
  properties: {
    codigoInterno: campoTexto,
    nome: campoTexto,
    marca: campoTexto,
    categoria: campoTexto,
  },
} as const

const corpoAtualizacao = {
  type: 'object',
  // Ao menos um campo: `PATCH` com corpo vazio é engano de quem chama, não
  // uma atualização de nada.
  minProperties: 1,
  additionalProperties: false,
  properties: {
    codigoInterno: campoTexto,
    nome: campoTexto,
    marca: campoTexto,
    categoria: campoTexto,
    // Reativar é o desfazer do `DELETE`. Sem isto, uma inativação por engano
    // não teria como ser corrigida pela API.
    ativo: { type: 'boolean' },
  },
} as const

const parametrosId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const

const consultaListagem = {
  type: 'object',
  additionalProperties: false,
  properties: {
    busca: { type: 'string', maxLength: 120 },
    incluirInativos: { type: 'boolean', default: false },
    pagina: { type: 'integer', minimum: 1, default: 1 },
    tamanhoPagina: {
      type: 'integer',
      minimum: 1,
      maximum: TAMANHO_PAGINA_MAXIMO,
      default: TAMANHO_PAGINA_PADRAO,
    },
  },
} as const

type ConsultaListagem = {
  busca?: string
  incluirInativos: boolean
  pagina: number
  tamanhoPagina: number
}

const CONFLITO_CODIGO = {
  erro: 'CODIGO_INTERNO_EM_USO',
  mensagem: 'Já existe um produto com esse código interno.',
}

const NAO_ENCONTRADO = {
  erro: 'PRODUTO_NAO_ENCONTRADO',
  mensagem: 'Produto não encontrado.',
}

export async function rotasProduto(app: FastifyInstance): Promise<void> {
  // Tudo aqui exige sessão; a escrita exige ainda o papel GESTOR (RF02).
  const somenteGestor = { preHandler: [autenticar, exigirPapel(Papel.GESTOR)] }
  const qualquerAutenticado = { preHandler: autenticar }

  app.post<{ Body: DadosProduto }>(
    '/produtos',
    { ...somenteGestor, schema: { body: corpoCriacao } },
    async (request, reply) => {
      const resultado = await criarProduto(request.body)

      if (!resultado.ok) return reply.code(409).send(CONFLITO_CODIGO)

      return reply.code(201).send({ produto: resultado.produto })
    },
  )

  app.get<{ Querystring: ConsultaListagem }>(
    '/produtos',
    { ...qualquerAutenticado, schema: { querystring: consultaListagem } },
    async (request) => {
      const { busca, incluirInativos, pagina, tamanhoPagina } = request.query
      return listarProdutos({ busca, incluirInativos, pagina, tamanhoPagina })
    },
  )

  app.get<{ Params: { id: string } }>(
    '/produtos/:id',
    { ...qualquerAutenticado, schema: { params: parametrosId } },
    async (request, reply) => {
      const produto = await buscarProduto(request.params.id)

      if (!produto) return reply.code(404).send(NAO_ENCONTRADO)

      return { produto }
    },
  )

  app.patch<{ Params: { id: string }; Body: Partial<DadosProduto> & { ativo?: boolean } }>(
    '/produtos/:id',
    { ...somenteGestor, schema: { params: parametrosId, body: corpoAtualizacao } },
    async (request, reply) => {
      const resultado = await atualizarProduto(request.params.id, request.body)

      if (!resultado.ok) {
        return resultado.motivo === 'CODIGO_INTERNO_EM_USO'
          ? reply.code(409).send(CONFLITO_CODIGO)
          : reply.code(404).send(NAO_ENCONTRADO)
      }

      return { produto: resultado.produto }
    },
  )

  // Inativa (`ativo = false`); nunca exclui fisicamente — ver o serviço e
  // `docs/decisoes.md` (2026-09-07). Responde com o produto para que a
  // interface confirme o novo estado sem uma segunda requisição.
  app.delete<{ Params: { id: string } }>(
    '/produtos/:id',
    { ...somenteGestor, schema: { params: parametrosId } },
    async (request, reply) => {
      const produto = await inativarProduto(request.params.id)

      if (!produto) return reply.code(404).send(NAO_ENCONTRADO)

      return { produto }
    },
  )
}
