import { requisitarApi } from './api'
import type { RespostaLeitura, UnidadeLida } from './saidas'

/**
 * Os três caminhos da unidade vencida (PRD seção 6.1, T11 no backend).
 *
 * Como em `saidas.ts`, este módulo só espelha: os tipos abaixo copiam, campo a
 * campo, o que `excecaoVencido.service.ts` devolve. Qual caminho seguir é
 * decisão da pessoa no balcão; se um dos três se aplica é decisão do servidor,
 * conferida sob lock (RNF02). Nada aqui compara validade, status ou ordem.
 */

/** Espelha `ResultadoCorrecao`. */
export type ResultadoCorrecao = {
  correcao: { dataValidadeAnterior: string; dataValidadeNova: string }
  /**
   * O mesmo contrato de `POST /saidas/ler`, importado de `saidas.ts` em vez de
   * redeclarado: a correção revalida o FIFO no servidor e devolve um veredito
   * comum, que a tela já sabe exibir. Uma segunda declaração da mesma forma
   * seria uma segunda versão da resposta que a tela lê (RNF04).
   */
  revalidacao: RespostaLeitura
}

/** Espelha `ResultadoDescarte`. */
export type ResultadoDescarte = {
  resultado: 'DESCARTE_REGISTRADO'
  unidade: UnidadeLida
  descarte: { id: string; dataHora: string; motivo: string }
  mensagem: string
}

/** Espelha `ResultadoOverride`. */
export type ResultadoOverride = {
  resultado: 'VENDA_VENCIDA_AUTORIZADA'
  unidade: UnidadeLida
  saida: {
    id: string
    dataHora: string
    justificativa: string
    autorizadoPor: { id: string; nome: string }
  }
  mensagem: string
}

/** O que descarte e override têm em comum: a unidade saiu do estoque. */
export type Resolucao = ResultadoDescarte | ResultadoOverride

/**
 * Limites de texto espelhados de `excecaoVencido.routes.ts` (T12, Decisão 3).
 *
 * Espelhar aqui é conveniência de formulário, não autoridade: quem recusa é o
 * servidor, e é a mensagem dele que a tela exibe. O que a tela pode antecipar é
 * o que ela sabe por inteiro — o texto que a pessoa acabou de digitar. O que
 * for cópia de estado do servidor (a validade gravada, por exemplo) continua
 * sendo pergunta, não palpite.
 */
export const MINIMO_JUSTIFICATIVA = 10
export const MAXIMO_JUSTIFICATIVA = 500
export const MAXIMO_MOTIVO = 280

/**
 * Caminho 1 — a validade foi digitada errada no cadastro de entrada.
 *
 * `dataValidade` vai como `AAAA-MM-DD`, que é o que `<input type="date">`
 * entrega cru e o que o backend valida com `format: 'date'` (RNF01). Nenhuma
 * conversão no meio: `new Date()` num texto de data volta um dia atrás em fuso
 * negativo, como `services/datas.ts` documenta desde T05.
 *
 * A resposta pode trazer qualquer um dos quatro vereditos, inclusive
 * `CONFIRMAR` — e nesse caso a venda já aconteceu (T09, T11).
 */
export async function corrigirValidade(
  unidadeId: string,
  dataValidade: string,
  sessaoVendaId: string | null,
): Promise<ResultadoCorrecao> {
  return requisitarApi<ResultadoCorrecao>('/excecao-vencido/corrigir', {
    method: 'POST',
    body: corpo({ unidadeId, dataValidade }, sessaoVendaId),
  })
}

/**
 * Caminho 2 — a unidade está de fato vencida e não será vendida.
 *
 * `motivo` vazio é **omitido**, nunca enviado como texto em branco: o backend
 * valida `minLength: 1` e recusaria a requisição inteira, e sem o campo ele
 * grava o texto padrão. É o caminho de menor atrito de propósito — é ele que
 * produz o dado de perda que a pesquisa quer medir.
 */
export async function descartarUnidade(
  unidadeId: string,
  motivo: string,
  sessaoVendaId: string | null,
): Promise<ResultadoDescarte> {
  const informado = motivo.trim()
  return requisitarApi<ResultadoDescarte>('/excecao-vencido/descartar', {
    method: 'POST',
    body: corpo(informado ? { unidadeId, motivo: informado } : { unidadeId }, sessaoVendaId),
  })
}

/**
 * Caminho 3 — decisão comercial consciente, restrita ao GESTOR.
 *
 * A justificativa é obrigatória e é a única explicação permanente de uma venda
 * de produto vencido: o `EventoLog` é imutável (RNF05).
 */
export async function autorizarVendaVencida(
  unidadeId: string,
  justificativa: string,
  sessaoVendaId: string | null,
): Promise<ResultadoOverride> {
  return requisitarApi<ResultadoOverride>('/excecao-vencido/override', {
    method: 'POST',
    body: corpo({ unidadeId, justificativa: justificativa.trim() }, sessaoVendaId),
  })
}

/**
 * Monta o corpo com o agrupador de atendimento quando ele existe.
 *
 * Mesma regra de `lerCodigoQr`: o campo é omitido quando não há agrupador,
 * nunca enviado vazio. O backend valida `format: 'uuid'`, e perder a resolução
 * de um frasco vencido por causa de um campo de relatório seria o pior dos
 * desfechos (T09).
 */
function corpo(campos: Record<string, string>, sessaoVendaId: string | null): string {
  return JSON.stringify(sessaoVendaId ? { ...campos, sessaoVendaId } : campos)
}
