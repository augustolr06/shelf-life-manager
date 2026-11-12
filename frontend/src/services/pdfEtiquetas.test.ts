import { describe, expect, it } from 'vitest'
import type { Etiqueta } from './etiquetas'
import {
  agruparPorProduto,
  ALTURA_PAGINA,
  ALTURA_RODAPE,
  colunasPorLinha,
  LARGURA_PAGINA,
  MARGEM,
  montarLayout,
  textoDoCabecalho,
  type GrupoDeEtiquetas,
  type TamanhoEmMm,
} from './pdfEtiquetas'

/**
 * O layout do PDF de etiquetas (T50), sem desenhar PDF nenhum.
 *
 * O que se prova aqui são as regras de papel: os grupos não se misturam, nada
 * sai da área útil da folha, um cabeçalho nunca fica sozinho no pé da página e
 * o produto que atravessa a página repete o cabeçalho. A aparência real (o
 * símbolo, o tracejado, o milímetro medido) é conferida no PDF baixado no
 * navegador, e a legibilidade física é T16.
 */

function produto(id: string, nome = `Produto ${id}`, marca = 'Natura') {
  return { id, codigoInterno: `PRF-${id}`, nome, marca }
}

let sequencia = 0
function etiqueta(de: ReturnType<typeof produto>): Etiqueta {
  sequencia++
  return {
    id: `unidade-${sequencia}`,
    codigoQr: `PRF-${String(sequencia).padStart(6, '0')}`,
    dataValidade: '2027-03-01',
    produto: de,
    svg: '<svg viewBox="0 0 29 29"></svg>',
  }
}

function grupo(de: ReturnType<typeof produto>, quantidade: number): GrupoDeEtiquetas {
  return { produto: de, etiquetas: Array.from({ length: quantidade }, () => etiqueta(de)) }
}

describe('agruparPorProduto', () => {
  it('corta a lista em blocos consecutivos do mesmo produto, sem reordenar', () => {
    const a = produto('a')
    const b = produto('b')
    const lista = [etiqueta(a), etiqueta(a), etiqueta(b), etiqueta(a)]

    const grupos = agruparPorProduto(lista)

    // O servidor entrega cada produto contíguo; se não entregasse, a tela não
    // juntaria por conta própria — reordenar a folha não é papel dela.
    expect(grupos.map((g) => [g.produto.id, g.etiquetas.length])).toEqual([
      ['a', 2],
      ['b', 1],
      ['a', 1],
    ])
    expect(grupos.flatMap((g) => g.etiquetas)).toEqual(lista)
  })

  it('lista vazia não tem grupo', () => {
    expect(agruparPorProduto([])).toEqual([])
  })
})

describe('colunas por linha', () => {
  it.each([
    [15, 9],
    [20, 7],
    [25, 6],
  ] as const)('com símbolo de %i mm cabem %i etiquetas por linha', (lado, colunas) => {
    expect(colunasPorLinha(lado)).toBe(colunas)
  })
})

describe('montarLayout', () => {
  const tamanhos: TamanhoEmMm[] = [15, 20, 25]

  it.each(tamanhos)('com %i mm, nada sai da área útil da folha A4', (lado) => {
    const paginas = montarLayout([grupo(produto('a'), 130), grupo(produto('b'), 7)], lado)

    for (const pagina of paginas) {
      for (const item of pagina.itens) {
        expect(item.x).toBeGreaterThanOrEqual(MARGEM)
        expect(item.y).toBeGreaterThanOrEqual(MARGEM)
        if (item.tipo === 'etiqueta') {
          expect(item.x + item.largura).toBeLessThanOrEqual(LARGURA_PAGINA - MARGEM)
          expect(item.y + item.altura).toBeLessThanOrEqual(ALTURA_PAGINA - MARGEM - ALTURA_RODAPE)
        }
      }
    }
  })

  it('põe todas as etiquetas, na ordem recebida, cada grupo depois do seu cabeçalho', () => {
    const grupos = [grupo(produto('a'), 3), grupo(produto('b'), 2)]

    const [pagina] = montarLayout(grupos, 20)

    expect(pagina?.itens.map((item) => (item.tipo === 'cabecalho' ? item.texto : item.etiqueta.id))).toEqual([
      textoDoCabecalho(grupos[0] as GrupoDeEtiquetas, false),
      ...(grupos[0]?.etiquetas.map((e) => e.id) ?? []),
      textoDoCabecalho(grupos[1] as GrupoDeEtiquetas, false),
      ...(grupos[1]?.etiquetas.map((e) => e.id) ?? []),
    ])
  })

  it('preenche a linha antes de descer, e o próximo produto começa numa linha nova', () => {
    const grupos = [grupo(produto('a'), 8), grupo(produto('b'), 1)]

    const [pagina] = montarLayout(grupos, 20)
    const etiquetas = pagina?.itens.filter((item) => item.tipo === 'etiqueta') ?? []
    const linhas = new Set(etiquetas.map((item) => item.y))

    // 7 colunas a 20 mm: o produto "a" ocupa duas linhas, e "b" uma terceira.
    expect(linhas.size).toBe(3)
    expect(etiquetas[0]?.y).toBe(etiquetas[6]?.y)
    expect(etiquetas[7]?.y).toBeGreaterThan(etiquetas[6]?.y ?? 0)
  })

  it('produto que atravessa a página repete o cabeçalho, com "(continuação)"', () => {
    // 7 colunas × 8 linhas = 56 etiquetas de 20 mm cabem na primeira página.
    const longo = grupo(produto('a', 'Kaiak'), 60)

    const paginas = montarLayout([longo], 20)

    expect(paginas).toHaveLength(2)
    const [primeiro] = paginas[1]?.itens ?? []
    expect(primeiro).toMatchObject({ tipo: 'cabecalho', continuacao: true })
    expect(primeiro?.tipo === 'cabecalho' && primeiro.texto).toBe(
      'Natura — Kaiak · PRF-a · 60 etiquetas (continuação)',
    )
    expect(paginas.flatMap((p) => p.itens).filter((i) => i.tipo === 'etiqueta')).toHaveLength(60)
  })

  it('cabeçalho nunca fica sozinho no pé da página', () => {
    // O primeiro produto enche a página até sobrar menos que cabeçalho + uma
    // linha; o segundo precisa começar na página seguinte.
    for (const quantidade of [49, 50, 55, 56]) {
      const paginas = montarLayout([grupo(produto('a'), quantidade), grupo(produto('b'), 3)], 20)

      for (const pagina of paginas) {
        const ultimo = pagina.itens.at(-1)
        expect(ultimo?.tipo).toBe('etiqueta')
      }
    }
  })

  it('cada página tem rodapé com o tamanho do símbolo e a numeração', () => {
    const paginas = montarLayout([grupo(produto('a'), 60)], 15)

    expect(paginas.map((p) => p.rodape)).toEqual(
      paginas.map((_p, i) => `Símbolo de 15 mm · página ${i + 1} de ${paginas.length}`),
    )
  })

  it('sem etiquetas, não há página', () => {
    expect(montarLayout([], 20)).toEqual([])
  })
})

describe('textoDoCabecalho', () => {
  it('diz marca, nome, código e quantas etiquetas, no singular quando é uma', () => {
    expect(textoDoCabecalho(grupo(produto('x', 'Malbec', 'Boticário'), 1), false)).toBe(
      'Boticário — Malbec · PRF-x · 1 etiqueta',
    )
  })
})
