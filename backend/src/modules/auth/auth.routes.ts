import type { FastifyInstance } from 'fastify'
import { autenticar } from './auth.middleware.js'
import { autenticarCredenciais } from './auth.service.js'
import { DURACAO_SESSAO_SEGUNDOS, NOME_COOKIE_SESSAO, opcoesCookieSessao } from './cookie.js'
import type { PayloadToken } from './tipos.js'

const corpoLogin = {
  type: 'object',
  required: ['email', 'senha'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
    senha: { type: 'string', minLength: 1 },
  },
} as const

type CorpoLogin = { email: string; senha: string }

export async function rotasAuth(app: FastifyInstance): Promise<void> {
  // RF01 — autenticação. Rota pública.
  app.post<{ Body: CorpoLogin }>(
    '/auth/login',
    { schema: { body: corpoLogin } },
    async (request, reply) => {
      const { email, senha } = request.body
      const usuario = await autenticarCredenciais(email, senha)

      if (!usuario) {
        // Mensagem única para e-mail inexistente e senha errada: não informar
        // qual dos dois falhou.
        return reply.code(401).send({
          erro: 'CREDENCIAL_INVALIDA',
          mensagem: 'E-mail ou senha incorretos.',
        })
      }

      const payload: PayloadToken = {
        sub: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        papel: usuario.papel,
      }
      const token = app.jwt.sign(payload, { expiresIn: DURACAO_SESSAO_SEGUNDOS })

      return reply
        .setCookie(NOME_COOKIE_SESSAO, token, opcoesCookieSessao)
        .send({ usuario })
    },
  )

  // Encerrar sessão. Sem estado no servidor (JWT), então basta apagar o cookie.
  // As mesmas opções do cookie de sessão: o navegador só substitui um cookie
  // por outro de nome, path e domínio idênticos. (`clearCookie` sobrescreve
  // `maxAge`/`expires` por conta própria.)
  app.post('/auth/logout', async (_request, reply) =>
    reply.clearCookie(NOME_COOKIE_SESSAO, opcoesCookieSessao).code(204).send(),
  )

  // Rota protegida de referência: devolve quem está logado. O frontend a usa
  // para restaurar a sessão ao abrir o app.
  app.get('/auth/me', { preHandler: autenticar }, async (request) => ({
    usuario: request.usuario,
  }))
}
