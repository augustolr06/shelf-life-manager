import { formatarData } from './datas'
import type { Etiqueta } from './etiquetas'

/**
 * O PDF de etiquetas de vários produtos (T50).
 *
 * Três partes, em ordem de pureza:
 *
 * 1. `agruparPorProduto`: corta a lista que veio do servidor em grupos, sem
 *    reordenar nada — a ordem marca → nome → validade é do servidor (RNF04).
 * 2. `montarLayout`: decide onde cada cabeçalho e cada etiqueta cai, em
 *    milímetros, página por página. É função pura, e é ela que os testes
 *    cobrem: jsdom não desenha PDF, mas confere coordenadas.
 * 3. `gerarPdfEtiquetas`: só desenha o layout. Carrega `jspdf` e `svg2pdf.js`
 *    por `import()` dinâmico, para que as bibliotecas só sejam baixadas por
 *    quem clica em "Gerar PDF", e não pesem na abertura do PWA.
 *
 * O símbolo continua vindo pronto do servidor, em SVG (`simboloQr.ts` é o
 * dono dele): aqui ele só é posto no papel, no tamanho escolhido.
 *
 * Por que PDF no navegador, e não mais `window.print()` como em T15: a folha
 * de "todos" passa de três mil etiquetas, que o navegador teria de montar como
 * elementos na tela para imprimir, e um arquivo baixado pode ser levado ao
 * computador que tem a impressora. Ver `docs/decisoes.md` (T50).
 */

/** Lado do símbolo em milímetros: as três opções de T15, à espera de T16. */
export const TAMANHOS_EM_MM = [15, 20, 25] as const
export type TamanhoEmMm = (typeof TAMANHOS_EM_MM)[number]
export const TAMANHO_PADRAO: TamanhoEmMm = 20

/** A4 retrato. */
export const LARGURA_PAGINA = 210
export const ALTURA_PAGINA = 297
export const MARGEM = 10
/** Faixa reservada ao rodapé, abaixo da área das etiquetas. */
export const ALTURA_RODAPE = 6
export const ALTURA_CABECALHO = 7
/** Espaço entre etiquetas, nas duas direções. */
export const ESPACO = 2
/** Espaço depois do último bloco de um produto, antes do cabeçalho do próximo. */
export const ESPACO_ENTRE_GRUPOS = 4

/**
 * Folga em volta do símbolo e as duas linhas de texto. A zona de silêncio de 4
 * módulos já vem dentro do `viewBox` (T14): a folga aqui é só o que a tesoura
 * precisa, como na folha de T15.
 */
const FOLGA_LATERAL = 2
const FOLGA_VERTICAL = 1
const ALTURA_TEXTO = 7

export function larguraDaEtiqueta(lado: TamanhoEmMm): number {
  return lado + 2 * FOLGA_LATERAL
}

export function alturaDaEtiqueta(lado: TamanhoEmMm): number {
  return FOLGA_VERTICAL + lado + ALTURA_TEXTO + FOLGA_VERTICAL
}

/** Quantas etiquetas cabem numa linha da largura útil da página. */
export function colunasPorLinha(lado: TamanhoEmMm): number {
  const util = LARGURA_PAGINA - 2 * MARGEM
  return Math.floor((util + ESPACO) / (larguraDaEtiqueta(lado) + ESPACO))
}

export type GrupoDeEtiquetas = {
  produto: Etiqueta['produto']
  etiquetas: Etiqueta[]
}

/**
 * Agrupa as etiquetas consecutivas do mesmo produto, na ordem em que chegaram.
 *
 * Consecutivas, e não "todas do mesmo id": o servidor já entrega cada produto
 * num bloco contíguo, e juntar blocos separados seria reordenar a folha por
 * conta própria.
 */
export function agruparPorProduto(etiquetas: Etiqueta[]): GrupoDeEtiquetas[] {
  const grupos: GrupoDeEtiquetas[] = []
  for (const etiqueta of etiquetas) {
    const ultimo = grupos.at(-1)
    if (ultimo && ultimo.produto.id === etiqueta.produto.id) ultimo.etiquetas.push(etiqueta)
    else grupos.push({ produto: etiqueta.produto, etiquetas: [etiqueta] })
  }
  return grupos
}

export type CabecalhoNoLayout = {
  tipo: 'cabecalho'
  x: number
  y: number
  texto: string
  continuacao: boolean
}

export type EtiquetaNoLayout = {
  tipo: 'etiqueta'
  /** Canto superior esquerdo da guia de corte. */
  x: number
  y: number
  largura: number
  altura: number
  etiqueta: Etiqueta
}

export type PaginaDoLayout = {
  itens: Array<CabecalhoNoLayout | EtiquetaNoLayout>
  rodape: string
}

/** "Marca — Nome · código · N etiquetas", o que separa um produto do outro. */
export function textoDoCabecalho(grupo: GrupoDeEtiquetas, continuacao: boolean): string {
  const { produto, etiquetas } = grupo
  const quantidade = `${etiquetas.length} ${etiquetas.length === 1 ? 'etiqueta' : 'etiquetas'}`
  const base = `${produto.marca} — ${produto.nome} · ${produto.codigoInterno} · ${quantidade}`
  return continuacao ? `${base} (continuação)` : base
}

/**
 * Onde cada cabeçalho e cada etiqueta cai, página por página, em milímetros.
 *
 * Duas regras de papel:
 * - **um cabeçalho nunca fica sozinho no pé da página**: se ele e a primeira
 *   linha de etiquetas não cabem juntos, o produto começa na página seguinte;
 * - **produto que atravessa a página repete o cabeçalho**, com
 *   "(continuação)": quem recorta a segunda página não tem a primeira à vista.
 *
 * O rodapé de cada página leva o tamanho do símbolo (T16 precisa saber de qual
 * tamanho é a folha que aprovou ou reprovou) e a numeração.
 */
export function montarLayout(grupos: GrupoDeEtiquetas[], lado: TamanhoEmMm): PaginaDoLayout[] {
  const largura = larguraDaEtiqueta(lado)
  const altura = alturaDaEtiqueta(lado)
  const colunas = colunasPorLinha(lado)
  const limiteInferior = ALTURA_PAGINA - MARGEM - ALTURA_RODAPE

  const paginas: Array<PaginaDoLayout['itens']> = []
  let itens: PaginaDoLayout['itens'] = []
  let y = MARGEM

  function novaPagina() {
    if (itens.length > 0) paginas.push(itens)
    itens = []
    y = MARGEM
  }

  function cabecalho(grupo: GrupoDeEtiquetas, continuacao: boolean) {
    itens.push({ tipo: 'cabecalho', x: MARGEM, y, texto: textoDoCabecalho(grupo, continuacao), continuacao })
    y += ALTURA_CABECALHO
  }

  for (const grupo of grupos) {
    // O cabeçalho só entra se a primeira linha couber logo abaixo dele.
    if (y + ALTURA_CABECALHO + altura > limiteInferior) novaPagina()
    cabecalho(grupo, false)

    for (let inicio = 0; inicio < grupo.etiquetas.length; inicio += colunas) {
      if (y + altura > limiteInferior) {
        novaPagina()
        cabecalho(grupo, true)
      }
      grupo.etiquetas.slice(inicio, inicio + colunas).forEach((etiqueta, coluna) => {
        itens.push({
          tipo: 'etiqueta',
          x: MARGEM + coluna * (largura + ESPACO),
          y,
          largura,
          altura,
          etiqueta,
        })
      })
      y += altura + ESPACO
    }

    y += ESPACO_ENTRE_GRUPOS
  }
  if (itens.length > 0) paginas.push(itens)

  return paginas.map((itensDaPagina, indice) => ({
    itens: itensDaPagina,
    rodape: `Símbolo de ${lado} mm · página ${indice + 1} de ${paginas.length}`,
  }))
}

/** Milímetros de fonte em pontos tipográficos, a unidade do jsPDF para texto. */
const PONTOS_POR_MM = 72 / 25.4

/**
 * Desenha o PDF e o entrega para download.
 *
 * Fontes padrão do PDF (Helvetica e Courier): não precisam ser embutidas, e
 * cobrem os acentos do português. Courier no código, como a fonte mono da
 * tela: é o texto que a atendente redigita quando a câmera falha (T10), e
 * `0`/`O` e `1`/`I` precisam se distinguir.
 */
export async function gerarPdfEtiquetas(
  grupos: GrupoDeEtiquetas[],
  lado: TamanhoEmMm,
  aoProgredir?: (desenhadas: number, total: number) => void,
): Promise<void> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])

  const paginas = montarLayout(grupos, lado)
  const total = grupos.reduce((soma, grupo) => soma + grupo.etiquetas.length, 0)
  const leitor = new DOMParser()
  const documento = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  documento.setProperties({ title: 'Etiquetas', creator: 'ShelfLife Manager' })

  let desenhadas = 0
  for (const [indice, pagina] of paginas.entries()) {
    if (indice > 0) documento.addPage()

    for (const item of pagina.itens) {
      if (item.tipo === 'cabecalho') {
        documento.setFont('helvetica', 'bold')
        documento.setFontSize(9)
        documento.setTextColor(0)
        // Nome longo não invade a margem: fica a primeira linha que cabe.
        const [linha] = documento.splitTextToSize(item.texto, LARGURA_PAGINA - 2 * MARGEM)
        documento.text(linha ?? item.texto, item.x, item.y + 4.5)
        continue
      }

      const { x, y, largura, altura, etiqueta } = item

      // Guia de corte: tracejado cinza fino, como na folha de T15.
      documento.setDrawColor(153)
      documento.setLineWidth(0.2)
      documento.setLineDashPattern([1, 1], 0)
      documento.roundedRect(x, y, largura, altura, 1, 1, 'S')
      documento.setLineDashPattern([], 0)

      const svg = leitor.parseFromString(etiqueta.svg, 'image/svg+xml').documentElement
      await svg2pdf(svg, documento, { x: x + FOLGA_LATERAL, y: y + FOLGA_VERTICAL, width: lado, height: lado })

      const centro = x + largura / 2
      const baseDoSimbolo = y + FOLGA_VERTICAL + lado
      documento.setTextColor(0)
      documento.setFont('courier', 'bold')
      documento.setFontSize(2.6 * PONTOS_POR_MM)
      documento.text(etiqueta.codigoQr, centro, baseDoSimbolo + 3, { align: 'center' })
      documento.setFont('helvetica', 'normal')
      documento.setFontSize(2.4 * PONTOS_POR_MM)
      documento.text(`Val ${formatarData(etiqueta.dataValidade)}`, centro, baseDoSimbolo + 6, {
        align: 'center',
      })

      desenhadas++
      aoProgredir?.(desenhadas, total)
    }

    documento.setFont('helvetica', 'normal')
    documento.setFontSize(7)
    documento.setTextColor(80)
    documento.text(pagina.rodape, MARGEM, ALTURA_PAGINA - MARGEM)
  }

  documento.save(`etiquetas-${dataDeHoje()}.pdf`)
}

/** Data local `AAAA-MM-DD`, só para o nome do arquivo. */
function dataDeHoje(): string {
  const agora = new Date()
  const doisDigitos = (n: number) => String(n).padStart(2, '0')
  return `${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}-${doisDigitos(agora.getDate())}`
}
