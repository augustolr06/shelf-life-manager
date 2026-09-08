import { StatusUnidade } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { hojeComoData } from '../../shared/data.js'
import { comProdutoJaLido, type UnidadeNaResposta } from '../unidade/unidadeNaResposta.js'

/**
 * A fila de descarte pendente (RF11): toda unidade que ainda está no estoque e
 * cuja validade já passou.
 *
 * É a contrapartida exata da exclusão que a validação FIFO faz do pool
 * prioritário (`docs/arquitetura.md` seção 4, passo 4): lá, `dataValidade >=
 * hoje` mantém a unidade candidata a sair; aqui, a negação disso é o que a
 * torna pendente. As duas cláusulas precisam continuar sendo negação uma da
 * outra — se divergirem, aparece uma faixa de unidades que não está nem no
 * fluxo de saída nem nesta fila, invisível dos dois lados. É por isso que
 * `hojeComoData()` é a mesma função nos dois lugares, e não uma segunda noção
 * de "hoje" escrita aqui.
 *
 * **Descoberta, não resolução.** Este módulo só lista. Dar destino à unidade
 * continua sendo os três caminhos da seção 6.1 do PRD, em
 * `modules/excecao-vencido/` (T11) — inclusive quando quem age é o gestor
 * vindo desta lista.
 */

export type UnidadePendente = UnidadeNaResposta & {
  /**
   * Há quantos dias a unidade venceu, calculado contra o mesmo "hoje" que
   * decide o FIFO.
   *
   * Vai na resposta em vez de ser derivado na tela porque a diferença é uma
   * comparação de datas, e comparação de data no navegador depende do fuso do
   * aparelho — que não é necessariamente o da loja (RNF01). O frontend não
   * compara validade em lugar nenhum, e esta lista não vai ser a exceção.
   */
  diasVencida: number
  /** Quando o frasco entrou no estoque. Ajuda o gestor a achá-lo na prateleira. */
  dataEntrada: string
}

export type FilaDeDescarte = {
  unidades: UnidadePendente[]
  /** A fila inteira, não a página: é o número que mede o problema. */
  total: number
  pagina: number
  tamanhoPagina: number
}

export type FiltrosDaFila = {
  pagina: number
  tamanhoPagina: number
}

const MILISSEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000

export async function listarDescartesPendentes(filtros: FiltrosDaFila): Promise<FilaDeDescarte> {
  const { pagina, tamanhoPagina } = filtros
  const hoje = hojeComoData()

  const where = {
    status: StatusUnidade.EM_ESTOQUE,
    // Estritamente menor: o que vence *hoje* ainda pode ser vendido hoje, e
    // continua no pool do FIFO. A borda é a mesma dos dois lados.
    dataValidade: { lt: hoje },
  }

  const [unidades, total] = await Promise.all([
    prisma.unidadeProduto.findMany({
      where,
      // A mais vencida primeiro: é a ordem da urgência, e é a mesma noção de
      // prioridade que o FIFO aplica ao pool não-vencido. O desempate por
      // `codigoQr` (único) existe para a paginação ser estável — sem ele, duas
      // unidades da mesma data poderiam trocar de lugar entre uma página e a
      // seguinte, e uma delas nunca apareceria.
      orderBy: [{ dataValidade: 'asc' }, { codigoQr: 'asc' }],
      // Uma consulta só: a fila é lista, e buscar o produto por unidade seria
      // N+1 num painel que pode ter dezenas de linhas.
      include: { produto: true },
      skip: (pagina - 1) * tamanhoPagina,
      take: tamanhoPagina,
    }),
    prisma.unidadeProduto.count({ where }),
  ])

  return {
    unidades: unidades.map((unidade) => ({
      ...comProdutoJaLido(unidade, unidade.produto),
      diasVencida: Math.round((hoje.getTime() - unidade.dataValidade.getTime()) / MILISSEGUNDOS_POR_DIA),
      dataEntrada: unidade.dataEntrada.toISOString(),
    })),
    total,
    pagina,
    tamanhoPagina,
  }
}
