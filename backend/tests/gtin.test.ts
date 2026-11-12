import { describe, expect, it } from 'vitest'
import { validarGtin } from '../src/modules/produto/gtin.js'

// T47: a validação existe para que um código digitado errado não gaste a cota
// diária da fonte externa e volte como "não encontrado".
describe('validarGtin (T47)', () => {
  it.each([
    ['EAN-8', '96385074'],
    ['UPC-A (GTIN-12)', '036000291452'],
    ['EAN-13', '4006381333931'],
    ['EAN-13 brasileiro (prefixo 789)', '7891000325858'],
    ['GTIN-14', '00012345600012'],
    ['EAN-13 com zero à esquerda, como GTIN-14', '04006381333931'],
  ])('aceita %s com o dígito verificador certo', (_tipo, codigo) => {
    expect(validarGtin(codigo)).toEqual({ ok: true })
  })

  it.each([
    ['EAN-8', '96385075'],
    ['UPC-A', '036000291453'],
    ['EAN-13', '4006381333932'],
    ['GTIN-14', '00012345600013'],
  ])('recusa %s com o último dígito errado', (_tipo, codigo) => {
    expect(validarGtin(codigo)).toEqual({ ok: false, motivo: 'DIGITO_VERIFICADOR' })
  })

  it('pega dois dígitos vizinhos trocados, o erro mais comum de digitação', () => {
    // 7891000325858 com o 3º e o 4º trocados.
    expect(validarGtin('7819000325858')).toEqual({ ok: false, motivo: 'DIGITO_VERIFICADOR' })
  })

  it.each([
    ['com letra', '789ABC0000000'],
    ['código próprio da loja', 'SEMCOD-001'],
    ['curto demais', '1234567'],
    ['com 9 dígitos', '123456789'],
    ['com 15 dígitos', '123456789012345'],
    ['vazio', ''],
  ])('recusa pelo formato o código %s', (_caso, codigo) => {
    expect(validarGtin(codigo)).toEqual({ ok: false, motivo: 'FORMATO' })
  })
})
