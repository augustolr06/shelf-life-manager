/**
 * Formatação de data de calendário para exibição.
 *
 * Nasceu em `unidades.ts` (T05) e mudou para cá em T10, quando a tela de
 * leitura virou o segundo consumidor. A conversão é feita por fatia de texto,
 * de propósito: `new Date('2027-03-01')` é interpretado como UTC e volta um
 * dia atrás em fuso negativo, que é o do país inteiro. `dataValidade` é `DATE`
 * (RNF01) e não tem instante para converter.
 */

/** `2027-03-01` (ou o ISO completo) para `01/03/2027`, sem passar por fuso. */
export function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}
