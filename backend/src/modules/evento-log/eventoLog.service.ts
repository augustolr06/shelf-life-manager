import type { EventoLog, Prisma } from '@prisma/client'

/**
 * O único ponto do sistema que escreve no `EventoLog` (RF12, RNF05).
 *
 * O log tem duplo propósito — auditoria e **instrumento de coleta de dados
 * quantitativos do TCC** (PRD seção 3, RF12). É a segunda metade que dita a
 * forma deste módulo: um evento com o tipo escrito errado, ou uma linha
 * corrigida depois do fato, não quebra nenhuma tela e não aparece em teste
 * nenhum — corrompe o resultado da pesquisa em silêncio, meses depois, sem
 * deixar rastro.
 *
 * Daí as duas travas. A união fechada `TipoEvento` impede o tipo inventado; o
 * módulo não expõe `update`, `delete` nem `upsert`, e a migração
 * `20260908...append_only_evento_log` põe a mesma proibição no banco, para
 * alcançar também quem chegar por fora da aplicação.
 */

/**
 * Os nove tipos da tabela "Tipos de evento no `EventoLog`" (PRD seção 5).
 *
 * A lista está completa desde já, incluindo os eventos que só serão gravados
 * em T11 e T18: ela vem do PRD, não do que já foi implementado. Acrescentar um
 * tipo aqui depois de o piloto começar quebra a comparabilidade dos dados
 * coletados antes e depois (PRD seção 9) — por isso a lista é declarada de uma
 * vez e a mudança dela é um ato consciente, com data em `docs/decisoes.md`.
 */
export type TipoEvento =
  | 'UNIDADE_CADASTRADA'
  | 'LEITURA_QR_SAIDA'
  | 'ALERTA_FIFO_DISPARADO'
  | 'SAIDA_CONFIRMADA'
  | 'TENTATIVA_VENDA_UNIDADE_VENCIDA'
  | 'VENDA_VENCIDA_AUTORIZADA'
  | 'VALIDADE_CORRIGIDA'
  | 'DESCARTE_REGISTRADO'
  | 'ALERTA_PROATIVO_EMITIDO'

/** O cliente de dentro de um `prisma.$transaction` — nunca o client global. */
export type ClienteDeTransacao = Prisma.TransactionClient

export type EntradaDeEvento = {
  tipoEvento: TipoEvento
  /** Nulo quando o evento não descreve uma unidade específica — ver RNF05. */
  unidadeId?: string | null
  produtoId?: string | null
  usuarioId: string
  payload: Prisma.InputJsonObject
}

/**
 * Grava um evento. Só `create`, sempre (RNF05).
 *
 * Recebe o cliente de transação de quem chama em vez de abrir transação
 * própria: o evento precisa comitar **junto** com o fato que ele descreve. Um
 * evento gravado fora da transação sobreviveria a um rollback e passaria a
 * descrever algo que não aconteceu — no dado da pesquisa, isso é pior do que
 * não ter o evento.
 *
 * Devolve a `PrismaPromise` crua, e não uma `Promise` comum, para que o
 * chamador possa tanto aguardá-la dentro de um `$transaction` de callback
 * (como faz `validarSaidaFifo`) quanto compô-la na forma de array (como faz o
 * cadastro em lote de unidades). As duas formas continuam sendo uma transação
 * só.
 */
export function registrarEvento(
  tx: ClienteDeTransacao,
  entrada: EntradaDeEvento,
): Prisma.PrismaPromise<EventoLog> {
  return tx.eventoLog.create({
    data: {
      tipoEvento: entrada.tipoEvento,
      unidadeId: entrada.unidadeId ?? null,
      produtoId: entrada.produtoId ?? null,
      usuarioId: entrada.usuarioId,
      payload: entrada.payload,
    },
  })
}

/**
 * Data de calendário dentro de um payload é texto `AAAA-MM-DD`, nunca
 * instante.
 *
 * O valor vem de uma coluna `DATE` ancorada na meia-noite UTC (RNF01);
 * serializado como instante no JSON, ele voltaria da análise sujeito a
 * escorregar um dia por fuso — o defeito silencioso que a RNF01 existe para
 * evitar, reintroduzido pela porta do log.
 *
 * Vive aqui, e não em `src/shared/data.ts`, porque é regra de formato do
 * payload e não de conversão de data: `shared/data.ts` é a fronteira entre a
 * API e a coluna, e continua com o par `dataDeString`/`hojeComoData`.
 */
export function dataParaPayload(data: Date): string {
  return data.toISOString().slice(0, 10)
}
