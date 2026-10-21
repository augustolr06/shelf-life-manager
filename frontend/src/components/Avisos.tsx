import { Toaster } from 'sonner'

/** Nome acessível da região dos toasts; é por ele que os testes a encontram. */
export const ROTULO_AVISOS = 'Avisos'

/**
 * Onde os toasts de `services/avisos.ts` aparecem. Montado uma vez, em
 * `App.tsx` (T29).
 *
 * Embaixo, no centro: a única tela cujo conteúdo principal mora na metade de
 * baixo — o veredito da leitura — não dispara toast nenhum. À direita, ele
 * cobria a coluna "Ações" das tabelas, e o de erro, que não some sozinho,
 * ficava em cima do botão da última linha. No celular a biblioteca estica o
 * toast na largura da tela, logo acima da barra inferior, ao alcance do
 * polegar.
 *
 * As cores por tipo (`richColors`) vêm dos tokens semânticos de
 * `estilos.css`, que sobrescrevem as variáveis da biblioteca (T35).
 */
export function Avisos() {
  return (
    <Toaster
      position="bottom-center"
      richColors
      customAriaLabel={ROTULO_AVISOS}
      // No celular, acima da barra inferior (T41): 68 px de barra e 8 de
      // respiro. O corte de "celular" da biblioteca é o mesmo da navegação,
      // 600 px.
      mobileOffset={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom, 0px))' }}
      toastOptions={{ closeButtonAriaLabel: 'Fechar aviso' }}
    />
  )
}
