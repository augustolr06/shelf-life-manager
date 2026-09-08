/**
 * `dataValidade` é um fato de calendário, não um instante: "vence em
 * 01/03/2027" não tem hora. A coluna é `DATE` por exigência da RNF01, e estas
 * funções são a única fronteira entre a string `YYYY-MM-DD` que trafega na
 * API e o `Date` que o Prisma leva ao Postgres.
 *
 * As duas ancoram na **meia-noite UTC**, que é exatamente como o Prisma
 * devolve uma coluna `DATE` ao ler. Isso é o que permite comparar um valor
 * recém-convertido com um valor vindo do banco sem que a comparação escorregue
 * um dia — o que a validação FIFO (T07) vai fazer a cada leitura de QR.
 *
 * Ambas montam a data a partir de componentes explícitos (`Date.UTC`), nunca
 * de `new Date('2027-03-01')` sobre texto solto: o fuso do servidor não pode
 * influenciar qual dia é gravado.
 */

/** Converte `YYYY-MM-DD` (o que a API recebe) no `Date` gravado na coluna. */
export function dataDeString(texto: string): Date {
  const [ano, mes, dia] = texto.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(ano, mes - 1, dia))
}

/**
 * Hoje, no calendário de quem está operando a loja: os componentes vêm da
 * hora local do servidor, e só então viram meia-noite UTC. Em BRT (UTC-3),
 * usar a data UTC direta faria o sistema virar o dia às 21h.
 */
export function hojeComoData(): Date {
  const agora = new Date()
  return new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()))
}
