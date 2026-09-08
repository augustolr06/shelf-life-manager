import type { Produto, UnidadeProduto } from '@prisma/client'
import { prisma } from '../../db/prisma.js'

/**
 * A forma como uma unidade física aparece em qualquer resposta da API.
 *
 * Nasceu no serviço de saída (T08) e mudou para cá em T11, quando os três
 * caminhos da unidade vencida passaram a devolver a mesma coisa: a unidade com
 * o produto embutido, e a validade como data de calendário. Uma segunda cópia
 * da forma abriria a porta para as duas divergirem — e a que divergisse seria
 * a de uma tela que ninguém olha todo dia.
 */
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
 * Busca o produto da unidade e monta a resposta.
 *
 * Sempre chamada **fora** da transação que decidiu ou baixou a unidade: é
 * consulta de apresentação, e prendê-la ao lock atrasaria a próxima operação
 * sobre o mesmo frasco sem motivo.
 */
export async function comProduto(unidade: UnidadeProduto): Promise<UnidadeNaResposta> {
  const produto = await prisma.produto.findUniqueOrThrow({ where: { id: unidade.produtoId } })
  return comProdutoJaLido(unidade, produto)
}

/** A mesma montagem, quando quem chama já tem o produto em mãos. */
export function comProdutoJaLido(unidade: UnidadeProduto, produto: Produto): UnidadeNaResposta {
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
 * `AAAA-MM-DD` vira `DD/MM/AAAA` só dentro de mensagem, que é texto para
 * humanos. O campo `dataValidade` das respostas continua no formato de máquina.
 */
export function comoDataDeTela(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split('-')
  return `${dia}/${mes}/${ano}`
}
