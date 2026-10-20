import type { RefObject } from 'react'

/**
 * Os controles de página das listas paginadas (T27): Catálogo, Alertas, fila
 * de descarte, Etiquetas e histórico de saídas do Dashboard.
 *
 * Até T27 cada tela tinha o próprio par Anterior/Próxima, e com 700 SKUs em
 * páginas de 20 a página 30 do catálogo ficava a 29 cliques. Com primeira,
 * última e a janela de números, qualquer página fica a poucos cliques.
 *
 * O componente não diz em que página se está nem quantos itens há: o resumo
 * no topo de cada lista já diz, e continua aparecendo quando há uma página só,
 * caso em que este componente some.
 *
 * Em tela estreita só ficam ‹ [6 / 35] › (o CSS esconde o resto); os rótulos
 * escondidos continuam valendo para leitor de tela.
 */

export type ItemPaginacao = number | 'reticencias'

/** Quantas páginas aparecem de cada lado da atual. */
const VIZINHAS = 2

/**
 * Os números a mostrar, com reticências nos saltos. Sempre inclui a primeira, a
 * última e as vizinhas da atual. Um salto de uma página só mostra o número,
 * porque a reticência ocuparia o mesmo espaço e esconderia o que ela substitui.
 */
export function paginasVisiveis(pagina: number, totalPaginas: number): ItemPaginacao[] {
  if (totalPaginas < 1) return []

  const atual = Math.min(Math.max(pagina, 1), totalPaginas)
  const inicio = Math.max(1, atual - VIZINHAS)
  const fim = Math.min(totalPaginas, atual + VIZINHAS)

  const numeros = [1]
  for (let numero = inicio; numero <= fim; numero++) {
    if (numero !== 1 && numero !== totalPaginas) numeros.push(numero)
  }
  if (totalPaginas > 1) numeros.push(totalPaginas)

  const itens: ItemPaginacao[] = []
  for (const numero of numeros) {
    const anterior = itens[itens.length - 1]
    if (typeof anterior === 'number') {
      if (numero - anterior === 2) itens.push(anterior + 1)
      else if (numero - anterior > 2) itens.push('reticencias')
    }
    itens.push(numero)
  }
  return itens
}

export function Paginacao({
  pagina,
  totalPaginas,
  aoMudar,
  alvoRolagem,
}: {
  pagina: number
  totalPaginas: number
  aoMudar: (pagina: number) => void
  /**
   * O início da lista paginada. Mudar de página rola até ele: o botão fica no
   * pé da lista, e a página nova começaria fora da vista. É o início da lista,
   * e não o topo da tela, porque no Catálogo do gestor e no Dashboard há
   * formulário e indicadores acima dela.
   */
  alvoRolagem: RefObject<HTMLElement | null>
}) {
  if (totalPaginas <= 1) return null

  function irPara(destino: number) {
    aoMudar(destino)
    alvoRolagem.current?.scrollIntoView({ block: 'start' })
  }

  const naPrimeira = pagina <= 1
  const naUltima = pagina >= totalPaginas

  return (
    <nav className="paginacao" aria-label="Paginação">
      <button
        type="button"
        className="paginacao-ponta"
        disabled={naPrimeira}
        onClick={() => irPara(1)}
      >
        <span aria-hidden="true">« </span>Primeira
      </button>
      <button type="button" disabled={naPrimeira} onClick={() => irPara(pagina - 1)}>
        <span aria-hidden="true">‹ </span>
        <span className="paginacao-texto">Anterior</span>
      </button>

      <ul className="paginacao-numeros">
        {paginasVisiveis(pagina, totalPaginas).map((item, indice) =>
          item === 'reticencias' ? (
            <li key={`reticencias-${indice}`} aria-hidden="true">
              …
            </li>
          ) : item === pagina ? (
            <li key={item}>
              {/* Não é botão: ir para a página em que se está não faz nada. O
                  "Página" oculto é o nome para o leitor de tela, porque
                  `aria-label` em `span` não vale (ARIA). */}
              <span className="paginacao-atual" aria-current="page">
                <span className="visualmente-oculto">Página </span>
                {item}
              </span>
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                aria-label={`Ir para a página ${item}`}
                onClick={() => irPara(item)}
              >
                {item}
              </button>
            </li>
          ),
        )}
      </ul>

      <span className="paginacao-compacta">
        {pagina} / {totalPaginas}
      </span>

      <button type="button" disabled={naUltima} onClick={() => irPara(pagina + 1)}>
        <span className="paginacao-texto">Próxima</span>
        <span aria-hidden="true"> ›</span>
      </button>
      <button
        type="button"
        className="paginacao-ponta"
        disabled={naUltima}
        onClick={() => irPara(totalPaginas)}
      >
        Última<span aria-hidden="true"> »</span>
      </button>
    </nav>
  )
}
