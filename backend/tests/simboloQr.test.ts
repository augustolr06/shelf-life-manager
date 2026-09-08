/**
 * O símbolo QR impresso na etiqueta (RF04, T14).
 *
 * Estes testes provam a **geometria** do símbolo — versão, nível de correção,
 * zona de silêncio, determinismo. Eles não provam que uma câmera lê a etiqueta
 * colada num frasco: isso é físico, e continua sendo a verificação manual da
 * RNF08 (T16) mais o teste de câmera em celular real já listado em
 * `tasks/backlog.md`.
 *
 * Contrato: tasks/T14-geracao-qr-unidade.md
 */

import { describe, expect, it } from 'vitest'
import { gerarCodigoQr, gerarCodigosQr } from '../src/modules/unidade/codigoQr.js'
import {
  LADO_DO_VIEWBOX,
  MARGEM_EM_MODULOS,
  MODULOS_DO_SIMBOLO,
  gerarSimboloSvg,
} from '../src/modules/unidade/simboloQr.js'

describe('geometria do símbolo', () => {
  it('cabe no menor símbolo da norma, com a zona de silêncio inteira', async () => {
    const svg = await gerarSimboloSvg(gerarCodigoQr())

    // 21 módulos de símbolo mais 4 de margem de cada lado. Se o `viewBox`
    // encolher para 21, a zona de silêncio sumiu — a causa clássica de
    // etiqueta que a câmera não lê.
    expect(LADO_DO_VIEWBOX).toBe(MODULOS_DO_SIMBOLO + 2 * MARGEM_EM_MODULOS)
    expect(svg).toContain(`viewBox="0 0 ${LADO_DO_VIEWBOX} ${LADO_DO_VIEWBOX}"`)
  })

  it('mantém a versão 1 para qualquer código que o gerador produza', async () => {
    // O `viewBox` é o observável da versão: versão 2 teria 25 módulos, e o
    // lado passaria de 29 para 33.
    for (const codigo of gerarCodigosQr(50)) {
      const svg = await gerarSimboloSvg(codigo)

      expect(svg).toContain(`viewBox="0 0 ${LADO_DO_VIEWBOX} ${LADO_DO_VIEWBOX}"`)
    }
  })

  it('usa o nível de correção mais alto da norma', async () => {
    // Prova indireta, e é a única disponível a partir do SVG: em versão 1, o
    // modo alfanumérico comporta 10 caracteres no nível H e 16 no nível Q.
    // Um código de 11 caracteres estourar a versão 1 só é possível se o nível
    // for H — em Q ele ainda caberia, e nada aqui falharia.
    await expect(gerarSimboloSvg('PRF-A1B2C34')).rejects.toThrow(/versão 1/)
  })

  it('recusa código que não cabe, em vez de imprimir um símbolo mais denso', async () => {
    // Se o formato do `codigoQr` crescer (a RNF08 ainda pode pedir isso em
    // T16), a etiqueta não pode ficar mais densa em silêncio: quem decide o
    // tamanho do símbolo é a validação física, não a biblioteca.
    await expect(gerarSimboloSvg('PRF-A1B2C3D4E5F6')).rejects.toThrow(/codigoQr/)
  })
})

describe('fidelidade do desenho', () => {
  /**
   * Reconstrói a matriz de módulos a partir dos comandos do `path` do SVG.
   *
   * O SVG desenha cada linha de módulos pretos como um traço horizontal em
   * `y + 0.5`, com espessura de 1 unidade: `M4 4.5h7` é "sete módulos pretos
   * seguidos na linha 4, a partir da coluna 4" (as coordenadas incluem a
   * margem). Reler isso de volta é o que prova que o arquivo entregue **é** o
   * símbolo, e não um desenho de tamanho certo com conteúdo errado.
   */
  function matrizDoSvg(svg: string): number[][] {
    const desenho = svg.match(/stroke="#000000" d="([^"]+)"/)?.[1]
    if (!desenho) throw new Error('SVG sem o path dos módulos pretos.')

    const matriz = Array.from({ length: MODULOS_DO_SIMBOLO }, () =>
      Array<number>(MODULOS_DO_SIMBOLO).fill(0),
    )
    let x = 0
    let y = 0

    for (const [, comando, argumentos] of desenho.matchAll(/([MmHh])([\d. -]*)/g)) {
      const numeros = (argumentos ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number)

      if (comando === 'M') [x, y] = numeros as [number, number]
      else if (comando === 'm') {
        x += numeros[0] as number
        y += numeros[1] as number
      } else if (comando === 'h') {
        const largura = numeros[0] as number
        const linha = matriz[Math.floor(y) - MARGEM_EM_MODULOS] as number[]
        for (let i = 0; i < largura; i += 1) linha[x - MARGEM_EM_MODULOS + i] = 1
        x += largura
      }
    }

    return matriz
  }

  it('desenha os três padrões de localização nos cantos', async () => {
    // O olho de boi 7×7 é o que a câmera procura primeiro. Se ele não estiver
    // nos três cantos, nada mais importa.
    const matriz = matrizDoSvg(await gerarSimboloSvg(gerarCodigoQr()))
    const ultimo = MODULOS_DO_SIMBOLO - 7

    for (const [linha, coluna] of [
      [0, 0],
      [0, ultimo],
      [ultimo, 0],
    ] as [number, number][]) {
      // Borda preta, anel branco, miolo preto 3×3.
      expect(matriz[linha]?.slice(coluna, coluna + 7)).toEqual([1, 1, 1, 1, 1, 1, 1])
      expect(matriz[linha + 1]?.slice(coluna, coluna + 7)).toEqual([1, 0, 0, 0, 0, 0, 1])
      expect(matriz[linha + 3]?.slice(coluna, coluna + 7)).toEqual([1, 0, 1, 1, 1, 0, 1])
    }
  })

  it('mantém a linha de sincronismo alternada', async () => {
    // A sexta linha alterna preto e branco de ponta a ponta: é a régua que o
    // decodificador usa para saber onde cada módulo começa.
    const matriz = matrizDoSvg(await gerarSimboloSvg(gerarCodigoQr()))
    const sincronismo = matriz[6]?.slice(8, MODULOS_DO_SIMBOLO - 8)

    expect(sincronismo).toEqual(sincronismo?.map((_, i) => (i % 2 === 0 ? 1 : 0)))
  })

  it('desenha 21 linhas de 21 módulos, sem sobrar traço fora do símbolo', async () => {
    const matriz = matrizDoSvg(await gerarSimboloSvg(gerarCodigoQr()))

    expect(matriz).toHaveLength(MODULOS_DO_SIMBOLO)
    for (const linha of matriz) expect(linha).toHaveLength(MODULOS_DO_SIMBOLO)
  })
})

describe('forma do SVG entregue', () => {
  it('não fixa tamanho em pixels — quem dimensiona é a etiqueta', async () => {
    const svg = await gerarSimboloSvg(gerarCodigoQr())

    // O tamanho físico do símbolo é decisão de impressão (T15), em
    // milímetros. Largura em pixels aqui seria essa decisão tomada no lugar
    // errado.
    expect(svg).not.toMatch(/\swidth="/)
    expect(svg).not.toMatch(/\sheight="/)
  })

  it('não usa id, class nem style', async () => {
    // A folha de impressão embute dezenas destes na mesma página; atributo
    // repetido colidiria.
    const svg = await gerarSimboloSvg(gerarCodigoQr())

    expect(svg).not.toMatch(/\s(id|class|style)="/)
  })

  it('é determinístico: a etiqueta reimpressa é idêntica à original', async () => {
    const codigo = gerarCodigoQr()

    expect(await gerarSimboloSvg(codigo)).toBe(await gerarSimboloSvg(codigo))
  })

  it('produz símbolos diferentes para códigos diferentes', async () => {
    const [primeiro, segundo] = gerarCodigosQr(2) as [string, string]

    expect(await gerarSimboloSvg(primeiro)).not.toBe(await gerarSimboloSvg(segundo))
  })
})
