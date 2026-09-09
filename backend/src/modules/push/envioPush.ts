import { Papel } from '@prisma/client'
import webpush from 'web-push'
import { prisma } from '../../db/prisma.js'
import { montarMensagem, type AlertaEmitido } from './mensagemPush.js'
import { chavesVapid } from './vapid.js'

/**
 * O envio da notificação push do alerta proativo (RF08, T19b) — a metade da
 * RF08 que alcança quem **não abriu** o sistema.
 *
 * Chamado pela varredura de T18 **depois** que as transações comitaram, nunca
 * de dentro de uma (Decisão 7). Duas razões: uma chamada HTTP dentro de
 * `$transaction` seguraria a transação pela latência da rede, e um serviço de
 * push fora do ar não pode fazer o `Alerta` deixar de existir — o registro é o
 * que a RF13 conta, e o push é só o empurrão.
 *
 * **Não grava `EventoLog`** (Decisão 5): enviar não é ato humano e não muda
 * estoque, e o indicador de reação já sai do par `ALERTA_PROATIVO_EMITIDO` →
 * `ALERTA_LIDO` de T19. A consequência — o log não distingue "leu porque o push
 * chegou" de "leu porque abriu o app" — está declarada em
 * `docs/notas-para-artigo.md`.
 *
 * Contrato: `tasks/T19b-notificacao-push.md`.
 */

/** Um aparelho inscrito, reduzido ao que o envio precisa. */
export type DestinoPush = {
  id: string
  endpoint: string
  chaves: { p256dh: string; auth: string }
}

/**
 * Quem de fato fala com o serviço de push. Injetável pela mesma razão que o
 * agendador de T18 recebe a varredura: o que se testa aqui é a regra — quem
 * recebe, quantas notificações, o que acontece com a inscrição morta —, e isso
 * não deve depender de rede nem da biblioteca.
 */
export type RemetentePush = (destino: DestinoPush, payload: string) => Promise<void>

/** O mínimo que este módulo usa de um logger. */
export type LogDoEnvio = {
  warn: (dados: Record<string, unknown>, mensagem: string) => void
}

export type OpcoesDeEnvio = {
  enviar?: RemetentePush
  log?: LogDoEnvio
}

export type ResumoDoEnvio = {
  notificacoesEnviadas: number
  /** Inscrições apagadas por o aparelho não existir mais (404/410). */
  inscricoesRemovidas: number
  falhas: number
}

const NADA_ENVIADO: ResumoDoEnvio = {
  notificacoesEnviadas: 0,
  inscricoesRemovidas: 0,
  falhas: 0,
}

/**
 * 404 e 410 são a forma padrão de o serviço do navegador dizer "este aparelho
 * não existe mais" — app desinstalado, permissão revogada, inscrição expirada.
 * A linha é apagada na hora; do contrário a tabela vira lixo que a varredura
 * tenta contatar todo dia, para sempre.
 */
const INSCRICAO_MORTA = [404, 410]

const logPadrao: LogDoEnvio = {
  warn: (dados, mensagem) => console.warn(mensagem, dados),
}

/** Uma vez por processo: sem chaves, a mensagem é sempre a mesma. */
let avisouQueNaoHaChaves = false

function statusDoErro(erro: unknown): number | null {
  if (typeof erro === 'object' && erro !== null && 'statusCode' in erro) {
    const status = (erro as { statusCode: unknown }).statusCode
    if (typeof status === 'number') return status
  }
  return null
}

/**
 * O remetente de verdade, ou `null` quando o servidor não tem chaves VAPID.
 *
 * A configuração é aplicada por envio (e não uma vez no import) pelo mesmo
 * motivo de `vapid.ts`: a ausência de chave é estado previsto, e trocar o par
 * deve ser um reinício, não um rebuild.
 */
function remetentePadrao(): RemetentePush | null {
  const chaves = chavesVapid()
  if (!chaves) return null

  return async (destino, payload) => {
    webpush.setVapidDetails(chaves.assunto, chaves.chavePublica, chaves.chavePrivada)
    await webpush.sendNotification(
      { endpoint: destino.endpoint, keys: destino.chaves },
      payload,
    )
  }
}

/**
 * Notifica os aparelhos inscritos sobre o que a passagem da varredura emitiu.
 *
 * Envia **uma** notificação por aparelho (Decisão 2), só para os alertas de
 * janela com canal `PUSH` ou `AMBOS`, e só para aparelhos cujo dono é `GESTOR`
 * **neste momento** (Decisão 3) — uma conta rebaixada para `ATENDENTE` deixa de
 * receber sem que ninguém precise limpar tabela, pela mesma razão de T19 e T13:
 * a jornada J3 termina em decisão comercial, que não é ato de balcão.
 *
 * Nunca lança: uma falha de push não pode derrubar a varredura nem desfazer um
 * alerta já gravado.
 */
export async function enviarNotificacoesPush(
  emitidos: readonly AlertaEmitido[],
  opcoes: OpcoesDeEnvio = {},
): Promise<ResumoDoEnvio> {
  const log = opcoes.log ?? logPadrao

  const mensagem = montarMensagem(emitidos)
  // Passagem sem alerta novo, ou só com janelas `IN_APP`: é o caso da maioria
  // dos dias, e não é falha.
  if (!mensagem) return { ...NADA_ENVIADO }

  const enviar = opcoes.enviar ?? remetentePadrao()

  if (!enviar) {
    if (!avisouQueNaoHaChaves) {
      avisouQueNaoHaChaves = true
      log.warn(
        { alertas: emitidos.length },
        'push não configurado neste servidor (VAPID ausente): alertas ficam só na lista in-app',
      )
    }
    return { ...NADA_ENVIADO }
  }

  const inscricoes = await prisma.inscricaoPush.findMany({
    where: { usuario: { papel: Papel.GESTOR } },
  })

  const payload = JSON.stringify(mensagem)
  const resumo: ResumoDoEnvio = { ...NADA_ENVIADO }

  for (const inscricao of inscricoes) {
    const destino: DestinoPush = {
      id: inscricao.id,
      endpoint: inscricao.endpoint,
      chaves: { p256dh: inscricao.p256dh, auth: inscricao.auth },
    }

    try {
      await enviar(destino, payload)
      resumo.notificacoesEnviadas += 1
    } catch (erro) {
      const status = statusDoErro(erro)

      if (status !== null && INSCRICAO_MORTA.includes(status)) {
        await prisma.inscricaoPush.deleteMany({ where: { id: inscricao.id } })
        resumo.inscricoesRemovidas += 1
        continue
      }

      // Sem fila de reenvio: a varredura seguinte não reemite o alerta (índice
      // único de T18), então um push perdido está perdido. É aceitável porque
      // a lista in-app continua sendo a fonte de verdade — está declarado como
      // limitação em `docs/notas-para-artigo.md`.
      resumo.falhas += 1
      // O `endpoint` não entra no log: é credencial de envio. O `id` basta
      // para achar a linha.
      log.warn(
        { inscricaoId: inscricao.id, status },
        'falha ao enviar notificação push; a inscrição foi mantida',
      )
    }
  }

  return resumo
}
