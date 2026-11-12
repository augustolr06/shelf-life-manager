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
  /** Até 500, o teto do servidor. O padrão do servidor é 100. */
  tamanhoPagina?: number
}

export async function listarEtiquetas(
  produtoId: string,
  filtros: FiltrosEtiquetas = {},
): Promise<FolhaDeEtiquetas> {
  const parametros = new URLSearchParams()
  // Mesma regra de `listarProdutos`: parâmetro no padrão é omitido, para que a
  // primeira página seja a URL simples da folha.
  if (filtros.pagina && filtros.pagina > 1) parametros.set('pagina', String(filtros.pagina))
  if (filtros.tamanhoPagina) parametros.set('tamanhoPagina', String(filtros.tamanhoPagina))
  for (const id of filtros.unidadeIds ?? []) parametros.append('unidadeIds', id)

  const consulta = parametros.toString()
  return requisitarApi<FolhaDeEtiquetas>(
    `/produtos/${produtoId}/unidades/etiquetas${consulta ? `?${consulta}` : ''}`,
  )
}

/**
 * Quais produtos entram na folha de vários produtos (T50): os escolhidos, ou
 * todos os que têm unidade em estoque.
 */
export type EscopoDeEtiquetas = { produtoIds: string[] } | { todos: true }

/**
 * Espelho de `POST /unidades/etiquetas` (T50). É `POST` embora seja leitura:
 * a lista de produtos pode ter centenas de UUIDs, longa demais para uma URL.
 *
 * A resposta é a mesma `FolhaDeEtiquetas` da folha de um produto. Ela já vem
 * na ordem marca → nome → validade, com os grupos contíguos, e o frontend não
 * reordena nada.
 */
export function listarEtiquetasDeVariosProdutos(
  escopo: EscopoDeEtiquetas,
  pagina: number,
  tamanhoPagina: number = TAMANHO_PAGINA_MAXIMO,
): Promise<FolhaDeEtiquetas> {
  return requisitarApi<FolhaDeEtiquetas>('/unidades/etiquetas', {
    method: 'POST',
    body: JSON.stringify({ ...escopo, pagina, tamanhoPagina }),
  })
}

/** O teto de página do servidor (`MAXIMO_UNIDADES` em `unidade.routes.ts`). */
export const TAMANHO_PAGINA_MAXIMO = 500

/**
 * Busca todas as páginas de uma folha, em sequência, e devolve as etiquetas
 * juntas (T50).
 *
 * O servidor pagina por causa do limite de tamanho de resposta da hospedagem,
 * mas o PDF é um arquivo só. A objeção de T15 a juntar páginas (imprimir algo
 * que não está na tela) não vale mais: o que se imprime agora é o próprio PDF.
 *
 * Em sequência, e não em paralelo: só a primeira resposta diz o `total`, e
 * dezenas de pedidos simultâneos de três mil símbolos seriam carga à toa
 * sobre um servidor que atende também o balcão.
 */
export async function carregarFolhaCompleta(
  buscarPagina: (pagina: number) => Promise<FolhaDeEtiquetas>,
  aoProgredir?: (carregadas: number, total: number) => void,
): Promise<Etiqueta[]> {
  const etiquetas: Etiqueta[] = []
  for (let pagina = 1; ; pagina++) {
    const folha = await buscarPagina(pagina)
    etiquetas.push(...folha.etiquetas)
    aoProgredir?.(etiquetas.length, folha.total)
    // Página vazia também encerra: se o estoque mudou entre os pedidos e o
    // total ficou maior que o que existe, o laço não roda para sempre.
    if (etiquetas.length >= folha.total || folha.etiquetas.length === 0) return etiquetas
  }
}
