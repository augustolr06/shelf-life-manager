import { useCallback, useEffect, useState } from 'react'
import { ErroApi } from '../services/api'
import {
  buscarChavePublicaPush,
  desinscreverAparelho,
  inscreverAparelho,
} from '../services/push'

/**
 * O bloco "Neste aparelho" da tela de configuração de alertas (RF08, T19b).
 *
 * É o único ponto do frontend que fala com as APIs de push do navegador —
 * permissão, service worker e `PushManager` —, isolado aqui pela mesma razão
 * que `LeitorCamera` isola a câmera em T10: são APIs que não existem em jsdom e
 * que dependem de contexto seguro (HTTPS ou `localhost`), então concentrá-las
 * num componente deixa claro o que a suíte cobre por dublê e o que só a
 * verificação em aparelho real cobre.
 *
 * A inscrição é **do aparelho, não da pessoa**: o celular da gestora e o
 * computador da loja são duas inscrições, e desativar num não cala o outro.
 *
 * Nenhum julgamento vive aqui (RNF04): quem decide o que notificar, quando e
 * para quem é o servidor. Esta tela liga e desliga o recebimento neste
 * aparelho, e diz honestamente quando não pode.
 */

type Estado =
  | { situacao: 'verificando' }
  /** Navegador sem suporte, ou service worker ainda não registrado. */
  | { situacao: 'indisponivel'; motivo: string }
  | { situacao: 'negada' }
  /** O servidor não tem chaves VAPID: não há notificação a receber. */
  | { situacao: 'servidorSemPush' }
  | { situacao: 'inativa'; chavePublica: string }
  | { situacao: 'ativa'; endpoint: string }

const MOTIVO_NAVEGADOR =
  'Este navegador não oferece notificações. Os alertas continuam na aba Alertas.'

const MOTIVO_SEM_SERVICE_WORKER =
  'Instale o aplicativo (ou recarregue a página) para poder receber notificações neste aparelho.'

/**
 * A chave pública VAPID viaja em base64url e o `PushManager` exige bytes.
 * Conversão mecânica, sem regra: o `+`/`/` do base64 comum vira `-`/`_` no
 * base64url, e o preenchimento com `=` é retirado na ida.
 */
function chaveParaBytes(chaveBase64Url: string): Uint8Array<ArrayBuffer> {
  const preenchimento = '='.repeat((4 - (chaveBase64Url.length % 4)) % 4)
  const base64 = (chaveBase64Url + preenchimento).replace(/-/g, '+').replace(/_/g, '/')
  const binario = atob(base64)
  // Sobre um `ArrayBuffer` explícito, e não `new Uint8Array(n)`: o
  // `applicationServerKey` do `PushManager` não aceita a forma genérica, que
  // admitiria também `SharedArrayBuffer`.
  const bytes = new Uint8Array(new ArrayBuffer(binario.length))
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i)
  return bytes
}

function suportaPush(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  )
}

export function NotificacoesDoAparelho() {
  const [estado, setEstado] = useState<Estado>({ situacao: 'verificando' })
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const verificar = useCallback(async () => {
    if (!suportaPush()) {
      setEstado({ situacao: 'indisponivel', motivo: MOTIVO_NAVEGADOR })
      return
    }

    // `getRegistration` e não `ready`: sem service worker registrado, `ready`
    // nunca resolve, e a tela ficaria em "verificando…" para sempre.
    const registro = await navigator.serviceWorker.getRegistration()
    if (!registro) {
      setEstado({ situacao: 'indisponivel', motivo: MOTIVO_SEM_SERVICE_WORKER })
      return
    }

    const inscricao = await registro.pushManager.getSubscription()
    if (inscricao) {
      setEstado({ situacao: 'ativa', endpoint: inscricao.endpoint })
      return
    }

    if (Notification.permission === 'denied') {
      setEstado({ situacao: 'negada' })
      return
    }

    try {
      // A chave é buscada agora, e não no clique: é ela que diz se este
      // servidor sequer envia notificação, e a tela precisa contar isso antes
      // de oferecer um botão que não levaria a nada.
      setEstado({ situacao: 'inativa', chavePublica: await buscarChavePublicaPush() })
    } catch (falha) {
      if (falha instanceof ErroApi && falha.codigo === 'PUSH_NAO_CONFIGURADO') {
        setEstado({ situacao: 'servidorSemPush' })
        return
      }
      setEstado({ situacao: 'indisponivel', motivo: MOTIVO_NAVEGADOR })
      setErro(falha instanceof Error ? falha.message : 'Não foi possível consultar o servidor.')
    }
  }, [])

  useEffect(() => {
    void verificar()
  }, [verificar])

  async function ativar(chavePublica: string) {
    setErro(null)
    setOcupado(true)
    try {
      // A permissão é pedida **no clique**, nunca na abertura da tela: o
      // navegador penaliza (e o usuário recusa) o pedido que aparece sem que
      // ninguém tenha pedido nada.
      const permissao = await Notification.requestPermission()
      if (permissao !== 'granted') {
        setEstado({ situacao: 'negada' })
        return
      }

      const registro = await navigator.serviceWorker.getRegistration()
      if (!registro) {
        setEstado({ situacao: 'indisponivel', motivo: MOTIVO_SEM_SERVICE_WORKER })
        return
      }

      const inscricao = await registro.pushManager.subscribe({
        // Exigido pelos navegadores: todo push precisa virar notificação
        // visível. É a mesma promessa que `sw-push.js` cumpre.
        userVisibleOnly: true,
        applicationServerKey: chaveParaBytes(chavePublica),
      })

      const dados = inscricao.toJSON()
      await inscreverAparelho({
        endpoint: inscricao.endpoint,
        chaves: {
          p256dh: dados.keys?.p256dh ?? '',
          auth: dados.keys?.auth ?? '',
        },
      })

      setEstado({ situacao: 'ativa', endpoint: inscricao.endpoint })
    } catch (falha) {
      setErro(
        falha instanceof Error
          ? falha.message
          : 'Não foi possível ativar as notificações neste aparelho.',
      )
    } finally {
      setOcupado(false)
    }
  }

  async function desativar(endpoint: string) {
    setErro(null)
    setOcupado(true)
    try {
      // O servidor primeiro: se o navegador falhar em cancelar, o pior caso é
      // uma inscrição que existe no aparelho e não recebe mais nada. Na ordem
      // inversa, o pior caso seria o servidor continuar mandando aviso para um
      // aparelho que pediu silêncio.
      await desinscreverAparelho(endpoint)

      const registro = await navigator.serviceWorker.getRegistration()
      const inscricao = await registro?.pushManager.getSubscription()
      await inscricao?.unsubscribe()

      await verificar()
    } catch (falha) {
      setErro(
        falha instanceof Error
          ? falha.message
          : 'Não foi possível desativar as notificações neste aparelho.',
      )
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section className="notificacoes-do-aparelho">
      <h3>Notificações neste aparelho</h3>

      {estado.situacao === 'verificando' && <p role="status">Verificando este aparelho…</p>}

      {estado.situacao === 'indisponivel' && <p className="nota-informativa">{estado.motivo}</p>}

      {estado.situacao === 'servidorSemPush' && (
        <p className="nota-informativa">
          Este servidor não está configurado para enviar notificações. Os alertas continuam
          aparecendo na aba <strong>Alertas</strong>.
        </p>
      )}

      {estado.situacao === 'negada' && (
        <p className="nota-informativa">
          As notificações estão bloqueadas para este site. Libere nas configurações do
          navegador e volte aqui.
        </p>
      )}

      {estado.situacao === 'inativa' && (
        <>
          <p className="nota-informativa">
            Este aparelho não recebe notificações. Sem elas, o alerta só aparece para quem
            abrir o sistema.
          </p>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void ativar(estado.chavePublica)}
          >
            {ocupado ? 'Ativando…' : 'Ativar notificações'}
          </button>
        </>
      )}

      {estado.situacao === 'ativa' && (
        <>
          <p className="nota-informativa">
            Este aparelho recebe as notificações das janelas com canal push ou ambos.
          </p>
          <button type="button" disabled={ocupado} onClick={() => void desativar(estado.endpoint)}>
            {ocupado ? 'Desativando…' : 'Desativar notificações'}
          </button>
        </>
      )}

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
    </section>
  )
}
