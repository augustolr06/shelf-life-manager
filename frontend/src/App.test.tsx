import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { respostaFalsa } from './services/testes/respostaFalsa'

const GESTOR = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Gestora de Loja',
  email: 'gestor@estoque.local',
  papel: 'GESTOR' as const,
}

const buscar = vi.fn<typeof fetch>()

const SESSAO_ATIVA = () => respostaFalsa(200, { usuario: GESTOR })
const SEM_SESSAO = () =>
  respostaFalsa(401, { erro: 'NAO_AUTENTICADO', mensagem: 'Sessão ausente ou expirada.' })
const CATALOGO_VAZIO = () =>
  respostaFalsa(200, { produtos: [], total: 0, pagina: 1, tamanhoPagina: 20 })
const REDE_FORA = () => {
  throw new TypeError('Failed to fetch')
}

/**
 * O `App` autenticado dispara requisições de mais de um módulo (sessão e
 * catálogo), e a ordem entre elas não é o objeto do teste. Por isso o dublê
 * responde por rota, e não por sequência de chamadas.
 */
function rotear(rotas: Record<string, () => Response>) {
  buscar.mockImplementation(async (entrada, init) => {
    const caminho = String(entrada).replace('http://localhost:3333', '')
    const chave = `${init?.method ?? 'GET'} ${caminho}`
    const manipulador = rotas[chave]
    if (!manipulador) throw new Error(`rota não simulada no teste: ${chave}`)
    return manipulador()
  })
}

describe('App — guardião de sessão', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mostra a tela de login quando GET /auth/me responde 401', async () => {
    rotear({ 'GET /auth/me': SEM_SESSAO })

    render(<App />)

    // Antes da resposta chegar não pode aparecer nem login nem conteúdo.
    expect(screen.getByRole('status')).toHaveTextContent(/verificando sessão/i)

    expect(await screen.findByLabelText(/e-mail/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/senha/i)).toBeInTheDocument()
  })

  it('restaura a sessão existente sem passar pela tela de login', async () => {
    rotear({ 'GET /auth/me': SESSAO_ATIVA, 'GET /produtos': CATALOGO_VAZIO })

    render(<App />)

    expect(await screen.findByText(/gestora de loja — gestor/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument()
    // A tela de domínio de T04 é renderizada dentro do ramo autenticado.
    expect(screen.getByRole('heading', { name: /catálogo de produtos/i })).toBeInTheDocument()
  })

  it('envia o cookie de sessão em toda requisição', async () => {
    rotear({ 'GET /auth/me': SESSAO_ATIVA, 'GET /produtos': CATALOGO_VAZIO })

    render(<App />)
    await screen.findByRole('button', { name: /sair/i })

    // Sem `credentials: 'include'` o navegador não manda o cookie httpOnly e
    // toda rota protegida responderia 401.
    for (const [, init] of buscar.mock.calls) {
      expect(init).toMatchObject({ credentials: 'include' })
    }
  })

  it('encerra a sessão no backend e volta para a tela de login', async () => {
    rotear({
      'GET /auth/me': SESSAO_ATIVA,
      'GET /produtos': CATALOGO_VAZIO,
      'POST /auth/logout': () => respostaFalsa(204),
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /sair/i }))

    expect(await screen.findByLabelText(/senha/i)).toBeInTheDocument()
    expect(buscar).toHaveBeenLastCalledWith(
      'http://localhost:3333/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('mantém a sessão aberta se o logout não chegar ao servidor', async () => {
    rotear({
      'GET /auth/me': SESSAO_ATIVA,
      'GET /produtos': CATALOGO_VAZIO,
      'POST /auth/logout': REDE_FORA,
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /sair/i }))

    // O cookie continua válido no navegador; fingir que a sessão acabou
    // deixaria a tela mentindo sobre o estado real.
    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível falar/i)
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument()
  })

  it('cai na tela de login avisando quando o backend está inalcançável', async () => {
    rotear({ 'GET /auth/me': REDE_FORA })

    render(<App />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/conexão/i))
    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument()
  })
})
