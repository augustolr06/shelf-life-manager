import type { Prisma } from '@prisma/client'

/**
 * Os prazos de toda transação interativa do sistema, num lugar só.
 *
 * ## Por que os padrões do Prisma não servem aqui
 *
 * O Prisma usa `maxWait` de 2s e `timeout` de 5s. Os dois foram calibrados
 * para um servidor quente falando com um banco quente, e é justamente a
 * situação que a hospedagem escolhida em 2026-09-15 **não** garante:
 *
 * - a função serverless parte fria depois de um período sem uso;
 * - o Neon suspende a computação após ~5 minutos ociosa, e a primeira consulta
 *   precisa acordá-la.
 *
 * Numa perfumaria isso não é caso raro: é a **primeira leitura de QR do dia**,
 * e a segunda depois do almoço. Com `maxWait` de 2s, obter conexão pode não
 * caber no prazo, e a atendente vê um erro de transação com o cliente na
 * frente — não por falta de estoque, não por FIFO, mas porque o banco estava
 * dormindo.
 *
 * ## A escolha
 *
 * `maxWait` de 10s é tempo para acordar banco e obter conexão. `timeout` de
 * 15s é o tempo que a transação em si pode levar depois disso. **Espera longa
 * é melhor que erro rápido neste balcão**: uma leitura que demora cinco
 * segundos atrasa o atendimento; uma que falha manda a atendente decidir
 * sozinha qual frasco vender, que é o que o sistema existe para evitar.
 *
 * Os dois prazos cabem folgadamente no limite de duração de função da
 * plataforma, então quem aborta primeiro é sempre este prazo — nunca a
 * hospedagem no meio de uma escrita.
 *
 * ## Por que aqui, e não em cada `$transaction`
 *
 * São seis chamadas interativas hoje, e a sétima é a que alguém escreve sem
 * lembrar de repetir as opções. Aplicadas no construtor do client, valem para
 * todas por construção. Este módulo não constrói client nenhum de propósito:
 * é importado tanto pelo client de produção (`db/prisma.ts`) quanto pelo das
 * suítes (`tests/apoio/bancoDeTeste.ts`), e importar um client ali abriria
 * conexão com o banco de desenvolvimento durante os testes.
 */
export const OPCOES_DE_TRANSACAO: Prisma.PrismaClientOptions['transactionOptions'] = {
  /** Tempo para conseguir conexão — inclui acordar um banco suspenso. */
  maxWait: 10_000,
  /** Tempo que a transação pode levar depois de começar. */
  timeout: 15_000,
}
