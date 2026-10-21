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

/**
 * `2026-10-21` para `Quarta-feira, 21 de outubro`, o cabeçalho da tela Início
 * (T42). A data é a que o servidor devolveu; daqui só sai o nome do dia e do
 * mês. O `Date` é montado em UTC e formatado em UTC, para que o fuso do
 * aparelho não mude o dia da semana — a mesma cautela de `formatarData`.
 */
export function formatarDataPorExtenso(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number) as [number, number, number]
  const texto = new Date(Date.UTC(ano, mes - 1, dia)).toLocaleDateString('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/**
 * Instante ISO para `01/03/2027 14:32`.
 *
 * Existe separado de `formatarData` porque os dois formatos do sistema são
 * coisas diferentes: `dataValidade` é `DATE` e não tem hora para converter
 * (RNF01), enquanto `Saida.dataHora` é o momento em que a venda aconteceu.
 * Aqui a conversão para o fuso do aparelho é desejada — é a hora local de quem
 * está lendo o relatório.
 */
export function formatarInstante(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
