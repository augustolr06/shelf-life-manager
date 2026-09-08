import { randomUUID } from 'node:crypto'
import { Prisma, type UnidadeProduto } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { registrarEvento } from '../evento-log/eventoLog.service.js'
import { dataDeString, hojeComoData } from '../../shared/data.js'
import { gerarCodigosQr } from './codigoQr.js'

/**
 * Uma linha do recebimento: uma validade e quantas unidades chegaram com
 * ela. Um recebimento misto — o cenário que motiva o projeto — é várias
 * linhas na mesma requisição, cada uma com sua própria data (RF03).
 */
export type ItemLote = {
  dataValidade: string
  quantidade: number
}

/**
 * Cadastrar unidade já vencida é legítimo (é o que acontece quando a loja
 * encontra na prateleira um item que nunca foi registrado), então isto é
 * aviso, não recusa. Quem decide o que fazer com a unidade vencida é o fluxo
 * de exceção da seção 6.1 do PRD, não o cadastro.
 */
export type Aviso = {
  codigo: 'UNIDADE_JA_VENCIDA'
  dataValidade: string
  quantidade: number
  mensagem: string
}

export type FalhaCadastro =
  | 'PRODUTO_NAO_ENCONTRADO'
  | 'PRODUTO_INATIVO'
  | 'CODIGO_QR_INDISPONIVEL'

export type ResultadoCadastro =
  | { ok: true; unidades: UnidadeProduto[]; avisos: Aviso[] }
  | { ok: false; motivo: FalhaCadastro }

/**
 * Quantas vezes o lote inteiro é regerado se o banco recusar um `codigoQr`
 * repetido. Com 32^6 códigos possíveis a colisão é remotíssima; o laço existe
 * para que ela seja um retry invisível e não um erro na cara da gestora.
 */
const TENTATIVAS_DE_CODIGO = 3

export async function cadastrarUnidades(
  produtoId: string,
  itens: ItemLote[],
  registradoPorId: string,
): Promise<ResultadoCadastro> {
  const produto = await prisma.produto.findUnique({ where: { id: produtoId } })

  if (!produto) return { ok: false, motivo: 'PRODUTO_NAO_ENCONTRADO' }
  // Produto inativo não participa do uso operacional do catálogo — receber
  // unidade dele é quase certamente engano de quem escolheu o SKU na tela.
  if (!produto.ativo) return { ok: false, motivo: 'PRODUTO_INATIVO' }

  const validades = expandirEmUnidades(itens)

  for (let tentativa = 1; tentativa <= TENTATIVAS_DE_CODIGO; tentativa += 1) {
    const codigos = gerarCodigosQr(validades.length)

    // Os ids são gerados aqui, e não deixados a cargo do `@default(uuid())`,
    // para que o `UNIDADE_CADASTRADA` de cada unidade possa referenciá-la na
    // mesma transação — o log não tem FK para `UnidadeProduto` (seção 3 da
    // arquitetura), mas precisa do id certo. Não muda nada de fato: o
    // `@default(uuid())` do Prisma também é gerado no client.
    const ids = validades.map(() => randomUUID())

    try {
      // Uma transação para o lote todo: um recebimento é um evento único, e
      // gravar metade das unidades deixaria a gestora sem saber quais frascos
      // já têm etiqueta e quais não têm. Os eventos entram na mesma transação,
      // pelo mesmo motivo — e porque um lote que falha não pode deixar
      // registro de cadastro que não aconteceu (RF12).
      const criacoes = validades.map((dataValidade, indice) =>
        prisma.unidadeProduto.create({
          data: {
            id: ids[indice] as string,
            produtoId,
            codigoQr: codigos[indice] as string,
            dataValidade: dataDeString(dataValidade),
            registradoPorId,
            // `status` não é escrito: o valor inicial EM_ESTOQUE vem do
            // default do schema, e o cliente não tem como propor outro.
          },
        }),
      )

      // Um evento por unidade, não um por lote: `EventoLog.unidadeId` é
      // singular, e é essa granularidade que permite cruzar o cadastro com as
      // leituras posteriores da mesma unidade (RF12). O recebimento é
      // reconstruído por `unidadesNoLote`, sem precisar de uma entidade
      // `Lote` que o PRD não previu.
      const eventos = validades.map((dataValidade, indice) =>
        registrarEvento(prisma, {
          tipoEvento: 'UNIDADE_CADASTRADA',
          unidadeId: ids[indice] as string,
          produtoId,
          usuarioId: registradoPorId,
          payload: {
            codigoQr: codigos[indice] as string,
            // Já é texto `AAAA-MM-DD` como chegou da API (RNF01).
            dataValidade,
            unidadesNoLote: validades.length,
          },
        }),
      )

      const gravados = await prisma.$transaction([...criacoes, ...eventos])
      const unidades = gravados.slice(0, criacoes.length) as UnidadeProduto[]

      return { ok: true, unidades, avisos: avisosDeValidade(itens) }
    } catch (erro) {
      if (!ehViolacaoDeUnicidade(erro)) throw erro
      if (tentativa === TENTATIVAS_DE_CODIGO) return { ok: false, motivo: 'CODIGO_QR_INDISPONIVEL' }
    }
  }

  // Inalcançável: o laço acima ou retorna ou lança.
  return { ok: false, motivo: 'CODIGO_QR_INDISPONIVEL' }
}

/** Uma linha `{ validade, quantidade: 3 }` vira três unidades independentes. */
function expandirEmUnidades(itens: ItemLote[]): string[] {
  return itens.flatMap((item) => Array<string>(item.quantidade).fill(item.dataValidade))
}

export function contarUnidades(itens: ItemLote[]): number {
  return itens.reduce((soma, item) => soma + item.quantidade, 0)
}

function avisosDeValidade(itens: ItemLote[]): Aviso[] {
  const hoje = hojeComoData()

  return itens
    .filter((item) => dataDeString(item.dataValidade) < hoje)
    .map((item) => ({
      codigo: 'UNIDADE_JA_VENCIDA' as const,
      dataValidade: item.dataValidade,
      quantidade: item.quantidade,
      mensagem:
        `${item.quantidade} unidade(s) foram cadastradas já vencidas ` +
        `(validade ${item.dataValidade}). Elas entram em estoque e serão barradas na venda.`,
    }))
}

function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002'
}
