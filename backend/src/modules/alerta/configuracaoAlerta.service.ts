import type { ConfiguracaoAlerta, Prisma } from '@prisma/client'
import { prisma } from '../../db/prisma.js'

/**
 * A janela de antecedência dos alertas proativos (RF08) — o único parâmetro
 * do sistema que a loja define e o código não sabe.
 *
 * Tudo o que existe até aqui é reativo: o FIFO decide quando alguém lê um QR
 * (T07), e a fila de descarte (T13) mostra a perda já consumada. Entre "está
 * no estoque" e "venceu" existe uma janela em que ainda cabe decisão comercial
 * (jornada J3 do PRD), e o número de dias dessa janela depende do giro do
 * produto — 30 dias é razoável para um perfume e absurdo para outra coisa.
 * Quem sabe o número é a gestora.
 *
 * **Este módulo só guarda o parâmetro.** Nenhuma varredura de estoque acontece
 * aqui, nenhuma linha de `Alerta` é escrita ou lida: quem cruza a janela com
 * as validades é T18, e quem entrega o aviso é T19.
 */

/**
 * Os canais de entrega possíveis, como conjunto fechado.
 *
 * O PRD (RF08) fala em "alerta in-app **e/ou** notificação push" num campo só,
 * então o valor precisa conseguir dizer "os dois" — daí `AMBOS`, em vez de
 * obrigar a gestora a manter duas configurações espelhadas para a mesma
 * janela.
 *
 * A coluna continua `String` no Prisma (`docs/arquitetura.md` seção 3), e o
 * fechamento do conjunto vive aqui e no `enum` do JSON Schema da rota. Um
 * `enum` no banco seria mais forte, e custaria uma migração numa tarefa que o
 * schema de T02 já atende; a decisão está em `docs/decisoes.md` (2026-09-08).
 * O que **não** é opcional é o conjunto ser fechado em algum lugar: canal
 * livre é dado que T19 teria de adivinhar como entregar.
 */
export const CANAIS = ['IN_APP', 'PUSH', 'AMBOS'] as const

export type Canal = (typeof CANAIS)[number]

/** Mínimo 1: a unidade que vence *hoje* ainda está no pool do FIFO e ainda é
 * vendável (a borda que T13 testou), e no dia seguinte ela já aparece na fila
 * de descarte. Uma janela de 0 dias duplicaria por notificação, com um dia de
 * diferença, o que a fila já mostra por varredura. */
export const ANTECEDENCIA_MINIMA = 1

/** Teto arbitrário, para que um erro de digitação (3650) não vire uma janela
 * que inclui o estoque inteiro e transforme o alerta em ruído constante. */
export const ANTECEDENCIA_MAXIMA = 365

export type ConfiguracaoNaResposta = {
  id: string
  diasAntecedencia: number
  canal: Canal
  ativo: boolean
}

export type DadosConfiguracao = {
  diasAntecedencia: number
  canal: Canal
}

export type AlteracaoConfiguracao = Partial<DadosConfiguracao> & { ativo?: boolean }

type MotivoRecusa = 'ANTECEDENCIA_JA_CONFIGURADA' | 'CONFIGURACAO_NAO_ENCONTRADA'

type Resultado =
  | { ok: true; configuracao: ConfiguracaoNaResposta }
  | { ok: false; motivo: MotivoRecusa }

function naResposta(linha: ConfiguracaoAlerta): ConfiguracaoNaResposta {
  return {
    id: linha.id,
    diasAntecedencia: linha.diasAntecedencia,
    // A coluna é `String`; o conjunto fechado é garantido na entrada, pelo
    // `enum` do schema da rota. Uma linha com canal fora do conjunto só
    // chegaria aqui vinda de escrita direta no banco.
    canal: linha.canal as Canal,
    ativo: linha.ativo,
  }
}

/**
 * Todas as configurações, ativas e inativas, da janela mais larga para a mais
 * estreita — que é a ordem em que elas disparam.
 *
 * Sem paginação: a lista tem ordem de grandeza de unidades. As inativas vêm
 * juntas porque inativar é o desfazer do `DELETE` (ver `inativarConfiguracao`)
 * e uma configuração invisível não teria como ser reativada pela interface.
 */
export async function listarConfiguracoes(): Promise<ConfiguracaoNaResposta[]> {
  const linhas = await prisma.configuracaoAlerta.findMany({
    orderBy: [{ diasAntecedencia: 'desc' }, { id: 'asc' }],
  })
  return linhas.map(naResposta)
}

/**
 * Duas configurações **ativas** com a mesma antecedência fariam o job de T18
 * gerar dois `Alerta` para a mesma unidade no mesmo dia, inflando a contagem
 * de alertas emitidos que a RF13 vai reportar — um número da pesquisa, não só
 * uma duplicata de tela.
 *
 * A garantia é de aplicação, dentro da transação, e não índice único no banco:
 * "único entre as ativas" é índice parcial, que exigiria SQL cru na migração,
 * para proteger uma escrita que acontece quando a gestora mexe na
 * configuração. É deliberadamente o oposto da escolha da RNF02 — lá o dado em
 * disputa é o estoque, com dois atendimentos simultâneos sobre o mesmo frasco.
 */
function colideComAtiva(
  tx: Prisma.TransactionClient,
  diasAntecedencia: number,
  ignorarId?: string,
) {
  return tx.configuracaoAlerta.findFirst({
    where: {
      ativo: true,
      diasAntecedencia,
      ...(ignorarId ? { id: { not: ignorarId } } : {}),
    },
  })
}

export async function criarConfiguracao(dados: DadosConfiguracao): Promise<Resultado> {
  return prisma.$transaction(async (tx) => {
    if (await colideComAtiva(tx, dados.diasAntecedencia)) {
      return { ok: false, motivo: 'ANTECEDENCIA_JA_CONFIGURADA' }
    }

    const criada = await tx.configuracaoAlerta.create({
      data: { diasAntecedencia: dados.diasAntecedencia, canal: dados.canal },
    })

    return { ok: true, configuracao: naResposta(criada) }
  })
}

export async function atualizarConfiguracao(
  id: string,
  alteracao: AlteracaoConfiguracao,
): Promise<Resultado> {
  return prisma.$transaction(async (tx) => {
    const atual = await tx.configuracaoAlerta.findUnique({ where: { id } })
    if (!atual) return { ok: false, motivo: 'CONFIGURACAO_NAO_ENCONTRADA' }

    // A colisão é verificada sobre o **estado resultante**, não sobre o que
    // veio no corpo: reativar uma configuração de 30 dias colide se outra de
    // 30 dias tiver sido criada enquanto esta estava inativa, mesmo que o
    // `PATCH` só traga `ativo`.
    const diasResultante = alteracao.diasAntecedencia ?? atual.diasAntecedencia
    const ativoResultante = alteracao.ativo ?? atual.ativo

    if (ativoResultante && (await colideComAtiva(tx, diasResultante, id))) {
      return { ok: false, motivo: 'ANTECEDENCIA_JA_CONFIGURADA' }
    }

    const alterada = await tx.configuracaoAlerta.update({ where: { id }, data: alteracao })

    return { ok: true, configuracao: naResposta(alterada) }
  })
}

/**
 * Inativa (`ativo = false`); **nunca apaga**.
 *
 * Mesmo precedente do catálogo de produtos (T04), com uma razão a mais e mais
 * forte: `Alerta.configuracaoId` é FK obrigatória, então apagar uma
 * configuração que já emitiu alertas ou quebra a integridade referencial ou
 * leva junto o histórico de alertas emitidos — que é dado da pesquisa
 * (RF12/RF13). Inativar preserva a leitura "este alerta foi emitido sob a
 * janela de 30 dias que hoje não existe mais".
 *
 * Idempotente: inativar o que já está inativo devolve o mesmo estado.
 */
export async function inativarConfiguracao(id: string): Promise<ConfiguracaoNaResposta | null> {
  const atual = await prisma.configuracaoAlerta.findUnique({ where: { id } })
  if (!atual) return null

  const inativada = await prisma.configuracaoAlerta.update({
    where: { id },
    data: { ativo: false },
  })

  return naResposta(inativada)
}
