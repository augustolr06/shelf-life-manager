/**
 * Cadastra os produtos fictícios de uma planilha:
 *
 *     npm run ficticios:cadastrar -- <email-de-quem-registra> [planilha.csv]
 *
 * Sem planilha, usa `dados-ficticios/produtos-ficticios.csv`. O e-mail é de
 * uma conta existente e ativa: é ela que aparece como quem registrou as
 * unidades e assina os `UNIDADE_CADASTRADA`.
 *
 * A planilha é validada inteira antes de qualquer escrita — um erro na linha
 * 40 não deixa as 39 anteriores gravadas. Termina com código 1 em qualquer
 * recusa, como `usuario:senha`.
 */
import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { prisma } from '../prisma.js'
import { cadastrarFicticios, destinoDoBanco } from './ficticios.js'
import { lerPlanilha } from './planilha.js'

const PLANILHA_PADRAO = 'dados-ficticios/produtos-ficticios.csv'

const [email, caminho = PLANILHA_PADRAO] = process.argv.slice(2)

try {
  if (!email) {
    console.error('uso: npm run ficticios:cadastrar -- <email-de-quem-registra> [planilha.csv]')
    process.exitCode = 1
  } else {
    console.log(`banco: ${destinoDoBanco()}`)
    console.log(`planilha: ${caminho}\n`)

    const planilha = lerPlanilha(await readFile(caminho, 'utf8'))

    if (!planilha.ok) {
      console.error('planilha recusada, nada foi gravado:')
      for (const erro of planilha.erros) console.error(`  ${erro}`)
      process.exitCode = 1
    } else {
      const resultado = await cadastrarFicticios(planilha.produtos, email)

      if (!resultado.ok) {
        console.error(`cadastro interrompido — ${resultado.motivo}`)
        process.exitCode = 1
      } else {
        for (const produto of resultado.produtos) {
          if (produto.situacao === 'JA_EXISTIA') {
            console.log(`${produto.codigoInterno}: já existia, pulado`)
            continue
          }
          console.log(`${produto.codigoInterno}: criado, ${produto.unidades.length} unidade(s)`)
          for (const unidade of produto.unidades) {
            console.log(`  ${unidade.codigoQr}  validade ${unidade.dataValidade}`)
          }
        }
      }
    }
  }
} catch (erro) {
  console.error('falha ao cadastrar os produtos fictícios:', erro)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
