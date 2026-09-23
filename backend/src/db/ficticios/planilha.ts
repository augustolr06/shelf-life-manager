/**
 * Leitura da planilha de produtos fictícios (`dados-ficticios/*.csv`). O CSV em
 * si é lido por `shared/csv.ts`, o mesmo da importação do catálogo (T24). O que
 * é daqui é a validade, que aceita também a data que o Excel reescreve como
 * `DD/MM/AAAA` quando alguém digita `AAAA-MM-DD` numa célula.
 *
 * Uma linha é **uma validade de um produto**, como uma linha do recebimento
 * (RF03). O produto que chega com três validades ocupa três linhas: nome,
 * marca e categoria vêm da primeira, e as seguintes podem deixá-los em branco.
 * Validade e quantidade em branco numa linha só é produto sem unidade.
 *
 * Nada aqui toca o banco: a função devolve a planilha inteira interpretada ou
 * a lista de erros, e quem chama só escreve se não houver erro nenhum.
 */
import { lerCsv } from '../../shared/csv.js'
import { dataDeString, hojeComoData, textoDeData } from '../../shared/data.js'
import type { DadosProduto } from '../../modules/produto/produto.service.js'
import type { ItemLote } from '../../modules/unidade/unidade.service.js'

/**
 * A marca do dado fictício, e a única coisa que o script de remoção olha.
 * É o mesmo prefixo que `docs/roteiro-testes-manuais.md` usa para o dado
 * criado à mão pela interface — os dois caminhos saem pela mesma limpeza.
 */
export const PREFIXO_FICTICIO = 'ZZ-'

/** O mesmo teto por linha do recebimento pela API (`unidade.routes.ts`). */
const MAXIMO_POR_LINHA = 200

const COLUNAS = ['codigoInterno', 'nome', 'marca', 'categoria', 'validade', 'quantidade'] as const

export type ProdutoFicticio = DadosProduto & { itens: ItemLote[] }

export type Planilha =
  | { ok: true; produtos: ProdutoFicticio[] }
  | { ok: false; erros: string[] }

export function lerPlanilha(texto: string, hoje: Date = hojeComoData()): Planilha {
  const csv = lerCsv(texto)
  if (!csv) return { ok: false, erros: ['a planilha está vazia'] }

  const nomes = csv.cabecalho
  const faltando = COLUNAS.filter((coluna) => !nomes.includes(coluna))
  if (faltando.length > 0) {
    return { ok: false, erros: [`linha 1: faltam as colunas ${faltando.join(', ')}`] }
  }

  const erros: string[] = []
  const produtos = new Map<string, ProdutoFicticio>()

  for (const { numero, valores } of csv.linhas) {
    const campo = (coluna: (typeof COLUNAS)[number]) =>
      (valores[nomes.indexOf(coluna)] ?? '').trim()
    const erro = (mensagem: string) => erros.push(`linha ${numero}: ${mensagem}`)

    // Mesma normalização de `criarProduto`: é por este código que a linha se
    // junta às outras do mesmo produto e que a remoção o encontra depois.
    const codigoInterno = campo('codigoInterno').toUpperCase()
    if (!codigoInterno.startsWith(PREFIXO_FICTICIO)) {
      erro(`codigoInterno "${codigoInterno}" precisa começar com ${PREFIXO_FICTICIO}`)
      continue
    }

    let produto = produtos.get(codigoInterno)
    const descricao = { nome: campo('nome'), marca: campo('marca'), categoria: campo('categoria') }

    if (!produto) {
      const vazios = Object.entries(descricao).filter(([, valor]) => valor === '')
      if (vazios.length > 0) {
        erro(`primeira linha de ${codigoInterno} sem ${vazios.map(([nome]) => nome).join(', ')}`)
        continue
      }
      produto = { codigoInterno, ...descricao, itens: [] }
      produtos.set(codigoInterno, produto)
    } else {
      for (const [nome, valor] of Object.entries(descricao)) {
        const anterior = produto[nome as keyof typeof descricao]
        if (valor !== '' && valor !== anterior) {
          erro(`${nome} "${valor}" diverge de "${anterior}", da primeira linha de ${codigoInterno}`)
        }
      }
    }

    const validade = campo('validade')
    const quantidade = campo('quantidade')
    if (validade === '' && quantidade === '') continue

    const data = interpretarValidade(validade, hoje)
    if (!data) {
      erro(`validade "${validade}" não é AAAA-MM-DD, DD/MM/AAAA nem HOJE±N`)
      continue
    }

    const numeroDeUnidades = Number(quantidade)
    if (!Number.isInteger(numeroDeUnidades) || numeroDeUnidades < 1 || numeroDeUnidades > MAXIMO_POR_LINHA) {
      erro(`quantidade "${quantidade}" precisa ser inteiro de 1 a ${MAXIMO_POR_LINHA}`)
      continue
    }

    produto.itens.push({ dataValidade: data, quantidade: numeroDeUnidades })
  }

  if (erros.length > 0) return { ok: false, erros }
  if (produtos.size === 0) return { ok: false, erros: ['a planilha não tem nenhum produto'] }
  return { ok: true, produtos: [...produtos.values()] }
}

/**
 * A validade como texto `AAAA-MM-DD` (RNF01: dia de calendário, sem hora).
 *
 * `HOJE+N` existe porque a massa de teste é relativa ao dia em que roda: uma
 * unidade "vencida há 5 dias" escrita como data fixa deixa de ser o caso que
 * se queria testar na semana seguinte — o mesmo motivo pelo qual as suítes
 * derivam as datas de `hojeComoData()`.
 */
export function interpretarValidade(texto: string, hoje: Date): string | null {
  const relativa = /^HOJE\s*(?:([+-])\s*(\d+))?$/i.exec(texto)
  if (relativa) {
    const [, sinal, dias] = relativa
    const deslocamento = dias ? Number(dias) * (sinal === '-' ? -1 : 1) : 0
    const data = new Date(hoje)
    data.setUTCDate(data.getUTCDate() + deslocamento)
    return textoDeData(data)
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto)
  const brasileira = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto)
  const partes = iso ? [iso[1], iso[2], iso[3]] : brasileira ? [brasileira[3], brasileira[2], brasileira[1]] : null
  if (!partes) return null

  const candidata = partes.join('-')
  // 31/02 vira 03/03 no `Date.UTC`; a volta para texto denuncia a data inexistente.
  return textoDeData(dataDeString(candidata)) === candidata ? candidata : null
}
