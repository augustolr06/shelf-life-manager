/**
 * A inscrição de aparelhos na notificação push (RF08, T19b).
 *
 * Roda contra PostgreSQL de verdade, como as demais suítes de pasta: o que se
 * verifica aqui é que reinscrever o mesmo aparelho **atualiza** em vez de
 * duplicar — garantia do índice único de `endpoint`, que um duplo de teste só
 * saberia repetir de volta.
 *
 * As chaves VAPID são ligadas e desligadas por `process.env` dentro da própria
 * suíte: `vapid.ts` as resolve a cada chamada justamente para que os dois
 * estados (configurado e não configurado) sejam exercitáveis no mesmo processo.
 *
 * Contrato: tasks/T19b-notificacao-push.md · docs/arquitetura.md seção 5.
 */

import { Papel, type PrismaClient, type Usuario } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/db/prisma.js', async () => {
  const { clienteCompartilhadoDeTeste } = await import('../apoio/bancoDeTeste.js')
  return { prisma: clienteCompartilhadoDeTeste() }
})

import { buildApp } from '../../src/buildApp.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { cookieDeSessao, criarUsuario } from '../apoio/cenario.js'

const ROTA = '/push/inscricoes'

/** Chaves inventadas: nenhuma rota desta suíte assina nada de verdade. */
const CHAVE_PUBLICA = 'chave-publica-de-teste'

let prisma: PrismaClient
let app: FastifyInstance
let atendente: Usuario
let gestor: Usuario

function ligarPush(): void {
  process.env.VAPID_PUBLIC_KEY = CHAVE_PUBLICA
  process.env.VAPID_PRIVATE_KEY = 'chave-privada-de-teste'
}

function desligarPush(): void {
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
}

beforeAll(async () => {
  await prepararBancoDeTeste()
  prisma = clienteCompartilhadoDeTeste()
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await limparBanco(prisma)
  atendente = await criarUsuario(prisma, Papel.ATENDENTE)
  gestor = await criarUsuario(prisma, Papel.GESTOR)
  ligarPush()
})

afterEach(() => {
  desligarPush()
})

const aparelho = {
  endpoint: 'https://push.exemplo.local/aparelho-da-gestora',
  chaves: { p256dh: 'p256dh-do-aparelho', auth: 'auth-do-aparelho' },
}

function inscrever(corpo: unknown = aparelho, usuario: Usuario = gestor) {
  return app.inject({
    method: 'POST',
    url: ROTA,
    cookies: cookieDeSessao(app, usuario),
    payload: corpo,
  })
}

function desinscrever(endpoint: string, usuario: Usuario = gestor) {
  return app.inject({
    method: 'DELETE',
    url: ROTA,
    cookies: cookieDeSessao(app, usuario),
    payload: { endpoint },
  })
}

describe('a chave pública', () => {
  it('é servida ao gestor para que o navegador possa se inscrever', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/push/chave-publica',
      cookies: cookieDeSessao(app, gestor),
    })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toEqual({ chavePublica: CHAVE_PUBLICA })
  })
})

describe('inscrever um aparelho', () => {
  it('grava a inscrição e devolve 201 sem as chaves do aparelho', async () => {
    const resposta = await inscrever()

    expect(resposta.statusCode).toBe(201)

    const { inscricao } = resposta.json()
    expect(inscricao).toHaveProperty('id')
    expect(inscricao).toHaveProperty('criadoEm')
    // O `endpoint` é credencial de envio: não volta em resposta de API.
    expect(JSON.stringify(resposta.json())).not.toContain(aparelho.endpoint)

    const gravadas = await prisma.inscricaoPush.findMany()
    expect(gravadas).toHaveLength(1)
    expect(gravadas[0]).toMatchObject({
      endpoint: aparelho.endpoint,
      p256dh: aparelho.chaves.p256dh,
      auth: aparelho.chaves.auth,
      usuarioId: gestor.id,
    })
  })

  it('reinscrever o mesmo aparelho atualiza as chaves e não duplica a linha', async () => {
    await inscrever()

    const renovado = {
      endpoint: aparelho.endpoint,
      chaves: { p256dh: 'p256dh-renovado', auth: 'auth-renovado' },
    }
    const resposta = await inscrever(renovado)

    // 200 e não 201: nada foi criado, o navegador só trocou as chaves.
    expect(resposta.statusCode).toBe(200)

    const gravadas = await prisma.inscricaoPush.findMany()
    expect(gravadas).toHaveLength(1)
    expect(gravadas[0]).toMatchObject({ p256dh: 'p256dh-renovado', auth: 'auth-renovado' })
  })

  it('dois aparelhos da mesma gestora são duas inscrições', async () => {
    await inscrever()
    await inscrever({ ...aparelho, endpoint: 'https://push.exemplo.local/computador-da-loja' })

    expect(await prisma.inscricaoPush.count()).toBe(2)
  })

  it('recusa corpo sem as chaves do aparelho', async () => {
    const resposta = await inscrever({ endpoint: aparelho.endpoint })

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('CORPO_INVALIDO')
    expect(await prisma.inscricaoPush.count()).toBe(0)
  })
})

describe('desinscrever um aparelho', () => {
  it('remove a inscrição', async () => {
    await inscrever()

    const resposta = await desinscrever(aparelho.endpoint)

    expect(resposta.statusCode).toBe(204)
    expect(await prisma.inscricaoPush.count()).toBe(0)
  })

  it('endpoint desconhecido também é 204: o estado desejado já vale', async () => {
    const resposta = await desinscrever('https://push.exemplo.local/aparelho-que-nao-existe')

    expect(resposta.statusCode).toBe(204)
  })
})

describe('quem pode se inscrever', () => {
  it('recusa a atendente nas três rotas', async () => {
    const cookies = cookieDeSessao(app, atendente)

    const respostas = await Promise.all([
      app.inject({ method: 'GET', url: '/push/chave-publica', cookies }),
      app.inject({ method: 'POST', url: ROTA, cookies, payload: aparelho }),
      app.inject({ method: 'DELETE', url: ROTA, cookies, payload: { endpoint: aparelho.endpoint } }),
    ])

    for (const resposta of respostas) expect(resposta.statusCode).toBe(403)
    expect(await prisma.inscricaoPush.count()).toBe(0)
  })

  it('recusa quem não tem sessão', async () => {
    const resposta = await app.inject({ method: 'POST', url: ROTA, payload: aparelho })

    expect(resposta.statusCode).toBe(401)
  })
})

describe('servidor sem chaves VAPID', () => {
  beforeEach(() => {
    desligarPush()
  })

  it('recusa as três rotas com 503 PUSH_NAO_CONFIGURADO', async () => {
    const cookies = cookieDeSessao(app, gestor)

    const respostas = await Promise.all([
      app.inject({ method: 'GET', url: '/push/chave-publica', cookies }),
      app.inject({ method: 'POST', url: ROTA, cookies, payload: aparelho }),
      app.inject({ method: 'DELETE', url: ROTA, cookies, payload: { endpoint: aparelho.endpoint } }),
    ])

    for (const resposta of respostas) {
      expect(resposta.statusCode).toBe(503)
      expect(resposta.json().erro).toBe('PUSH_NAO_CONFIGURADO')
    }

    // Nada é gravado: uma inscrição aceita num servidor sem chaves nunca
    // receberia aviso nenhum.
    expect(await prisma.inscricaoPush.count()).toBe(0)
  })
})
