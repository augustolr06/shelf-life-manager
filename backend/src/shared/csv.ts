/**
 * Leitura de CSV, para as duas planilhas que o sistema aceita: o catálogo
 * importado pela gestora (T24) e a massa de produtos fictícios.
 *
 * CSV, e não `.xlsx`, para não trazer dependência nova: Excel, LibreOffice e
 * Google Planilhas abrem e salvam CSV. Aceita o que esses programas produzem na
 * prática — separador `;` (o padrão do Excel em pt-BR, onde a vírgula é
 * decimal) ou `,`, o BOM do "CSV UTF-8" do Excel, campos entre aspas e quebra
 * de linha CRLF. Não aceita quebra de linha **dentro** de um campo: nenhum dado
 * de produto tem, e suportá-la custaria perder o número da linha nos erros.
 *
 * Só divide o texto. Decidir o que cada coluna significa, e se o valor serve, é
 * de quem chama.
 */

export type LinhaCsv = {
  /** Número da linha no arquivo, contando o cabeçalho como 1 — o que o Excel mostra. */
  numero: number
  valores: string[]
}

export type Csv = {
  cabecalho: string[]
  linhas: LinhaCsv[]
}

/** `null` para um texto sem nenhuma linha preenchida. Linhas em branco são ignoradas. */
export function lerCsv(texto: string): Csv | null {
  const linhas = texto
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((conteudo, indice) => ({ numero: indice + 1, conteudo }))
    // Linha só de separadores é o que o Excel grava quando a pessoa apaga o
    // conteúdo das células em vez de excluir a linha.
    .filter((linha) => linha.conteudo.replace(/[;,\s]/g, '') !== '')

  const [primeira, ...dados] = linhas
  if (!primeira) return null

  const separador = primeira.conteudo.includes(';') ? ';' : ','

  return {
    cabecalho: dividirLinha(primeira.conteudo, separador).map((nome) => nome.trim()),
    linhas: dados.map(({ numero, conteudo }) => ({
      numero,
      valores: dividirLinha(conteudo, separador),
    })),
  }
}

/** Divide uma linha respeitando campos entre aspas e `""` como aspa literal. */
function dividirLinha(linha: string, separador: string): string[] {
  const campos: string[] = []
  let atual = ''
  let entreAspas = false

  for (let i = 0; i < linha.length; i += 1) {
    const caractere = linha[i]
    if (entreAspas) {
      if (caractere === '"' && linha[i + 1] === '"') {
        atual += '"'
        i += 1
      } else if (caractere === '"') {
        entreAspas = false
      } else {
        atual += caractere
      }
    } else if (caractere === '"') {
      entreAspas = true
    } else if (caractere === separador) {
      campos.push(atual)
      atual = ''
    } else {
      atual += caractere
    }
  }

  campos.push(atual)
  return campos
}
