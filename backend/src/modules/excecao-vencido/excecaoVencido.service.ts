import { StatusUnidade, type Descarte, type UnidadeProduto } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { dataParaPayload, registrarEvento } from '../evento-log/eventoLog.service.js'
import { montarRespostaDeLeitura, type RespostaLeitura } from '../saida/saida.service.js'
import { validarSaidaFifo } from '../saida/validarSaidaFifo.js'
import { travarUnidadePorId } from '../unidade/travarUnidade.js'
import { comoDataDeTela, comProduto, type UnidadeNaResposta } from '../unidade/unidadeNaResposta.js'
import { dataDeString, hojeComoData } from '../../shared/data.js'

/**
 * Os três caminhos da unidade vencida (PRD seção 6.1).
 *
 * Até T07 o sistema sabia identificar a unidade vencida e a devolvia intacta:
 * `EXCECAO_VENCIDO` não toca no frasco, de propósito, porque quem decide o
 * destino dele é uma pessoa e não a validação. Este módulo é o destino — as
 * três vias que essa pessoa tem, e nada além delas.
 *
 * **Nenhuma decisão de FIFO acontece aqui** (RNF03). A correção de validade
 * chama `validarSaidaFifo`, que continua sendo a única a decidir vereditos; o
 * descarte e o override tratam de unidade que, por estar vencida, já está fora
 * do pool de candidatas prioritárias (PRD 6.1) — não há ordem a respeitar
 * porque não há fila da qual ela participe.
 *
 * As três operações compartilham as mesmas pré-condições, conferidas **sob o
 * lock** da RNF02: a unidade existe, está `EM_ESTOQUE`, e está vencida. A
 * terceira é a que importa no override: sem ela, "vender com justificativa"
 * viraria um contorno do bloqueio de FIFO, disponível a quem tem o papel de
 * gestor. O override é escape do bloqueio de **validade**, e só dele.
 */

export type FalhaExcecao =
  | 'UNIDADE_NAO_ENCONTRADA'
  | 'UNIDADE_JA_BAIXADA'
  | 'UNIDADE_NAO_VENCIDA'
  | 'VALIDADE_INALTERADA'

type Falha = { ok: false; motivo: FalhaExcecao }

/**
 * Texto gravado quando o descarte vem sem motivo.
 *
 * A fricção deliberada da seção 6.1 do PRD mora no override, não aqui: este é
 * o caminho que se quer fácil, porque é ele que produz o dado de perda que a
 * pesquisa quer quantificar. Exigir texto livre a cada frasco vencido no balcão
 * colocaria o atrito exatamente onde ele reduz a coleta.
 */
export const MOTIVO_PADRAO_DE_DESCARTE = 'Unidade vencida constatada na leitura de saída.'

export type ResultadoCorrecao =
  | {
      ok: true
      correcao: { dataValidadeAnterior: string; dataValidadeNova: string }
      /** O mesmo contrato de `POST /saidas/ler` — a tela não aprende forma nova. */
      revalidacao: RespostaLeitura
    }
  | Falha

export type ResultadoDescarte =
  | {
      ok: true
      resultado: 'DESCARTE_REGISTRADO'
      unidade: UnidadeNaResposta
      descarte: { id: string; dataHora: string; motivo: string }
      mensagem: string
    }
  | Falha

export type ResultadoOverride =
  | {
      ok: true
      resultado: 'VENDA_VENCIDA_AUTORIZADA'
      unidade: UnidadeNaResposta
      saida: {
        id: string
        dataHora: string
        justificativa: string
        autorizadoPor: { id: string; nome: string }
      }
      mensagem: string
    }
  | Falha

/**
 * Caminho 1 — a validade foi digitada errada no cadastro de entrada.
 *
 * Corrige o dado, registra o valor anterior e **revalida o FIFO do zero**, tudo
 * numa transação só. A revalidação é server-side por dois motivos: a tela não
 * pode esquecer de fazê-la, e a unidade permanece sob o mesmo lock do início ao
 * fim — entre corrigir e revalidar não existe instante em que outra atendente
 * veja o estoque pela metade.
 *
 * A consequência é que esta chamada pode terminar com a unidade **vendida**, se
 * a data corrigida a tornar a prioritária do pool. É coerente com o resto do
 * sistema: não existe `POST /saidas/confirmar` desde T09, e o veredito
 * `CONFIRMAR` já é a venda feita.
 */
export async function corrigirValidade(
  unidadeId: string,
  novaValidade: string,
  usuarioId: string,
  sessaoVendaId?: string,
): Promise<ResultadoCorrecao> {
  const nova = dataDeString(novaValidade)

  const resultado = await prisma.$transaction(async (tx) => {
    const alvo = conferirPreCondicoes(await travarUnidadePorId(tx, unidadeId))
    if (!alvo.ok) return alvo
    const { unidade } = alvo

    // Correção que não corrige só produziria uma linha de log dizendo que nada
    // mudou — no dado da pesquisa, ruído que parece evento.
    if (unidade.dataValidade.getTime() === nova.getTime()) {
      return { ok: false as const, motivo: 'VALIDADE_INALTERADA' as const }
    }

    const anterior = unidade.dataValidade

    await tx.unidadeProduto.update({ where: { id: unidade.id }, data: { dataValidade: nova } })

    await registrarEvento(tx, {
      tipoEvento: 'VALIDADE_CORRIGIDA',
      unidadeId: unidade.id,
      produtoId: unidade.produtoId,
      usuarioId,
      payload: {
        codigoQr: unidade.codigoQr,
        // O valor anterior é o ponto do evento: sem ele não há como distinguir,
        // meses depois, um erro de digitação corrigido de uma validade que
        // sempre foi aquela (RF12).
        dataValidadeAnterior: dataParaPayload(anterior),
        dataValidadeNova: dataParaPayload(nova),
        sessaoVendaId: sessaoVendaId ?? null,
      },
    })

    // Do zero: a mesma função, o mesmo caminho de uma leitura nova de QR. O
    // `FOR UPDATE` dela reencontra o lock que esta transação já tem.
    const veredito = await validarSaidaFifo(unidade.codigoQr, usuarioId, tx, sessaoVendaId ?? null)

    return {
      ok: true as const,
      codigoQr: unidade.codigoQr,
      dataValidadeAnterior: dataParaPayload(anterior),
      dataValidadeNova: dataParaPayload(nova),
      veredito,
    }
  })

  if (!resultado.ok) return resultado

  return {
    ok: true,
    correcao: {
      dataValidadeAnterior: resultado.dataValidadeAnterior,
      dataValidadeNova: resultado.dataValidadeNova,
    },
    revalidacao: await montarRespostaDeLeitura(resultado.codigoQr, resultado.veredito),
  }
}

/**
 * Caminho 2 — a unidade está de fato vencida e não será vendida.
 *
 * É o dado mais valioso da pesquisa: a perda que o trabalho quer quantificar.
 * Depois daqui a unidade está `DESCARTADA`, e uma leitura do mesmo código cai
 * no ramo 2 de `validarSaidaFifo` (`UNIDADE_JA_BAIXADA`) sem que nada tenha
 * sido acrescentado àquela função.
 */
export async function descartarUnidade(
  unidadeId: string,
  usuarioId: string,
  motivo: string | undefined,
  sessaoVendaId?: string,
): Promise<ResultadoDescarte> {
  const motivoGravado = motivo?.trim() || MOTIVO_PADRAO_DE_DESCARTE

  const resultado = await prisma.$transaction(async (tx) => {
    const alvo = conferirPreCondicoes(await travarUnidadePorId(tx, unidadeId))
    if (!alvo.ok) return alvo
    const { unidade } = alvo

    const baixada = await tx.unidadeProduto.update({
      where: { id: unidade.id },
      data: { status: StatusUnidade.DESCARTADA },
    })

    const descarte = await tx.descarte.create({
      data: { unidadeId: unidade.id, usuarioId, motivo: motivoGravado },
    })

    await registrarEvento(tx, {
      tipoEvento: 'DESCARTE_REGISTRADO',
      unidadeId: unidade.id,
      produtoId: unidade.produtoId,
      usuarioId,
      payload: {
        codigoQr: unidade.codigoQr,
        dataValidade: dataParaPayload(unidade.dataValidade),
        motivo: motivoGravado,
        sessaoVendaId: sessaoVendaId ?? null,
      },
    })

    return { ok: true as const, unidade: baixada, descarte }
  })

  if (!resultado.ok) return resultado

  const unidade = await comProduto(resultado.unidade)

  return {
    ok: true,
    resultado: 'DESCARTE_REGISTRADO',
    unidade,
    descarte: descarteNaResposta(resultado.descarte),
    mensagem:
      `Descarte registrado: ${unidade.produto.nome} (${unidade.produto.marca}), ` +
      `validade ${comoDataDeTela(unidade.dataValidade)}. ` +
      'A unidade saiu do estoque e entra no relatório de perdas.',
  }
}

/**
 * Caminho 3 — decisão comercial consciente, restrita ao `GESTOR`.
 *
 * Cria a `Saida` marcada como venda de unidade vencida, com a justificativa e
 * quem autorizou. **Não passa por `validarSaidaFifo`**: a unidade vencida está
 * fora do pool prioritário por definição (PRD 6.1), e mandá-la à função só
 * devolveria `EXCECAO_VENCIDO` num laço. Não há veredito de FIFO a tomar aqui,
 * há uma venda declaradamente fora do fluxo — registrada como tal.
 *
 * `alertaFifoDisparado` e `tentativasAteAcerto` ficam no zero: esta venda não
 * atravessou o laço de substituição, e contá-la no indicador de acerto na
 * primeira leitura misturaria duas coisas diferentes (RF12).
 */
export async function autorizarVendaVencida(
  unidadeId: string,
  gestor: { id: string; nome: string },
  justificativa: string,
  sessaoVendaId?: string,
): Promise<ResultadoOverride> {
  const resultado = await prisma.$transaction(async (tx) => {
    const alvo = conferirPreCondicoes(await travarUnidadePorId(tx, unidadeId))
    if (!alvo.ok) return alvo
    const { unidade } = alvo

    const baixada = await tx.unidadeProduto.update({
      where: { id: unidade.id },
      data: { status: StatusUnidade.VENDIDA },
    })

    const saida = await tx.saida.create({
      data: {
        unidadeId: unidade.id,
        // Quem executa e quem autoriza são o mesmo gestor: o sistema não tem
        // escalação de papel dentro da sessão de uma atendente (não há PIN de
        // gerente). Os dois campos continuam separados no schema porque uma
        // escalação futura os preencheria diferente — e porque apagar a
        // distinção agora seria perder a pergunta.
        usuarioId: gestor.id,
        autorizadoPorId: gestor.id,
        vendaDeUnidadeVencida: true,
        justificativaOverride: justificativa,
        alertaFifoDisparado: false,
        tentativasAteAcerto: 0,
        sessaoVendaId: sessaoVendaId ?? null,
      },
    })

    await registrarEvento(tx, {
      tipoEvento: 'VENDA_VENCIDA_AUTORIZADA',
      unidadeId: unidade.id,
      produtoId: unidade.produtoId,
      usuarioId: gestor.id,
      payload: {
        codigoQr: unidade.codigoQr,
        dataValidade: dataParaPayload(unidade.dataValidade),
        justificativa,
        autorizadoPorId: gestor.id,
        sessaoVendaId: sessaoVendaId ?? null,
      },
    })

    return { ok: true as const, unidade: baixada, saida }
  })

  if (!resultado.ok) return resultado

  const unidade = await comProduto(resultado.unidade)

  return {
    ok: true,
    resultado: 'VENDA_VENCIDA_AUTORIZADA',
    unidade,
    saida: {
      id: resultado.saida.id,
      dataHora: resultado.saida.dataHora.toISOString(),
      justificativa,
      autorizadoPor: { id: gestor.id, nome: gestor.nome },
    },
    mensagem:
      `Venda de unidade vencida autorizada por ${gestor.nome}: ` +
      `${unidade.produto.nome} (${unidade.produto.marca}), ` +
      `validade ${comoDataDeTela(unidade.dataValidade)}. ` +
      'O registro desta autorização é permanente.',
  }
}

/**
 * As mesmas três perguntas dos ramos 1 a 3 de `validarSaidaFifo`, na mesma
 * ordem.
 *
 * Não é duplicação de regra de FIFO — nenhuma ordem de saída é consultada aqui.
 * São perguntas de **estado** da unidade, e a ordem importa pelo mesmo motivo
 * que importa lá: mandar ao fluxo de exceção um frasco já vendido faria a
 * atendente resolver duas vezes o mesmo item.
 *
 * Roda sempre depois de `travarUnidadePorId`, nunca antes: entre uma leitura
 * sem lock e a escrita caberia outra transação inteira.
 */
function conferirPreCondicoes(
  unidade: UnidadeProduto | null,
): { ok: true; unidade: UnidadeProduto } | Falha {
  if (!unidade) return { ok: false, motivo: 'UNIDADE_NAO_ENCONTRADA' }

  if (unidade.status !== StatusUnidade.EM_ESTOQUE) {
    return { ok: false, motivo: 'UNIDADE_JA_BAIXADA' }
  }

  // A trava que sustenta os três caminhos: eles existem para resolver o que
  // está vencido. Aplicá-los a uma unidade válida seria, no descarte, uma perda
  // inventada no dado da pesquisa e, no override, uma venda fora da ordem FIFO
  // com aparência de exceção legítima.
  if (unidade.dataValidade >= hojeComoData()) {
    return { ok: false, motivo: 'UNIDADE_NAO_VENCIDA' }
  }

  return { ok: true, unidade }
}

function descarteNaResposta(descarte: Descarte): { id: string; dataHora: string; motivo: string } {
  return {
    id: descarte.id,
    dataHora: descarte.dataHora.toISOString(),
    motivo: descarte.motivo,
  }
}
