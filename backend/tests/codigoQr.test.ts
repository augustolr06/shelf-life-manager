import { describe, expect, it } from 'vitest'
import {
  gerarCodigoQr,
  gerarCodigosQr,
  normalizarCodigoQr,
  PADRAO_CODIGO_QR,
} from '../src/modules/unidade/codigoQr.js'

// Estes testes descrevem o formato pelo `PADRAO_CODIGO_QR` exportado, não por
// uma expressão literal repetida aqui: o formato é provisório até o teste
// físico da RNF08 (T16), e trocá-lo deve ser editar um arquivo só.
describe('geração de codigoQr', () => {
  it('gera código no formato publicado pelo módulo', () => {
    expect(gerarCodigoQr()).toMatch(PADRAO_CODIGO_QR)
  })

  it('não usa as letras que se confundem na leitura humana', () => {
    // I, L, O e U ficam de fora do Crockford Base32 para não virarem 1, 0 e V
    // quando alguém digitar o código no fallback manual do RF05.
    const amostra = Array.from({ length: 500 }, gerarCodigoQr).join('')

    expect(amostra.slice(amostra.indexOf('-'))).not.toMatch(/[ILOU]/)
  })

  it('gera códigos distintos entre si dentro do mesmo lote', () => {
    const codigos = gerarCodigosQr(200)

    expect(codigos).toHaveLength(200)
    expect(new Set(codigos).size).toBe(200)
    for (const codigo of codigos) expect(codigo).toMatch(PADRAO_CODIGO_QR)
  })
})

// A normalização é o fallback manual do RF05 (T08): quando a câmera não lê, a
// atendente digita, e digitar erra de formas previsíveis.
describe('normalização de codigoQr digitado à mão', () => {
  it('não altera um código já bem formado', () => {
    const codigo = gerarCodigoQr()

    expect(normalizarCodigoQr(codigo)).toBe(codigo)
  })

  it('corrige caixa e espaços', () => {
    expect(normalizarCodigoQr('  prf-2b3c4d ')).toBe('PRF-2B3C4D')
    expect(normalizarCodigoQr('PRF- 2B3C 4D')).toBe('PRF-2B3C4D')
  })

  it('desfaz as confusões que o alfabeto Crockford antecipa', () => {
    // O gerador nunca emite I, L nem O, então mapeá-las de volta para 1 e 0
    // não pode colidir com nenhum código válido.
    expect(normalizarCodigoQr('PRF-I23456')).toBe('PRF-123456')
    expect(normalizarCodigoQr('PRF-L23456')).toBe('PRF-123456')
    expect(normalizarCodigoQr('PRF-O23456')).toBe('PRF-023456')
  })

  it('o resultado da correção continua sendo um código válido', () => {
    expect(normalizarCodigoQr('prf-iolo23')).toMatch(PADRAO_CODIGO_QR)
  })
})
