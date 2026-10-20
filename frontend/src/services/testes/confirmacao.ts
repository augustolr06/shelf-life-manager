import { fireEvent, screen, within } from '@testing-library/react'

/**
 * A confirmação de ação destrutiva aberta (T39), achada pelo título que a
 * pessoa lê.
 */
export async function encontrarConfirmacao(titulo: string | RegExp): Promise<HTMLElement> {
  return screen.findByRole('dialog', { name: titulo })
}

/**
 * Clica num dos botões da confirmação aberta: o verbo da ação, para seguir, ou
 * "Cancelar". Procura dentro do diálogo, porque o verbo costuma repetir o
 * rótulo do botão da tela ("Inativar").
 */
export async function responderConfirmacao(
  titulo: string | RegExp,
  botao: string | RegExp,
): Promise<void> {
  const dialogo = await encontrarConfirmacao(titulo)
  fireEvent.click(within(dialogo).getByRole('button', { name: botao }))
}
