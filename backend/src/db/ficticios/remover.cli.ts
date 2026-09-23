/**
 * Remove do banco todos os produtos fictícios (`codigoInterno` começando em
 * `ZZ-`) e tudo o que eles deixaram, **inclusive os eventos do `EventoLog`**
 * — a exceção à RNF05 explicada em `ficticios.ts`.
 *
 *     npm run ficticios:remover                  (só mostra o que apagaria)
 *     npm run ficticios:remover -- --confirmar   (apaga)
 *
 * O padrão é não apagar nada: o mesmo comando roda contra o banco local e o de
 * produção, e o que separa um do outro é só a `DATABASE_URL` do momento.
 */
import 'dotenv/config'
import { prisma } from '../prisma.js'
import { destinoDoBanco, removerFicticios } from './ficticios.js'

const confirmar = process.argv.slice(2).includes('--confirmar')

try {
  console.log(`banco: ${destinoDoBanco()}\n`)

  const levantamento = await removerFicticios(confirmar)

  if (levantamento.produtos.length === 0) {
    console.log('nenhum produto fictício neste banco')
  } else {
    for (const produto of levantamento.produtos) console.log(`  ${produto.codigoInterno}  ${produto.nome}`)
    console.log(
      `\n${levantamento.produtos.length} produto(s), ${levantamento.unidades} unidade(s), ` +
        `${levantamento.saidas} saída(s), ${levantamento.descartes} descarte(s), ` +
        `${levantamento.alertas} alerta(s), ${levantamento.eventos} evento(s) no EventoLog`,
    )
    console.log(confirmar ? '\nremovidos.' : '\nnada foi apagado. Para apagar: npm run ficticios:remover -- --confirmar')
  }
} catch (erro) {
  console.error('falha ao remover os produtos fictícios — nada foi apagado:', erro)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
