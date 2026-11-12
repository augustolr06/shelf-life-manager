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

/**
 * Quais produtos entram numa folha de vários produtos (T50): uma lista
 * escolhida pela gestora, ou todos os que têm unidade em estoque.
 */
export type EscopoDeEtiquetas = { produtoIds: string[] } | { todos: true }

/**
 * As etiquetas de vários produtos de uma vez (T50): a entrega mista, a
 * etiquetagem do estoque que já existe e a reimpressão avulsa.
 *
 * Devolve a mesma `FolhaDeEtiquetas` da folha de um produto só: cada etiqueta
 * já traz o produto, e é dele que a tela tira o cabeçalho de cada grupo. Um
 * tipo agrupado aqui seria uma segunda forma da mesma resposta.
 *
 * **A ordem é o que mantém os grupos inteiros.** Marca, nome e id do produto
 * (o id desempata dois produtos de nome e marca iguais, que de outro modo
 * poderiam se intercalar), e dentro dele a ordem FIFO da folha de T14. Com a
 * ordem total, a paginação não parte nem embaralha um grupo: a página seguinte
 * continua exatamente de onde a anterior parou.
 *
 * **Paginada, embora a saída seja um PDF só.** "Todos" pode passar de três mil
 * etiquetas, e a Vercel limita o corpo da resposta (cerca de 4,5 MB) e o tempo
 * de execução. Quem junta as páginas é a tela, antes de montar o PDF.
 *
 * Mesmas regras da folha de um produto: só `EM_ESTOQUE`, produto inativo
 * entra, e id que não existe é ignorado — a lista vem de uma tela que pode
 * estar desatualizada.
 */
export async function listarEtiquetasDeVariosProdutos(
  escopo: EscopoDeEtiquetas,
  paginacao: { pagina: number; tamanhoPagina: number },
): Promise<FolhaDeEtiquetas> {
  const { pagina, tamanhoPagina } = paginacao

  const where = {
    status: StatusUnidade.EM_ESTOQUE,
    ...('produtoIds' in escopo ? { produtoId: { in: escopo.produtoIds } } : {}),
  }

  const [unidades, total] = await Promise.all([
    prisma.unidadeProduto.findMany({
      where,
      include: { produto: true },
      orderBy: [
        { produto: { marca: 'asc' } },
        { produto: { nome: 'asc' } },
        { produtoId: 'asc' },
        { dataValidade: 'asc' },
        { codigoQr: 'asc' },
      ],
      skip: (pagina - 1) * tamanhoPagina,
      take: tamanhoPagina,
    }),
    prisma.unidadeProduto.count({ where }),
  ])

  const etiquetas = await Promise.all(
    unidades.map(async ({ produto, ...unidade }) => ({
      ...comProdutoJaLido(unidade, produto),
      svg: await gerarSimboloSvg(unidade.codigoQr),
    })),
  )

  return { etiquetas, total, pagina, tamanhoPagina }
}
