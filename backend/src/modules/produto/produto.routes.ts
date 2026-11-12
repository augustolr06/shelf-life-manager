import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import {
  atualizarProduto,
  buscarProduto,
  criarProduto,
  inativarProduto,
  listarCategorias,
  listarProdutos,
  type DadosProduto,
} from './produto.service.js'
import { importarProdutos } from './importacao.service.js'
import { consultarCodigoDeBarras } from './codigoDeBarras.service.js'

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
    categoria: { type: 'string', maxLength: 120 },
    codigoInterno: { type: 'string', maxLength: 120 },
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

/**
 * O arquivo chega como texto, do jeito que está no disco: quem interpreta o
 * CSV é o servidor (T24, Decisão 3). O teto de bytes fica abaixo do limite de
 * corpo da Vercel (4,5 MB), com folga para 5.000 linhas de catálogo; o padrão
 * do Fastify, 1 MiB, recusaria uma planilha grande com um 413 sem explicação.
 */
const LIMITE_CORPO_IMPORTACAO = 4 * 1024 * 1024

const corpoImportacao = {
  type: 'object',
  required: ['conteudo'],
  additionalProperties: false,
  properties: {
    conteudo: { type: 'string', minLength: 1, maxLength: 3_500_000 },
  },
} as const

/**
 * O tamanho do código consultado (T47). Formato e dígito verificador ficam no
 * serviço, e não aqui, para a recusa sair com a mensagem do caso em vez da
 * genérica de schema; o teto só impede um parâmetro absurdo. 20 cobre o
 * GTIN-14 e os códigos próprios da loja (`SEMCOD-001`), que também são
 * procurados no catálogo.
 */
const parametrosCodigoDeBarras = {
  type: 'object',
  required: ['codigo'],
  properties: { codigo: { type: 'string', minLength: 1, maxLength: 20 } },
} as const

const MENSAGENS_CODIGO_INVALIDO = {
  FORMATO: 'O código de barras tem só números, com 8, 12, 13 ou 14 dígitos.',
  DIGITO_VERIFICADOR:
    'O último dígito não confere com os anteriores: o código de barras foi digitado errado. Confira e digite de novo.',
} as const

type ConsultaListagem = {
  busca?: string
  categoria?: string
  codigoInterno?: string
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

  // Importação do catálogo (T24). Código já cadastrado é pulado e devolvido em
  // `ignorados`; qualquer problema na planilha recusa o arquivo inteiro, sem
  // gravar nada, com a lista de linhas a corrigir.
  app.post<{ Body: { conteudo: string } }>(
    '/produtos/importar',
    { ...somenteGestor, bodyLimit: LIMITE_CORPO_IMPORTACAO, schema: { body: corpoImportacao } },
    async (request, reply) => {
      const resultado = await importarProdutos(request.body.conteudo)

      if (!resultado.ok) {
        return reply.code(400).send({
          erro: 'PLANILHA_INVALIDA',
          mensagem: 'A planilha tem problemas e nada foi importado. Corrija as linhas abaixo e envie de novo.',
          erros: resultado.erros,
        })
      }

      return { criados: resultado.criados, ignorados: resultado.ignorados }
    },
  )

  app.get<{ Querystring: ConsultaListagem }>(
    '/produtos',
    { ...qualquerAutenticado, schema: { querystring: consultaListagem } },
    async (request) => {
      const { busca, categoria, codigoInterno, incluirInativos, pagina, tamanhoPagina } =
        request.query
      return listarProdutos({ busca, categoria, codigoInterno, incluirInativos, pagina, tamanhoPagina })
    },
  )

  // Rota própria, e não um campo de `GET /produtos` (T45): a lista de
  // categorias não muda com a busca nem com a página, e a listagem sai a cada
  // pausa na digitação (T26). A tela pede uma vez ao abrir e de novo depois de
  // cadastrar ou importar. Estática, ganha de `/produtos/:id` no roteador.
  app.get('/produtos/categorias', qualquerAutenticado, async () => ({
    categorias: await listarCategorias(),
  }))

  // Consulta pelo código de barras para o cadastro (T47): o catálogo da loja e,
  // se o produto ainda não estiver nele, o catálogo externo. Só para GESTOR,
  // que é quem cadastra — e quem gasta a cota diária da fonte. O 200 cobre os
  // quatro desfechos previstos, inclusive não achar; o 400 é só para o código
  // que não pode ser um código de barras.
  app.get<{ Params: { codigo: string } }>(
    '/produtos/codigo-de-barras/:codigo',
    { ...somenteGestor, schema: { params: parametrosCodigoDeBarras } },
    async (request, reply) => {
      const resultado = await consultarCodigoDeBarras(request.params.codigo, request.log)

      if (resultado.situacao === 'CODIGO_INVALIDO') {
        return reply.code(400).send({
          erro: 'CODIGO_DE_BARRAS_INVALIDO',
          mensagem: MENSAGENS_CODIGO_INVALIDO[resultado.motivo],
        })
      }

      return resultado
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
