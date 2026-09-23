/**
 * Produtos fictícios para testar o sistema publicado: cadastro a partir da
 * planilha e remoção de tudo o que eles deixaram no banco.
 *
 * O dado fictício é reconhecido **só** pelo prefixo `ZZ-` do `codigoInterno`
 * — não por uma coluna nova no schema, e não pela planilha. A remoção varre o
 * banco pelo prefixo, e por isso alcança também o produto `ZZ-` criado à mão
 * pela interface durante o roteiro de testes manuais.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import { criarProduto } from '../../modules/produto/produto.service.js'
import { cadastrarUnidades } from '../../modules/unidade/unidade.service.js'
import { textoDeData } from '../../shared/data.js'
import { PREFIXO_FICTICIO, type ProdutoFicticio } from './planilha.js'

export type ProdutoCadastrado = {
  codigoInterno: string
  situacao: 'CRIADO' | 'JA_EXISTIA'
  unidades: { codigoQr: string; dataValidade: string }[]
}

export type ResultadoCadastroFicticio =
  | { ok: true; produtos: ProdutoCadastrado[] }
  | { ok: false; motivo: string }

/**
 * Cadastra pelos mesmos serviços que a interface usa — normalização do
 * produto, geração do `codigoQr` e o `UNIDADE_CADASTRADA` de cada unidade —
 * para que o dado fictício seja indistinguível do real em tudo, menos no
 * prefixo. Um atalho por `createMany` testaria um estoque que a aplicação não
 * produz.
 *
 * Produto que já existe é pulado inteiro, unidades inclusive: rodar a
 * planilha duas vezes não pode dobrar o estoque de teste. Para recriar,
 * remove-se primeiro.
 */
export async function cadastrarFicticios(
  produtos: ProdutoFicticio[],
  emailDeQuemRegistra: string,
): Promise<ResultadoCadastroFicticio> {
  const usuario = await prisma.usuario.findUnique({ where: { email: emailDeQuemRegistra } })
  if (!usuario) return { ok: false, motivo: `não existe usuário ${emailDeQuemRegistra} neste banco` }
  if (!usuario.ativo) return { ok: false, motivo: `o usuário ${emailDeQuemRegistra} está desativado` }

  const cadastrados: ProdutoCadastrado[] = []

  for (const { itens, ...dados } of produtos) {
    const criacao = await criarProduto(dados)

    if (!criacao.ok) {
      cadastrados.push({ codigoInterno: dados.codigoInterno, situacao: 'JA_EXISTIA', unidades: [] })
      continue
    }

    const registro: ProdutoCadastrado = {
      codigoInterno: criacao.produto.codigoInterno,
      situacao: 'CRIADO',
      unidades: [],
    }
    cadastrados.push(registro)

    if (itens.length === 0) continue

    const lote = await cadastrarUnidades(criacao.produto.id, itens, usuario.id)
    if (!lote.ok) {
      return {
        ok: false,
        motivo:
          `${registro.codigoInterno}: produto criado, mas as unidades não (${lote.motivo}). ` +
          'Rode a remoção e cadastre de novo.',
      }
    }

    registro.unidades = lote.unidades.map((unidade) => ({
      codigoQr: unidade.codigoQr,
      dataValidade: textoDeData(unidade.dataValidade),
    }))
  }

  return { ok: true, produtos: cadastrados }
}

export type Levantamento = {
  produtos: { codigoInterno: string; nome: string }[]
  unidades: number
  saidas: number
  descartes: number
  alertas: number
  eventos: number
}

/**
 * Remove os produtos `ZZ-` e **tudo** o que eles deixaram: unidades, saídas,
 * descartes, alertas e os eventos do `EventoLog`.
 *
 * ## A exceção à RNF05
 *
 * O `EventoLog` é append-only, e um trigger de banco recusa `DELETE` nele
 * (migração `20260908120000_append_only_evento_log`). Esta função é o único
 * código do repositório que o contorna, e de propósito: a RNF05 existe para
 * proteger o dado da pesquisa (RF12), e o evento de um produto fictício não é
 * dado da pesquisa — é contaminação dele. Deixá-lo significaria o dashboard
 * contar para sempre os bloqueios FIFO dos testes (`ALERTA_FIFO_DISPARADO` é
 * contado direto do log, sem filtro de produto). Decidido em
 * `docs/decisoes.md` (2026-09-22).
 *
 * O contorno é o mais estreito possível. O trigger é desligado **dentro da
 * transação**, e `ALTER TABLE` é transacional no PostgreSQL: se qualquer
 * passo falhar, o rollback o religa junto com o resto. E o `DELETE` só alcança
 * eventos cujo `produtoId` ou `unidadeId` pertence a um produto `ZZ-` — a
 * leitura de um QR que não existe, que não tem nenhum dos dois, fica.
 *
 * Sem `confirmar`, só levanta o que seria apagado e não escreve nada.
 */
export async function removerFicticios(confirmar: boolean): Promise<Levantamento> {
  // O `ALTER TABLE` pega lock exclusivo no `EventoLog` até o commit, e toda
  // leitura de QR grava evento: o balcão espera enquanto isto roda. Por isso a
  // transação é uma só e curta, e o prazo daqui não é o da aplicação.
  return prisma.$transaction(
    async (tx) => {
      const produtos = await tx.produto.findMany({
        where: { codigoInterno: { startsWith: PREFIXO_FICTICIO } },
        select: { id: true, codigoInterno: true, nome: true },
        orderBy: { codigoInterno: 'asc' },
      })
      const produtoIds = produtos.map((produto) => produto.id)
      const unidadeIds = (
        await tx.unidadeProduto.findMany({ where: { produtoId: { in: produtoIds } }, select: { id: true } })
      ).map((unidade) => unidade.id)

      const daUnidade = { unidadeId: { in: unidadeIds } }
      const doFicticio: Prisma.EventoLogWhereInput = {
        OR: [{ produtoId: { in: produtoIds } }, { unidadeId: { in: unidadeIds } }],
      }

      const levantamento: Levantamento = {
        produtos: produtos.map(({ codigoInterno, nome }) => ({ codigoInterno, nome })),
        unidades: unidadeIds.length,
        saidas: await tx.saida.count({ where: daUnidade }),
        descartes: await tx.descarte.count({ where: daUnidade }),
        alertas: await tx.alerta.count({ where: daUnidade }),
        eventos: await tx.eventoLog.count({ where: doFicticio }),
      }

      if (!confirmar || produtos.length === 0) return levantamento

      await tx.$executeRaw`ALTER TABLE "EventoLog" DISABLE TRIGGER eventolog_append_only`
      await tx.eventoLog.deleteMany({ where: doFicticio })
      await tx.$executeRaw`ALTER TABLE "EventoLog" ENABLE TRIGGER eventolog_append_only`

      await tx.alerta.deleteMany({ where: daUnidade })
      await tx.saida.deleteMany({ where: daUnidade })
      await tx.descarte.deleteMany({ where: daUnidade })
      await tx.unidadeProduto.deleteMany({ where: { id: { in: unidadeIds } } })
      await tx.produto.deleteMany({ where: { id: { in: produtoIds } } })

      return levantamento
    },
    { timeout: 60_000 },
  )
}

/**
 * Para onde o script está apontando, sem usuário nem senha. Os dois scripts
 * imprimem isto primeiro: o mesmo terminal fala com o banco local e com o de
 * produção, e a diferença é só a variável de ambiente.
 */
export function destinoDoBanco(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '')
    return `${url.host}${url.pathname}`
  } catch {
    return '(DATABASE_URL ausente ou inválida)'
  }
}
