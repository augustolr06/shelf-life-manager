import { Prisma, type Produto } from '@prisma/client'
import { prisma } from '../../db/prisma.js'

export type DadosProduto = {
  codigoInterno: string
  nome: string
  marca: string
  categoria: string
}

export type FiltrosListagem = {
  busca?: string | undefined
  incluirInativos: boolean
  pagina: number
  tamanhoPagina: number
}

export type PaginaDeProdutos = {
  produtos: Produto[]
  total: number
  pagina: number
  tamanhoPagina: number
}

/**
 * Motivos de falha previstos. Seguem a convenção do módulo de auth: o serviço
 * descreve o que aconteceu e quem chama decide o código HTTP — nenhuma
 * decisão de resposta vive aqui.
 */
export type FalhaEscrita = 'CODIGO_INTERNO_EM_USO' | 'PRODUTO_NAO_ENCONTRADO'

export type ResultadoEscrita =
  | { ok: true; produto: Produto }
  | { ok: false; motivo: FalhaEscrita }

/**
 * O `codigoInterno` é digitado à mão pela gestora. Sem normalizar, "prf-001"
 * e "PRF-001" seriam dois SKUs distintos para o Postgres, e o catálogo
 * ganharia duplicatas que a restrição de unicidade não pega.
 */
function normalizar(dados: DadosProduto): DadosProduto {
  return {
    codigoInterno: dados.codigoInterno.trim().toUpperCase(),
    nome: dados.nome.trim(),
    marca: dados.marca.trim(),
    categoria: dados.categoria.trim(),
  }
}

export async function criarProduto(dados: DadosProduto): Promise<ResultadoEscrita> {
  try {
    return { ok: true, produto: await prisma.produto.create({ data: normalizar(dados) }) }
  } catch (erro) {
    // Colisão detectada pela restrição `@unique` do banco, não por consulta
    // prévia: duas criações simultâneas passariam por um `findUnique`.
    if (ehViolacaoDeUnicidade(erro)) return { ok: false, motivo: 'CODIGO_INTERNO_EM_USO' }
    throw erro
  }
}

export async function listarProdutos(filtros: FiltrosListagem): Promise<PaginaDeProdutos> {
  const { busca, incluirInativos, pagina, tamanhoPagina } = filtros

  const where: Prisma.ProdutoWhereInput = {
    // Inativos ficam fora por padrão: o uso corrente do catálogo é operacional
    // (cadastrar unidade, vender), e produto inativo não participa disso.
    ...(incluirInativos ? {} : { ativo: true }),
    ...(busca
      ? {
          OR: [
            { nome: { contains: busca, mode: 'insensitive' } },
            { codigoInterno: { contains: busca, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [produtos, total] = await Promise.all([
    prisma.produto.findMany({
      where,
      orderBy: { nome: 'asc' },
      skip: (pagina - 1) * tamanhoPagina,
      take: tamanhoPagina,
    }),
    prisma.produto.count({ where }),
  ])

  return { produtos, total, pagina, tamanhoPagina }
}

export async function buscarProduto(id: string): Promise<Produto | null> {
  return prisma.produto.findUnique({ where: { id } })
}

export async function atualizarProduto(
  id: string,
  dados: Partial<DadosProduto> & { ativo?: boolean },
): Promise<ResultadoEscrita> {
  const alteracoes: Prisma.ProdutoUpdateInput = {
    ...(dados.codigoInterno !== undefined
      ? { codigoInterno: dados.codigoInterno.trim().toUpperCase() }
      : {}),
    ...(dados.nome !== undefined ? { nome: dados.nome.trim() } : {}),
    ...(dados.marca !== undefined ? { marca: dados.marca.trim() } : {}),
    ...(dados.categoria !== undefined ? { categoria: dados.categoria.trim() } : {}),
    ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
  }

  try {
    return { ok: true, produto: await prisma.produto.update({ where: { id }, data: alteracoes }) }
  } catch (erro) {
    if (ehViolacaoDeUnicidade(erro)) return { ok: false, motivo: 'CODIGO_INTERNO_EM_USO' }
    if (ehRegistroInexistente(erro)) return { ok: false, motivo: 'PRODUTO_NAO_ENCONTRADO' }
    throw erro
  }
}

/**
 * Inativação, nunca exclusão física (`docs/decisoes.md`, 2026-09-07): apagar
 * um produto levaria junto o histórico de unidades vendidas e descartadas que
 * sustenta a pesquisa, e deixaria o `EventoLog` — append-only por RNF05 —
 * apontando para um `produtoId` órfão.
 *
 * Idempotente: inativar duas vezes devolve o mesmo produto, sem erro.
 */
export async function inativarProduto(id: string): Promise<Produto | null> {
  const resultado = await atualizarProduto(id, { ativo: false })
  return resultado.ok ? resultado.produto : null
}

function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002'
}

function ehRegistroInexistente(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2025'
}
