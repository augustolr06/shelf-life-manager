import type { UnidadeProduto } from '@prisma/client'
import type { ClienteDeTransacao } from '../evento-log/eventoLog.service.js'

/**
 * O lock de linha exigido pela RNF02, num lugar só.
 *
 * Toda operação que decide o destino de uma unidade física — a leitura de QR
 * (T07) e os três caminhos da unidade vencida (T11) — precisa ler e escrever a
 * mesma linha sem que outra transação se meta no meio. O `FOR UPDATE` exige
 * query raw: a API de alto nível do Prisma não expõe lock de linha, e é por
 * isso que a seção 1 da arquitetura escolheu Prisma "com query raw para lock
 * explícito".
 *
 * A releitura pelo client tipado, depois do lock, custa uma viagem a mais e
 * paga por duas coisas: quem chama recebe um `UnidadeProduto` de verdade (com
 * `dataValidade` convertida e `status` como enum) em vez de linha crua, e a
 * leitura acontece **depois** do lock, já no `READ COMMITTED` — que é o que faz
 * a transação perdedora enxergar a baixa da vencedora em vez de estourar numa
 * restrição `@unique`.
 *
 * **O lock é da unidade, nunca do SKU.** Travar o produto inteiro serializaria
 * o balcão, com duas atendentes esperando uma pela outra para resolver frascos
 * diferentes do mesmo perfume (PRD seção 6.2).
 *
 * As duas formas existem porque as duas chaves são legítimas em contextos
 * diferentes: o balcão conhece a unidade pelo código impresso na etiqueta; os
 * endpoints de exceção a conhecem pelo `id` que o próprio servidor devolveu no
 * veredito.
 */

export function travarUnidadePorCodigo(
  tx: ClienteDeTransacao,
  codigoQr: string,
): Promise<UnidadeProduto | null> {
  return travar(tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "UnidadeProduto" WHERE "codigoQr" = ${codigoQr} FOR UPDATE
  `, tx)
}

export function travarUnidadePorId(
  tx: ClienteDeTransacao,
  id: string,
): Promise<UnidadeProduto | null> {
  return travar(tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "UnidadeProduto" WHERE "id" = ${id} FOR UPDATE
  `, tx)
}

async function travar(
  consulta: Promise<{ id: string }[]>,
  tx: ClienteDeTransacao,
): Promise<UnidadeProduto | null> {
  const travadas = await consulta

  const id = travadas[0]?.id
  if (id === undefined) return null

  return tx.unidadeProduto.findUniqueOrThrow({ where: { id } })
}
