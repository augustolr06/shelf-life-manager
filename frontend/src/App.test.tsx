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

describe('App — guardião de sessão', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mostra a tela de login quando GET /auth/me responde 401', async () => {
    buscar.mockResolvedValueOnce(
      respostaFalsa(401, { erro: 'NAO_AUTENTICADO', mensagem: 'Sessão ausente ou expirada.' }),
    )

    render(<App />)

    // Antes da resposta chegar não pode aparecer nem login nem conteúdo.
    expect(screen.getByRole('status')).toHaveTextContent(/verificando sessão/i)

    expect(await screen.findByLabelText(/e-mail/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/senha/i)).toBeInTheDocument()
  })

  it('restaura a sessão existente sem passar pela tela de login', async () => {
    buscar.mockResolvedValueOnce(respostaFalsa(200, { usuario: GESTOR }))

    render(<App />)

    expect(await screen.findByText(/gestora de loja — gestor/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument()
  })

  it('envia o cookie de sessão em toda requisição', async () => {
    buscar.mockResolvedValueOnce(respostaFalsa(200, { usuario: GESTOR }))

    render(<App />)
    await screen.findByRole('button', { name: /sair/i })

    // Sem `credentials: 'include'` o navegador não manda o cookie httpOnly e
    // toda rota protegida responderia 401.
    expect(buscar).toHaveBeenCalledWith(
      'http://localhost:3333/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('encerra a sessão no backend e volta para a tela de login', async () => {
    buscar
      .mockResolvedValueOnce(respostaFalsa(200, { usuario: GESTOR }))
      .mockResolvedValueOnce(respostaFalsa(204))

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /sair/i }))

    expect(await screen.findByLabelText(/senha/i)).toBeInTheDocument()
    expect(buscar).toHaveBeenLastCalledWith(
      'http://localhost:3333/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('mantém a sessão aberta se o logout não chegar ao servidor', async () => {
    buscar
      .mockResolvedValueOnce(respostaFalsa(200, { usuario: GESTOR }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /sair/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível falar/i)
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument()
  })

  it('cai na tela de login avisando quando o backend está inalcançável', async () => {
    buscar.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    render(<App />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/conexão/i))
    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument()
  })
})
