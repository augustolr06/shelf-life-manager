import bcrypt from 'bcryptjs'
import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// O acesso ao banco é substituído: T03 valida credencial e papel, não a
// persistência. Assim a suíte roda sem PostgreSQL de pé.
vi.mock('../src/db/prisma.js', () => ({
  prisma: { usuario: { findUnique: vi.fn() } },
}))

import { prisma } from '../src/db/prisma.js'
import { buildApp } from '../src/buildApp.js'
import { autenticar, exigirPapel } from '../src/modules/auth/auth.middleware.js'
import { NOME_COOKIE_SESSAO } from '../src/modules/auth/cookie.js'

const SENHA = 'estoque123'
const SENHA_HASH = bcrypt.hashSync(SENHA, 10)

type UsuarioDeTeste = {
  id: string
  nome: string
  email: string
  senhaHash: string
  papel: Papel
}

const GESTOR: UsuarioDeTeste = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Gestora de Loja',
  email: 'gestor@estoque.local',
  senhaHash: SENHA_HASH,
  papel: Papel.GESTOR,
  ativo: true,
}

const ATENDENTE: UsuarioDeTeste = {
  id: '22222222-2222-2222-2222-222222222222',
  nome: 'Atendente de Balcão',
  email: 'atendente@estoque.local',
  senhaHash: SENHA_HASH,
  papel: Papel.ATENDENTE,
  ativo: true,
}

const buscarUsuario = vi.mocked(prisma.usuario.findUnique)

/** Faz login e devolve o cookie de sessão pronto para as próximas requisições. */
async function logar(app: FastifyInstance, usuario: UsuarioDeTeste): Promise<string> {
  buscarUsuario.mockResolvedValueOnce(usuario)

  const resposta = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: usuario.email, senha: SENHA },
  })

  const cookie = resposta.cookies.find((c) => c.name === NOME_COOKIE_SESSAO)
  if (!cookie) throw new Error('login não devolveu cookie de sessão')
  return cookie.value
}

describe('módulo de autenticação (RF01)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = buildApp()

    // Rota de exercício do middleware de papel. Vive só no teste: as rotas
    // reais restritas a GESTOR chegam a partir de T04.
    app.get(
      '/apenas-gestor',
      { preHandler: [autenticar, exigirPapel(Papel.GESTOR)] },
      async () => ({ ok: true }),
    )

    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    buscarUsuario.mockReset()
  })

  describe('POST /auth/login', () => {
    it('autentica credencial válida e devolve o cookie httpOnly', async () => {
      buscarUsuario.mockResolvedValueOnce(GESTOR)

      const resposta = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: GESTOR.email, senha: SENHA },
      })

      expect(resposta.statusCode).toBe(200)
      expect(resposta.json()).toEqual({
        usuario: {
          id: GESTOR.id,
          nome: GESTOR.nome,
          email: GESTOR.email,
          papel: Papel.GESTOR,
        },
      })

      const cookie = resposta.cookies.find((c) => c.name === NOME_COOKIE_SESSAO)
      expect(cookie).toBeDefined()
      expect(cookie?.httpOnly).toBe(true)
      // O hash da senha nunca sai do servidor.
      expect(resposta.body).not.toContain(SENHA_HASH)
    })

    it('rejeita senha incorreta sem emitir cookie', async () => {
      buscarUsuario.mockResolvedValueOnce(GESTOR)

      const resposta = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: GESTOR.email, senha: 'senha-errada' },
      })

      expect(resposta.statusCode).toBe(401)
      expect(resposta.json()).toMatchObject({ erro: 'CREDENCIAL_INVALIDA' })
      expect(resposta.cookies).toHaveLength(0)
    })

    it('responde igual para e-mail inexistente, sem revelar qual campo falhou', async () => {
      buscarUsuario.mockResolvedValueOnce(null)

      const resposta = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'ninguem@estoque.local', senha: SENHA },
      })

      expect(resposta.statusCode).toBe(401)
      expect(resposta.json()).toMatchObject({ erro: 'CREDENCIAL_INVALIDA' })
    })

    it('recusa corpo malformado antes de consultar o banco', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'nao-e-email', senha: SENHA },
      })

      expect(resposta.statusCode).toBe(400)
      expect(buscarUsuario).not.toHaveBeenCalled()
    })
  })

  describe('GET /auth/me', () => {
    it('devolve o usuário autenticado a partir do cookie', async () => {
      const sessao = await logar(app, ATENDENTE)

      const resposta = await app.inject({
        method: 'GET',
        url: '/auth/me',
        cookies: { [NOME_COOKIE_SESSAO]: sessao },
      })

      expect(resposta.statusCode).toBe(200)
      expect(resposta.json()).toEqual({
        usuario: {
          id: ATENDENTE.id,
          nome: ATENDENTE.nome,
          email: ATENDENTE.email,
          papel: Papel.ATENDENTE,
        },
      })
    })

    it('recusa requisição sem cookie de sessão', async () => {
      const resposta = await app.inject({ method: 'GET', url: '/auth/me' })

      expect(resposta.statusCode).toBe(401)
      expect(resposta.json()).toMatchObject({ erro: 'NAO_AUTENTICADO' })
    })

    it('recusa token assinado com outro segredo', async () => {
      const resposta = await app.inject({
        method: 'GET',
        url: '/auth/me',
        cookies: { [NOME_COOKIE_SESSAO]: 'token.forjado.invalido' },
      })

      expect(resposta.statusCode).toBe(401)
    })
  })

  describe('autorização por papel', () => {
    it('permite o papel exigido', async () => {
      const sessao = await logar(app, GESTOR)

      const resposta = await app.inject({
        method: 'GET',
        url: '/apenas-gestor',
        cookies: { [NOME_COOKIE_SESSAO]: sessao },
      })

      expect(resposta.statusCode).toBe(200)
    })

    it('bloqueia com 403 quem está autenticado mas não tem o papel', async () => {
      const sessao = await logar(app, ATENDENTE)

      const resposta = await app.inject({
        method: 'GET',
        url: '/apenas-gestor',
        cookies: { [NOME_COOKIE_SESSAO]: sessao },
      })

      expect(resposta.statusCode).toBe(403)
      expect(resposta.json()).toMatchObject({ erro: 'PAPEL_INSUFICIENTE' })
    })

    it('responde 401, não 403, quando nem sequer há sessão', async () => {
      const resposta = await app.inject({ method: 'GET', url: '/apenas-gestor' })

      expect(resposta.statusCode).toBe(401)
    })
  })

  describe('POST /auth/logout', () => {
    it('expira o cookie de sessão', async () => {
      const resposta = await app.inject({ method: 'POST', url: '/auth/logout' })

      expect(resposta.statusCode).toBe(204)
      const cookie = resposta.cookies.find((c) => c.name === NOME_COOKIE_SESSAO)
      expect(cookie?.value).toBe('')
    })
  })
})
