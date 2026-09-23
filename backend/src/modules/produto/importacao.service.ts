import { prisma } from '../../db/prisma.js'
import { lerCsv } from '../../shared/csv.js'
import { normalizarDadosProduto, type DadosProduto } from './produto.service.js'

/**
 * Importação do catálogo a partir da planilha da loja (T24).
 *
 * A planilha é validada inteira antes de qualquer escrita, e com um problema
 * só nada é gravado: gravar as linhas boas e recusar as ruins deixaria a
 * gestora sem saber o que já entrou. Os problemas voltam todos de uma vez, com
 * o número da linha que o Excel mostra, para que ela corrija tudo numa rodada.
 *
 * Só produtos. Unidades entram pelo recebimento, uma etiqueta por frasco —
 * `tasks/T24-importacao-produtos-csv.md`, Decisão 1.
 */

/** O mesmo teto por campo do formulário de cadastro (`produto.routes.ts`). */
export const TAMANHO_MAXIMO_CAMPO = 120

/** ~700 SKUs na loja (RNF10). O teto só existe para barrar o arquivo errado. */
export const MAXIMO_LINHAS = 5000

/**
 * Quantos problemas a resposta lista. Uma planilha com a coluna errada tem um
 * problema por linha, e setecentas mensagens iguais não ajudam ninguém.
 */
const MAXIMO_ERROS_LISTADOS = 50

const CAMPOS: (keyof DadosProduto)[] = ['codigoInterno', 'nome', 'marca', 'categoria']

const ROTULOS: Record<keyof DadosProduto, string> = {
  codigoInterno: 'código interno',
  nome: 'nome',
  marca: 'marca',
  categoria: 'categoria',
}

export type ResultadoImportacao =
  | { ok: true; criados: number; ignorados: { linha: number; codigoInterno: string }[] }
  | { ok: false; erros: string[] }

export async function importarProdutos(conteudo: string): Promise<ResultadoImportacao> {
  const leitura = interpretarPlanilha(conteudo)
  if (!leitura.ok) return leitura

  const existentes = new Set(
    (
      await prisma.produto.findMany({
        where: { codigoInterno: { in: leitura.produtos.map((p) => p.dados.codigoInterno) } },
        select: { codigoInterno: true },
      })
    ).map((produto) => produto.codigoInterno),
  )

  const ignorados = leitura.produtos
    .filter((p) => existentes.has(p.dados.codigoInterno))
    .map((p) => ({ linha: p.linha, codigoInterno: p.dados.codigoInterno }))

  // Uma instrução só, e portanto atômica. `skipDuplicates` cobre o código
  // cadastrado por outra pessoa entre a consulta acima e esta escrita: ele não
  // entra na lista de ignorados, mas também não derruba a importação.
  const { count } = await prisma.produto.createMany({
    data: leitura.produtos.filter((p) => !existentes.has(p.dados.codigoInterno)).map((p) => p.dados),
    skipDuplicates: true,
  })

  return { ok: true, criados: count, ignorados }
}

type Leitura =
  | { ok: true; produtos: { linha: number; dados: DadosProduto }[] }
  | { ok: false; erros: string[] }

/** A parte sem banco: do texto do arquivo às linhas prontas para gravar. */
export function interpretarPlanilha(conteudo: string): Leitura {
  const csv = lerCsv(conteudo)
  if (!csv || csv.linhas.length === 0) {
    return { ok: false, erros: ['A planilha não tem nenhum produto abaixo do cabeçalho.'] }
  }

  const colunas = csv.cabecalho.map(chaveDeColuna)
  const faltando = CAMPOS.filter((campo) => !colunas.includes(chaveDeColuna(campo)))
  if (faltando.length > 0) {
    return {
      ok: false,
      erros: [
        `Linha 1: faltam as colunas ${faltando.map((campo) => ROTULOS[campo]).join(', ')}. ` +
          'O cabeçalho precisa ter código interno, nome, marca e categoria.',
      ],
    }
  }

  if (csv.linhas.length > MAXIMO_LINHAS) {
    return { ok: false, erros: [`A planilha tem mais de ${MAXIMO_LINHAS} linhas. Divida em partes.`] }
  }

  const erros: string[] = []
  const produtos: { linha: number; dados: DadosProduto }[] = []
  const primeiraLinhaDoCodigo = new Map<string, number>()

  for (const { numero, valores } of csv.linhas) {
    const valor = (campo: keyof DadosProduto) => valores[colunas.indexOf(chaveDeColuna(campo))] ?? ''
    const dados = normalizarDadosProduto({
      codigoInterno: valor('codigoInterno'),
      nome: valor('nome'),
      marca: valor('marca'),
      categoria: valor('categoria'),
    })

    const problemas: string[] = []
    const vazios = CAMPOS.filter((campo) => dados[campo] === '')
    if (vazios.length > 0) problemas.push(`${vazios.map((campo) => ROTULOS[campo]).join(', ')} em branco`)
    for (const campo of CAMPOS) {
      if (dados[campo].length > TAMANHO_MAXIMO_CAMPO) {
        problemas.push(`${ROTULOS[campo]} com mais de ${TAMANHO_MAXIMO_CAMPO} caracteres`)
      }
    }

    const anterior = primeiraLinhaDoCodigo.get(dados.codigoInterno)
    if (dados.codigoInterno !== '' && anterior !== undefined) {
      problemas.push(`código ${dados.codigoInterno} repetido (já aparece na linha ${anterior})`)
    } else if (dados.codigoInterno !== '') {
      primeiraLinhaDoCodigo.set(dados.codigoInterno, numero)
    }

    if (problemas.length > 0) {
      erros.push(`Linha ${numero}: ${problemas.join('; ')}.`)
    } else {
      produtos.push({ linha: numero, dados })
    }
  }

  if (erros.length > MAXIMO_ERROS_LISTADOS) {
    const restantes = erros.length - MAXIMO_ERROS_LISTADOS
    return { ok: false, erros: [...erros.slice(0, MAXIMO_ERROS_LISTADOS), `… e mais ${restantes} linha(s) com problema.`] }
  }
  if (erros.length > 0) return { ok: false, erros }
  return { ok: true, produtos }
}

/**
 * O nome da coluna sem acento, maiúscula, espaço, `_` ou `-`: `Código interno`,
 * `codigo_interno` e `codigoInterno` são a mesma coluna. A planilha da loja foi
 * escrita por gente, não pelo sistema.
 */
function chaveDeColuna(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]/g, '')
}
