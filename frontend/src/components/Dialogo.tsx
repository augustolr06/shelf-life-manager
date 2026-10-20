import { useEffect, useId, useRef, type ReactNode, type SyntheticEvent } from 'react'

type Props = {
  aberto: boolean
  titulo: string
  /** O texto do diálogo. Vira a descrição acessível dele. */
  children: ReactNode
  /** Os botões. O primeiro recebe o foco ao abrir. */
  acoes: ReactNode
  /**
   * O que o Esc faz. Sem isto o Esc não fecha: há diálogo que não tem para
   * onde voltar, como o de sessão expirada (T30). Com isto, quem fecha é quem
   * chama, mudando `aberto` — o diálogo nunca se fecha sozinho.
   */
  aoCancelar?: () => void
}

/**
 * Diálogo modal sobre o `<dialog>` nativo (T30). `showModal()` já dá o que um
 * modal precisa sem biblioteca: a tela de trás fica inerte, o foco não sai
 * dele, e ele fica por cima de tudo, inclusive dos toasts. Feito para ser
 * reaproveitado pelas confirmações de T39.
 *
 * Clique fora não fecha: o fundo não é um botão, e um toque perdido no
 * celular não pode descartar uma pergunta.
 */
export function Dialogo({ aberto, titulo, children, acoes, aoCancelar }: Props) {
  const referencia = useRef<HTMLDialogElement>(null)
  const idTitulo = useId()
  const idCorpo = useId()

  useEffect(() => {
    const dialogo = referencia.current
    if (!aberto || !dialogo || dialogo.open) return
    dialogo.showModal()
    // Foco explícito no primeiro botão: o React não escreve o atributo
    // `autofocus` no DOM, e sem ele cada navegador escolhe um alvo diferente.
    dialogo.querySelector<HTMLElement>('.dialogo-acoes button')?.focus()
  }, [aberto])

  if (!aberto) return null

  function pedirFechamento(evento: SyntheticEvent) {
    evento.preventDefault()
    aoCancelar?.()
  }

  return (
    <dialog
      ref={referencia}
      className="dialogo"
      aria-labelledby={idTitulo}
      aria-describedby={idCorpo}
      // Esc é tratado na tecla, antes de virar pedido de fechamento: o Chrome
      // ignora o `preventDefault` do `cancel` repetido sem clique entre um e
      // outro, e o segundo Esc fecharia o diálogo por conta própria.
      onKeyDown={(evento) => {
        if (evento.key === 'Escape') pedirFechamento(evento)
      }}
      // O que sobra: o botão voltar do Android, que chega como `cancel`.
      onCancel={pedirFechamento}
      onClose={() => {
        // Fechou por fora do controle (o `cancel` ignorado acima): quem pode
        // cancelar cancela; quem não pode volta a ver o diálogo.
        if (aoCancelar) aoCancelar()
        else referencia.current?.showModal()
      }}
    >
      <h2 id={idTitulo}>{titulo}</h2>
      <div id={idCorpo}>{children}</div>
      <div className="dialogo-acoes">{acoes}</div>
    </dialog>
  )
}
