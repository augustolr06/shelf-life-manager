import bcrypt from 'bcryptjs'
import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Sem banco: o que se prova aqui é comportamento de borda (quantas tentativas
// passam, quais cabeçalhos saem), não persistência.
vi.mock('../src/db/prisma.js', () => ({
  prisma: { usuario: { findUnique: vi.fn() } },
}))

import { prisma } from '../src/db/prisma.js'
import { buildApp } from '../src/buildApp.js'

const buscarUsuario = vi.mocked(prisma.usuario.findUnique)

const SENHA = 'perfumaria-2026-balcao'

const GESTOR = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Gestora de Loja',
  email: 'gestor@estoque.local',
  senhaHash: bcrypt.hashSync(SENHA, 10),
  papel: Papel.GESTOR,
  ativo: true,
}

/** O limite declarado em `auth.routes.ts`. */
const MAXIMO_POR_MINUTO = 10

let app: FastifyInstance

// App novo a cada teste: o contador do limite vive na memória da instância, e
// um app compartilhado faria um teste herdar as tentativas do anterior.
beforeEach(async () => {
  vi.clearAllMocks()
  app = buildApp()
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function tentarLogin(senha = 'senha-errada-mas-longa') {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'gestor@estoque.local', senha },
  })
}

describe('limite de tentativas de login', () => {
  it(`permite ${MAXIMO_POR_MINUTO} tentativas na janela`, async () => {
    buscarUsuario.mockResolvedValue(null)

    for (let i = 0; i < MAXIMO_POR_MINUTO; i += 1) {
      expect((await tentarLogin()).statusCode).toBe(401)
    }
  })

  it('recusa a tentativa seguinte com 429', async () => {
    buscarUsuario.mockResolvedValue(null)

    for (let i = 0; i < MAXIMO_POR_MINUTO; i += 1) await tentarLogin()

    expect((await tentarLogin()).statusCode).toBe(429)
  })

  // T12b: toda recusa da API sai como `{ erro, mensagem }`. O formato próprio
  // do plugin passaria pelo `ErroApi` do frontend como mensagem genérica.
  it('recusa no formato de erro da API, não no do plugin', async () => {
    buscarUsuario.mockResolvedValue(null)

    for (let i = 0; i < MAXIMO_POR_MINUTO; i += 1) await tentarLogin()
    const bloqueada = await tentarLogin()

    expect(bloqueada.json()).toEqual({
      erro: 'MUITAS_TENTATIVAS',
      mensagem: expect.stringContaining('Muitas tentativas'),
    })
  })

  it('conta também as tentativas bem-sucedidas', async () => {
    buscarUsuario.mockResolvedValue(GESTOR)

    for (let i = 0; i < MAXIMO_POR_MINUTO; i += 1) {
      expect((await tentarLogin(SENHA)).statusCode).toBe(200)
    }

    expect((await tentarLogin(SENHA)).statusCode).toBe(429)
  })

  // O ponto mais importante do arquivo: o limite é da rota de login, não da
  // API. O balcão lê QR em rajada, e um limite global trocaria proteção de
  // senha por venda travada.
  it('não limita as rotas que o balcão usa em rajada', async () => {
    const rajada = await Promise.all(
      Array.from({ length: MAXIMO_POR_MINUTO * 3 }, () =>
        app.inject({ method: 'POST', url: '/saidas/ler', payload: { codigoQr: 'PRF-ABC123' } }),
      ),
    )

    // 401 porque não há sessão — o que importa é que nenhuma vire 429.
    expect(rajada.map((r) => r.statusCode)).not.toContain(429)
  })

  it('não limita o health check, que o frontend consulta em laço', async () => {
    const rajada = await Promise.all(
      Array.from({ length: MAXIMO_POR_MINUTO * 3 }, () =>
        app.inject({ method: 'GET', url: '/health' }),
      ),
    )

    expect(rajada.every((r) => r.statusCode === 200)).toBe(true)
  })
})

describe('cabeçalhos de segurança', () => {
  it('impede o navegador de adivinhar o tipo do conteúdo', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/health' })

    expect(resposta.headers['x-content-type-options']).toBe('nosniff')
  })

  it('não emite CSP: esta API responde JSON, nunca documento', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/health' })

    expect(resposta.headers['content-security-policy']).toBeUndefined()
  })

  // O padrão do helmet (`same-origin`) recusaria no navegador exatamente o
  // acesso que esta API existe para servir — mesma classe de falha silenciosa
  // do cookie `SameSite`.
  it('não restringe o consumo cross-origin, que é o caso de uso', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/health' })

    expect(resposta.headers['cross-origin-resource-policy']).toBeUndefined()
  })
})
