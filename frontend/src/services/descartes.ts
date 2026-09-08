import { requisitarApi } from './api'
import type { UnidadeLida } from './saidas'

/**
 * A fila de descarte pendente (RF11, T13 no backend).
 *
 * Como os outros módulos de serviço, este só espelha o que
 * `descarte.service.ts` devolve. Quem define o que é "vencido" é o servidor,
 * com a mesma noção de hoje que decide o FIFO — inclusive o `diasVencida`, que
 * chega pronto justamente para que a tela não precise comparar datas.
 */

export type UnidadePendente = UnidadeLida & {
  /** Há quantos dias venceu, calculado no servidor (RNF01). */
  diasVencida: number
  dataEntrada: string
}

export type FilaDeDescarte = {
  unidades: UnidadePendente[]
  /** A fila inteira, não a página. */
  total: number
  pagina: number
  tamanhoPagina: number
}

export async function listarDescartesPendentes(pagina = 1): Promise<FilaDeDescarte> {
  // Mesma regra de `listarProdutos`: parâmetro no padrão é omitido, para que a
  // URL da primeira página seja a URL simples da fila.
  const consulta = pagina > 1 ? `?pagina=${pagina}` : ''
  return requisitarApi<FilaDeDescarte>(`/descartes/pendentes${consulta}`)
}
