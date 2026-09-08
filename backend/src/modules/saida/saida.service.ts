import type { Produto, UnidadeProduto } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { normalizarCodigoQr } from '../unidade/codigoQr.js'
import { validarSaidaFifo, type Veredito } from './validarSaidaFifo.js'

/**
 * A camada entre a rota HTTP e o núcleo do sistema (RF05, RF06).
 *
 * Ela faz três coisas, nenhuma delas decisória: abre a transação que a RNF02
 * exige, chama `validarSaidaFifo` — a única função autorizada a dar o veredito
 * (RNF03) — e traduz o resultado em JSON. Se em algum momento aparecer aqui um
 * `if` sobre validade, status ou ordem de unidades, é sinal de que a lógica
 * está vazando para fora da função: é isso que a RNF03 proíbe.
 */

/** Como uma unidade aparece na resposta da API. */
export type UnidadeNaResposta = {
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

export async function lerCodigoQr(codigoDigitado: string, usuarioId: string): Promise<RespostaLeitura> {
  const codigoQr = normalizarCodigoQr(codigoDigitado)

  // A transação cobre a decisão e a baixa, e nada além disso: nenhuma consulta
  // de apresentação, nenhuma espera pela atendente. A janela de concorrência é
  // o tempo da decisão, não o tempo de caminhar até a prateleira (PRD 6.2).
  const veredito = await prisma.$transaction((tx) => validarSaidaFifo(codigoQr, usuarioId, tx))

  return montarResposta(codigoQr, veredito)
}

/**
 * Traduz o veredito, buscando **depois do commit** o que a tela precisa e o
 * `Veredito` não carrega: o produto de cada unidade e, no bloqueio, a unidade
 * lida (o veredito só traz a correta).
 *
 * Fora da transação de propósito — são consultas de apresentação, e prendê-las
 * ao lock atrasaria a próxima leitura do mesmo frasco sem motivo.
 */
async function montarResposta(codigoQr: string, veredito: Veredito): Promise<RespostaLeitura> {
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
        // Fato consumado, não convite: a `Saida` já foi criada e o status já é
        // VENDIDA, dentro da transação que acabou de comitar (arquitetura
        // seção 4, ramo 5). A mensagem não pode sugerir que falta um passo.
        mensagem:
          `Saída registrada: ${unidade.produto.nome} (${unidade.produto.marca}), ` +
          `validade ${comoDataDeTela(unidade.dataValidade)}.`,
      }
    }
  }
}

const MENSAGEM_DE_ERRO = {
  QR_NAO_ENCONTRADO:
    'Código não cadastrado. Confira a etiqueta ou digite o código impresso abaixo do QR.',
  UNIDADE_JA_BAIXADA:
    'Esta unidade já saiu do estoque — foi vendida ou descartada. Leia outra unidade.',
} as const

async function comProduto(unidade: UnidadeProduto): Promise<UnidadeNaResposta> {
  const produto = await prisma.produto.findUniqueOrThrow({ where: { id: unidade.produtoId } })
  return comProdutoJaLido(unidade, produto)
}

function comProdutoJaLido(unidade: UnidadeProduto, produto: Produto): UnidadeNaResposta {
  return {
    id: unidade.id,
    codigoQr: unidade.codigoQr,
    dataValidade: unidade.dataValidade.toISOString().slice(0, 10),
    produto: {
      id: produto.id,
      codigoInterno: produto.codigoInterno,
      nome: produto.nome,
      marca: produto.marca,
    },
  }
}

/**
 * `AAAA-MM-DD` vira `DD/MM/AAAA` só dentro da mensagem, que é texto para
 * humanos. O campo `dataValidade` da resposta continua no formato de máquina.
 */
function comoDataDeTela(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split('-')
  return `${dia}/${mes}/${ano}`
}
