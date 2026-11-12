import { Prisma, StatusUnidade } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { faixaDosDias, type Faixa } from '../dashboard/dashboard.service.js'
import { PADRAO_CODIGO_QR, normalizarCodigoQr } from '../unidade/codigoQr.js'
import {
  consultarUnidade,
  diasAteAValidade,
  type Consulta,
  type SituacaoDaValidade,
} from '../unidade/consulta.service.js'

/**
 * A busca da tela Consultar produto (T49): um campo só, que aceita o código da
 * etiqueta da unidade (T32) ou o nome, a marca e o código de barras do
 * produto, e o estoque do produto achado.
 *
 * Como a consulta de T32, só lê: não passa por `validarSaidaFifo`, não trava
 * linha e não grava `EventoLog` (o motivo está em
 * `modules/unidade/consulta.service.ts`). Contrato:
 * `tasks/T49-consulta-por-produto.md`.
 */

/** Quantos produtos a busca devolve por vez: é uma lista de escolha, não o catálogo. */
export const LIMITE_DE_PRODUTOS = 20

export type ProdutoNaConsulta = {
  id: string
  codigoInterno: string
  nome: string
  marca: string
  categoria: string
  ativo: boolean
  /** Unidades `EM_ESTOQUE` do produto agora. */
  emEstoque: number
}

export type ResultadoDaBusca =
  | { tipo: 'UNIDADE'; consulta: Consulta }
  | { tipo: 'PRODUTOS'; produtos: ProdutoNaConsulta[]; total: number }

export type UnidadeEmEstoque = {
  id: string
  codigoQr: string
  /** Data de calendário `AAAA-MM-DD` (RNF01). */
  dataValidade: string
  /** Instante do cadastro. */
  dataEntrada: string
  /** Negativo depois de vencida. */
  diasParaVencer: number
  situacao: SituacaoDaValidade
  /** A faixa do dashboard (T20), que dá a cor do distintivo na tela (T40). */
  faixa: Faixa
}

export type EstoqueDoProduto = {
  produto: Omit<ProdutoNaConsulta, 'emEstoque'>
  unidades: UnidadeEmEstoque[]
}

const CAMPOS_DO_PRODUTO = {
  id: true,
  codigoInterno: true,
  nome: true,
  marca: true,
  categoria: true,
  ativo: true,
  _count: { select: { unidades: { where: { status: StatusUnidade.EM_ESTOQUE } } } },
} satisfies Prisma.ProdutoSelect

type ProdutoComContagem = Prisma.ProdutoGetPayload<{ select: typeof CAMPOS_DO_PRODUTO }>

/**
 * A ordem dos passos é a do que o termo pode ser, do mais específico ao mais
 * vago:
 *
 * 1. **Código de etiqueta.** Só este módulo, por `codigoQr.ts`, sabe o formato
 *    (provisório até T16); a tela não o repete. Código no formato e sem
 *    unidade cai na busca de produto, que em geral não acha nada — e a tela
 *    diz isso.
 * 2. **Código interno exato**, normalizado como no cadastro: é o código de
 *    barras lido na embalagem, e "contém" traria também os produtos cujo
 *    código só começa com os mesmos dígitos.
 * 3. **Nome, marca ou código interno contendo o termo**, sem diferença de
 *    caixa. Os inativos entram: a unidade em estoque de produto inativo ainda
 *    é vendida (T39), e a pergunta da consulta é o que existe na loja.
 */
export async function buscarNaConsulta(termo: string): Promise<ResultadoDaBusca> {
  const texto = termo.trim()
  if (texto === '') return { tipo: 'PRODUTOS', produtos: [], total: 0 }

  if (PADRAO_CODIGO_QR.test(normalizarCodigoQr(texto))) {
    const unidade = await consultarUnidade(texto)
    if (unidade.ok) return { tipo: 'UNIDADE', consulta: unidade.consulta }
  }

  const exato = await prisma.produto.findUnique({
    where: { codigoInterno: texto.toUpperCase() },
    select: CAMPOS_DO_PRODUTO,
  })
  if (exato) return { tipo: 'PRODUTOS', produtos: [naConsulta(exato)], total: 1 }

  const where: Prisma.ProdutoWhereInput = {
    OR: [
      { nome: { contains: texto, mode: 'insensitive' } },
      { marca: { contains: texto, mode: 'insensitive' } },
      { codigoInterno: { contains: texto, mode: 'insensitive' } },
    ],
  }
  const [produtos, total] = await Promise.all([
    prisma.produto.findMany({
      where,
      select: CAMPOS_DO_PRODUTO,
      orderBy: [{ nome: 'asc' }, { codigoInterno: 'asc' }],
      take: LIMITE_DE_PRODUTOS,
    }),
    prisma.produto.count({ where }),
  ])

  return { tipo: 'PRODUTOS', produtos: produtos.map(naConsulta), total }
}

/**
 * O produto e as unidades que estão na loja agora, em ordem de validade e, no
 * empate, de código — a ordem de leitura de uma lista de datas, e não um
 * veredito: a lista **não** marca a próxima a sair, porque isso é decisão de
 * `validarSaidaFifo` (RNF03, T32 decisão 2). Dias, situação e faixa saem
 * daqui, como no cartão da unidade, e a tela não compara data (RNF01, RNF04).
 */
export async function estoqueDoProduto(id: string): Promise<EstoqueDoProduto | null> {
  const produto = await prisma.produto.findUnique({
    where: { id },
    select: { id: true, codigoInterno: true, nome: true, marca: true, categoria: true, ativo: true },
  })
  if (!produto) return null

  const unidades = await prisma.unidadeProduto.findMany({
    where: { produtoId: id, status: StatusUnidade.EM_ESTOQUE },
    orderBy: [{ dataValidade: 'asc' }, { codigoQr: 'asc' }],
  })

  return {
    produto,
    unidades: unidades.map((unidade) => {
      const diasParaVencer = diasAteAValidade(unidade.dataValidade)
      return {
        id: unidade.id,
        codigoQr: unidade.codigoQr,
        dataValidade: unidade.dataValidade.toISOString().slice(0, 10),
        dataEntrada: unidade.dataEntrada.toISOString(),
        diasParaVencer,
        // A mesma borda do cartão da unidade e do pool do FIFO: o que vence
        // hoje ainda está no prazo.
        situacao: diasParaVencer < 0 ? 'VENCIDA' : 'NO_PRAZO',
        faixa: faixaDosDias(diasParaVencer),
      }
    }),
  }
}

function naConsulta({ _count, ...produto }: ProdutoComContagem): ProdutoNaConsulta {
  return { ...produto, emEstoque: _count.unidades }
}
