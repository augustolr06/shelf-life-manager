import { requisitarApi } from './api'

/** Espelha `UnidadeProduto` como `POST /produtos/:id/unidades` devolve (T05). */
export type UnidadeCadastrada = {
  id: string
  produtoId: string
  codigoQr: string
  /** ISO vindo de uma coluna `DATE` — só a parte da data tem significado (RNF01). */
  dataValidade: string
  status: 'EM_ESTOQUE' | 'VENDIDA' | 'DESCARTADA'
  dataEntrada: string
  registradoPorId: string
}

/** Uma validade e quantas unidades chegaram com ela. */
export type ItemLote = {
  dataValidade: string
  quantidade: number
}

export type AvisoCadastro = {
  codigo: string
  dataValidade: string
  quantidade: number
  mensagem: string
}

export type ResultadoRecebimento = {
  unidades: UnidadeCadastrada[]
  avisos: AvisoCadastro[]
}

export async function cadastrarUnidades(
  produtoId: string,
  itens: ItemLote[],
): Promise<ResultadoRecebimento> {
  return requisitarApi<ResultadoRecebimento>(`/produtos/${produtoId}/unidades`, {
    method: 'POST',
    body: JSON.stringify({ unidades: itens }),
  })
}
