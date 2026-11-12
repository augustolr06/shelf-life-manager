import { requisitarApi } from './api'
import type { ConsultaUnidade } from './unidades'

/**
 * Espelha as rotas de `modules/consulta` (T49): a busca da tela Consultar
 * produto e o estoque de um produto. Quem decide se o termo é código de
 * etiqueta é o servidor, dono do formato (T08); dias, situação e faixa das
 * unidades vêm prontos dele (RNF01, RNF04).
 */

export type ProdutoNaConsulta = {
  id: string
  codigoInterno: string
  nome: string
  marca: string
  categoria: string
  ativo: boolean
  /** Unidades em estoque agora. */
  emEstoque: number
}

export type ResultadoDaBusca =
  | { tipo: 'UNIDADE'; consulta: ConsultaUnidade }
  | { tipo: 'PRODUTOS'; produtos: ProdutoNaConsulta[]; total: number }

/** As cinco faixas de validade do servidor (T20), que dão a cor do distintivo (T40). */
export type FaixaDeValidade =
  | 'VENCIDA'
  | 'ATE_7_DIAS'
  | 'DE_8_A_30_DIAS'
  | 'DE_31_A_90_DIAS'
  | 'ACIMA_DE_90_DIAS'

export type UnidadeEmEstoque = {
  id: string
  codigoQr: string
  /** Data de calendário `AAAA-MM-DD` (RNF01). */
  dataValidade: string
  dataEntrada: string
  /** Negativo depois de vencida. */
  diasParaVencer: number
  situacao: 'VENCIDA' | 'NO_PRAZO'
  faixa: FaixaDeValidade
}

export type EstoqueDoProduto = {
  produto: Omit<ProdutoNaConsulta, 'emEstoque'>
  /** Em ordem de validade — ordem de leitura, não a próxima a sair (RNF03). */
  unidades: UnidadeEmEstoque[]
}

/** O termo vai como foi digitado ou lido: quem normaliza é o servidor. */
export async function buscarNaConsulta(termo: string): Promise<ResultadoDaBusca> {
  return requisitarApi<ResultadoDaBusca>(`/consulta/busca?${new URLSearchParams({ termo })}`)
}

export async function buscarEstoqueDoProduto(id: string): Promise<EstoqueDoProduto> {
  return requisitarApi<EstoqueDoProduto>(`/consulta/produtos/${encodeURIComponent(id)}`)
}
