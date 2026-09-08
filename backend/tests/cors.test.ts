import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

/**
 * Regressão descoberta na conferência de T04 no navegador: o padrão do
 * `@fastify/cors` libera apenas os métodos safelisted do CORS (GET, HEAD,
 * POST), então o preflight de `PATCH` e `DELETE` era recusado e a tela de
 * produtos não conseguia inativar nem reativar nada. Chamada de `curl` não
 * revela isso, porque não faz preflight.
 */
describe('CORS — preflight das rotas de escrita', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  for (const metodo of ['GET', 'POST', 'PATCH', 'DELETE']) {
    it(`permite ${metodo} vindo do frontend`, async () => {
      const resposta = await app.inject({
        method: 'OPTIONS',
        url: '/produtos/33333333-3333-3333-3333-333333333333',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': metodo,
        },
      })

      expect(resposta.headers['access-control-allow-methods']).toContain(metodo)
      expect(resposta.headers['access-control-allow-credentials']).toBe('true')
    })
  }
})
