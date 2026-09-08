import QRCode from 'qrcode'

/**
 * O símbolo QR que vai impresso na etiqueta do frasco (RF04).
 *
 * Divisão de responsabilidade com `codigoQr.ts`, o vizinho: lá mora o
 * **formato** do identificador (`PRF-XXXXXX`), aqui mora o **símbolo** que o
 * carrega até a câmera. Nenhuma rota, serviço ou tela monta SVG de QR por
 * conta própria — trocar a aparência da etiqueta é editar este arquivo.
 *
 * ## O que é codificado: o código puro, nunca uma URL
 *
 * O símbolo carrega exatamente o texto do `codigoQr`, sem prefixo de domínio.
 * Codificar `https://.../u/PRF-XXXXXX` amarraria cada etiqueta já colada num
 * frasco a um endereço de implantação (trocar o domínio inutilizaria o estoque
 * etiquetado), e os ~35 caracteres da URL empurrariam o símbolo para uma
 * versão maior — mais módulos no mesmo espaço físico, o oposto do que a RNF08
 * pede numa embalagem pequena e curva. Como bônus, o texto que a câmera lê
 * (T10) e o que a atendente digita no fallback manual passam a ser o mesmo.
 *
 * ## Por que nível H sem custo de tamanho
 *
 * Um QR versão 1 em modo alfanumérico e correção `H` comporta **exatamente 10
 * caracteres**; `PRF-` mais os 6 do alfabeto Crockford são exatamente 10, e
 * todos pertencem ao conjunto alfanumérico do QR (o hífen inclusive). Ou seja,
 * dá para usar a correção de erro mais alta da norma — que recupera cerca de
 * 30% de um símbolo danificado — sem gastar um único módulo a mais do que o
 * menor símbolo possível. Para etiqueta sujeita a atrito, gordura de mão e
 * curvatura de frasco, é o melhor negócio disponível.
 *
 * O contrapeso está registrado em `docs/decisoes.md` (2026-09-08): isso deixa o
 * formato do `codigoQr` mais caro de mudar do que T05 previu. Um sétimo
 * caractere derruba o símbolo para versão 2. Daí a verificação explícita
 * abaixo: se o formato crescer, isto falha alto em vez de imprimir em silêncio
 * uma etiqueta mais densa do que a validação física (RNF08 / T16) aprovou.
 */

/** O mais alto da norma: ~30% do símbolo recuperável se danificado. */
const NIVEL_CORRECAO = 'H' as const

/** 21×21 módulos, o menor símbolo que a norma define. */
export const VERSAO_ESPERADA = 1
export const MODULOS_DO_SIMBOLO = 21

/**
 * Zona de silêncio de 4 módulos em volta, como a norma exige. Recortá-la é a
 * causa clássica de etiqueta que a câmera não lê — e a tentação de recortar
 * aparece justamente quando o espaço na embalagem é pouco, que é o caso aqui.
 */
export const MARGEM_EM_MODULOS = 4

/** Lado do `viewBox`: o símbolo mais as duas margens. */
export const LADO_DO_VIEWBOX = MODULOS_DO_SIMBOLO + 2 * MARGEM_EM_MODULOS

/**
 * O SVG do símbolo, sem largura nem altura em pixels — só `viewBox`.
 *
 * Quem dimensiona é a etiqueta (T15), em milímetros, porque o tamanho físico é
 * que decide a legibilidade. Um tamanho fixo aqui seria uma decisão de
 * impressão tomada no lugar errado.
 *
 * Também sem `id`, `class` ou `style`: a folha de impressão embute dezenas
 * destes na mesma página, e atributo repetido colidiria.
 */
export async function gerarSimboloSvg(codigoQr: string): Promise<string> {
  const simbolo = QRCode.create(codigoQr, { errorCorrectionLevel: NIVEL_CORRECAO })

  if (simbolo.version !== VERSAO_ESPERADA) {
    throw new Error(
      `O código "${codigoQr}" não cabe num QR versão ${VERSAO_ESPERADA} com correção ` +
        `${NIVEL_CORRECAO} (a biblioteca precisou da versão ${simbolo.version}). O formato ` +
        'do codigoQr cresceu além de 10 caracteres alfanuméricos; a etiqueta ficaria mais ' +
        'densa do que a validação física da RNF08 aprovou. Ver src/modules/unidade/codigoQr.ts.',
    )
  }

  return QRCode.toString(codigoQr, {
    type: 'svg',
    errorCorrectionLevel: NIVEL_CORRECAO,
    margin: MARGEM_EM_MODULOS,
  })
}
