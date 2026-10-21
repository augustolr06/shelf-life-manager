import { requisitarApi } from './api'
import type { UnidadeLida } from './saidas'

/**
 * Os agregados e o histórico de saídas da RF13 (T20 no backend).
 *
 * Como os outros módulos de serviço, este só espelha o que
 * `dashboard.service.ts` devolve. Nenhum número nasce aqui: faixa de
 * vencimento, taxa de acerto, o que é "vencido" e o próprio período padrão são
 * decididos no servidor (RNF04) — a tela nem sequer sabe calcular "hoje menos
 * 29 dias", e é por isso que o período volta **ecoado** na resposta.
 */

export type Faixa =
  | 'VENCIDA'
  | 'ATE_7_DIAS'
  | 'DE_8_A_30_DIAS'
  | 'DE_31_A_90_DIAS'
  | 'ACIMA_DE_90_DIAS'

export type ContagemDaFaixa = { faixa: Faixa; unidades: number }

/**
 * A unidade não vencida que vence primeiro (T42). Dias e faixa vêm prontos:
 * a tela Início só os exibe.
 */
export type ProximoVencimento = {
  unidade: UnidadeLida
  /** `0` quando vence hoje; nunca negativo. */
  diasParaVencer: number
  faixa: Faixa
}

/** Datas de calendário `AAAA-MM-DD`, no formato que a rota aceita e devolve. */
export type Periodo = { de: string; ate: string }

export type Dashboard = {
  /** O intervalo que o servidor de fato usou — inclusive quando não foi pedido. */
  periodo: Periodo
  /** A data de hoje no servidor, `AAAA-MM-DD` (T42): a do cabeçalho do Início. */
  hoje: string
  /** Fotografia do **agora**: ignora o período. */
  estoque: {
    unidadesEmEstoque: number
    /** As cinco faixas, sempre as cinco, inclusive zeradas. */
    porFaixaDeVencimento: ContagemDaFaixa[]
    /** `null` sem unidade em estoque a vencer (vazio ou só vencidas). */
    proximoVencimento: ProximoVencimento | null
  }
  saidas: {
    total: number
    naPrimeiraLeitura: number
    /** `null`, nunca `0`, quando não houve saída no período — são fatos opostos. */
    taxaAcertoPrimeiraLeitura: number | null
  }
  fifo: {
    alertasDisparados: number
    substituicoesEfetivas: number
  }
  perdas: {
    /** Do período. */
    descartes: number
    /** Do **agora**: é a faixa `VENCIDA`, repetida onde se lê como prejuízo iminente. */
    unidadesVencidasEmEstoque: number
  }
  overrides: { total: number }
}

export type SaidaNoHistorico = {
  id: string
  /** Instante, não data de calendário: uma saída acontece a uma hora do dia. */
  dataHora: string
  tentativasAteAcerto: number
  alertaFifoDisparado: boolean
  vendaDeUnidadeVencida: boolean
  justificativaOverride: string | null
  sessaoVendaId: string | null
  usuario: { id: string; nome: string }
  /** Só existe no override (PRD 6.1); `null` em toda saída comum. */
  autorizadoPor: { id: string; nome: string } | null
  unidade: UnidadeLida
}

export type HistoricoDeSaidas = {
  saidas: SaidaNoHistorico[]
  /** O período inteiro, não a página. */
  total: number
  pagina: number
  tamanhoPagina: number
  periodo: Periodo
}

/**
 * O recorte pedido pela tela. Cada ponta é opcional **de propósito**: a que
 * faltar é preenchida pelo servidor com o seu padrão, em vez de a tela
 * inventar uma data para completar o par.
 */
export type PeriodoPedido = { de?: string; ate?: string }

export type FiltrosDoHistorico = {
  periodo?: PeriodoPedido | null
  pagina?: number
  apenasOverrides?: boolean
}

/**
 * Monta a querystring do período.
 *
 * Período ausente **não** vira `de`/`ate` calculados no cliente: a URL sai sem
 * os parâmetros e o servidor aplica os últimos 30 dias. Assim existe um único
 * dono do recorte padrão, e a tela descobre qual foi lendo o `periodo` ecoado.
 */
function comPeriodo(parametros: URLSearchParams, periodo?: PeriodoPedido | null): void {
  if (!periodo) return
  if (periodo.de) parametros.set('de', periodo.de)
  if (periodo.ate) parametros.set('ate', periodo.ate)
}

function comoConsulta(parametros: URLSearchParams): string {
  return parametros.size > 0 ? `?${parametros}` : ''
}

/**
 * A taxa que o servidor calculou, como percentual de uma casa. Mudou da tela
 * de Relatórios para cá em T42, quando o Início virou o segundo leitor dela:
 * as duas telas mostram a mesma taxa com a mesma precisão.
 *
 * `null` **não** chega aqui: "sem saídas no período" e "0%" são fatos opostos
 * (T20), e cada tela diz o primeiro com as próprias palavras.
 */
export function formatarTaxa(taxa: number): string {
  return `${(taxa * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`
}

export async function buscarDashboard(periodo?: PeriodoPedido | null): Promise<Dashboard> {
  const parametros = new URLSearchParams()
  comPeriodo(parametros, periodo)
  return requisitarApi<Dashboard>(`/dashboard${comoConsulta(parametros)}`)
}

export async function listarHistoricoDeSaidas(
  filtros: FiltrosDoHistorico = {},
): Promise<HistoricoDeSaidas> {
  const parametros = new URLSearchParams()
  comPeriodo(parametros, filtros.periodo)

  // Mesma regra das demais listas: parâmetro no padrão é omitido, para que a
  // URL da primeira página seja a URL simples do histórico.
  if (filtros.pagina && filtros.pagina > 1) parametros.set('pagina', String(filtros.pagina))
  if (filtros.apenasOverrides) parametros.set('apenasOverrides', 'true')

  return requisitarApi<HistoricoDeSaidas>(`/dashboard/saidas${comoConsulta(parametros)}`)
}
