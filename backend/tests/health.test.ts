import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/buildApp.js'

describe('GET /health', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('responde 200', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/health' })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toMatchObject({ status: 'ok' })
  })
})
