import { toast } from 'sonner'
import { ErroApi } from './api'

/**
 * Ponto único de chamada dos toasts (T29). As telas não importam a biblioteca:
 * trocá-la depois mexe neste arquivo e em `components/Avisos.tsx`, e em mais
 * nenhum.
 *
 * Toast é para **resultado de ação** — o que acabou de acontecer com o clique.
 * Veredito da leitura, erro de campo, falha ao carregar a tela e relatório de
 * planilha continuam no lugar onde estão (critério em `tasks/T29-toasts.md`).
 */

const MENSAGEM_PADRAO = 'Não foi possível concluir a operação.'

/** Quanto o aviso de sucesso fica na tela antes de sumir sozinho. */
export const DURACAO_SUCESSO_MS = 4000

export const avisar = {
  sucesso(mensagem: string) {
    toast.success(mensagem, { duration: DURACAO_SUCESSO_MS })
  },

  /**
   * Erro fica até ser fechado: o usuário precisa ler o que deu errado, e um
   * aviso que some sozinho some justamente enquanto ele procura o motivo.
   *
   * O texto continua sendo o do servidor quando há um (RNF04). `padrao` é o
   * texto de cada ação para a falha que não trouxe mensagem própria.
   */
  erro(falha: unknown, padrao: string = MENSAGEM_PADRAO) {
    toast.error(mensagemDaFalha(falha, padrao), { duration: Infinity, closeButton: true })
  },
}

function mensagemDaFalha(falha: unknown, padrao: string): string {
  if (falha instanceof ErroApi) return falha.message
  // Mensagem já pronta: a de um desfecho que o servidor devolveu sem erro
  // HTTP, ou a de uma API do navegador que a tela traduziu.
  if (typeof falha === 'string' && falha !== '') return falha
  return padrao
}
