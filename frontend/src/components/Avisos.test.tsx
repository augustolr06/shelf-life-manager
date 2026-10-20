import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErroApi } from '../services/api'
import { avisar, DURACAO_SUCESSO_MS } from '../services/avisos'
import { encontrarAviso } from '../services/testes/avisos'
import { Avisos } from './Avisos'

afterEach(() => {
  vi.useRealTimers()
})

describe('Avisos (T29)', () => {
  it('mostra o sucesso como toast de sucesso', async () => {
    render(<Avisos />)

    act(() => avisar.sucesso('Produto cadastrado.'))

    expect((await encontrarAviso('Produto cadastrado.')).tipo).toBe('success')
  })

  it('mostra a mensagem que o servidor escreveu, como toast de erro', async () => {
    render(<Avisos />)

    act(() => avisar.erro(new ErroApi(409, 'Já existe um produto com este código.', 'CONFLITO')))

    expect((await encontrarAviso('Já existe um produto com este código.')).tipo).toBe('error')
  })

  it('cai no texto da ação quando a falha não traz mensagem do servidor', async () => {
    render(<Avisos />)

    act(() => avisar.erro(new TypeError('x is undefined'), 'Não foi possível inativar o produto.'))

    await encontrarAviso('Não foi possível inativar o produto.')
    // Erro de programação não vai para a tela com o texto técnico.
    expect(screen.queryByText('x is undefined')).not.toBeInTheDocument()
  })

  it('aceita uma mensagem já pronta', async () => {
    render(<Avisos />)

    act(() => avisar.erro('Esta unidade já foi resolvida por outra pessoa.'))

    await encontrarAviso('Esta unidade já foi resolvida por outra pessoa.')
  })

  it('o sucesso some sozinho, e o erro fica até ser fechado', async () => {
    vi.useFakeTimers()
    render(<Avisos />)

    act(() => {
      avisar.sucesso('Alerta marcado como lido.')
      avisar.erro('Seu papel não permite esta ação.')
    })
    // A biblioteca adiciona o toast num `setTimeout` próprio.
    act(() => vi.advanceTimersByTime(0))
    expect(screen.getByText('Alerta marcado como lido.')).toBeInTheDocument()

    // Folga para a animação de saída.
    act(() => vi.advanceTimersByTime(DURACAO_SUCESSO_MS * 3))

    expect(screen.queryByText('Alerta marcado como lido.')).not.toBeInTheDocument()
    expect(screen.getByText('Seu papel não permite esta ação.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }))
    act(() => vi.advanceTimersByTime(1000))

    expect(screen.queryByText('Seu papel não permite esta ação.')).not.toBeInTheDocument()
  })
})
