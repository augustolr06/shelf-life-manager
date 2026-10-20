/**
 * A consulta de uma unidade pelo QR, sem registrar saída (T32).
 *
 * Roda contra PostgreSQL de verdade, no padrão de T13 e T14: o que se prova é
 * o que a consulta encontra, como ela compara a validade com `hojeComoData()`
 * (RNF01) e — sobretudo — que ela **não escreve nada**. Uma linha a mais no
 * `EventoLog` falsearia o denominador da taxa de acerto da RF12, e isso um
 * duplo do Prisma não teria como mostrar.
 *
 * Contrato: tasks/T32-consulta-unidade-qr.md · docs/arquitetura.md seção 5.
 */

import {
  Papel,
  type PrismaClient,
  type Produto,
  StatusUnidade,
  type UnidadeProduto,
  type Usuario,
} from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/db/prisma.js', async () => {
  const { clienteCompartilhadoDeTeste } = await import('../apoio/bancoDeTeste.js')
  return { prisma: clienteCompartilhadoDeTeste() }
})

import { buildApp } from '../../src/buildApp.js'
import { textoDeData } from '../../src/shared/data.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { cookieDeSessao, criarProduto, criarUnidade, criarUsuario, emDias } from '../apoio/cenario.js'

let prisma: PrismaClient
let app: FastifyInstance
let atendente: Usuario
let gestor: Usuario
let perfume: Produto

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
  perfume = await criarProduto(prisma)
})

function novaUnidade(diasAteVencer: number, status?: StatusUnidade): Promise<UnidadeProduto> {
  return criarUnidade(prisma, {
    produtoId: perfume.id,
    registradoPorId: gestor.id,
    diasAteVencer,
    ...(status ? { status } : {}),
  })
}

function consultar(codigoQr: string, usuario: Usuario | null = atendente) {
  return app.inject({
    method: 'GET',
    url: `/unidades/consulta/${encodeURIComponent(codigoQr)}`,
    ...(usuario ? { cookies: cookieDeSessao(app, usuario) } : {}),
  })
}

describe('unidade encontrada', () => {
  it('devolve a unidade em estoque com produto, validade de calendário e dias para vencer', async () => {
    const unidade = await novaUnidade(49)

    const resposta = await consultar(unidade.codigoQr)

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toEqual({
      unidade: {
        id: unidade.id,
        codigoQr: unidade.codigoQr,
        dataValidade: textoDeData(emDias(49)),
        status: 'EM_ESTOQUE',
        dataEntrada: unidade.dataEntrada.toISOString(),
        produto: {
          id: perfume.id,
          codigoInterno: perfume.codigoInterno,
          nome: perfume.nome,
          marca: perfume.marca,
          categoria: perfume.categoria,
          ativo: true,
        },
      },
      situacao: 'NO_PRAZO',
      diasParaVencer: 49,
    })
  })

  it('a unidade que vence hoje ainda está no prazo, com zero dias', async () => {
    // A mesma borda do pool do FIFO: o que vence hoje ainda é vendável hoje.
    const unidade = await novaUnidade(0)

    const corpo = (await consultar(unidade.codigoQr)).json()

    expect(corpo.situacao).toBe('NO_PRAZO')
    expect(corpo.diasParaVencer).toBe(0)
  })

  it('a unidade vencida é VENCIDA, com dias negativos', async () => {
    const unidade = await novaUnidade(-3)

    const resposta = await consultar(unidade.codigoQr)

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().situacao).toBe('VENCIDA')
    expect(resposta.json().diasParaVencer).toBe(-3)
    expect(resposta.json().unidade.status).toBe('EM_ESTOQUE')
  })

  it('encontra a unidade vendida, com o status real', async () => {
    // Saber que o frasco já foi baixado é uma das perguntas que a consulta
    // responde: aqui ela não vira `UNIDADE_JA_BAIXADA`, como na leitura.
    const unidade = await novaUnidade(30, StatusUnidade.VENDIDA)

    const resposta = await consultar(unidade.codigoQr)

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().unidade.status).toBe('VENDIDA')
    expect(resposta.json().situacao).toBe('NO_PRAZO')
  })

  it('encontra a unidade descartada, com o status real', async () => {
    const unidade = await novaUnidade(-10, StatusUnidade.DESCARTADA)

    const resposta = await consultar(unidade.codigoQr)

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().unidade.status).toBe('DESCARTADA')
    expect(resposta.json().situacao).toBe('VENCIDA')
  })

  it('diz quando o produto da unidade está inativo', async () => {
    const unidade = await novaUnidade(30)
    await prisma.produto.update({ where: { id: perfume.id }, data: { ativo: false } })

    const corpo = (await consultar(unidade.codigoQr)).json()

    expect(corpo.unidade.produto.ativo).toBe(false)
  })

  it('normaliza o código digitado à mão, como a leitura de saída', async () => {
    const unidade = await novaUnidade(30)

    // Caixa baixa e espaços nas pontas; `codigoQr.ts` é o dono do formato.
    const resposta = await consultar(` ${unidade.codigoQr.toLowerCase()} `)

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().unidade.id).toBe(unidade.id)
  })

  it('atende o gestor também', async () => {
    const unidade = await novaUnidade(30)

    const resposta = await consultar(unidade.codigoQr, gestor)

    expect(resposta.statusCode).toBe(200)
  })
})

describe('recusas', () => {
  it('código inexistente é 404 QR_NAO_ENCONTRADO', async () => {
    const resposta = await consultar('PRF-ZZZZZZ')

    expect(resposta.statusCode).toBe(404)
    expect(resposta.json()).toEqual({
      erro: 'QR_NAO_ENCONTRADO',
      mensagem: expect.any(String),
    })
  })

  it('código acima do comprimento máximo é 400', async () => {
    const resposta = await consultar('X'.repeat(65))

    expect(resposta.statusCode).toBe(400)
  })

  it('sem sessão é 401', async () => {
    const unidade = await novaUnidade(30)

    const resposta = await consultar(unidade.codigoQr, null)

    expect(resposta.statusCode).toBe(401)
    expect(resposta.json().erro).toBe('NAO_AUTENTICADO')
  })
})

describe('consultar não escreve nada', () => {
  it('nenhuma linha nova em EventoLog, nem no acerto nem no código inexistente', async () => {
    const emEstoque = await novaUnidade(30)
    const vencida = await novaUnidade(-3)
    const vendida = await novaUnidade(30, StatusUnidade.VENDIDA)
    const antes = await prisma.eventoLog.count()

    await consultar(emEstoque.codigoQr)
    await consultar(vencida.codigoQr)
    await consultar(vendida.codigoQr)
    await consultar('PRF-ZZZZZZ')

    expect(await prisma.eventoLog.count()).toBe(antes)
  })

  it('a unidade consultada continua como estava, sem saída nem descarte', async () => {
    const unidade = await novaUnidade(30)

    await consultar(unidade.codigoQr)

    const depois = await prisma.unidadeProduto.findUniqueOrThrow({ where: { id: unidade.id } })
    expect(depois.status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(await prisma.saida.count()).toBe(0)
    expect(await prisma.descarte.count()).toBe(0)
  })
})
