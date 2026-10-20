import { prisma } from '../../db/prisma.js'
import { normalizarCodigoQr } from '../unidade/codigoQr.js'
import {
  comoDataDeTela,
  comProduto,
  comProdutoJaLido,
  type UnidadeNaResposta,
} from '../unidade/unidadeNaResposta.js'
import { validarSaidaFifo, type ModoDeSaida, type Veredito } from './validarSaidaFifo.js'

/**
 * A camada entre a rota HTTP e o núcleo do sistema (RF05, RF06).
 *
 * Ela faz três coisas, nenhuma delas decisória: abre a transação que a RNF02
 * exige, chama `validarSaidaFifo` — a única função autorizada a dar o veredito
 * (RNF03) — e traduz o resultado em JSON. Se em algum momento aparecer aqui um
 * `if` sobre validade, status ou ordem de unidades, é sinal de que a lógica
 * está vazando para fora da função: é isso que a RNF03 proíbe.
 */

/**
 * A forma da unidade na resposta mudou para `unidade/unidadeNaResposta.ts` em
 * T11, quando os três caminhos da unidade vencida passaram a devolvê-la também.
 * Reexportada daqui porque é este o módulo que T08 e T10 documentam como o
 * contrato de `/saidas/ler`.
 */
export type { UnidadeNaResposta }

/**
 * O veredito como o frontend o recebe. É espelho do tipo `Veredito`: o mesmo
 * discriminador, os mesmos ramos. A tela escolhe o que exibir por este campo e
 * por nada mais (RNF04).
 */
export type RespostaLeitura =
  | { veredito: 'ERRO'; motivo: 'QR_NAO_ENCONTRADO' | 'UNIDADE_JA_BAIXADA'; codigoQr: string; mensagem: string }
  | { veredito: 'EXCECAO_VENCIDO'; codigoQr: string; unidade: UnidadeNaResposta; mensagem: string }
  | {
      veredito: 'BLOQUEAR_FIFO'
      codigoQr: string
      unidadeLida: UnidadeNaResposta
      unidadeCorreta: UnidadeNaResposta
      tentativas: number
      mensagem: string
    }
  | { veredito: 'CONFIRMAR'; codigoQr: string; unidade: UnidadeNaResposta; mensagem: string }

/**
 * Um item da confirmação do carrinho: o mesmo formato de `/saidas/ler`, mais o
 * id que a tela usou para pedir a venda (T33b). A tela lê o veredito de cada
 * item, e não um resumo do carrinho (RNF04).
 */
export type ItemFinalizado = RespostaLeitura & { unidadeId: string }

export type ResultadoFinalizacao =
  | { ok: true; itens: ItemFinalizado[] }
  | { ok: false; motivo: 'UNIDADE_NAO_ENCONTRADA' }

/**
 * A leitura do balcão: valida e **não baixa** (T33b). `CONFIRMAR` quer dizer
 * que a unidade pode ser vendida, e ela vai para o carrinho da tela. A venda é
 * `finalizarCarrinho`.
 */
export async function lerCodigoQr(
  codigoDigitado: string,
  usuarioId: string,
  sessaoVendaId?: string,
  noCarrinho?: string[],
): Promise<RespostaLeitura> {
  const codigoQr = normalizarCodigoQr(codigoDigitado)

  // A transação cobre a decisão, e nada além disso: nenhuma consulta de
  // apresentação, nenhuma espera pela atendente. A janela de concorrência é o
  // tempo da decisão, não o tempo de caminhar até a prateleira (PRD 6.2).
  const veredito = await prisma.$transaction((tx) =>
    validarSaidaFifo(codigoQr, usuarioId, tx, sessaoVendaId ?? null, {
      modo: 'AVALIAR',
      ...(noCarrinho ? { noCarrinho } : {}),
    }),
  )

  return montarRespostaDeLeitura(codigoQr, veredito, 'AVALIAR')
}

/**
 * A confirmação do carrinho (`POST /saidas/finalizar`, T33b): revalida e baixa
 * cada unidade, uma transação por item.
 *
 * **Sem tudo-ou-nada.** Cada item é um ciclo independente (PRD 6.2): um item
 * barrado, porque outra atendente o vendeu ou porque entrou uma unidade de
 * validade menor desde a leitura, não desfaz a venda dos outros. Uma transação
 * só para o carrinho inteiro também seguraria o lock de todas as unidades até
 * a última, que é a espera que a 6.2 quer evitar.
 *
 * **A ordem da fila é por validade crescente**, desempate por código, e é
 * decidida aqui, não pelo corpo. Processadas na ordem do corpo, a de fevereiro
 * seria barrada pela de janeiro do mesmo carrinho, ainda `EM_ESTOQUE`. Ordenar
 * não é decidir veredito (RNF03): o veredito de cada item continua saindo de
 * `validarSaidaFifo`, sob o lock daquela unidade, e a ordem só garante que a
 * pergunta seja feita na sequência em que o próprio FIFO a responderia. A
 * consulta da ordem é sem lock, e uma validade corrigida entre ela e o item
 * pode no máximo mudar a sequência, nunca o veredito.
 *
 * O carrinho guarda ids (o que a leitura devolveu), e a função trava por
 * código. A mesma consulta que ordena traduz um no outro. Id que não é de
 * unidade nenhuma recusa o carrinho inteiro, antes de qualquer item: unidade
 * não é apagada, então ele só vem de cliente quebrado.
 */
export async function finalizarCarrinho(
  unidadeIds: string[],
  usuarioId: string,
  sessaoVendaId?: string,
): Promise<ResultadoFinalizacao> {
  const fila = await prisma.unidadeProduto.findMany({
    where: { id: { in: unidadeIds } },
    select: { id: true, codigoQr: true },
    orderBy: [{ dataValidade: 'asc' }, { codigoQr: 'asc' }],
  })

  // O schema da rota já recusou ids repetidos, então contar basta.
  if (fila.length !== unidadeIds.length) return { ok: false, motivo: 'UNIDADE_NAO_ENCONTRADA' }

  const porId = new Map<string, ItemFinalizado>()

  for (const { id, codigoQr } of fila) {
    const veredito = await prisma.$transaction((tx) =>
      validarSaidaFifo(codigoQr, usuarioId, tx, sessaoVendaId ?? null, { modo: 'EFETIVAR' }),
    )
    porId.set(id, { unidadeId: id, ...(await montarRespostaDeLeitura(codigoQr, veredito, 'EFETIVAR')) })
  }

  // A resposta volta na ordem do corpo, que é a ordem do carrinho na tela.
  return { ok: true, itens: unidadeIds.map((id) => porId.get(id)!) }
}

/**
 * Traduz o veredito, buscando **depois do commit** o que a tela precisa e o
 * `Veredito` não carrega: o produto de cada unidade e, no bloqueio, a unidade
 * lida (o veredito só traz a correta).
 *
 * Fora da transação de propósito — são consultas de apresentação, e prendê-las
 * ao lock atrasaria a próxima leitura do mesmo frasco sem motivo.
 *
 * Exportada desde T11: a correção de validade da seção 6.1 do PRD revalida o
 * FIFO e precisa devolver o veredito novo **no mesmo contrato** desta rota. Uma
 * segunda tradução do mesmo `Veredito` seria uma segunda versão da resposta que
 * a tela lê (RNF04).
 *
 * O `modo` só muda a mensagem de `CONFIRMAR` (T33b): na leitura a unidade foi
 * liberada, na confirmação do carrinho ela foi vendida.
 */
export async function montarRespostaDeLeitura(
  codigoQr: string,
  veredito: Veredito,
  modo: ModoDeSaida,
): Promise<RespostaLeitura> {
  switch (veredito.tipo) {
    case 'ERRO':
      return {
        veredito: 'ERRO',
        motivo: veredito.motivo,
        codigoQr,
        mensagem: MENSAGEM_DE_ERRO[veredito.motivo],
      }

    case 'EXCECAO_VENCIDO': {
      const unidade = await comProduto(veredito.unidade)
      return {
        veredito: 'EXCECAO_VENCIDO',
        codigoQr,
        unidade,
        mensagem:
          `${unidade.produto.nome} (${unidade.produto.marca}) venceu em ` +
          `${comoDataDeTela(unidade.dataValidade)}. Esta unidade não sai pelo fluxo normal.`,
      }
    }

    case 'BLOQUEAR_FIFO': {
      // A unidade lida existe e é do mesmo produto da correta — acabou de ser
      // bloqueada dentro da transação, então uma consulta por código a
      // encontra. As duas dividem o mesmo produto: é o mesmo SKU nos dois
      // lados do bloqueio, por definição do pool prioritário.
      const lidaCrua = await prisma.unidadeProduto.findUniqueOrThrow({ where: { codigoQr } })
      const produto = await prisma.produto.findUniqueOrThrow({
        where: { id: veredito.unidadeCorreta.produtoId },
      })

      const unidadeLida = comProdutoJaLido(lidaCrua, produto)
      const unidadeCorreta = comProdutoJaLido(veredito.unidadeCorreta, produto)

      return {
        veredito: 'BLOQUEAR_FIFO',
        codigoQr,
        unidadeLida,
        unidadeCorreta,
        tentativas: veredito.tentativas,
        mensagem:
          `Devolva esta unidade à prateleira (validade ${comoDataDeTela(unidadeLida.dataValidade)}). ` +
          `Saia primeiro com a de validade ${comoDataDeTela(unidadeCorreta.dataValidade)} — ` +
          `código ${unidadeCorreta.codigoQr}.`,
      }
    }

    case 'CONFIRMAR': {
      const unidade = await comProduto(veredito.unidade)
      return {
        veredito: 'CONFIRMAR',
        codigoQr,
        unidade,
        // Na leitura, a mensagem não pode dizer que a venda aconteceu: a
        // atendente que lê "registrada" não confirma o carrinho (T33). Na
        // confirmação, é fato consumado — a `Saida` já existe.
        mensagem:
          `${MENSAGEM_DE_CONFIRMAR[modo]}: ${unidade.produto.nome} (${unidade.produto.marca}), ` +
          `validade ${comoDataDeTela(unidade.dataValidade)}.`,
      }
    }
  }
}

const MENSAGEM_DE_CONFIRMAR = {
  AVALIAR: 'Pode ser vendida',
  EFETIVAR: 'Venda registrada',
} as const

const MENSAGEM_DE_ERRO = {
  QR_NAO_ENCONTRADO:
    'Código não cadastrado. Confira a etiqueta ou digite o código impresso abaixo do QR.',
  UNIDADE_JA_BAIXADA:
    'Esta unidade já saiu do estoque — foi vendida ou descartada. Leia outra unidade.',
} as const
