import type { ContagemDaFaixa, Faixa } from '../services/dashboard'

/**
 * O estoque por validade numa barra empilhada, com a legenda (T42).
 *
 * A barra e a legenda são um componente só **de propósito**: as cores das
 * faixas do meio ficam abaixo de 3:1 sobre branco, e isso só é aceitável
 * porque a legenda repete cada faixa com nome e número
 * (`docs/redesign/claude-design/README.md`, "Escala de validade"). Separadas,
 * alguém acabaria usando a barra sozinha.
 *
 * Nada é classificado aqui: as faixas e as contagens são as que o servidor
 * devolveu, na ordem dele (RNF04). A única conta é a proporção de cada pedaço,
 * que é apresentação.
 */

/** Na legenda, curto: cabe em cinco colunas. */
const ROTULO_DA_FAIXA: Record<Faixa, string> = {
  VENCIDA: 'Vencidas',
  ATE_7_DIAS: 'Até 7 dias',
  DE_8_A_30_DIAS: '8 a 30 dias',
  DE_31_A_90_DIAS: '31 a 90 dias',
  ACIMA_DE_90_DIAS: '+90 dias',
}

/** Na descrição da barra para o leitor de tela, em frase. */
const DESCRICAO_DA_FAIXA: Record<Faixa, string> = {
  VENCIDA: 'vencidas',
  ATE_7_DIAS: 'em até 7 dias',
  DE_8_A_30_DIAS: 'entre 8 e 30 dias',
  DE_31_A_90_DIAS: 'entre 31 e 90 dias',
  ACIMA_DE_90_DIAS: 'com mais de 90 dias',
}

/** `VENCIDA` → `faixa-vencida`: a classe da escala de validade (T40). */
function classeDaFaixa(faixa: Faixa): string {
  return `faixa-${faixa.toLowerCase()}`
}

type Props = {
  total: number
  faixas: readonly ContagemDaFaixa[]
}

export function BarraEstoque({ total, faixas }: Props) {
  const descricao = `${total} unidade${total === 1 ? '' : 's'}: ${faixas
    .map(({ faixa, unidades }) => `${unidades} ${DESCRICAO_DA_FAIXA[faixa]}`)
    .join(', ')}`

  return (
    <div className="estoque-por-validade">
      <div className="barra-empilhada" role="img" aria-label={descricao}>
        {/* Faixa zerada não ocupa pedaço da barra, mas continua na legenda. */}
        {faixas
          .filter(({ unidades }) => unidades > 0)
          .map(({ faixa, unidades }) => (
            <span
              key={faixa}
              className={`segmento ${classeDaFaixa(faixa)}`}
              style={{ flexGrow: unidades }}
            />
          ))}
      </div>

      <ul className="legenda-validade">
        {faixas.map(({ faixa, unidades }) => (
          <li key={faixa} className={classeDaFaixa(faixa)}>
            <span className="rotulo-legenda">
              <span className="amostra-faixa" aria-hidden="true" />
              {ROTULO_DA_FAIXA[faixa]}
            </span>
            <span className="valor-legenda">{unidades}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
