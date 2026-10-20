import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaMinhaSenha } from './TelaMinhaSenha'
import { encontrarAviso, renderizarComAvisos, semAvisos } from '../services/testes/avisos'
import { respostaFalsa } from '../services/testes/respostaFalsa'

const buscar = vi.fn<typeof fetch>()

function preencher(atual: string, nova: string, confirmacao = nova) {
  fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: atual } })
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: nova } })
  fireEvent.change(screen.getByLabelText('Repetir a nova senha'), {
    target: { value: confirmacao },
  })
  fireEvent.click(screen.getByRole('button', { name: /^trocar senha$/i }))
}

describe('TelaMinhaSenha (T22)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('envia a senha atual e a nova, sem id nenhum', async () => {
    buscar.mockResolvedValueOnce(respostaFalsa(204))

    renderizarComAvisos(<TelaMinhaSenha />)
    preencher('senha-antiga-2026', 'senha-nova-2026')

    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(1))
    const chamada = buscar.mock.calls[0]
    expect(chamada?.[0]).toBe('http://localhost:3333/usuarios/eu/senha')
    expect(JSON.parse(String(chamada?.[1]?.body))).toEqual({
      senhaAtual: 'senha-antiga-2026',
      senhaNova: 'senha-nova-2026',
    })
  })

  it('confirma o sucesso e limpa os campos', async () => {
    buscar.mockResolvedValueOnce(respostaFalsa(204))

    renderizarComAvisos(<TelaMinhaSenha />)
    preencher('senha-antiga-2026', 'senha-nova-2026')

    expect((await encontrarAviso(/Senha trocada/)).tipo).toBe('success')
    expect(screen.getByLabelText('Senha atual')).toHaveValue('')
    expect(screen.getByLabelText('Nova senha')).toHaveValue('')
  })

  // Conferência local de digitação — não chega a sair da tela.
  it('recusa confirmação diferente sem chamar a API', async () => {
    renderizarComAvisos(<TelaMinhaSenha />)
    preencher('senha-antiga-2026', 'senha-nova-2026', 'senha-nova-2027')

    expect(await screen.findByRole('alert')).toHaveTextContent(/confirmação não corresponde/i)
    expect(buscar).not.toHaveBeenCalled()
    // Aponta um campo digitado: fica no formulário, não vira toast (T29).
    expect(await semAvisos()).toBe(true)
  })

  // RNF04: senha atual errada é veredito do backend, e a mensagem é a dele.
  it('mostra a recusa do backend quando a senha atual está errada', async () => {
    buscar.mockResolvedValueOnce(
      respostaFalsa(401, { erro: 'SENHA_ATUAL_INCORRETA', mensagem: 'Senha atual incorreta.' }),
    )

    renderizarComAvisos(<TelaMinhaSenha />)
    preencher('chutei', 'senha-nova-2026')

    expect((await encontrarAviso('Senha atual incorreta.')).tipo).toBe('error')
  })
})
