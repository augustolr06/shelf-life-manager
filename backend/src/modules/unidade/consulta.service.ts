import type { StatusUnidade } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { hojeComoData } from '../../shared/data.js'
import { normalizarCodigoQr } from './codigoQr.js'
import { comProdutoJaLido, type UnidadeNaResposta } from './unidadeNaResposta.js'

/**
 * A consulta de uma unidade pelo QR, sem registrar saída (T32).
 *
 * É o "o que é este frasco?" do balcão, e por isso **não** passa por
 * `validarSaidaFifo`: não diz se a unidade é a próxima a sair (veredito FIFO, e
 * a RNF03 proíbe decidi-lo fora daquela função), não trava a linha e não grava
 * `EventoLog`. O `LEITURA_QR_SAIDA` é o denominador da taxa de acerto na
 * primeira leitura (RF12), e contar consulta ali falsearia o indicador; um tipo
 * novo também não cabe, porque o log registra o que acontece com o estoque, e
 * olhar um frasco não muda o estoque (o mesmo argumento das etiquetas de T14).
 *
 * Contrato: `tasks/T32-consulta-unidade-qr.md`.
 */

/**
 * `VENCIDA` a partir do dia seguinte ao da validade. A borda é a mesma do
 * pool do FIFO, da varredura de alertas e da fila de descarte: o que vence
 * *hoje* ainda é vendável hoje.
 */
export type SituacaoDaValidade = 'VENCIDA' | 'NO_PRAZO'

export type UnidadeConsultada = Omit<UnidadeNaResposta, 'produto'> & {
  /** O estado real: vendida ou descartada também é resposta da consulta. */
  status: StatusUnidade
  /** Instante do cadastro, não data de calendário. */
  dataEntrada: string
  produto: UnidadeNaResposta['produto'] & {
    categoria: string
    ativo: boolean
  }
}

export type Consulta = {
  unidade: UnidadeConsultada
  /**
   * Decidida aqui, e não na tela: comparar validade no navegador depende do
   * fuso do aparelho (RNF01), e a tela só reflete o que o servidor diz (RNF04)
   * — o mesmo `situacao` de `GET /alertas` (T19).
   */
  situacao: SituacaoDaValidade
  /** Dias até a validade, contra `hojeComoData()`. Negativo depois de vencida. */
  diasParaVencer: number
}

export type ResultadoDaConsulta =
  | { ok: true; consulta: Consulta }
  | { ok: false; motivo: 'QR_NAO_ENCONTRADO' }

const MILISSEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000

export async function consultarUnidade(codigoDigitado: string): Promise<ResultadoDaConsulta> {
  // O mesmo tratamento da leitura de saída: o código pode ter vindo digitado
  // à mão, e `codigoQr.ts` é o dono único do formato (T08).
  const codigoQr = normalizarCodigoQr(codigoDigitado)

  const unidade = await prisma.unidadeProduto.findUnique({
    where: { codigoQr },
    include: { produto: true },
  })

  if (!unidade) return { ok: false, motivo: 'QR_NAO_ENCONTRADO' }

  const diasParaVencer = Math.round(
    (unidade.dataValidade.getTime() - hojeComoData().getTime()) / MILISSEGUNDOS_POR_DIA,
  )
  const base = comProdutoJaLido(unidade, unidade.produto)

  return {
    ok: true,
    consulta: {
      unidade: {
        ...base,
        status: unidade.status,
        dataEntrada: unidade.dataEntrada.toISOString(),
        produto: {
          ...base.produto,
          categoria: unidade.produto.categoria,
          ativo: unidade.produto.ativo,
        },
      },
      // Também para unidade vendida ou descartada: a situação fala da
      // validade, e o `status` diz se o frasco ainda está na loja.
      situacao: diasParaVencer < 0 ? 'VENCIDA' : 'NO_PRAZO',
      diasParaVencer,
    },
  }
}
