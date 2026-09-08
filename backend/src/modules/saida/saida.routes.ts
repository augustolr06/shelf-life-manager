import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import { lerCodigoQr } from './saida.service.js'

/**
 * Comprimento máximo do texto aceito como código. Generoso em relação aos 10
 * caracteres do formato atual (`PRF-XXXXXX`), porque o formato é provisório
 * até a RNF08 (T16) — mas limitado, porque o campo é livre e vai direto para
 * uma consulta e para o `EventoLog`.
 */
const MAXIMO_CODIGO = 64

const corpoLeitura = {
  type: 'object',
  required: ['codigoQr'],
  // O usuário vem da sessão, nunca do corpo: toda leitura é atribuível a quem
  // a fez (RF01, RF12).
  additionalProperties: false,
  properties: {
    codigoQr: { type: 'string', minLength: 1, maxLength: MAXIMO_CODIGO },
  },
} as const

export async function rotasSaida(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { codigoQr: string } }>(
    '/saidas/ler',
    {
      // Ler QR no balcão é atribuição das duas funções (docs/arquitetura.md
      // seção 5). A lista é explícita mesmo cobrindo todos os papéis de hoje:
      // um papel novo no enum não deve ganhar acesso ao fluxo de saída por
      // omissão.
      preHandler: [autenticar, exigirPapel(Papel.ATENDENTE, Papel.GESTOR)],
      schema: { body: corpoLeitura },
    },
    async (request, reply) => {
      const resposta = await lerCodigoQr(request.body.codigoQr, request.usuario.id)

      // 200 para todo veredito, inclusive bloqueio e código desconhecido: a
      // leitura foi processada e registrada, e o veredito é o resultado dela,
      // não uma falha de protocolo. Codificar o veredito no status faria a
      // tela decidir pelo status em vez de pelo veredito — a porta que a RNF04
      // fecha (docs/decisoes.md, 2026-09-08).
      return reply.code(200).send(resposta)
    },
  )
}
