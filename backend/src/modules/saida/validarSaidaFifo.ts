import { Prisma, StatusUnidade, type UnidadeProduto } from '@prisma/client'
import { hojeComoData } from '../../shared/data.js'

/**
 * Núcleo do sistema (RF06).
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
 * Precisa rodar **inteiramente dentro** de uma transação, com a unidade lida
 * bloqueada por `SELECT ... FOR UPDATE` (RNF02) — por isso recebe o `tx` em
 * vez de abrir a transação por conta própria: quem chama é que delimita o
 * escopo atômico da leitura e da baixa.
 */
export async function validarSaidaFifo(
  codigoQr: string,
  usuarioId: string,
  tx: ClienteDeTransacao,
): Promise<Veredito> {
  const unidade = await bloquearUnidade(tx, codigoQr)
  const veredito = await decidir(codigoQr, usuarioId, unidade, tx)

  // Depois de decidir, e não antes, para que o registro carregue o veredito:
  // é a única forma de o EventoLog responder "quantas leituras acertaram de
  // primeira", que é o indicador do TCC (RF12). Gravar aqui, num ponto só,
  // também é o que garante estruturalmente uma leitura por chamada.
  await registrarEvento(tx, 'LEITURA_QR_SAIDA', unidade, usuarioId, {
    codigoQr,
    veredito: veredito.tipo,
    ...(veredito.tipo === 'ERRO' ? { motivo: veredito.motivo } : {}),
  })

  return veredito
}

/**
 * Os cinco ramos da seção 7 do PRD, **nesta ordem**. Cada ramo grava o evento
 * que lhe é próprio; o `LEITURA_QR_SAIDA` comum a todos fica com quem chama.
 */
async function decidir(
  codigoQr: string,
  usuarioId: string,
  unidade: UnidadeProduto | null,
  tx: ClienteDeTransacao,
): Promise<Veredito> {
  // 1. Código desconhecido: etiqueta danificada, item de outra loja, ou
  // unidade que nunca foi cadastrada. Nada a bloquear, nada a baixar.
  if (!unidade) return { tipo: 'ERRO', motivo: 'QR_NAO_ENCONTRADO' }

  // 2. Antes da validade, e não depois: mandar ao fluxo de exceção (T11) um
  // item que já foi vendido ou descartado faria a atendente resolver duas
  // vezes o mesmo frasco.
  if (unidade.status !== StatusUnidade.EM_ESTOQUE) {
    return { tipo: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' }
  }

  const hoje = hojeComoData()

  // 3. Vencida curto-circuita o FIFO: ela é, por definição, a de menor
  // validade do SKU, e sem este ramo vindo antes do próximo o sistema a
  // apontaria como "a que deve sair primeiro". A unidade não é tocada — o
  // destino dela é decidido pelos três caminhos da seção 6.1 do PRD (T11).
  if (unidade.dataValidade < hoje) {
    await registrarEvento(tx, 'TENTATIVA_VENDA_UNIDADE_VENCIDA', unidade, usuarioId, {
      codigoQr,
      dataValidade: comoTextoDeData(unidade.dataValidade),
    })
    return { tipo: 'EXCECAO_VENCIDO', unidade }
  }

  const prioritaria = await unidadePrioritaria(tx, unidade.produtoId, hoje)

  // 4. Comparação por **valor** de validade, não por identidade: havendo
  // empate, todas as unidades da menor validade são prioritárias, e ler
  // qualquer uma delas confirma. Exigir uma vencedora arbitrária pediria à
  // atendente um frasco fisicamente indistinguível do que está na mão dela
  // (docs/decisoes.md, 2026-09-07).
  if (unidade.dataValidade.getTime() !== prioritaria.dataValidade.getTime()) {
    const tentativas = (await contarBloqueiosDoCiclo(tx, unidade.produtoId, usuarioId)) + 1

    // `unidadeId` é a unidade LIDA: o evento descreve a leitura errada. A
    // correta vai no payload, porque o indicador da RF13 precisa cruzar as
    // duas pontas (alertas disparados vs. substituições efetivas).
    await registrarEvento(tx, 'ALERTA_FIFO_DISPARADO', unidade, usuarioId, {
      codigoQr,
      dataValidade: comoTextoDeData(unidade.dataValidade),
      unidadeCorretaId: prioritaria.id,
      dataValidadeCorreta: comoTextoDeData(prioritaria.dataValidade),
      tentativas,
    })

    return { tipo: 'BLOQUEAR_FIFO', unidadeCorreta: prioritaria, tentativas }
  }

  // 5. Confirmação. O ciclo fecha aqui, e é aqui que o total de tentativas
  // vira dado permanente na `Saida`.
  const tentativasAteAcerto = await contarBloqueiosDoCiclo(tx, unidade.produtoId, usuarioId)

  const baixada = await tx.unidadeProduto.update({
    where: { id: unidade.id },
    data: { status: StatusUnidade.VENDIDA },
  })

  await tx.saida.create({
    data: {
      unidadeId: unidade.id,
      usuarioId,
      alertaFifoDisparado: tentativasAteAcerto > 0,
      tentativasAteAcerto,
    },
  })

  await registrarEvento(tx, 'SAIDA_CONFIRMADA', baixada, usuarioId, {
    codigoQr,
    dataValidade: comoTextoDeData(baixada.dataValidade),
    tentativasAteAcerto,
  })

  return { tipo: 'CONFIRMAR', unidade: baixada }
}

/**
 * Toma o lock da linha e devolve a unidade já tipada.
 *
 * O `FOR UPDATE` exige query raw — a API de alto nível do Prisma não expõe
 * lock de linha, e é por isso que a seção 1 da arquitetura escolheu Prisma
 * "com query raw para lock explícito". A releitura pelo client tipado custa
 * uma viagem a mais, e paga por duas coisas: o `Veredito` carrega um
 * `UnidadeProduto` de verdade (com `dataValidade` convertida e `status` como
 * enum) em vez de linha crua, e a leitura acontece **depois** do lock, já no
 * `READ COMMITTED` — que é o que faz a transação perdedora enxergar a baixa
 * da vencedora e devolver `UNIDADE_JA_BAIXADA` em vez de estourar na
 * restrição `@unique` de `Saida.unidadeId`.
 *
 * O lock é da unidade lida, nunca do SKU: travar o produto inteiro
 * serializaria o balcão, com duas atendentes esperando uma pela outra para
 * vender frascos diferentes do mesmo perfume.
 */
async function bloquearUnidade(
  tx: ClienteDeTransacao,
  codigoQr: string,
): Promise<UnidadeProduto | null> {
  const travadas = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "UnidadeProduto" WHERE "codigoQr" = ${codigoQr} FOR UPDATE
  `

  const id = travadas[0]?.id
  if (id === undefined) return null

  return tx.unidadeProduto.findUniqueOrThrow({ where: { id } })
}

/**
 * Uma unidade de menor `dataValidade` entre as que ainda podem ser vendidas.
 *
 * O pool exclui vencidas (`dataValidade >= hoje`, PRD 6.1): sem essa exclusão
 * o laço FIFO apontaria a unidade vencida como "a mais antiga" e empurraria
 * ativamente produto vencido para o cliente — o oposto do objetivo do
 * trabalho.
 *
 * `findFirstOrThrow` e não `findFirst`: quem chama já bloqueou uma unidade
 * `EM_ESTOQUE` e não vencida do mesmo produto, então o pool tem no mínimo
 * essa unidade. Pool vazio aqui seria defeito, não caso de negócio.
 *
 * O desempate por `dataEntrada` não escolhe *a* prioritária — todas as
 * empatadas são igualmente prioritárias e qualquer uma confirma. Ele existe
 * só para que a unidade sugerida na tela seja estável entre duas leituras
 * iguais, em vez de variar conforme a ordem que o Postgres devolver.
 */
function unidadePrioritaria(
  tx: ClienteDeTransacao,
  produtoId: string,
  hoje: Date,
): Promise<UnidadeProduto> {
  return tx.unidadeProduto.findFirstOrThrow({
    where: {
      produtoId,
      status: StatusUnidade.EM_ESTOQUE,
      dataValidade: { gte: hoje },
    },
    orderBy: [{ dataValidade: 'asc' }, { dataEntrada: 'asc' }, { id: 'asc' }],
  })
}

/**
 * Quantos bloqueios de FIFO já houve no ciclo corrente, **sem** contar a
 * leitura em andamento.
 *
 * O número é derivado do EventoLog, não persistido: a seção 6.2 do PRD proíbe
 * estado intermediário no servidor, e um ciclo abandonado (o cliente desistiu)
 * não pode deixar contador para limpar. O ciclo é do par (SKU, atendente) —
 * é a atendente que troca de frasco a cada tentativa, e contar por unidade
 * lida daria outro número (docs/decisoes.md, 2026-09-07).
 *
 * A fronteira do ciclo é a última `SAIDA_CONFIRMADA` do mesmo par, comparada
 * com `>` estrito. `ocorridoEm` é `timestamp(3)`, então dois eventos podem
 * cair no mesmo milissegundo; o `>` resolve o empate a favor de fechar o
 * ciclo, o que subconta em vez de inflar o indicador.
 */
async function contarBloqueiosDoCiclo(
  tx: ClienteDeTransacao,
  produtoId: string,
  usuarioId: string,
): Promise<number> {
  const ultimaConfirmacao = await tx.eventoLog.findFirst({
    where: { tipoEvento: 'SAIDA_CONFIRMADA', produtoId, usuarioId },
    orderBy: { ocorridoEm: 'desc' },
    select: { ocorridoEm: true },
  })

  return tx.eventoLog.count({
    where: {
      tipoEvento: 'ALERTA_FIFO_DISPARADO',
      produtoId,
      usuarioId,
      // Sem confirmação anterior, o ciclo começa no primeiro evento de todos.
      ...(ultimaConfirmacao ? { ocorridoEm: { gt: ultimaConfirmacao.ocorridoEm } } : {}),
    },
  })
}

/**
 * Só `create` — o EventoLog é append-only (RNF05). `unidadeId` e `produtoId`
 * são nulos quando o código lido não corresponde a unidade nenhuma; nesse
 * caso o próprio código, no payload, é o que resta para identificar a leitura.
 */
function registrarEvento(
  tx: ClienteDeTransacao,
  tipoEvento: string,
  unidade: UnidadeProduto | null,
  usuarioId: string,
  payload: Prisma.InputJsonObject,
) {
  return tx.eventoLog.create({
    data: {
      tipoEvento,
      unidadeId: unidade?.id ?? null,
      produtoId: unidade?.produtoId ?? null,
      usuarioId,
      payload,
    },
  })
}

/**
 * A validade no payload é texto de calendário `AAAA-MM-DD`, não instante: o
 * valor vem de uma coluna `DATE` ancorada na meia-noite UTC (RNF01), e é
 * assim que ele precisa ser lido de volta na análise, sem risco de escorregar
 * um dia por fuso.
 */
function comoTextoDeData(data: Date): string {
  return data.toISOString().slice(0, 10)
}
