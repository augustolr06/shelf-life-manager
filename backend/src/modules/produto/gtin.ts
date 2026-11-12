/**
 * Validação de código de barras GTIN (EAN-8, UPC-A, EAN-13 e GTIN-14) pelo
 * dígito verificador da GS1 (T47).
 *
 * Existe para a consulta ao catálogo externo, e não para o cadastro: o
 * `codigoInterno` continua sendo texto livre desde T04, porque nem todo
 * produto da loja tem código de barras (`SEMCOD-…`, ver
 * `docs/notas-para-artigo.md`, 2026-11-10). O que a validação pega é o código
 * digitado errado — um dígito trocado quase sempre quebra o verificador — antes
 * de ele gastar uma consulta da cota diária e voltar como "não encontrado",
 * que faria a gestora cadastrar à mão um código que não existe.
 */

export type ResultadoGtin = { ok: true } | { ok: false; motivo: 'FORMATO' | 'DIGITO_VERIFICADOR' }

const TAMANHOS_GTIN = new Set([8, 12, 13, 14])

export function validarGtin(codigo: string): ResultadoGtin {
  if (!/^\d+$/.test(codigo) || !TAMANHOS_GTIN.has(codigo.length)) {
    return { ok: false, motivo: 'FORMATO' }
  }

  const digitos = [...codigo].map(Number)
  const verificador = digitos.pop()

  // Mod-10 da GS1, igual para os quatro tamanhos: da direita para a esquerda,
  // sem o verificador, os dígitos pesam 3, 1, 3, 1… É por contar a partir da
  // direita que um GTIN-13 com um zero à esquerda vira o GTIN-14 equivalente
  // sem mudar o verificador.
  let soma = 0
  digitos.reverse().forEach((digito, posicao) => {
    soma += digito * (posicao % 2 === 0 ? 3 : 1)
  })
  const esperado = (10 - (soma % 10)) % 10

  return esperado === verificador ? { ok: true } : { ok: false, motivo: 'DIGITO_VERIFICADOR' }
}
