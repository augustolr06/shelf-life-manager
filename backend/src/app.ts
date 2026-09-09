import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import Fastify, { type FastifyInstance } from 'fastify'
import { NOME_COOKIE_SESSAO } from './modules/auth/cookie.js'
import { rotasAlerta } from './modules/alerta/alerta.routes.js'
import { rotasConfiguracaoAlerta } from './modules/alerta/configuracaoAlerta.routes.js'
import { rotasAuth } from './modules/auth/auth.routes.js'
import { rotasDescarte } from './modules/descarte/descarte.routes.js'
import { rotasExcecaoVencido } from './modules/excecao-vencido/excecaoVencido.routes.js'
import { rotasProduto } from './modules/produto/produto.routes.js'
import { rotasSaida } from './modules/saida/saida.routes.js'
import { rotasUnidade } from './modules/unidade/unidade.routes.js'
import { env } from './shared/env.js'
import { tratarErro, tratarRotaNaoEncontrada } from './shared/errosDaApi.js'

/**
 * Monta a instância do Fastify sem subir o servidor, para que os testes
 * possam usar `app.inject()` sem abrir porta.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true })

  // O cookie de sessão vem de outra origem (frontend em 5173, backend em
  // 3333), então o navegador só o envia se o CORS permitir credenciais.
  //
  // `methods` é obrigatório: o padrão do @fastify/cors é apenas os métodos
  // safelisted do CORS (GET, HEAD, POST), e sem esta lista o preflight de
  // PATCH e DELETE é recusado pelo navegador — falha que não aparece em
  // chamada de `curl`, que não faz preflight.
  app.register(cors, {
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  })

  // Ordem importa: o @fastify/jwt lê o token do cookie, então o parser de
  // cookie precisa estar registrado antes.
  app.register(cookie)
  app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: NOME_COOKIE_SESSAO, signed: false },
  })

  // Toda falha que o próprio Fastify gera (schema, corpo malformado, exceção
  // não tratada, rota inexistente) sai no formato `{ erro, mensagem }` que as
  // rotas já usam nas recusas escritas à mão. Registrado aqui, e não em
  // `server.ts`, para valer também nos testes com `app.inject()`.
  app.setErrorHandler(tratarErro)
  app.setNotFoundHandler(tratarRotaNaoEncontrada)

  app.register(rotasAuth)
  app.register(rotasProduto)
  app.register(rotasUnidade)
  app.register(rotasSaida)
  app.register(rotasExcecaoVencido)
  app.register(rotasDescarte)
  app.register(rotasConfiguracaoAlerta)
  app.register(rotasAlerta)

  // Liveness. O frontend consulta este endpoint antes de habilitar a tela de
  // leitura de QR (docs/arquitetura.md seção 6).
  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
  }))

  return app
}
