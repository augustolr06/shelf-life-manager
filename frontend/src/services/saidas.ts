import { requisitarApi } from './api'

/**
 * Fluxo de saída (RF05, RF06, RF07).
 *
 * Os tipos abaixo espelham, campo a campo, o que `POST /saidas/ler` devolve
 * (`backend/src/modules/saida/saida.service.ts`). Espelhar é tudo o que este
 * módulo faz: não há aqui — nem em nenhum outro arquivo do frontend —
 * comparação de validade, de status ou de ordem entre unidades. Quem decide o
 * veredito é `validarSaidaFifo`, no servidor (RNF03), e a tela só reflete o que
 * ele respondeu (RNF04).
 */

/** Como uma unidade chega na resposta da leitura. */
export type UnidadeLida = {
  id: string
  codigoQr: string
  /** Data de calendário `AAAA-MM-DD`, nunca instante ISO (RNF01). */
  dataValidade: string
  produto: {
    id: string
    codigoInterno: string
    nome: string
    marca: string
  }
}

export type MotivoErroLeitura = 'QR_NAO_ENCONTRADO' | 'UNIDADE_JA_BAIXADA'

/**
 * Os quatro vereditos, discriminados por `veredito`. Todos trazem `mensagem`
 * já redigida pelo servidor: a tela escolhe *layout* por este campo e exibe o
 * texto como veio, sem remontá-lo a partir do código do veredito.
 */
export type RespostaLeitura =
  | { veredito: 'ERRO'; motivo: MotivoErroLeitura; codigoQr: string; mensagem: string }
  | { veredito: 'EXCECAO_VENCIDO'; codigoQr: string; unidade: UnidadeLida; mensagem: string }
  | {
      veredito: 'BLOQUEAR_FIFO'
      codigoQr: string
      unidadeLida: UnidadeLida
      unidadeCorreta: UnidadeLida
      tentativas: number
      mensagem: string
    }
  | { veredito: 'CONFIRMAR'; codigoQr: string; unidade: UnidadeLida; mensagem: string }

/**
 * Envia uma leitura ao servidor.
 *
 * O código vai como foi lido ou digitado, sem normalização no cliente:
 * `codigoQr.ts` no backend é o dono único do formato (T08), que segue
 * provisório até o teste físico da RNF08. Normalizar aqui também criaria um
 * segundo dono e esconderia divergência entre os dois.
 *
 * Os quatro vereditos chegam em HTTP 200 e voltam daqui como dado. Só sobem
 * como `ErroApi` as situações que não chegaram a ser leitura: sem sessão,
 * papel insuficiente, corpo inválido, falha inesperada ou rede fora.
 */
export async function lerCodigoQr(
  codigoQr: string,
  sessaoVendaId: string | null,
): Promise<RespostaLeitura> {
  return requisitarApi<RespostaLeitura>('/saidas/ler', {
    method: 'POST',
    // O campo é omitido quando não há agrupador, nunca enviado vazio: o
    // backend valida o formato UUID e recusaria a requisição inteira — e
    // perder a venda por causa de um campo de relatório seria o pior dos
    // desfechos (T09, tratamento assimétrico de dado malformado).
    body: JSON.stringify(sessaoVendaId ? { codigoQr, sessaoVendaId } : { codigoQr }),
  })
}

/**
 * Agrupador de atendimento (PRD seção 5). Não cria estado nem semântica
 * transacional: serve para reconstruir, no relatório, quais saídas pertenceram
 * ao mesmo cliente no balcão.
 *
 * `crypto.randomUUID` exige contexto seguro — o mesmo que a câmera já exige.
 * Em `localhost` e HTTPS existe; num IP de rede local sem TLS, não. Nesse caso
 * a leitura continua funcionando **sem** o agrupador, que é opcional no
 * backend: perder o agrupamento de relatório é melhor que impedir a venda.
 */
export function criarSessaoVenda(): string | null {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : null
}
