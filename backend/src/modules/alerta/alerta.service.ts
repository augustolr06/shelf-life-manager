import type { Alerta, ConfiguracaoAlerta, Prisma, Produto, UnidadeProduto } from '@prisma/client'
import { StatusUnidade } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { dataParaPayload, registrarEvento } from '../evento-log/eventoLog.service.js'
import { hojeComoData } from '../../shared/data.js'
import { comProdutoJaLido, type UnidadeNaResposta } from '../unidade/unidadeNaResposta.js'
import type { Canal } from './configuracaoAlerta.service.js'

/**
 * A entrega do alerta proativo (RF08, T19): o que a varredura de T18 emitiu,
 * chegando a uma pessoa.
 *
 * Até aqui o alerta era registro. A varredura cruza a janela com o estoque e
 * escreve uma linha de `Alerta` que ninguém vê — está declarado em
 * `docs/notas-para-artigo.md` como limitação de T18: "o alerta existe no banco
 * e não é aviso". Este módulo é o que fecha a jornada J3 do PRD, e a coluna
 * `lidoEm` (que existe desde T02 e nunca foi escrita por ninguém) é o fim do
 * ciclo.
 *
 * **Nenhuma regra de janela vive aqui.** Quem decide o que entra na janela é
 * `varreduraAlertas.ts`; este módulo lê o que ela escreveu e olha o estado
 * *atual* da unidade, que pode ter mudado desde a emissão.
 *
 * Contrato: `tasks/T19-entrega-do-alerta.md`.
 */

export type SituacaoDoAlerta = 'NA_JANELA' | 'VENCIDA'

export type AlertaNaResposta = {
  id: string
  /** Quando a varredura emitiu. Instante, não data de calendário. */
  geradoEm: string
  lidoEm: string | null
  /**
   * Quantos dias faltam para a unidade vencer, contra o mesmo `hojeComoData()`
   * que decide o FIFO, a fila de descarte e a varredura. **Negativo** quando a
   * unidade venceu depois de o alerta ter sido emitido.
   *
   * Vem pronto do servidor pelo mesmo motivo do `diasVencida` de T13:
   * comparação de data no navegador depende do fuso do aparelho (RNF01).
   */
  diasParaVencer: number
  /**
   * O que aconteceu com a unidade desde a emissão, decidido aqui e não na tela
   * (RNF04). A tela marca o alerta perdido a partir deste campo, nunca do
   * sinal de `diasParaVencer`.
   */
  situacao: SituacaoDoAlerta
  /** A janela que gerou este alerta — a configuração como ela está hoje. */
  janela: {
    configuracaoId: string
    diasAntecedencia: number
    canal: Canal
  }
  unidade: UnidadeNaResposta
}

export type ListaDeAlertas = {
  alertas: AlertaNaResposta[]
  /** Os alertas exibíveis, não a página. */
  total: number
  /**
   * Os não lidos exibíveis — **sem** o filtro `apenasNaoLidos` aplicado. É o
   * número do contador da navegação, e ele não pode depender de onde a gestora
   * está olhando.
   */
  naoLidos: number
  pagina: number
  tamanhoPagina: number
}

export type FiltrosDeAlertas = {
  pagina: number
  tamanhoPagina: number
  apenasNaoLidos: boolean
}

type MotivoRecusa = 'ALERTA_NAO_ENCONTRADO'

type ResultadoDaLeitura =
  | { ok: true; alerta: AlertaNaResposta }
  | { ok: false; motivo: MotivoRecusa }

type AlertaCompleto = Alerta & {
  unidade: UnidadeProduto & { produto: Produto }
  configuracao: ConfiguracaoAlerta
}

const MILISSEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000

const COM_UNIDADE_E_JANELA = {
  // Uma ida só ao banco: buscar o produto por alerta seria N+1 numa lista que
  // pode ter dezenas de linhas — o mesmo cuidado da fila de T13.
  unidade: { include: { produto: true } },
  configuracao: true,
} as const

/**
 * O que a tela mostra: alerta cuja unidade **ainda está no estoque**.
 *
 * Vendida ou descartada, não há mais o que decidir sobre o frasco, e o alerta
 * some da lista. Já **vencida, o alerta continua** — marcado, e apontando para
 * a fila de descarte. Some-lo apagaria da tela justamente o caso que mede se a
 * RF08 funcionou: fomos avisados e o frasco venceu assim mesmo
 * (`tasks/T19-entrega-do-alerta.md`, Decisão 3).
 *
 * A linha de `Alerta` continua no banco nos três casos: ela é o registro do
 * que foi emitido, e é dela e do `EventoLog` que a RF13 vai contar.
 *
 * A janela ter sido inativada depois (T17) **não** esconde o alerta: ele foi
 * emitido quando ela valia, e inativar diz "não emita mais", não "desfaça".
 */
const EXIBIVEL = { unidade: { status: StatusUnidade.EM_ESTOQUE } }

function naResposta(alerta: AlertaCompleto, hoje: Date): AlertaNaResposta {
  const diasParaVencer = Math.round(
    (alerta.unidade.dataValidade.getTime() - hoje.getTime()) / MILISSEGUNDOS_POR_DIA,
  )

  return {
    id: alerta.id,
    geradoEm: alerta.geradoEm.toISOString(),
    lidoEm: alerta.lidoEm?.toISOString() ?? null,
    diasParaVencer,
    // A borda é a mesma da varredura e do pool do FIFO: o que vence *hoje*
    // ainda é vendável hoje, e só amanhã vira assunto da fila de T13.
    situacao: diasParaVencer < 0 ? 'VENCIDA' : 'NA_JANELA',
    janela: {
      configuracaoId: alerta.configuracaoId,
      diasAntecedencia: alerta.configuracao.diasAntecedencia,
      canal: alerta.configuracao.canal as Canal,
    },
    unidade: comProdutoJaLido(alerta.unidade, alerta.unidade.produto),
  }
}

export async function listarAlertas(filtros: FiltrosDeAlertas): Promise<ListaDeAlertas> {
  const { pagina, tamanhoPagina, apenasNaoLidos } = filtros
  const hoje = hojeComoData()

  const where: Prisma.AlertaWhereInput = {
    ...EXIBIVEL,
    ...(apenasNaoLidos ? { lidoEm: null } : {}),
  }

  const [alertas, total, naoLidos] = await Promise.all([
    prisma.alerta.findMany({
      where,
      include: COM_UNIDADE_E_JANELA,
      // Urgência primeiro, que é a mesma ordem da fila de T13 e das etiquetas
      // de T14. O desempate por `codigoQr` (único) existe para a paginação ser
      // estável: sem ele, duas unidades da mesma data podem trocar de lugar
      // entre uma página e a seguinte, e uma delas nunca apareceria.
      orderBy: [{ unidade: { dataValidade: 'asc' } }, { unidade: { codigoQr: 'asc' } }],
      skip: (pagina - 1) * tamanhoPagina,
      take: tamanhoPagina,
    }),
    prisma.alerta.count({ where }),
    // Sem o `apenasNaoLidos`: é o contador da navegação, e a paginação impede
    // derivá-lo da página carregada.
    prisma.alerta.count({ where: { ...EXIBIVEL, lidoEm: null } }),
  ])

  return {
    alertas: alertas.map((alerta) => naResposta(alerta, hoje)),
    total,
    naoLidos,
    pagina,
    tamanhoPagina,
  }
}

/**
 * Marca o alerta como lido — a primeira escrita em `Alerta.lidoEm` desde T02.
 *
 * **Idempotente**: alerta já lido mantém o `lidoEm` original. O instante é
 * dado da pesquisa (é ele que, contra o `ALERTA_PROATIVO_EMITIDO` da mesma
 * unidade, diz quanto tempo a loja levou para reagir), e duas abas abertas não
 * podem reescrevê-lo.
 *
 * "Lido" é da loja, não de cada gestor: `lidoEm` é uma coluna só, como a seção
 * 5 do PRD declara. Com dois gestores, o que um marcar sai do contador do
 * outro (`tasks/T19-entrega-do-alerta.md`, Decisão 4).
 *
 * Sem lock (RNF02 é sobre a baixa da unidade, que aqui não acontece): a
 * corrida entre dois cliques é resolvida pelo `updateMany` condicionado a
 * `lidoEm: null`, que é atômico — só um dos dois encontra a linha por marcar,
 * e só ele grava o evento.
 */
export async function marcarAlertaComoLido(
  id: string,
  usuarioId: string,
): Promise<ResultadoDaLeitura> {
  const hoje = hojeComoData()

  const alerta = await prisma.alerta.findUnique({ where: { id }, include: COM_UNIDADE_E_JANELA })

  if (!alerta) return { ok: false, motivo: 'ALERTA_NAO_ENCONTRADO' }

  // Já lido: nada a escrever, e nenhum segundo `ALERTA_LIDO` — dois eventos
  // inflariam a contagem da pesquisa descrevendo um reconhecimento que
  // aconteceu uma vez.
  if (alerta.lidoEm) return { ok: true, alerta: naResposta(alerta, hoje) }

  const lidoEm = new Date()

  const marcado = await prisma.$transaction(async (tx) => {
    const atualizacao = await tx.alerta.updateMany({
      where: { id, lidoEm: null },
      data: { lidoEm },
    })

    // Outra requisição marcou entre a leitura acima e esta escrita. O evento
    // é dela, não desta: quem reconheceu foi quem chegou primeiro.
    if (atualizacao.count === 0) return false

    // Décimo tipo de evento, acrescentado conscientemente antes do piloto
    // (Decisão 5 / `docs/decisoes.md`). Assinado pelo gestor que leu — a conta
    // de sistema de T18 assina só o que não tem autor humano. Na mesma
    // transação do `lidoEm`, como todo evento: um evento que sobrevivesse a um
    // rollback descreveria algo que não aconteceu.
    await registrarEvento(tx, {
      tipoEvento: 'ALERTA_LIDO',
      unidadeId: alerta.unidadeId,
      produtoId: alerta.unidade.produtoId,
      usuarioId,
      payload: {
        alertaId: alerta.id,
        configuracaoId: alerta.configuracaoId,
        diasAntecedencia: alerta.configuracao.diasAntecedencia,
        // Data de calendário em payload é texto, nunca instante (RNF01).
        dataValidade: dataParaPayload(alerta.unidade.dataValidade),
        diasParaVencer: Math.round(
          (alerta.unidade.dataValidade.getTime() - hoje.getTime()) / MILISSEGUNDOS_POR_DIA,
        ),
        geradoEm: alerta.geradoEm.toISOString(),
      },
    })

    return true
  })

  if (marcado) return { ok: true, alerta: naResposta({ ...alerta, lidoEm }, hoje) }

  // Perdeu a corrida: o `lidoEm` que vale é o de quem marcou primeiro, e é ele
  // que a resposta precisa devolver.
  const atual = await prisma.alerta.findUnique({ where: { id }, include: COM_UNIDADE_E_JANELA })

  return atual
    ? { ok: true, alerta: naResposta(atual, hoje) }
    : { ok: false, motivo: 'ALERTA_NAO_ENCONTRADO' }
}
