import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/buildApp.js'
import {
  MENSAGEM_CORPO_INVALIDO,
  MENSAGEM_ERRO_INTERNO,
} from '../src/shared/errosDaApi.js'

/**
 * T12b. Antes do `setErrorHandler`, uma violação de schema saía no formato do
 * Fastify e a tela do balcão exibia o texto interno do framework, em inglês:
 * `body/justificativa must NOT have fewer than 10 characters` (achado de T12).
 *
 * Nenhum destes testes toca o banco: a validação de schema roda **antes** do
 * `preHandler`, então a recusa acontece sem autenticar nem consultar nada.
 */

/** Segredo da mensagem que nunca deve chegar ao cliente, no teste do 500. */
const SEGREDO_DA_EXCECAO = 'Unique constraint failed on the fields: (`codigoQr`)'

describe('formato uniforme de erro da API', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = buildApp()

    // Rota só deste teste, registrada na instância real para exercitar o
    // mesmo handler que as rotas de produção usam. Simula o que hoje já
    // acontece quando o Prisma estoura fora dos casos tratados a mão
    // (`produto.service.ts` relança o erro original).
    app.get('/apenas-teste/explode', async () => {
      throw new Error(SEGREDO_DA_EXCECAO)
    })

    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('violação de schema', () => {
    it('recusa com 400 e CORPO_INVALIDO, nomeando o campo', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: '/excecao-vencido/override',
        payload: {
          unidadeId: '33333333-3333-3333-3333-333333333333',
          // Abaixo do mínimo de 10 caracteres: o caso exato reproduzido em T12.
          justificativa: 'ok',
        },
      })

      expect(resposta.statusCode).toBe(400)
      expect(resposta.json()).toEqual({
        erro: 'CORPO_INVALIDO',
        mensagem: MENSAGEM_CORPO_INVALIDO,
        campos: ['justificativa'],
      })
    })

    it('nomeia o campo obrigatório que faltou', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: '/excecao-vencido/corrigir',
        payload: { unidadeId: '33333333-3333-3333-3333-333333333333' },
      })

      expect(resposta.statusCode).toBe(400)
      expect(resposta.json().campos).toEqual(['dataValidade'])
    })

    it('não recusa propriedade desconhecida: o Fastify a remove antes de validar', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: '/excecao-vencido/corrigir',
        payload: {
          unidadeId: '33333333-3333-3333-3333-333333333333',
          dataValidade: '2027-01-01',
          apelido: 'frasco da vitrine',
        },
      })

      // Não é 400: o `removeAdditional` do ajv (padrão do Fastify) apaga
      // `apelido` do corpo e o schema passa. A requisição segue para o
      // `preHandler` e para na autenticação. Registrado como teste porque
      // explica por que `campos` nunca cita campo desconhecido — e porque
      // `additionalProperties: false`, neste projeto, filtra em vez de recusar.
      expect(resposta.statusCode).toBe(401)
    })

    it('lista só a primeira falha, porque o ajv do Fastify para na primeira', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: '/excecao-vencido/override',
        // Dois campos errados de uma vez: id fora do formato UUID e
        // justificativa curta demais.
        payload: { unidadeId: 'nao-e-uuid', justificativa: 'ok' },
      })

      expect(resposta.statusCode).toBe(400)
      // Documenta o comportamento, não o endossa: `campos` é uma pista de
      // diagnóstico, não a lista completa do que está errado no formulário.
      expect(resposta.json().campos).toEqual(['unidadeId'])
    })

    it('recusa data inexistente no calendário sem vazar a regra do ajv (RNF01)', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: '/excecao-vencido/corrigir',
        payload: {
          unidadeId: '33333333-3333-3333-3333-333333333333',
          dataValidade: '2027-02-30',
        },
      })

      expect(resposta.statusCode).toBe(400)
      expect(resposta.json()).toMatchObject({
        erro: 'CORPO_INVALIDO',
        campos: ['dataValidade'],
      })
    })

    it('não devolve nada do texto interno do Fastify', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: '/saidas/ler',
        // Corpo vazio: `codigoQr` é obrigatório. Um tipo errado não serviria
        // aqui — o `coerceTypes` do Fastify converteria `42` em `'42'` e a
        // requisição passaria.
        payload: {},
      })

      expect(resposta.statusCode).toBe(400)

      expect(resposta.body).not.toContain('must NOT')
      expect(resposta.body).not.toContain('must be')
      expect(resposta.body).not.toContain('Bad Request')
      expect(resposta.body).not.toContain('FST_ERR_VALIDATION')
    })
  })

  describe('erro não tratado', () => {
    it('responde 500 no formato do projeto sem repassar a mensagem da exceção', async () => {
      const resposta = await app.inject({ method: 'GET', url: '/apenas-teste/explode' })

      expect(resposta.statusCode).toBe(500)
      expect(resposta.json()).toEqual({
        erro: 'ERRO_INTERNO',
        mensagem: MENSAGEM_ERRO_INTERNO,
      })
      // O detalhe do banco (tabela, coluna, valor que colidiu) fica só no log
      // do servidor — RNF09.
      expect(resposta.body).not.toContain('codigoQr')
      expect(resposta.body).not.toContain('constraint')
    })
  })

  describe('rota inexistente', () => {
    it('responde 404 no mesmo formato das demais falhas', async () => {
      const resposta = await app.inject({ method: 'GET', url: '/rota-que-nao-existe' })

      expect(resposta.statusCode).toBe(404)
      expect(resposta.json()).toEqual({
        erro: 'ROTA_NAO_ENCONTRADA',
        mensagem: expect.any(String),
      })
      expect(resposta.body).not.toContain('Not Found')
    })
  })
})
