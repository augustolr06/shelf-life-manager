import { requisitarApi } from './api'
import type { Canal } from './configuracaoAlerta'
import type { UnidadeLida } from './saidas'

/**
 * A entrega do alerta proativo (RF08, T19 no backend).
 *
 * Como os outros módulos de serviço, este só espelha o que
 * `alerta.service.ts` devolve. Nenhuma regra vive aqui: o que está na janela, a
 * ordem, quantos dias faltam e se a unidade já venceu vêm decididos do
 * servidor (RNF04) — inclusive `situacao`, que existe justamente para a tela
 * não classificar nada comparando datas no navegador (RNF01).
 */

export type SituacaoDoAlerta = 'NA_JANELA' | 'VENCIDA'

export type Alerta = {
  id: string
  /** Quando a varredura emitiu — instante, não data de calendário. */
  geradoEm: string
  lidoEm: string | null
  /** Negativo quando a unidade venceu depois de o alerta ser emitido. */
  diasParaVencer: number
  situacao: SituacaoDoAlerta
  janela: {
    configuracaoId: string
    diasAntecedencia: number
    canal: Canal
  }
  unidade: UnidadeLida
}

export type ListaDeAlertas = {
  alertas: Alerta[]
  /** A lista inteira, não a página. */
  total: number
  /** Os não lidos da lista inteira, independentemente do filtro pedido. */
  naoLidos: number
  pagina: number
  tamanhoPagina: number
}

export type FiltrosDeAlertas = {
  pagina?: number
  apenasNaoLidos?: boolean
  tamanhoPagina?: number
}

export async function listarAlertas(filtros: FiltrosDeAlertas = {}): Promise<ListaDeAlertas> {
  const parametros = new URLSearchParams()

  // Mesma regra de `listarProdutos` e da fila de descarte: parâmetro no padrão
  // é omitido, para que a URL da primeira página seja a URL simples da lista.
  if (filtros.pagina && filtros.pagina > 1) parametros.set('pagina', String(filtros.pagina))
  if (filtros.apenasNaoLidos) parametros.set('apenasNaoLidos', 'true')
  if (filtros.tamanhoPagina) parametros.set('tamanhoPagina', String(filtros.tamanhoPagina))

  const consulta = parametros.size > 0 ? `?${parametros}` : ''
  return requisitarApi<ListaDeAlertas>(`/alertas${consulta}`)
}

/**
 * Marca o alerta como lido. Idempotente no servidor: chamar duas vezes devolve
 * o mesmo `lidoEm`, e só a primeira grava evento.
 */
export async function marcarAlertaComoLido(id: string): Promise<Alerta> {
  const { alerta } = await requisitarApi<{ alerta: Alerta }>(`/alertas/${id}/lido`, {
    method: 'POST',
  })
  return alerta
}

/**
 * Só o contador de não lidos, para o distintivo da navegação.
 *
 * Pede a menor página possível porque o que interessa é o `naoLidos` do
 * cabeçalho da resposta — a alternativa seria um endpoint de contagem só para
 * isso, e o número já viaja aqui.
 */
export async function contarAlertasNaoLidos(): Promise<number> {
  const { naoLidos } = await listarAlertas({ tamanhoPagina: 1 })
  return naoLidos
}
