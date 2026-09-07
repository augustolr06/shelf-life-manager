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
