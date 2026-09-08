import { describe, expect, it } from 'vitest'
import { gerarCodigoQr, gerarCodigosQr, PADRAO_CODIGO_QR } from '../src/modules/unidade/codigoQr.js'

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
