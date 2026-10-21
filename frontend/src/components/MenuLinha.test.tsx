import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MenuLinha, type AcaoDaLinha } from './MenuLinha'

function montar(acoes: AcaoDaLinha[] = [{ rotulo: 'Inativar', perigo: true, aoEscolher: vi.fn() }]) {
  render(
    <>
      <MenuLinha rotulo="Ações de “Perfume”" acoes={acoes} />
      <button type="button">Fora do menu</button>
    </>,
  )
  return screen.getByRole('button', { name: 'Ações de “Perfume”' })
}

describe('MenuLinha (T45)', () => {
  it('abre com o foco no primeiro item e diz que está aberto', () => {
    const botao = montar()
    expect(botao).toHaveAttribute('aria-haspopup', 'menu')
    expect(botao).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(botao)

    expect(botao).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: 'Ações de “Perfume”' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Inativar' })).toHaveFocus()
  })

  it('escolher fecha o menu, devolve o foco ao botão e só então executa a ação', () => {
    const aoEscolher = vi.fn(() => {
      // A confirmação de T39 abre aqui; quando ela fechar, o foco volta a quem
      // estava com ele.
      expect(screen.getByRole('button', { name: 'Ações de “Perfume”' })).toHaveFocus()
    })
    const botao = montar([{ rotulo: 'Inativar', perigo: true, aoEscolher }])

    fireEvent.click(botao)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Inativar' }))

    expect(aoEscolher).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Esc fecha sem executar e devolve o foco ao botão', () => {
    const aoEscolher = vi.fn()
    const botao = montar([{ rotulo: 'Inativar', aoEscolher }])

    fireEvent.click(botao)
    fireEvent.keyDown(screen.getByRole('menuitem'), { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(botao).toHaveFocus()
    expect(aoEscolher).not.toHaveBeenCalled()
  })

  it('toque fora fecha sem executar', () => {
    const aoEscolher = vi.fn()
    const botao = montar([{ rotulo: 'Inativar', aoEscolher }])

    fireEvent.click(botao)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Fora do menu' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(aoEscolher).not.toHaveBeenCalled()
  })

  it('setas andam entre os itens, em volta', () => {
    const botao = montar([
      { rotulo: 'Primeira', aoEscolher: vi.fn() },
      { rotulo: 'Segunda', aoEscolher: vi.fn() },
    ])

    fireEvent.click(botao)
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Segunda' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Primeira' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByRole('menuitem', { name: 'Segunda' })).toHaveFocus()
  })
})
