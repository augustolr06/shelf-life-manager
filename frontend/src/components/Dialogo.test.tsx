import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dialogo } from './Dialogo'

function montar(props: { aberto?: boolean; aoCancelar?: () => void } = {}) {
  return render(
    <Dialogo
      aberto={props.aberto ?? true}
      titulo="Descartar unidade?"
      aoCancelar={props.aoCancelar}
      acoes={
        <>
          <button type="button">Cancelar</button>
          <button type="button">Descartar</button>
        </>
      }
    >
      <p>A unidade sai do estoque.</p>
    </Dialogo>,
  )
}

describe('Dialogo (T30)', () => {
  it('abre com título e texto como nome e descrição acessíveis', () => {
    montar()

    const dialogo = screen.getByRole('dialog', { name: 'Descartar unidade?' })
    expect(dialogo).toHaveAccessibleDescription('A unidade sai do estoque.')
  })

  it('põe o foco no primeiro botão das ações', () => {
    montar()

    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
  })

  it('não renderiza nada fechado', () => {
    montar({ aberto: false })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('sem aoCancelar, o Esc não fecha', () => {
    montar()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('com aoCancelar, o Esc chama quem decide fechar', () => {
    const aoCancelar = vi.fn()
    montar({ aoCancelar })

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(aoCancelar).toHaveBeenCalledTimes(1)
  })

  it('reabre se o navegador fechar por fora um diálogo que não pode ser cancelado', () => {
    montar()
    const dialogo = screen.getByRole<HTMLDialogElement>('dialog')

    dialogo.close()

    expect(dialogo.open).toBe(true)
  })
})
