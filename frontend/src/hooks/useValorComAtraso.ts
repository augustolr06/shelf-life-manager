import { useEffect, useState } from 'react'

/**
 * O valor recebido, mas só depois de `atrasoMs` sem mudança (T26, Decisão 2).
 * Serve à busca enquanto se digita: sem o atraso, cada tecla seria uma
 * requisição. Cada nova mudança reinicia a contagem, então o valor devolvido é
 * o da última tecla, nunca um intermediário.
 */
export function useValorComAtraso<T>(valor: T, atrasoMs = 300): T {
  const [valorComAtraso, setValorComAtraso] = useState(valor)

  useEffect(() => {
    const temporizador = setTimeout(() => setValorComAtraso(valor), atrasoMs)
    return () => clearTimeout(temporizador)
  }, [valor, atrasoMs])

  return valorComAtraso
}
