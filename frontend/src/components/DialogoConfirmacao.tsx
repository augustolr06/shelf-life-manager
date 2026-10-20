import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Dialogo } from './Dialogo'

export type PedidoConfirmacao = {
  /** A pergunta, com o verbo da ação: "Inativar produto?". */
  titulo: string
  /**
   * O que acontece se a pessoa confirmar, citando o dado concreto (código da
   * unidade, nome do produto, nome da conta), para ela perceber se clicou na
   * linha errada. Descreve o que o servidor faz; não promete nada além disso.
   */
  consequencia: string
  /** Repete o verbo da ação ("Descartar"), nunca "OK" ou "Sim". */
  rotuloConfirmar: string
}

type Confirmar = (pedido: PedidoConfirmacao) => Promise<boolean>

const ContextoConfirmacao = createContext<Confirmar | null>(null)

/**
 * Confirmação antes de ação destrutiva (T39). Na tela, a ação vira
 * `if (!(await confirmar({...}))) return` antes da chamada à API: o fluxo
 * continua legível de cima para baixo, sem estado de "diálogo aberto" em cada
 * componente.
 *
 * A confirmação é só de interface (RNF04): ela libera a mesma chamada que
 * antes saía no clique, e quem autoriza e valida continua sendo o servidor.
 */
export function useConfirmacao(): Confirmar {
  const confirmar = useContext(ContextoConfirmacao)
  if (!confirmar) throw new Error('useConfirmacao precisa de um <ProvedorConfirmacao> acima.')
  return confirmar
}

/** Monta o único diálogo de confirmação do app. Fica no `App`, em volta das telas. */
export function ProvedorConfirmacao({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<PedidoConfirmacao | null>(null)
  /** Quem está esperando a resposta do pedido aberto. */
  const responderAberto = useRef<((confirmado: boolean) => void) | null>(null)

  const confirmar = useCallback<Confirmar>(
    (novo) =>
      new Promise<boolean>((resolver) => {
        // Um pedido novo com outro ainda aberto não deixa o primeiro esperando
        // para sempre: ele é cancelado, que é o desfecho seguro.
        responderAberto.current?.(false)
        responderAberto.current = resolver
        setPedido(novo)
      }),
    [],
  )

  function responder(confirmado: boolean) {
    responderAberto.current?.(confirmado)
    responderAberto.current = null
    setPedido(null)
  }

  return (
    <ContextoConfirmacao.Provider value={confirmar}>
      {children}
      <Dialogo
        aberto={pedido !== null}
        titulo={pedido?.titulo ?? ''}
        aoCancelar={() => responder(false)}
        acoes={
          // Cancelar primeiro, e por isso com o foco: Enter ou um segundo
          // toque no mesmo lugar nunca executam a ação destrutiva.
          <>
            <button type="button" className="secundario" onClick={() => responder(false)}>
              Cancelar
            </button>
            <button type="button" onClick={() => responder(true)}>
              {pedido?.rotuloConfirmar}
            </button>
          </>
        }
      >
        <p>{pedido?.consequencia}</p>
      </Dialogo>
    </ContextoConfirmacao.Provider>
  )
}
