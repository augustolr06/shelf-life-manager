import { randomInt } from 'node:crypto'

/**
 * Geração do `codigoQr` de uma unidade física. **Formato provisório** até a
 * validação física da RNF08 (T16): o teste de leitura em frasco curvo e
 * embalagem pequena pode reabri-lo. Por isso ele vive só aqui — nenhuma rota,
 * serviço ou teste deve repetir o formato literal; quem precisar validar usa
 * `PADRAO_CODIGO_QR`, e trocar o formato é editar este arquivo.
 *
 * Decidido em `docs/decisoes.md` (2026-09-07): `PRF-XXXXXX`, com os 6
 * caracteres tirados do alfabeto Crockford Base32 — que omite I, L, O e U
 * justamente para não se confundirem com 1, 0 e V quando alguém precisar
 * digitar o código à mão (fallback manual do RF05).
 */
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const PREFIXO = 'PRF'
const COMPRIMENTO = 6

/** 32^6 ≈ 1,07 bilhão de combinações, muito acima da escala da RNF10. */
export const PADRAO_CODIGO_QR = new RegExp(`^${PREFIXO}-[${ALFABETO}]{${COMPRIMENTO}}$`)

export function gerarCodigoQr(): string {
  let sufixo = ''
  for (let i = 0; i < COMPRIMENTO; i += 1) {
    // `randomInt` em vez de `Math.random`: o código identifica uma unidade
    // física e não deve ser previsível a partir dos anteriores.
    sufixo += ALFABETO[randomInt(ALFABETO.length)]
  }
  return `${PREFIXO}-${sufixo}`
}

/**
 * Códigos distintos entre si para um mesmo lote. A unicidade real continua
 * sendo a restrição `@unique` da coluna — isto só evita que a colisão mais
 * provável (duas unidades da mesma requisição) chegue ao banco.
 */
export function gerarCodigosQr(quantidade: number): string[] {
  const codigos = new Set<string>()
  while (codigos.size < quantidade) codigos.add(gerarCodigoQr())
  return [...codigos]
}
