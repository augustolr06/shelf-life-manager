import { randomUUID } from 'node:crypto'
import { StatusUnidade } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { dataParaPayload, registrarEvento } from '../evento-log/eventoLog.service.js'
import { enviarNotificacoesPush, type OpcoesDeEnvio } from '../push/envioPush.js'
import type { AlertaEmitido } from '../push/mensagemPush.js'
import { hojeComoData } from '../../shared/data.js'
import { usuarioDoSistema } from './usuarioDoSistema.js'

/**
 * A varredura periódica da RF08: cruza cada janela de antecedência ativa (T17)
 * com as unidades em estoque e materializa um `Alerta` para cada unidade que
 * **entrou** naquela janela.
 *
 * É a primeira coisa que este sistema faz sem alguém pedir. O FIFO age quando
 * uma atendente lê um QR (T07–T10); a fila de descarte (T13) mostra o que já
 * virou perda. A jornada J3 do PRD pede o contrário disso — enxergar a unidade
 * enquanto ainda cabe decisão comercial.
 *
 * **A entrega in-app não é daqui.** Esta função escreve linhas de `Alerta` e os
 * eventos correspondentes; exibir e marcar como lido é T19. O que ela passou a
 * fazer em T19b é **notificar** — e ainda assim sem decidir nada sobre a
 * notificação: ela entrega ao módulo `push` o que emitiu, depois de comitar, e
 * segue adiante.
 *
 * Contrato: `tasks/T18-job-verificacao-alertas.md` e
 * `tasks/T19b-notificacao-push.md`.
 */

export type ResumoDaVarredura = {
  /** Janelas ativas consideradas. Zero significa "nada a fazer", não falha. */
  configuracoesAvaliadas: number
  /**
   * Soma, por janela, das unidades dentro dela — inclusive as que já haviam
   * sido alertadas antes. É o número que descreve o estoque; o de baixo
   * descreve o que esta passagem mudou.
   */
  unidadesNaJanela: number
  alertasEmitidos: number
  /**
   * Aparelhos notificados nesta passagem (T19b). Zero é o valor normal na
   * maioria dos dias — passagem sem alerta novo não notifica ninguém — e
   * também quando o servidor não tem chaves VAPID.
   */
  notificacoesEnviadas: number
}

const MILISSEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000

/** O último dia da janela: `hoje + diasAntecedencia`, ainda como data. */
function limiteDaJanela(hoje: Date, diasAntecedencia: number): Date {
  return new Date(
    Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + diasAntecedencia),
  )
}

export async function varrerEstoqueParaAlertas(
  /** Injetável só para os testes; em produção é sempre o envio de verdade. */
  opcoesDePush: OpcoesDeEnvio = {},
): Promise<ResumoDaVarredura> {
  const hoje = hojeComoData()

  // Só as ativas: inativar é o que `DELETE /configuracao-alerta/:id` faz desde
  // T17, e uma janela inativa que continuasse alertando tornaria o botão
  // mentiroso. Da mais larga para a mais estreita, a mesma ordem da listagem.
  const configuracoes = await prisma.configuracaoAlerta.findMany({
    where: { ativo: true },
    orderBy: [{ diasAntecedencia: 'desc' }, { id: 'asc' }],
  })

  const resumo: ResumoDaVarredura = {
    configuracoesAvaliadas: configuracoes.length,
    unidadesNaJanela: 0,
    alertasEmitidos: 0,
    notificacoesEnviadas: 0,
  }

  // O que esta passagem emitiu, acumulado para notificar **uma vez** no fim
  // (T19b, Decisão 2): uma notificação por janela deixaria a gestora com duas
  // no bolso quando 30 e 7 dias estão configuradas juntas.
  const emitidos: AlertaEmitido[] = []

  if (configuracoes.length === 0) return resumo

  // Resolvido uma vez, fora do laço: é sempre a mesma conta, e ela existe para
  // que o evento tenha autor (ver `usuarioDoSistema.ts`).
  const sistema = await usuarioDoSistema()

  for (const configuracao of configuracoes) {
    const limite = limiteDaJanela(hoje, configuracao.diasAntecedencia)

    // A janela é fechada dos dois lados. O `gte: hoje` é a mesma borda
    // inferior do pool prioritário do FIFO (`docs/arquitetura.md` seção 4,
    // passo 4): o que já venceu é assunto da fila de descarte (T13), e
    // alertar sobre perda consumada seria a terceira apresentação do mesmo
    // fato. `lte: limite` inclui a unidade que vence exatamente no último dia
    // da janela — "avise 30 dias antes" inclui o trigésimo dia.
    const naJanela = {
      status: StatusUnidade.EM_ESTOQUE,
      dataValidade: { gte: hoje, lte: limite },
      // Unidade de produto inativo entra, pelo mesmo motivo de T13: inativar
      // o SKU não tira o frasco da prateleira.
    }

    const [unidadesNaJanela, candidatas] = await Promise.all([
      prisma.unidadeProduto.count({ where: naJanela }),
      prisma.unidadeProduto.findMany({
        where: {
          ...naJanela,
          // O filtro que torna a varredura idempotente, resolvido pelo banco
          // como um `NOT EXISTS` — e não por comparação em memória, que
          // precisaria carregar o histórico de alertas para decidir.
          alertas: { none: { configuracaoId: configuracao.id } },
        },
        orderBy: [{ dataValidade: 'asc' }, { codigoQr: 'asc' }],
      }),
    ])

    resumo.unidadesNaJanela += unidadesNaJanela

    if (candidatas.length === 0) continue

    // Ids pré-gerados para que alerta e evento entrem na mesma transação em
    // forma de array, como o cadastro em lote de T05: uma transação por
    // janela, sem `await` no meio.
    const ids = candidatas.map(() => randomUUID())

    const criacoes = candidatas.map((unidade, indice) =>
      prisma.alerta.create({
        data: {
          id: ids[indice] as string,
          unidadeId: unidade.id,
          configuracaoId: configuracao.id,
          // `geradoEm` vem do default do schema: é instante, não data de
          // calendário — quando o job rodou, e não que dia ele estava vendo.
        },
      }),
    )

    // Um evento por alerta, não um por varredura: `EventoLog.unidadeId` é
    // singular, e é essa granularidade que permite cruzar o alerta com a saída
    // posterior da mesma unidade (RF12) — que é o indicador que interessa, "a
    // unidade alertada foi vendida antes de vencer?". Um evento agregado
    // ("emiti 43 alertas") não responde isso.
    const eventos = candidatas.map((unidade) =>
      registrarEvento(prisma, {
        tipoEvento: 'ALERTA_PROATIVO_EMITIDO',
        unidadeId: unidade.id,
        produtoId: unidade.produtoId,
        usuarioId: sistema.id,
        payload: {
          configuracaoId: configuracao.id,
          diasAntecedencia: configuracao.diasAntecedencia,
          canal: configuracao.canal,
          // Texto `AAAA-MM-DD`: data de calendário em payload nunca é
          // instante (RNF01, e a nota de `dataParaPayload`).
          dataValidade: dataParaPayload(unidade.dataValidade),
          diasParaVencer: Math.round(
            (unidade.dataValidade.getTime() - hoje.getTime()) / MILISSEGUNDOS_POR_DIA,
          ),
        },
      }),
    )

    // Uma transação por janela: ou a janela inteira foi processada, ou nenhum
    // alerta dela existe. Meia janela gravada não corromperia nada (a próxima
    // passagem completaria), mas deixaria eventos sem o alerta que eles dizem
    // ter sido emitido — e é o `EventoLog` que a pesquisa lê.
    await prisma.$transaction([...criacoes, ...eventos])

    resumo.alertasEmitidos += candidatas.length

    for (const unidade of candidatas) {
      emitidos.push({
        unidadeId: unidade.id,
        diasAntecedencia: configuracao.diasAntecedencia,
        canal: configuracao.canal,
      })
    }
  }

  // **Depois** das transações, nunca dentro (T19b, Decisão 7): uma chamada
  // HTTP dentro de `$transaction` seguraria a transação pela latência da rede,
  // e um serviço de push fora do ar não pode fazer o `Alerta` deixar de
  // existir. O `try/catch` é a segunda metade da mesma regra — o envio já não
  // lança por conta própria, e este é o cinto de segurança para o que
  // escapar: a varredura precisa terminar dizendo a verdade sobre o que
  // gravou, mesmo que ninguém tenha sido notificado.
  try {
    const envio = await enviarNotificacoesPush(emitidos, opcoesDePush)
    resumo.notificacoesEnviadas = envio.notificacoesEnviadas
  } catch (erro) {
    console.error('envio de notificações push falhou; os alertas foram gravados', erro)
  }

  return resumo
}
