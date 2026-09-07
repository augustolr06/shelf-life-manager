import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaLogin } from './TelaLogin'
import { respostaFalsa } from '../services/testes/respostaFalsa'

const GESTOR = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Gestora de Loja',
  email: 'gestor@estoque.local',
  papel: 'GESTOR' as const,
}

const buscar = vi.fn<typeof fetch>()

/** Preenche o formulário e submete. */
function entrar(email: string, senha: string) {
  fireEvent.change(screen.getByLabelText(/e-mail/i), { target: { value: email } })
  fireEvent.change(screen.getByLabelText(/senha/i), { target: { value: senha } })
  fireEvent.click(screen.getByRole('button', { name: /entrar/i }))
}

describe('TelaLogin', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('autentica e devolve o usuário retornado pelo backend', async () => {
    buscar.mockResolvedValueOnce(respostaFalsa(200, { usuario: GESTOR }))
    const aoAutenticar = vi.fn()

    render(<TelaLogin aoAutenticar={aoAutenticar} />)
    entrar(GESTOR.email, 'estoque123')

    await vi.waitFor(() => expect(aoAutenticar).toHaveBeenCalledWith(GESTOR))
    expect(buscar).toHaveBeenCalledWith(
      'http://localhost:3333/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ email: GESTOR.email, senha: 'estoque123' }),
      }),
    )
  })

  it('exibe a mensagem que o backend devolveu para credencial inválida', async () => {
    buscar.mockResolvedValueOnce(
      respostaFalsa(401, {
        erro: 'CREDENCIAL_INVALIDA',
        mensagem: 'E-mail ou senha incorretos.',
      }),
    )
    const aoAutenticar = vi.fn()

    render(<TelaLogin aoAutenticar={aoAutenticar} />)
    entrar(GESTOR.email, 'senha-errada')

    // O texto é o do backend, não um julgamento do frontend (RNF04).
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.')
    expect(aoAutenticar).not.toHaveBeenCalled()
    // O formulário continua utilizável para nova tentativa.
    expect(screen.getByRole('button', { name: /entrar/i })).toBeEnabled()
  })

  it('não guarda credencial nem papel no armazenamento do navegador', async () => {
    buscar.mockResolvedValueOnce(respostaFalsa(200, { usuario: GESTOR }))

    render(<TelaLogin aoAutenticar={vi.fn()} />)
    entrar(GESTOR.email, 'estoque123')

    await vi.waitFor(() => expect(buscar).toHaveBeenCalled())
    // A sessão vive no cookie httpOnly; papel no cliente permitiria o
    // frontend decidir autorização, o que a RNF04 proíbe.
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})
