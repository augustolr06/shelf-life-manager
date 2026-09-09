/**
 * Uma varredura avulsa, pela linha de comando: `npm run alertas:varrer`.
 *
 * O caminho normal é o agendador dentro do servidor (`agendador.ts`). Este
 * script existe para duas coisas: demonstrar o job sem esperar o intervalo, e
 * dar a saída de emergência a quem preferir agendar por fora (cron, systemd)
 * — a função varrida é exatamente a mesma, então as duas formas não podem
 * divergir.
 *
 * Termina com código 1 se a varredura falhar, para que um agendador externo
 * perceba.
 */
import 'dotenv/config'
import { prisma } from '../../db/prisma.js'
import { varrerEstoqueParaAlertas } from './varreduraAlertas.js'

try {
  const resumo = await varrerEstoqueParaAlertas()
  console.log(
    `varredura concluída: ${resumo.configuracoesAvaliadas} janela(s) ativa(s), ` +
      `${resumo.unidadesNaJanela} unidade(s) na janela, ` +
      `${resumo.alertasEmitidos} alerta(s) emitido(s)`,
  )
} catch (erro) {
  console.error('varredura de alertas falhou:', erro)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
