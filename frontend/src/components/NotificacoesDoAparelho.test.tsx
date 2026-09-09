import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificacoesDoAparelho } from './NotificacoesDoAparelho'
import { respostaFalsa } from '../services/testes/respostaFalsa'

/**
 * O bloco "Neste aparelho" da configuração de alertas (RF08, T19b).
 *
 * As APIs de push do navegador não existem em jsdom, então elas entram aqui
 * como dublês — do mesmo modo que a suíte de T10 dubla o leitor de câmera. O
 * que estes testes cobrem é a **decisão da tela**: o que ela mostra em cada
 * estado do aparelho, quando ela pede permissão e o que manda ao servidor. O
 * que eles não cobrem, e nenhum teste automatizado cobre, é a notificação
 * chegando de verdade — isso é a verificação em aparelho real, com HTTPS.
 */

const CHAVE_PUBLICA = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'

const ENDPOINT = 'https://push.exemplo.local/aparelho-da-gestora'

const buscar = vi.fn<typeof fetch>()

/** Um `PushSubscription` reduzido ao que o componente usa. */
function inscricaoFalsa() {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p256dh-do-aparelho', auth: 'auth-do-aparelho' } }),
    unsubscribe: vi.fn(async () => true),
  }
}

/**
 * Liga no `navigator` e no `window` o mínimo que o componente exige para
 * considerar o aparelho compatível.
 */
function aparelhoCompativel(opcoes: {
  inscricaoAtual?: ReturnType<typeof inscricaoFalsa> | null
  permissao?: NotificationPermission
  aoInscrever?: () => unknown
  semServiceWorker?: boolean
}) {
  const inscrever = vi.fn(async () => opcoes.aoInscrever?.() ?? inscricaoFalsa())
  const registro = {
    pushManager: {
      getSubscription: vi.fn(async () => opcoes.inscricaoAtual ?? null),
      subscribe: inscrever,
    },
  }
  const pedirPermissao = vi.fn(async () => opcoes.permissao ?? 'granted')

  vi.stubGlobal('navigator', {
    serviceWorker: { getRegistration: vi.fn(async () => (opcoes.semServiceWorker ? undefined : registro)) },
  })
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('Notification', {
    permission: opcoes.permissao === 'denied' ? 'denied' : 'default',
    requestPermission: pedirPermissao,
  })

  return { inscrever, pedirPermissao, registro }
}

/** O corpo JSON enviado na chamada de índice `n`. */
function corpoDaChamada(n: number): unknown {
  const [, init] = buscar.mock.calls[n] as [string, RequestInit]
  return JSON.parse(String(init.body))
}

describe('NotificacoesDoAparelho (RF08, T19b)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('declara o navegador sem suporte e não consulta o servidor', async () => {
    // jsdom não tem `serviceWorker`, `PushManager` nem `Notification`: é o
    // estado do navegador antigo, e nele a tela não deve prometer nada.
    render(<NotificacoesDoAparelho />)

    expect(await screen.findByText(/não oferece notificações/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(buscar).not.toHaveBeenCalled()
  })

  it('pede para instalar o aplicativo quando não há service worker registrado', async () => {
    aparelhoCompativel({ semServiceWorker: true })

    render(<NotificacoesDoAparelho />)

    expect(await screen.findByText(/Instale o aplicativo/i)).toBeInTheDocument()
    expect(buscar).not.toHaveBeenCalled()
  })

  it('oferece ativar quando o aparelho pode receber e ainda não recebe', async () => {
    aparelhoCompativel({})
    buscar.mockResolvedValueOnce(respostaFalsa(200, { chavePublica: CHAVE_PUBLICA }))

    render(<NotificacoesDoAparelho />)

    expect(await screen.findByRole('button', { name: 'Ativar notificações' })).toBeInTheDocument()
    expect(buscar).toHaveBeenCalledWith(
      'http://localhost:3333/push/chave-publica',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('diz que o servidor não envia notificação quando ele responde 503', async () => {
    aparelhoCompativel({})
    buscar.mockResolvedValueOnce(
      respostaFalsa(503, { erro: 'PUSH_NAO_CONFIGURADO', mensagem: 'Sem push.' }),
    )

    render(<NotificacoesDoAparelho />)

    expect(await screen.findByText(/servidor não está configurado/i)).toBeInTheDocument()
    // Nada de botão: ativar não levaria a lugar nenhum.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('mostra o aparelho já inscrito, sem pedir a chave ao servidor', async () => {
    aparelhoCompativel({ inscricaoAtual: inscricaoFalsa() })

    render(<NotificacoesDoAparelho />)

    expect(await screen.findByRole('button', { name: 'Desativar notificações' })).toBeInTheDocument()
    expect(buscar).not.toHaveBeenCalled()
  })

  it('diz que a permissão está bloqueada no navegador', async () => {
    aparelhoCompativel({ permissao: 'denied' })

    render(<NotificacoesDoAparelho />)

    expect(await screen.findByText(/notificações estão bloqueadas/i)).toBeInTheDocument()
    // A chave não é pedida: não há o que ativar enquanto o bloqueio valer.
    expect(buscar).not.toHaveBeenCalled()
  })

  it('ativar pede a permissão no clique, inscreve no navegador e avisa o servidor', async () => {
    const aparelho = aparelhoCompativel({})
    buscar.mockResolvedValueOnce(respostaFalsa(200, { chavePublica: CHAVE_PUBLICA }))
    buscar.mockResolvedValueOnce(respostaFalsa(201, { inscricao: { id: 'i1', criadoEm: 'agora' } }))

    render(<NotificacoesDoAparelho />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ativar notificações' }))

    await screen.findByRole('button', { name: 'Desativar notificações' })

    // A permissão só é pedida depois do clique: pedir na abertura da tela é o
    // caminho mais curto para a gestora recusar para sempre.
    expect(aparelho.pedirPermissao).toHaveBeenCalledTimes(1)
    expect(aparelho.inscrever).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    )

    const [url, init] = buscar.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('http://localhost:3333/push/inscricoes')
    expect(init.method).toBe('POST')
    expect(corpoDaChamada(1)).toEqual({
      endpoint: ENDPOINT,
      chaves: { p256dh: 'p256dh-do-aparelho', auth: 'auth-do-aparelho' },
    })
  })

  it('permissão recusada no clique não vira inscrição', async () => {
    const aparelho = aparelhoCompativel({ permissao: 'default' })
    buscar.mockResolvedValueOnce(respostaFalsa(200, { chavePublica: CHAVE_PUBLICA }))
    aparelho.pedirPermissao.mockResolvedValueOnce('denied')

    render(<NotificacoesDoAparelho />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ativar notificações' }))

    expect(await screen.findByText(/notificações estão bloqueadas/i)).toBeInTheDocument()
    expect(aparelho.inscrever).not.toHaveBeenCalled()
    // Só a chave pública foi buscada; nada foi inscrito no servidor.
    expect(buscar).toHaveBeenCalledTimes(1)
  })

  it('desativar remove no servidor e cancela no navegador', async () => {
    const inscricao = inscricaoFalsa()
    aparelhoCompativel({ inscricaoAtual: inscricao })
    buscar.mockResolvedValueOnce(respostaFalsa(204))
    buscar.mockResolvedValueOnce(respostaFalsa(200, { chavePublica: CHAVE_PUBLICA }))

    render(<NotificacoesDoAparelho />)
    fireEvent.click(await screen.findByRole('button', { name: 'Desativar notificações' }))

    await waitFor(() => expect(inscricao.unsubscribe).toHaveBeenCalledTimes(1))

    const [url, init] = buscar.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3333/push/inscricoes')
    expect(init.method).toBe('DELETE')
    expect(corpoDaChamada(0)).toEqual({ endpoint: ENDPOINT })
  })

  it('exibe a mensagem do servidor quando a inscrição falha', async () => {
    aparelhoCompativel({})
    buscar.mockResolvedValueOnce(respostaFalsa(200, { chavePublica: CHAVE_PUBLICA }))
    buscar.mockResolvedValueOnce(
      respostaFalsa(503, { erro: 'PUSH_NAO_CONFIGURADO', mensagem: 'Este servidor não envia notificações.' }),
    )

    render(<NotificacoesDoAparelho />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ativar notificações' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Este servidor não envia notificações.',
    )
  })
})
