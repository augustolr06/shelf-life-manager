/**
 * A busca da Consulta por produto (T49): código de etiqueta, código de barras,
 * nome e marca num campo só, e o estoque do produto achado.
 *
 * Contra PostgreSQL de verdade, como a consulta de unidade (T32): o que se
 * prova é o que a busca encontra no banco — `contains` sem diferença de caixa,
 * a contagem de unidades por status, a ordem por validade — e que ela não
 * escreve nada.
 *
 * Contrato: tasks/T49-consulta-por-produto.md · docs/arquitetura.md seção 5.
 */

import { Papel, type PrismaClient, type Produto, StatusUnidade, type Usuario } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/db/prisma.js', async () => {
  const { clienteCompartilhadoDeTeste } = await import('../apoio/bancoDeTeste.js')
  return { prisma: clienteCompartilhadoDeTeste() }
})

import { buildApp } from '../../src/buildApp.js'
import { textoDeData } from '../../src/shared/data.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { cookieDeSessao, criarUnidade, criarUsuario, emDias } from '../apoio/cenario.js'

let prisma: PrismaClient
let app: FastifyInstance
let atendente: Usuario
let gestor: Usuario
let tinta: Produto
let henna: Produto

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

function produto(codigoInterno: string, nome: string, marca: string, ativo = true) {
  return prisma.produto.create({
    data: { codigoInterno, nome, marca, categoria: 'Coloração', ativo },
  })
}

beforeEach(async () => {
  await limparBanco(prisma)
  atendente = await criarUsuario(prisma, Papel.ATENDENTE)
  gestor = await criarUsuario(prisma, Papel.GESTOR)
  tinta = await produto('7891000325858', 'Alta Moda 6.1 Louro Escuro', 'Alfaparf')
  henna = await produto('7896000000017', 'Henna Pó Castanho', 'Surya Brasil')
})

function novaUnidade(produtoId: string, diasAteVencer: number, status?: StatusUnidade) {
  return criarUnidade(prisma, {
    produtoId,
    registradoPorId: gestor.id,
    diasAteVencer,
    ...(status ? { status } : {}),
  })
}

function buscar(termo: string, usuario: Usuario | null = atendente) {
  return app.inject({
    method: 'GET',
    url: `/consulta/busca?${new URLSearchParams({ termo })}`,
    ...(usuario ? { cookies: cookieDeSessao(app, usuario) } : {}),
  })
}

function estoque(id: string, usuario: Usuario | null = atendente) {
  return app.inject({
    method: 'GET',
    url: `/consulta/produtos/${id}`,
    ...(usuario ? { cookies: cookieDeSessao(app, usuario) } : {}),
  })
}

describe('GET /consulta/busca', () => {
  it('código de etiqueta devolve a unidade, na forma da consulta de T32', async () => {
    const unidade = await novaUnidade(tinta.id, 40)

    const resposta = await buscar(unidade.codigoQr)

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toMatchObject({
      tipo: 'UNIDADE',
      consulta: {
        unidade: { codigoQr: unidade.codigoQr, status: 'EM_ESTOQUE', produto: { id: tinta.id } },
        situacao: 'NO_PRAZO',
        diasParaVencer: 40,
      },
    })
  })

  it('código de etiqueta digitado com minúsculas, espaços e O no lugar de 0 ainda acha a unidade', async () => {
    const unidade = await novaUnidade(tinta.id, 10)
    const digitado = ` ${unidade.codigoQr.toLowerCase().replace(/0/g, 'o')} `

    const resposta = await buscar(digitado)

    expect(resposta.json()).toMatchObject({
      tipo: 'UNIDADE',
      consulta: { unidade: { codigoQr: unidade.codigoQr } },
    })
  })

  it('código de barras exato devolve só aquele produto, com as unidades em estoque contadas', async () => {
    // Um segundo produto cujo código contém o primeiro: "contém" traria os dois.
    await produto('17891000325858', 'Outro produto', 'Outra marca')
    await novaUnidade(tinta.id, 10)
    await novaUnidade(tinta.id, 90)
    await novaUnidade(tinta.id, 5, StatusUnidade.VENDIDA)
    await novaUnidade(tinta.id, -3, StatusUnidade.DESCARTADA)

    const resposta = await buscar('7891000325858')

    expect(resposta.json()).toEqual({
      tipo: 'PRODUTOS',
      total: 1,
      produtos: [
        {
          id: tinta.id,
          codigoInterno: '7891000325858',
          nome: 'Alta Moda 6.1 Louro Escuro',
          marca: 'Alfaparf',
          categoria: 'Coloração',
          ativo: true,
          emEstoque: 2,
        },
      ],
    })
  })

  it('código interno sem código de barras também é achado exato, sem diferença de caixa', async () => {
    const semCodigo = await produto('SEMCOD-001', 'Tonalizante sem código', 'Marca Local')

    const resposta = await buscar('semcod-001')

    expect(resposta.json().produtos.map((p: Produto) => p.id)).toEqual([semCodigo.id])
  })

  it('acha pelo nome, sem diferença de caixa', async () => {
    const resposta = await buscar('alta moda')

    expect(resposta.json()).toMatchObject({ tipo: 'PRODUTOS', total: 1, produtos: [{ id: tinta.id }] })
  })

  it('acha pela marca', async () => {
    const resposta = await buscar('surya')

    expect(resposta.json()).toMatchObject({ tipo: 'PRODUTOS', total: 1, produtos: [{ id: henna.id }] })
  })

  it('inclui produto inativo, que ainda pode ter unidades em estoque', async () => {
    const inativo = await produto('7890000000005', 'Alta Moda 7.0 Louro Médio', 'Alfaparf', false)
    await novaUnidade(inativo.id, 20)

    const resposta = await buscar('alfaparf')

    expect(resposta.json()).toMatchObject({
      tipo: 'PRODUTOS',
      total: 2,
      produtos: [
        { id: tinta.id, ativo: true, emEstoque: 0 },
        { id: inativo.id, ativo: false, emEstoque: 1 },
      ],
    })
  })

  it('devolve até 20 produtos em ordem de nome, com o total de verdade', async () => {
    for (let i = 1; i <= 22; i += 1) {
      await produto(`LOTE-${String(i).padStart(2, '0')}`, `Tom ${String(i).padStart(2, '0')}`, 'Marca Lote')
    }

    const resposta = await buscar('marca lote')

    expect(resposta.json().total).toBe(22)
    expect(resposta.json().produtos).toHaveLength(20)
    expect(resposta.json().produtos[0].nome).toBe('Tom 01')
  })

  it('nada encontrado é lista vazia, e não erro', async () => {
    const resposta = await buscar('perfume que não existe')

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toEqual({ tipo: 'PRODUTOS', produtos: [], total: 0 })
  })

  it('código no formato de etiqueta sem unidade cai na busca de produto', async () => {
    const resposta = await buscar('PRF-ZZZZZZ')

    expect(resposta.json()).toEqual({ tipo: 'PRODUTOS', produtos: [], total: 0 })
  })

  it('recusa termo vazio e acima de 120 caracteres', async () => {
    expect((await buscar('')).statusCode).toBe(400)
    expect((await buscar('x'.repeat(121))).statusCode).toBe(400)
  })

  it('exige sessão, e o gestor também consulta', async () => {
    expect((await buscar('alta', null)).statusCode).toBe(401)
    expect((await buscar('alta', gestor)).statusCode).toBe(200)
  })
})

describe('GET /consulta/produtos/:id', () => {
  it('devolve o produto e só as unidades em estoque, em ordem de validade, com dias, situação e faixa', async () => {
    const longe = await novaUnidade(tinta.id, 120)
    const vencida = await novaUnidade(tinta.id, -2)
    const hoje = await novaUnidade(tinta.id, 0)
    const proxima = await novaUnidade(tinta.id, 20)
    await novaUnidade(tinta.id, 1, StatusUnidade.VENDIDA)
    await novaUnidade(tinta.id, 3, StatusUnidade.DESCARTADA)

    const resposta = await estoque(tinta.id)

    expect(resposta.statusCode).toBe(200)
    const corpo = resposta.json()
    expect(corpo.produto).toEqual({
      id: tinta.id,
      codigoInterno: '7891000325858',
      nome: 'Alta Moda 6.1 Louro Escuro',
      marca: 'Alfaparf',
      categoria: 'Coloração',
      ativo: true,
    })
    expect(
      corpo.unidades.map((u: { codigoQr: string; diasParaVencer: number; situacao: string; faixa: string }) => [
        u.codigoQr,
        u.diasParaVencer,
        u.situacao,
        u.faixa,
      ]),
    ).toEqual([
      [vencida.codigoQr, -2, 'VENCIDA', 'VENCIDA'],
      // Vence hoje: ainda no prazo, como no pool do FIFO.
      [hoje.codigoQr, 0, 'NO_PRAZO', 'ATE_7_DIAS'],
      [proxima.codigoQr, 20, 'NO_PRAZO', 'DE_8_A_30_DIAS'],
      [longe.codigoQr, 120, 'NO_PRAZO', 'ACIMA_DE_90_DIAS'],
    ])
    // Data de calendário, nunca instante (RNF01).
    expect(corpo.unidades[0].dataValidade).toBe(textoDeData(emDias(-2)))
  })

  it('produto sem estoque devolve a lista vazia', async () => {
    const resposta = await estoque(henna.id)

    expect(resposta.json()).toMatchObject({ produto: { id: henna.id }, unidades: [] })
  })

  it('404 para produto que não existe, 401 sem sessão', async () => {
    const inexistente = '00000000-0000-4000-8000-000000000000'
    const resposta = await estoque(inexistente)

    expect(resposta.statusCode).toBe(404)
    expect(resposta.json()).toMatchObject({ erro: 'PRODUTO_NAO_ENCONTRADO' })
    expect((await estoque(tinta.id, null)).statusCode).toBe(401)
  })
})

it('consultar não grava nada no EventoLog', async () => {
  const unidade = await novaUnidade(tinta.id, 10)

  await buscar(unidade.codigoQr)
  await buscar('alfaparf')
  await estoque(tinta.id)

  expect(await prisma.eventoLog.count()).toBe(0)
})
