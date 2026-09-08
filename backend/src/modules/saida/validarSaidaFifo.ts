import type { Prisma, UnidadeProduto } from '@prisma/client'

/**
 * Núcleo do sistema (RF06). Esqueleto criado em T06 — a implementação é T07.
 *
 * Esta é a **única** função autorizada a decidir o veredito de uma leitura de
 * QR no fluxo de saída (RNF03). Nenhum controller, hook de ORM ou código de
 * frontend replica esta lógica; a tela apenas reflete o que sai daqui (RNF04).
 *
 * Contrato completo em docs/arquitetura.md seção 4 e PRD seção 7. Os casos de
 * teste que a definem estão em tests/fifo/validarSaidaFifo.test.ts e foram
 * escritos antes desta função existir, como exige a seção 8 do PRD.
 */

/** O cliente de dentro de um `prisma.$transaction` — nunca o client global. */
export type ClienteDeTransacao = Prisma.TransactionClient

export type Veredito =
  | { tipo: 'ERRO'; motivo: 'QR_NAO_ENCONTRADO' | 'UNIDADE_JA_BAIXADA' }
  | { tipo: 'EXCECAO_VENCIDO'; unidade: UnidadeProduto }
  | { tipo: 'BLOQUEAR_FIFO'; unidadeCorreta: UnidadeProduto; tentativas: number }
  | { tipo: 'CONFIRMAR'; unidade: UnidadeProduto }

/**
 * Marca do esqueleto de T06. T07 remove o `throw` — e a suíte de
 * `validarSaidaFifo`, que hoje falha inteira com esta mensagem, passa a ser a
 * definição de pronto daquela tarefa.
 */
export const NAO_IMPLEMENTADO = 'NAO_IMPLEMENTADO_T07'

/**
 * Precisa rodar **inteiramente dentro** de uma transação, com a unidade lida
 * bloqueada por `SELECT ... FOR UPDATE` (RNF02) — por isso recebe o `tx` em
 * vez de abrir a transação por conta própria: quem chama é que delimita o
 * escopo atômico da leitura e da baixa.
 */
export async function validarSaidaFifo(
  _codigoQr: string,
  _usuarioId: string,
  _tx: ClienteDeTransacao,
): Promise<Veredito> {
  throw new Error(
    `${NAO_IMPLEMENTADO}: a validação FIFO ainda não foi implementada. ` +
      'T06 entrega apenas os casos de teste (PRD seção 8); a implementação é T07.',
  )
}
