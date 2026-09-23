import { requisitarApi } from './api'

export type Produto = {
  id: string
  codigoInterno: string
  nome: string
  marca: string
  categoria: string
  ativo: boolean
}

export type DadosProduto = {
  codigoInterno: string
  nome: string
  marca: string
  categoria: string
}

export type PaginaDeProdutos = {
  produtos: Produto[]
  total: number
  pagina: number
  tamanhoPagina: number
}

export type FiltrosProduto = {
  busca?: string
  incluirInativos?: boolean
  pagina?: number
}

export async function listarProdutos(filtros: FiltrosProduto = {}): Promise<PaginaDeProdutos> {
  const parametros = new URLSearchParams()
  if (filtros.busca) parametros.set('busca', filtros.busca)
  if (filtros.incluirInativos) parametros.set('incluirInativos', 'true')
  if (filtros.pagina && filtros.pagina > 1) parametros.set('pagina', String(filtros.pagina))

  const consulta = parametros.toString()
  return requisitarApi<PaginaDeProdutos>(`/produtos${consulta ? `?${consulta}` : ''}`)
}

export async function criarProduto(dados: DadosProduto): Promise<Produto> {
  const { produto } = await requisitarApi<{ produto: Produto }>('/produtos', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
  return produto
}

/** `DELETE` inativa, nunca exclui — o backend é quem garante isso (RF02). */
export async function inativarProduto(id: string): Promise<Produto> {
  const { produto } = await requisitarApi<{ produto: Produto }>(`/produtos/${id}`, {
    method: 'DELETE',
  })
  return produto
}

export async function reativarProduto(id: string): Promise<Produto> {
  const { produto } = await requisitarApi<{ produto: Produto }>(`/produtos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ativo: true }),
  })
  return produto
}

export type ResultadoImportacao = {
  criados: number
  /** Códigos que já estavam cadastrados: pulados, e não alterados (T24). */
  ignorados: { linha: number; codigoInterno: string }[]
}

/**
 * Envia o texto da planilha como está. Quem interpreta o CSV e valida cada
 * linha é o servidor (T24, Decisão 3): a tela só mostra o que ele respondeu.
 */
export async function importarProdutos(conteudo: string): Promise<ResultadoImportacao> {
  return requisitarApi<ResultadoImportacao>('/produtos/importar', {
    method: 'POST',
    body: JSON.stringify({ conteudo }),
  })
}

/** A lista de linhas a corrigir que acompanha a recusa `PLANILHA_INVALIDA`. */
export function errosDaPlanilha(corpo: unknown): string[] {
  const erros = (corpo as { erros?: unknown } | null)?.erros
  return Array.isArray(erros) ? erros.filter((erro): erro is string => typeof erro === 'string') : []
}

/**
 * O texto de um arquivo CSV salvo pelo Excel, com os acentos certos.
 *
 * O Excel em português grava o "CSV (separado por vírgulas)" em Windows-1252,
 * e só o "CSV UTF-8" em UTF-8. Lido sempre como UTF-8, o primeiro vira
 * "Perfumaria Cl�ssica" no catálogo. Então tenta UTF-8 em modo estrito e, se
 * os bytes não forem UTF-8 válido, relê como Windows-1252 — que é o único
 * outro que um arquivo de planilha em pt-BR costuma ter.
 */
export async function lerTextoDaPlanilha(arquivo: Blob): Promise<string> {
  const bytes = await lerBytes(arquivo)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** `FileReader` em vez de `Blob.arrayBuffer()`, que navegadores mais antigos de celular não têm. */
function lerBytes(arquivo: Blob): Promise<ArrayBuffer> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader()
    leitor.onload = () => resolver(leitor.result as ArrayBuffer)
    leitor.onerror = () => rejeitar(leitor.error)
    leitor.readAsArrayBuffer(arquivo)
  })
}
