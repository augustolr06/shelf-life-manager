import { useEffect, useState } from 'react'

/**
 * Os três tamanhos da navegação (T41), com os cortes da especificação do
 * redesign: celular abaixo de 600 px, tablet de 600 a 1024 e computador acima.
 *
 * O menu é escolhido aqui, e não só por `@media` no CSS, porque cada formato
 * monta uma navegação diferente (menu lateral ou barra inferior com a folha
 * "Mais"). Com as duas no DOM e uma escondida, os links apareceriam em
 * dobro para quem não enxerga o CSS — o leitor de tela no meio da troca e o
 * jsdom dos testes.
 */
export type FormatoDaTela = 'computador' | 'tablet' | 'celular'

const CELULAR = '(max-width: 599.98px)'
const TABLET = '(max-width: 1024px)'

function formatoAtual(): FormatoDaTela {
  // O jsdom não tem `matchMedia`; fora dele, todo navegador que roda o PWA tem.
  if (typeof window.matchMedia !== 'function') return 'computador'
  if (window.matchMedia(CELULAR).matches) return 'celular'
  if (window.matchMedia(TABLET).matches) return 'tablet'
  return 'computador'
}

export function useFormatoDaTela(): FormatoDaTela {
  const [formato, setFormato] = useState(formatoAtual)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const consultas = [window.matchMedia(CELULAR), window.matchMedia(TABLET)]
    const atualizar = () => setFormato(formatoAtual())
    for (const consulta of consultas) consulta.addEventListener('change', atualizar)
    return () => {
      for (const consulta of consultas) consulta.removeEventListener('change', atualizar)
    }
  }, [])

  return formato
}
