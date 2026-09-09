import { StatusUnidade } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import {
  hojeComoData,
  inicioDoDia,
  inicioDoDiaSeguinte,
  textoDeData,
} from '../../shared/data.js'
import { comProdutoJaLido, type UnidadeNaResposta } from '../unidade/unidadeNaResposta.js'

/**
 * A consolidação da RF13: os números que o `EventoLog` e as tabelas
 * operacionais já contêm, lidos de uma vez.
 *
 * É a contrapartida da RF12. O log foi construído como **instrumento de coleta
 * de dados quantitativos do TCC** (PRD seção 3); este módulo é a leitura do
 * instrumento. Nada aqui produz fato: só conta o que os módulos de saída,
 * exceção, descarte e alerta gravaram — e é essa separação que mantém o painel
 * incapaz de mentir sobre a operação, porque ele não participa dela.
 *
 * **Quem calcula é o servidor** (RNF04). Faixa de vencimento, taxa de acerto e
 * recorte de período são decididos aqui; a tela de T21 exibe o que receber, sem
 * comparar data nenhuma — a mesma regra que vale para o veredito do balcão.
 */

/**
 * As faixas de vencimento do estoque, **fixas no código**.
 *
 * Seria tentador derivá-las das janelas de `ConfiguracaoAlerta` (T17), mas as
 * duas respondem perguntas diferentes: a janela diz "sobre o que me avisam?", a
 * faixa diz "como está distribuído o estoque?". E o painel é instrumento de
 * pesquisa — um gráfico cujas faixas mudam quando alguém edita uma configuração
 * deixa de ser comparável entre dois momentos do piloto
 * (`tasks/T20-endpoints-dashboard.md`, Decisão 2).
 */
export type Faixa =
  | 'VENCIDA'
  | 'ATE_7_DIAS'
  | 'DE_8_A_30_DIAS'
  | 'DE_31_A_90_DIAS'
  | 'ACIMA_DE_90_DIAS'

/**
 * O limite **superior** de cada faixa, em dias a partir de hoje; `null` na
 * última, que não tem teto.
 *
 * A lista é declarada como uma cadeia de tetos, e não como pares de bordas,
 * porque assim a contiguidade é estrutural: o piso de cada faixa é o teto da
 * anterior mais um dia, calculado abaixo e não digitado. Faixas escritas à mão
 * abririam a chance de um vão de um dia em que a unidade não apareceria em
 * lugar nenhum — o mesmo tipo de buraco que a fila de T13 existe para não ter.
 *
 * O teto de `VENCIDA` é `-1`: a unidade que vence **hoje** ainda está no pool
 * prioritário do FIFO e ainda pode ser vendida hoje, então ela abre a faixa
 * seguinte. É a mesma borda dos dois lados do sistema.
 */
const TETOS_DAS_FAIXAS: { faixa: Faixa; ateDias: number | null }[] = [
  { faixa: 'VENCIDA', ateDias: -1 },
  { faixa: 'ATE_7_DIAS', ateDias: 7 },
  { faixa: 'DE_8_A_30_DIAS', ateDias: 30 },
  { faixa: 'DE_31_A_90_DIAS', ateDias: 90 },
  { faixa: 'ACIMA_DE_90_DIAS', ateDias: null },
]

/** Quantos dias o período cobre quando `de`/`ate` não vêm na consulta. */
export const DIAS_DO_PERIODO_PADRAO = 30

export type Periodo = { de: string; ate: string }

export type ContagemDaFaixa = { faixa: Faixa; unidades: number }

export type Dashboard = {
  /**
   * Ecoado na resposta para que a tela diga de que intervalo está falando sem
   * repetir a regra do padrão. Vale para `saidas`, `fifo`, `perdas.descartes` e
   * `overrides`; `estoque` é fotografia do agora e o ignora.
   */
  periodo: Periodo
  estoque: {
    unidadesEmEstoque: number
    porFaixaDeVencimento: ContagemDaFaixa[]
  }
  saidas: {
    total: number
    naPrimeiraLeitura: number
    /** `null`, nunca `0`, quando não houve saída no período — ver `taxaDeAcerto`. */
    taxaAcertoPrimeiraLeitura: number | null
  }
  fifo: {
    alertasDisparados: number
    substituicoesEfetivas: number
  }
  perdas: {
    descartes: number
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
  unidade: UnidadeNaResposta
}

export type HistoricoDeSaidas = {
  saidas: SaidaNoHistorico[]
  /** O período inteiro, não a página. */
  total: number
  pagina: number
  tamanhoPagina: number
  periodo: Periodo
}

export type FiltrosDoHistorico = {
  periodo: Periodo
  pagina: number
  tamanhoPagina: number
  apenasOverrides: boolean
}

/** Uma data de calendário a N dias de hoje, na âncora UTC das colunas `DATE`. */
function emDiasDeHoje(dias: number): Date {
  const hoje = hojeComoData()
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + dias))
}

/**
 * Resolve `de`/`ate` da consulta no período efetivo.
 *
 * Devolve `{ ok: false }` em vez de lançar quando o intervalo é invertido: a
 * recusa é de negócio e o texto dela pertence à rota, como em todo o resto do
 * sistema (`docs/arquitetura.md` seção 5.1).
 */
export function resolverPeriodo(
  de?: string,
  ate?: string,
): { ok: true; periodo: Periodo } | { ok: false } {
  // O padrão termina hoje e inclui hoje, por isso `- 1`: 30 dias de janela são
  // hoje mais os 29 anteriores, não hoje mais 30.
  const periodo: Periodo = {
    de: de ?? textoDeData(emDiasDeHoje(-(DIAS_DO_PERIODO_PADRAO - 1))),
    ate: ate ?? textoDeData(hojeComoData()),
  }

  if (periodo.de > periodo.ate) return { ok: false }
  return { ok: true, periodo }
}

/**
 * O intervalo de instantes do período, fechado no começo e aberto no fim.
 * Ver `shared/data.ts` para por que as bordas são do dia **local**.
 */
function intervaloDeInstantes(periodo: Periodo): { gte: Date; lt: Date } {
  return { gte: inicioDoDia(periodo.de), lt: inicioDoDiaSeguinte(periodo.ate) }
}

/**
 * A taxa de acerto na primeira leitura — o indicador que o TCC persegue.
 *
 * `null` e não `0` quando não houve saída: "0% de acerto" e "nenhuma venda no
 * período" são fatos opostos, e um painel que mostra 0% num dia parado sugere
 * um sistema que não funciona. Quem exibe é obrigado a dizer "sem dados"
 * (`tasks/T20-endpoints-dashboard.md`, Decisão 4).
 *
 * O denominador é a **saída**, não a leitura de QR: a pergunta é "com que
 * frequência a atendente pega o frasco certo de primeira", e leitura de código
 * inexistente, unidade já baixada ou tentativa de venda de unidade vencida não
 * são erro de FIFO (Decisão 5). O dado bruto para a outra leitura do indicador
 * continua no `EventoLog`, intacto.
 *
 * **Uma distorção conhecida:** a venda autorizada de unidade vencida (override,
 * PRD 6.1) entra no denominador com `tentativasAteAcerto = 0` e conta como
 * acerto de primeira, embora não tenha passado pelo laço do FIFO. É raro por
 * construção — a fricção da justificativa existe para isso — e `overrides.total`
 * está na mesma resposta para que a análise possa descontá-lo.
 */
function taxaDeAcerto(total: number, naPrimeiraLeitura: number): number | null {
  if (total === 0) return null
  // Quatro casas: a razão vai para gráfico e para o texto do artigo, e
  // arredondar na exibição faria cada tela escolher a sua própria precisão.
  return Math.round((naPrimeiraLeitura / total) * 10_000) / 10_000
}

export async function montarDashboard(periodo: Periodo): Promise<Dashboard> {
  const noPeriodo = intervaloDeInstantes(periodo)
  const emEstoque = { status: StatusUnidade.EM_ESTOQUE }

  // Todas as contagens são feitas pelo banco e disparadas juntas: o painel é
  // uma requisição só, e a RNF06 (<500ms) vale para ela. Carregar linhas para
  // contar em JavaScript cresceria com o estoque inteiro.
  const [
    unidadesEmEstoque,
    porFaixaDeVencimento,
    saidasNoPeriodo,
    saidasNaPrimeiraLeitura,
    substituicoesEfetivas,
    overrides,
    descartes,
    alertasDisparados,
  ] = await Promise.all([
    prisma.unidadeProduto.count({ where: emEstoque }),
    contarPorFaixa(),
    prisma.saida.count({ where: { dataHora: noPeriodo } }),
    prisma.saida.count({ where: { dataHora: noPeriodo, tentativasAteAcerto: 0 } }),
    // A substituição efetiva é o bloqueio que **terminou em venda da unidade
    // certa**. Vem da `Saida`, enquanto o bloqueio vem do `EventoLog`, e é de
    // propósito: um bloqueio pode não terminar em venda (o cliente desiste, a
    // atendente para), e é exatamente essa diferença que o "vs." da RF13 pede
    // para ver. Se os dois números viessem da mesma tabela, não haveria o que
    // comparar.
    prisma.saida.count({ where: { dataHora: noPeriodo, alertaFifoDisparado: true } }),
    prisma.saida.count({ where: { dataHora: noPeriodo, vendaDeUnidadeVencida: true } }),
    prisma.descarte.count({ where: { dataHora: noPeriodo } }),
    prisma.eventoLog.count({
      where: { tipoEvento: 'ALERTA_FIFO_DISPARADO', ocorridoEm: noPeriodo },
    }),
  ])

  return {
    periodo,
    estoque: { unidadesEmEstoque, porFaixaDeVencimento },
    saidas: {
      total: saidasNoPeriodo,
      naPrimeiraLeitura: saidasNaPrimeiraLeitura,
      taxaAcertoPrimeiraLeitura: taxaDeAcerto(saidasNoPeriodo, saidasNaPrimeiraLeitura),
    },
    fifo: { alertasDisparados, substituicoesEfetivas },
    perdas: {
      descartes,
      // O mesmo número que a faixa `VENCIDA` e a mesma cláusula da fila de T13
      // (`dataValidade < hoje`, com o `hojeComoData()` do FIFO). Repetido aqui
      // porque é neste bloco que ele é lido como prejuízo iminente, e não como
      // distribuição de estoque. Não é uma segunda definição de "vencido": é a
      // mesma contagem, apresentada duas vezes.
      unidadesVencidasEmEstoque:
        porFaixaDeVencimento.find((contagem) => contagem.faixa === 'VENCIDA')?.unidades ?? 0,
    },
    overrides: { total: overrides },
  }
}

/**
 * As cinco faixas, sempre as cinco — **inclusive com zero**. Faixa que some da
 * resposta vira buraco no gráfico e sugere dado ausente onde há ausência de
 * unidades, que é informação legítima.
 */
async function contarPorFaixa(): Promise<ContagemDaFaixa[]> {
  return Promise.all(
    TETOS_DAS_FAIXAS.map(async ({ faixa, ateDias }, indice) => {
      const tetoAnterior = TETOS_DAS_FAIXAS[indice - 1]?.ateDias
      const dataValidade = {
        // O piso é o teto da faixa anterior mais um dia; a primeira não tem
        // piso, a última não tem teto. Assim as cinco cobrem toda a reta sem
        // vão nem sobreposição, e a soma delas é `unidadesEmEstoque`.
        ...(tetoAnterior === undefined || tetoAnterior === null
          ? {}
          : { gte: emDiasDeHoje(tetoAnterior + 1) }),
        ...(ateDias === null ? {} : { lte: emDiasDeHoje(ateDias) }),
      }

      return {
        faixa,
        unidades: await prisma.unidadeProduto.count({
          // Só o que está no estoque: o frasco vendido ou descartado já não
          // ocupa prateleira nem vence mais.
          where: { status: StatusUnidade.EM_ESTOQUE, dataValidade },
        }),
      }
    }),
  )
}

/**
 * O histórico de saídas da RF13 — o único item do requisito que é lista, e por
 * isso rota própria (`tasks/T20-endpoints-dashboard.md`, Decisão 1).
 */
export async function listarHistoricoDeSaidas(
  filtros: FiltrosDoHistorico,
): Promise<HistoricoDeSaidas> {
  const { periodo, pagina, tamanhoPagina, apenasOverrides } = filtros

  const where = {
    dataHora: intervaloDeInstantes(periodo),
    ...(apenasOverrides ? { vendaDeUnidadeVencida: true } : {}),
  }

  const [saidas, total] = await Promise.all([
    prisma.saida.findMany({
      where,
      // A mais recente primeiro: é histórico, não fila de urgência. O desempate
      // pelo `id` existe para a paginação ser estável — duas saídas podem
      // compartilhar o mesmo instante, e sem critério total uma delas nunca
      // apareceria.
      orderBy: [{ dataHora: 'desc' }, { id: 'desc' }],
      // Uma consulta só: a lista tem dezenas de linhas e buscar produto e
      // usuário por saída seria N+1.
      include: {
        unidade: { include: { produto: true } },
        usuario: true,
        autorizadoPor: true,
      },
      skip: (pagina - 1) * tamanhoPagina,
      take: tamanhoPagina,
    }),
    prisma.saida.count({ where }),
  ])

  return {
    saidas: saidas.map((saida) => ({
      id: saida.id,
      dataHora: saida.dataHora.toISOString(),
      tentativasAteAcerto: saida.tentativasAteAcerto,
      alertaFifoDisparado: saida.alertaFifoDisparado,
      vendaDeUnidadeVencida: saida.vendaDeUnidadeVencida,
      justificativaOverride: saida.justificativaOverride,
      sessaoVendaId: saida.sessaoVendaId,
      usuario: { id: saida.usuario.id, nome: saida.usuario.nome },
      autorizadoPor: saida.autorizadoPor
        ? { id: saida.autorizadoPor.id, nome: saida.autorizadoPor.nome }
        : null,
      unidade: comProdutoJaLido(saida.unidade, saida.unidade.produto),
    })),
    total,
    pagina,
    tamanhoPagina,
    periodo,
  }
}
