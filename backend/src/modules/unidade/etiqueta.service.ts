import { StatusUnidade } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { gerarSimboloSvg } from './simboloQr.js'
import { comProdutoJaLido, type UnidadeNaResposta } from './unidadeNaResposta.js'

/**
 * As etiquetas imprimíveis de um produto (RF04).
 *
 * O que este módulo entrega é o **dado da etiqueta** — a unidade, sua validade
 * e o símbolo QR pronto. Como isso vira papel colado no frasco (tamanho em
 * milímetros, folha, margens, o que aparece ao lado do símbolo) é T15: aqui não
 * há nenhuma decisão de layout.
 *
 * **Só o que está `EM_ESTOQUE`.** Unidade vendida ou descartada não tem frasco
 * na prateleira para receber etiqueta. Já a unidade **vencida** entra
 * normalmente: o frasco existe, e quem decide o destino dele são os três
 * caminhos da seção 6.1 do PRD, não a impressão.
 */

export type Etiqueta = UnidadeNaResposta & {
  /** SVG do símbolo QR, dimensionado por quem imprime (T15). */
  svg: string
}

export type FolhaDeEtiquetas = {
  etiquetas: Etiqueta[]
  /** O conjunto inteiro, não a página: é quantas etiquetas faltam imprimir. */
  total: number
  pagina: number
  tamanhoPagina: number
}

export type FiltrosDeEtiquetas = {
  pagina: number
  tamanhoPagina: number
  /**
   * Restringe às unidades pedidas — o caso de uso principal: a tela de
   * recebimento acabou de cadastrar um lote, tem os ids na resposta do `POST` e
   * quer as etiquetas **daqueles** frascos, não de todo o estoque do SKU.
   *
   * Não existe entidade `Lote` no modelo (decisão de T05), então esta é a única
   * expressão honesta de "o que acabou de chegar". Id que não pertence ao
   * produto ou que já saiu do estoque é ignorado, não é erro: a lista vem de
   * uma tela que pode estar desatualizada, e recusar a folha inteira por causa
   * de um frasco vendido no meio-tempo faria a gestora perder as outras.
   */
  unidadeIds?: string[]
}

export type ResultadoEtiquetas =
  | { ok: true; folha: FolhaDeEtiquetas }
  | { ok: false; motivo: 'PRODUTO_NAO_ENCONTRADO' }

export async function listarEtiquetas(
  produtoId: string,
  filtros: FiltrosDeEtiquetas,
): Promise<ResultadoEtiquetas> {
  const produto = await prisma.produto.findUnique({ where: { id: produtoId } })
  if (!produto) return { ok: false, motivo: 'PRODUTO_NAO_ENCONTRADO' }

  // Produto inativo **não** é recusado aqui, ao contrário do cadastro de
  // unidades: inativar o SKU no catálogo não devolve à fábrica o frasco que
  // está na prateleira, e reimprimir a etiqueta rasgada dele continua legítimo.
  // Mesma leitura que a fila de descarte de T13 faz do produto inativo.

  const { pagina, tamanhoPagina, unidadeIds } = filtros

  const where = {
    produtoId,
    status: StatusUnidade.EM_ESTOQUE,
    ...(unidadeIds ? { id: { in: unidadeIds } } : {}),
  }

  const [unidades, total] = await Promise.all([
    prisma.unidadeProduto.findMany({
      where,
      // A mesma ordem da fila de T13, e pelo mesmo motivo: a folha impressa sai
      // na ordem em que os frascos serão consumidos, e o desempate por
      // `codigoQr` (único) mantém a paginação estável.
      orderBy: [{ dataValidade: 'asc' }, { codigoQr: 'asc' }],
      skip: (pagina - 1) * tamanhoPagina,
      take: tamanhoPagina,
    }),
    prisma.unidadeProduto.count({ where }),
  ])

  const etiquetas = await Promise.all(
    unidades.map(async (unidade) => ({
      ...comProdutoJaLido(unidade, produto),
      svg: await gerarSimboloSvg(unidade.codigoQr),
    })),
  )

  return { ok: true, folha: { etiquetas, total, pagina, tamanhoPagina } }
}
