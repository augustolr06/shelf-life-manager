/**
 * Construtores de cenário para as suítes com banco real.
 *
 * Todas as datas são derivadas de `hojeComoData()`, nunca de literais como
 * '2026-09-01': o objeto de teste da validação FIFO é justamente a comparação
 * com "hoje", e uma suíte com datas fixas começa a mentir assim que o
 * calendário avança do dia em que ela foi escrita.
 */

import { Papel, type PrismaClient, StatusUnidade, type UnidadeProduto } from '@prisma/client'
import { hojeComoData } from '../../src/shared/data.js'
import { gerarCodigosQr } from '../../src/modules/unidade/codigoQr.js'

let sequencial = 0
function proximo(): number {
  return (sequencial += 1)
}

/** Uma data de calendário a N dias de hoje. N negativo é passado. */
export function emDias(dias: number): Date {
  const hoje = hojeComoData()
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + dias))
}

export function criarUsuario(prisma: PrismaClient, papel: Papel = Papel.ATENDENTE) {
  const n = proximo()
  return prisma.usuario.create({
    data: {
      nome: `Usuário de Teste ${n}`,
      email: `teste-${n}@estoque.local`,
      // As suítes com banco não exercitam login; o hash só precisa existir.
      senhaHash: 'hash-irrelevante-para-esta-suite',
      papel,
    },
  })
}

export function criarProduto(prisma: PrismaClient, nome = 'Eau de Parfum 50ml') {
  const n = proximo()
  return prisma.produto.create({
    data: {
      codigoInterno: `PRF-${String(n).padStart(3, '0')}`,
      nome,
      marca: 'Marca Exemplo',
      categoria: 'Perfumaria',
    },
  })
}

/**
 * Uma unidade física do SKU, posicionada no calendário por `diasAteVencer`.
 * `0` é uma unidade que vence hoje; negativo é uma unidade já vencida.
 */
export function criarUnidade(
  prisma: PrismaClient,
  dados: {
    produtoId: string
    registradoPorId: string
    diasAteVencer: number
    status?: StatusUnidade
  },
): Promise<UnidadeProduto> {
  return prisma.unidadeProduto.create({
    data: {
      produtoId: dados.produtoId,
      registradoPorId: dados.registradoPorId,
      codigoQr: gerarCodigosQr(1)[0] as string,
      dataValidade: emDias(dados.diasAteVencer),
      status: dados.status ?? StatusUnidade.EM_ESTOQUE,
    },
  })
}

export function eventosDe(prisma: PrismaClient, tipoEvento: string) {
  return prisma.eventoLog.findMany({ where: { tipoEvento } })
}
