import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A varredura de verdade é de T18 e tem suíte própria contra PostgreSQL. Aqui
// o que se prova é a porta: quem entra, quem não entra, e que a função chamada
// é a mesma — não o que ela faz.
vi.mock('../src/modules/alerta/varreduraAlertas.js', () => ({
  varrerEstoqueParaAlertas: vi.fn(),
}))

import { varrerEstoqueParaAlertas } from '../src/modules/alerta/varreduraAlertas.js'
import { buildApp } from '../src/app.js'

const varrer = vi.mocked(varrerEstoqueParaAlertas)

const SEGREDO = 'segredo-de-agendador-bem-comprido'

const RESUMO = {
  configuracoesAvaliadas: 1,
  unidadesNaJanela: 4,
  alertasEmitidos: 2,
  emitidos: [],
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  varrer.mockResolvedValue(RESUMO as never)
  app = buildApp()
  await app.ready()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await app.close()
})

function chamar(autorizacao?: string) {
  return app.inject({
    method: 'GET',
    url: '/interno/varredura-alertas',
    headers: autorizacao === undefined ? {} : { authorization: autorizacao },
  })
}

describe('GET /interno/varredura-alertas', () => {
  describe('sem CRON_SECRET configurado', () => {
    beforeEach(() => {
      vi.stubEnv('CRON_SECRET', '')
    })

    // Mesma postura das rotas de push sem chaves VAPID (T19b): a instalação
    // que não usa agendador externo não ganha uma porta aberta por engano.
    it('responde 503 e não varre nada', async () => {
      const resposta = await chamar(`Bearer ${SEGREDO}`)

      expect(resposta.statusCode).toBe(503)
      expect(resposta.json()).toMatchObject({ erro: 'CRON_NAO_CONFIGURADO' })
      expect(varrer).not.toHaveBeenCalled()
    })
  })

  describe('com CRON_SECRET configurado', () => {
    beforeEach(() => {
      vi.stubEnv('CRON_SECRET', SEGREDO)
    })

    it('varre e devolve o resumo quando o segredo confere', async () => {
      const resposta = await chamar(`Bearer ${SEGREDO}`)

      expect(resposta.statusCode).toBe(200)
      expect(resposta.json()).toMatchObject({ alertasEmitidos: 2, unidadesNaJanela: 4 })
      expect(varrer).toHaveBeenCalledOnce()
    })

    it.each([
      ['sem cabeçalho', undefined],
      ['cabeçalho vazio', ''],
      ['segredo errado do mesmo tamanho', `Bearer ${'x'.repeat(SEGREDO.length)}`],
      ['segredo errado de outro tamanho', 'Bearer curto'],
      ['segredo certo sem o esquema Bearer', SEGREDO],
      ['esquema trocado', `Basic ${SEGREDO}`],
    ])('recusa com 401: %s', async (_caso, autorizacao) => {
      const resposta = await chamar(autorizacao)

      expect(resposta.statusCode).toBe(401)
      expect(varrer).not.toHaveBeenCalled()
    })

    // A rota não é alcançável por quem usa o sistema: não há papel que a abra,
    // e o cookie de sessão não é credencial aqui.
    it('não aceita sessão de usuário no lugar do segredo', async () => {
      const resposta = await app.inject({
        method: 'GET',
        url: '/interno/varredura-alertas',
        cookies: { sessao: 'qualquer-token' },
      })

      expect(resposta.statusCode).toBe(401)
      expect(varrer).not.toHaveBeenCalled()
    })
  })
})
