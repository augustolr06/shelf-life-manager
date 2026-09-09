import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { varrerEstoqueParaAlertas } from './varreduraAlertas.js'

/**
 * O relógio da RF08 visto de fora do processo (T23, fatia 2).
 *
 * T18 decidiu que a varredura seria disparada por um `setInterval` **dentro**
 * do backend, para que um requisito funcional não dependesse de configuração
 * no servidor da loja. A decisão continua valendo — e depende de uma premissa
 * que T23 tornou explícita: existir um processo de longa duração. Numa
 * hospedagem serverless não existe, e o `setInterval` nunca dispara.
 *
 * Esta rota é a segunda porta para a **mesma** função, exatamente como o CLI
 * de T18 já era. Nenhuma lógica de varredura mora aqui: quem decide o que é
 * alerta continua sendo `varrerEstoqueParaAlertas`, num lugar só.
 *
 * ## Por que ela não é perigosa
 *
 * É uma rota que dispara escrita em massa, que foi precisamente o argumento de
 * T18 contra ter uma. Três coisas a tornam aceitável:
 *
 * 1. **Não é autenticada por sessão, e sim por segredo compartilhado.** Nenhum
 *    papel do sistema a alcança; nem o GESTOR. Quem a chama é o agendador da
 *    plataforma, com um segredo que só existe nas variáveis de ambiente.
 * 2. **A varredura é idempotente** (índice único de `Alerta`, T18). A segunda
 *    chamada do mesmo dia não emite nada. Chamá-la em excesso desperdiça
 *    consulta, não corrompe dado.
 * 3. **Sem `CRON_SECRET` configurado ela não existe na prática**: responde 503,
 *    como as rotas de push fazem sem as chaves VAPID (T19b). Uma instalação
 *    que não usa cron externo não ganha uma porta aberta por engano.
 */

/** Nome do cabeçalho e do esquema que os agendadores de plataforma usam. */
const PREFIXO_BEARER = 'Bearer '

/**
 * Comparação em tempo constante. Compara os **digests**, e não os textos, para
 * que segredos de tamanhos diferentes não estourem o `timingSafeEqual` (que
 * exige buffers do mesmo tamanho) nem revelem o tamanho do segredo certo pelo
 * modo de falhar.
 */
function segredoConfere(recebido: string, esperado: string): boolean {
  const digest = (valor: string) => createHash('sha256').update(valor).digest()
  return timingSafeEqual(digest(recebido), digest(esperado))
}

export async function rotasVarreduraAlertas(app: FastifyInstance): Promise<void> {
  app.get('/interno/varredura-alertas', async (request, reply) => {
    // Lido a cada requisição, e não uma vez no import, pelo mesmo motivo das
    // chaves VAPID (`modules/push/vapid.ts`): é configuração de instalação,
    // opcional, e o servidor precisa subir inteiro sem ela.
    const segredo = process.env.CRON_SECRET

    if (!segredo) {
      return reply.code(503).send({
        erro: 'CRON_NAO_CONFIGURADO',
        mensagem: 'A varredura por agendador externo não está configurada neste servidor.',
      })
    }

    const cabecalho = request.headers.authorization ?? ''
    const recebido = cabecalho.startsWith(PREFIXO_BEARER)
      ? cabecalho.slice(PREFIXO_BEARER.length)
      : ''

    if (!recebido || !segredoConfere(recebido, segredo)) {
      // Sem detalhe do que faltou: quem chama é máquina, e a mensagem só
      // serviria para quem está tentando adivinhar.
      return reply.code(401).send({
        erro: 'NAO_AUTORIZADO',
        mensagem: 'Credencial de agendador inválida.',
      })
    }

    const resumo = await varrerEstoqueParaAlertas()
    request.log.info({ motivo: 'agendador externo', ...resumo }, 'varredura de alertas concluída')

    return resumo
  })
}
