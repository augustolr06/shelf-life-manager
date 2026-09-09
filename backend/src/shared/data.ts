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

/** O caminho de volta: o `Date` de uma coluna `DATE` na string que a API devolve. */
export function textoDeData(data: Date): string {
  return data.toISOString().slice(0, 10)
}

/**
 * O recorte de período do dashboard (T20): o instante em que um dia de
 * calendário começa, e o instante em que o seguinte começa.
 *
 * Existem porque o dashboard filtra colunas que **não** são `DATE` —
 * `Saida.dataHora` e `Descarte.dataHora` são instantes, e `EventoLog.ocorridoEm`
 * também. Usar `dataDeString()` nessas comparações ancoraria o corte na
 * meia-noite **UTC**: em BRT (UTC-3), uma venda das 22h de segunda cairia no
 * relatório de terça. É a mesma classe de erro que a RNF01 existe para evitar,
 * entrando pela porta do recorte em vez da porta da validade.
 *
 * Por isso montam o instante a partir dos componentes **locais** (o construtor
 * sem `Date.UTC`), coerente com o `hojeComoData()` acima, que também lê a hora
 * local do servidor para decidir que dia é hoje na loja.
 *
 * O par é `[inicioDoDia(de), inicioDoDiaSeguinte(ate))` — fechado no começo,
 * aberto no fim. Um "fim do dia" às 23:59:59.999 deixaria de fora o que o
 * Postgres grava nos microssegundos seguintes, que sua coluna `timestamp`
 * guarda e o `Date` do JavaScript não representa.
 */
export function inicioDoDia(texto: string): Date {
  const [ano, mes, dia] = texto.split('-').map(Number) as [number, number, number]
  return new Date(ano, mes - 1, dia)
}

/** O início do dia seguinte, para ser o limite superior exclusivo do período. */
export function inicioDoDiaSeguinte(texto: string): Date {
  const [ano, mes, dia] = texto.split('-').map(Number) as [number, number, number]
  // `new Date(2026, 11, 32)` é 1º de janeiro: a virada de mês e de ano sai de
  // graça, e não há aritmética de calendário escrita aqui.
  return new Date(ano, mes - 1, dia + 1)
}
