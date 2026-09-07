import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import Fastify, { type FastifyInstance } from 'fastify'
import { NOME_COOKIE_SESSAO } from './modules/auth/cookie.js'
import { rotasAuth } from './modules/auth/auth.routes.js'
import { env } from './shared/env.js'

/**
 * Monta a instância do Fastify sem subir o servidor, para que os testes
 * possam usar `app.inject()` sem abrir porta.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true })

  // O cookie de sessão vem de outra origem (frontend em 5173, backend em
  // 3333), então o navegador só o envia se o CORS permitir credenciais.
  app.register(cors, { origin: env.FRONTEND_ORIGIN, credentials: true })

  // Ordem importa: o @fastify/jwt lê o token do cookie, então o parser de
  // cookie precisa estar registrado antes.
  app.register(cookie)
  app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: NOME_COOKIE_SESSAO, signed: false },
  })

  app.register(rotasAuth)

  // Liveness. O frontend consulta este endpoint antes de habilitar a tela de
  // leitura de QR (docs/arquitetura.md seção 6).
  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
  }))

  return app
}
