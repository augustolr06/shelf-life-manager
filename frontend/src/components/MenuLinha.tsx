import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Icone } from './Icone'

export type AcaoDaLinha = {
  rotulo: string
  /** Ação destrutiva: o item sai no vermelho da variante `perigo`. */
  perigo?: boolean
  aoEscolher: () => void
}

type Props = {
  /** O nome acessível do botão "…": diz de que linha são as ações. */
  rotulo: string
  acoes: AcaoDaLinha[]
}

/** Distância entre o botão e o menu, e entre o menu e a borda da janela. */
const FOLGA = 4

/**
 * O menu "…" de uma linha de tabela (T45). Abre por baixo do botão, ou por
 * cima quando não cabe embaixo.
 *
 * O menu vai para o `body` (portal), com posição fixa: dentro da célula, ele
 * seria cortado pelo contêiner que rola a tabela na horizontal no celular.
 * Por isso fecha ao rolar ou redimensionar — a posição foi calculada para o
 * botão onde ele estava.
 *
 * Escolher uma ação devolve o foco ao botão antes de executá-la: a confirmação
 * de T39 abre a seguir, e é a ele que o foco volta quando ela fecha.
 */
export function MenuLinha({ rotulo, acoes }: Props) {
  const [aberto, setAberto] = useState(false)
  const botao = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const idMenu = useId()

  function fechar(devolverFoco: boolean) {
    setAberto(false)
    if (devolverFoco) botao.current?.focus()
  }

  // Posição antes da pintura, para o menu não aparecer um quadro no lugar
  // errado. Precisa da altura do próprio menu para saber se cabe embaixo.
  useLayoutEffect(() => {
    const caixa = menu.current
    const ancora = botao.current
    if (!aberto || !caixa || !ancora) return

    const alvo = ancora.getBoundingClientRect()
    const cabeEmbaixo = alvo.bottom + FOLGA + caixa.offsetHeight <= window.innerHeight - FOLGA
    caixa.style.right = `${Math.max(FOLGA, window.innerWidth - alvo.right)}px`
    caixa.style.top = cabeEmbaixo
      ? `${alvo.bottom + FOLGA}px`
      : `${Math.max(FOLGA, alvo.top - FOLGA - caixa.offsetHeight)}px`
    caixa.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [aberto])

  useEffect(() => {
    if (!aberto) return

    function tocouFora(evento: PointerEvent) {
      const alvo = evento.target as Node
      if (!menu.current?.contains(alvo) && !botao.current?.contains(alvo)) fechar(false)
    }
    const saiuDoLugar = () => fechar(false)

    document.addEventListener('pointerdown', tocouFora)
    // Captura: a rolagem que importa costuma ser a do contêiner da tabela, e
    // evento de rolagem não sobe até a janela.
    window.addEventListener('scroll', saiuDoLugar, true)
    window.addEventListener('resize', saiuDoLugar)
    return () => {
      document.removeEventListener('pointerdown', tocouFora)
      window.removeEventListener('scroll', saiuDoLugar, true)
      window.removeEventListener('resize', saiuDoLugar)
    }
  }, [aberto])

  function navegar(evento: KeyboardEvent<HTMLDivElement>) {
    if (evento.key === 'Escape') {
      evento.preventDefault()
      fechar(true)
      return
    }
    // Tab sai do menu: ele fecha e o foco segue o caminho normal da página.
    if (evento.key === 'Tab') {
      fechar(false)
      return
    }

    const itens = Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    )
    const atual = itens.indexOf(document.activeElement as HTMLElement)
    const destino = {
      ArrowDown: (atual + 1) % itens.length,
      ArrowUp: (atual - 1 + itens.length) % itens.length,
      Home: 0,
      End: itens.length - 1,
    }[evento.key]
    if (destino === undefined) return
    evento.preventDefault()
    itens[destino]?.focus()
  }

  return (
    <>
      <button
        ref={botao}
        type="button"
        className="fantasma botao-icone"
        aria-label={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idMenu : undefined}
        onClick={() => (aberto ? fechar(true) : setAberto(true))}
      >
        <Icone nome="maisAcoes" />
      </button>

      {aberto &&
        createPortal(
          <div
            ref={menu}
            id={idMenu}
            role="menu"
            aria-label={rotulo}
            className="menu-linha"
            onKeyDown={navegar}
          >
            {acoes.map((acao) => (
              <button
                key={acao.rotulo}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={acao.perigo ? 'item-menu-linha perigo' : 'item-menu-linha'}
                onClick={() => {
                  fechar(true)
                  acao.aoEscolher()
                }}
              >
                {acao.rotulo}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
