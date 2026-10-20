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

/**
 * Espelha `GET /unidades/consulta/:codigoQr` (T32): a unidade pelo QR, sem
 * registrar saída. `situacao` e `diasParaVencer` vêm prontos do servidor —
 * a tela não compara datas (RNF01, RNF04), como em `/alertas` (T19).
 */
export type ConsultaUnidade = {
  unidade: {
    id: string
    codigoQr: string
    /** Data de calendário `AAAA-MM-DD` (RNF01). */
    dataValidade: string
    status: UnidadeCadastrada['status']
    /** Instante do cadastro. */
    dataEntrada: string
    produto: {
      id: string
      codigoInterno: string
      nome: string
      marca: string
      categoria: string
      ativo: boolean
    }
  }
  situacao: 'VENCIDA' | 'NO_PRAZO'
  /** Negativo depois de vencida. */
  diasParaVencer: number
}

/**
 * O código vai como foi lido ou digitado, como na leitura de saída: quem
 * normaliza é `codigoQr.ts`, no backend (T08). Código inexistente sobe como
 * `ErroApi` 404 `QR_NAO_ENCONTRADO`, com a mensagem do servidor.
 */
export async function consultarUnidade(codigoQr: string): Promise<ConsultaUnidade> {
  return requisitarApi<ConsultaUnidade>(`/unidades/consulta/${encodeURIComponent(codigoQr)}`)
}
