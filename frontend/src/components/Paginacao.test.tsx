import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Paginacao, paginasVisiveis } from './Paginacao'

describe('paginasVisiveis (T27)', () => {
  it('no meio, mostra duas vizinhas de cada lado, as pontas e reticências nos saltos', () => {
    expect(paginasVisiveis(6, 35)).toEqual([1, 'reticencias', 4, 5, 6, 7, 8, 'reticencias', 35])
  })

  it('na primeira página, a janela só cresce para a direita', () => {
    expect(paginasVisiveis(1, 35)).toEqual([1, 2, 3, 'reticencias', 35])
  })

  it('na última página, a janela só cresce para a esquerda', () => {
    expect(paginasVisiveis(35, 35)).toEqual([1, 'reticencias', 33, 34, 35])
  })

  it('perto da ponta, a janela encosta na primeira sem reticência', () => {
    expect(paginasVisiveis(3, 35)).toEqual([1, 2, 3, 4, 5, 'reticencias', 35])
    expect(paginasVisiveis(33, 35)).toEqual([1, 'reticencias', 31, 32, 33, 34, 35])
  })

  it('um salto de uma página só mostra o número, não a reticência', () => {
    expect(paginasVisiveis(5, 35)).toEqual([1, 2, 3, 4, 5, 6, 7, 'reticencias', 35])
    expect(paginasVisiveis(31, 35)).toEqual([1, 'reticencias', 29, 30, 31, 32, 33, 34, 35])
  })

  it('com poucas páginas, mostra todas', () => {
    expect(paginasVisiveis(1, 1)).toEqual([1])
    expect(paginasVisiveis(1, 2)).toEqual([1, 2])
    expect(paginasVisiveis(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('sem páginas, não mostra nada', () => {
    expect(paginasVisiveis(1, 0)).toEqual([])
  })
})

describe('Paginacao (T27)', () => {
  function renderizar(pagina: number, totalPaginas: number) {
    const aoMudar = vi.fn()
    const alvoRolagem = createRef<HTMLParagraphElement>()
    const resultado = render(
      <>
        <p ref={alvoRolagem}>Início da lista</p>
        <Paginacao
          pagina={pagina}
          totalPaginas={totalPaginas}
          aoMudar={aoMudar}
          alvoRolagem={alvoRolagem}
        />
      </>,
    )
    return { ...resultado, aoMudar, alvoRolagem }
  }

  it('não aparece quando há uma página só', () => {
    renderizar(1, 1)

    expect(screen.queryByRole('navigation', { name: 'Paginação' })).not.toBeInTheDocument()
  })

  it('leva à primeira, à anterior, à próxima e à última', () => {
    const { aoMudar } = renderizar(6, 35)

    fireEvent.click(screen.getByRole('button', { name: 'Primeira' }))
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    fireEvent.click(screen.getByRole('button', { name: 'Última' }))

    expect(aoMudar.mock.calls).toEqual([[1], [5], [7], [35]])
  })

  it('desabilita primeira e anterior na primeira página', () => {
    renderizar(1, 35)

    expect(screen.getByRole('button', { name: 'Primeira' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Última' })).toBeEnabled()
  })

  it('desabilita próxima e última na última página', () => {
    renderizar(35, 35)

    expect(screen.getByRole('button', { name: 'Primeira' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Última' })).toBeDisabled()
  })

  it('vai direto à página escolhida pelo número', () => {
    const { aoMudar } = renderizar(6, 35)

    fireEvent.click(screen.getByRole('button', { name: 'Ir para a página 8' }))

    expect(aoMudar).toHaveBeenCalledWith(8)
  })

  it('marca a página atual, que não é botão', () => {
    renderizar(6, 35)

    const atual = screen.getByRole('navigation').querySelector('[aria-current="page"]')
    expect(atual).toHaveTextContent('Página 6')
    expect(screen.queryByRole('button', { name: 'Ir para a página 6' })).not.toBeInTheDocument()
  })

  it('mostra os números da janela e as pontas, com reticências nos saltos', () => {
    renderizar(6, 35)

    // As reticências ficam fora do leitor de tela, e por isso fora de getByRole.
    const numeros = screen.getByRole('list').querySelectorAll('li')
    expect([...numeros].map((item) => item.textContent)).toEqual([
      '1',
      '…',
      '4',
      '5',
      'Página 6',
      '7',
      '8',
      '…',
      '35',
    ])
  })

  it('mostra a forma compacta da página atual, para tela estreita', () => {
    renderizar(6, 35)

    expect(screen.getByText('6 / 35')).toBeInTheDocument()
  })

  it('rola até o início da lista ao mudar de página', () => {
    const { alvoRolagem } = renderizar(6, 35)
    const rolar = vi.spyOn(alvoRolagem.current!, 'scrollIntoView')

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))

    expect(rolar).toHaveBeenCalledWith({ block: 'start' })
  })
})
