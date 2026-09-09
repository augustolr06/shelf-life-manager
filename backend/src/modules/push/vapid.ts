// Importado só pelo efeito colateral: `shared/env.ts` é quem carrega o `.env`
// do processo, e este módulo lê variáveis de ambiente diretamente.
import '../../shared/env.js'

/**
 * As chaves VAPID (RFC 8292) que autenticam este servidor perante o serviço de
 * push do navegador — a única credencial do sistema que **pode faltar**.
 *
 * É por isso que elas não ficam no objeto `env`, que é resolvido uma vez no
 * import e trata suas variáveis como pressuposto do processo. Aqui valem duas
 * regras diferentes:
 *
 * - **Ausência é um estado previsto, não erro de configuração.** Uma máquina de
 *   desenvolvimento, a suíte de testes e uma loja que não queira notificação
 *   sobem o servidor inteiro sem chave nenhuma; o que some é a notificação, e o
 *   sistema diz isso em vez de fingir que enviou (T19b, Decisão 4).
 * - **Resolvidas a cada chamada**, e não uma vez no import, para que a suíte
 *   possa exercitar os dois estados no mesmo processo — e para que trocar a
 *   chave no servidor da loja seja um reinício, não um rebuild.
 *
 * A chave **privada** nunca sai deste processo. A pública sai, mas por rota
 * autenticada (`GET /push/chave-publica`) em vez de embutida no bundle do
 * frontend: assim trocar o par não exige recompilar o app.
 */

export type ChavesVapid = {
  chavePublica: string
  chavePrivada: string
  /** Contato exigido pela RFC 8292 — `mailto:` ou `https:`. */
  assunto: string
}

const ASSUNTO_PADRAO = 'mailto:estoque@exemplo.local'

/** As chaves, ou `null` quando o push não está configurado neste servidor. */
export function chavesVapid(): ChavesVapid | null {
  const chavePublica = process.env.VAPID_PUBLIC_KEY
  const chavePrivada = process.env.VAPID_PRIVATE_KEY

  // As duas, ou nenhuma: meia configuração produziria erro de assinatura no
  // primeiro envio, longe daqui e sem explicação.
  if (!chavePublica || !chavePrivada) return null

  return {
    chavePublica,
    chavePrivada,
    assunto: process.env.VAPID_SUBJECT || ASSUNTO_PADRAO,
  }
}

export function pushEstaConfigurado(): boolean {
  return chavesVapid() !== null
}
