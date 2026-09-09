import { requisitarApi } from './api'
import type { UnidadeLida } from './saidas'

/**
 * As etiquetas imprimíveis de um produto (RF04, T14 no backend).
 *
 * Como os outros módulos de serviço, este só espelha o que
 * `etiqueta.service.ts` devolve. O símbolo QR chega **pronto** do servidor, em
 * SVG: o frontend não gera QR, não escolhe nível de correção e não decide a
 * ordem da folha — quem faz isso é `simboloQr.ts`, dono único do símbolo.
 *
 * O que é decisão desta camada da aplicação, e só dela, é o tamanho em
 * milímetros com que o símbolo vai ao papel (T15) — porque isso é impressão,
 * não dado.
 */

export type Etiqueta = UnidadeLida & {
  /** SVG do símbolo, sem largura nem altura: quem dimensiona é a folha. */
  svg: string
}

export type FolhaDeEtiquetas = {
  etiquetas: Etiqueta[]
  /** O conjunto inteiro, não a página: é quantas etiquetas faltam imprimir. */
  total: number
  pagina: number
  tamanhoPagina: number
}

export type FiltrosEtiquetas = {
  /**
   * Restringe às unidades pedidas — é como a tela de recebimento imprime
   * exatamente o lote que acabou de cadastrar, em vez do estoque inteiro do
   * SKU. Vai repetido na query (`?unidadeIds=a&unidadeIds=b`), que é o formato
   * que o schema da rota espera.
   */
  unidadeIds?: string[]
  pagina?: number
}

export async function listarEtiquetas(
  produtoId: string,
  filtros: FiltrosEtiquetas = {},
): Promise<FolhaDeEtiquetas> {
  const parametros = new URLSearchParams()
  // Mesma regra de `listarProdutos`: parâmetro no padrão é omitido, para que a
  // primeira página seja a URL simples da folha.
  if (filtros.pagina && filtros.pagina > 1) parametros.set('pagina', String(filtros.pagina))
  for (const id of filtros.unidadeIds ?? []) parametros.append('unidadeIds', id)

  const consulta = parametros.toString()
  return requisitarApi<FolhaDeEtiquetas>(
    `/produtos/${produtoId}/unidades/etiquetas${consulta ? `?${consulta}` : ''}`,
  )
}
