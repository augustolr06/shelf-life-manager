import { act, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { Avisos, ROTULO_AVISOS } from '../../components/Avisos'

/** Monta a tela com a região dos toasts ao lado, como o `App` faz (T29). */
export function renderizarComAvisos(tela: ReactElement) {
  return render(
    <>
      <Avisos />
      {tela}
    </>,
  )
}

/**
 * O toast com o texto dado, e de que tipo ele é (T29). O teste procura o
 * aviso pelo que o usuário lê, e não pela chamada ao módulo.
 */
export async function encontrarAviso(
  texto: string | RegExp,
): Promise<{ elemento: HTMLElement; tipo: string | null }> {
  const regiao = screen.getByRole('region', { name: ROTULO_AVISOS })
  const elemento = await within(regiao).findByText(texto)
  const toast = elemento.closest<HTMLElement>('[data-sonner-toast]')
  return { elemento, tipo: toast?.dataset.type ?? null }
}

/**
 * Nenhum toast na tela — para o caso em que a mensagem precisa ficar no lugar.
 * Espera uma volta do laço de eventos antes de olhar: a biblioteca adiciona o
 * toast num `setTimeout`, e olhar antes daria "nenhum" para um toast a caminho.
 */
export async function semAvisos(): Promise<boolean> {
  await act(() => new Promise((resolver) => setTimeout(resolver, 0)))
  const regiao = screen.queryByRole('region', { name: ROTULO_AVISOS })
  return regiao === null || regiao.querySelector('[data-sonner-toast]') === null
}
