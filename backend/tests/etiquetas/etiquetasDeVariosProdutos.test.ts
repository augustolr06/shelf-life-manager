/**
 * As etiquetas de vários produtos de uma vez (T50): `POST /unidades/etiquetas`.
 *
 * Contra PostgreSQL de verdade, como a suíte da folha de um produto
 * (`etiquetas.test.ts`): o que se prova é quais unidades entram e em que ordem,
 * e a ordem é o que mantém os grupos de produto inteiros entre as páginas.
 *
 * Contrato: tasks/T50-etiquetas-varios-produtos.md.
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
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { cookieDeSessao, criarProduto, criarUnidade, criarUsuario } from '../apoio/cenario.js'

let prisma: PrismaClient
let app: FastifyInstance
let atendente: Usuario
let gestor: Usuario

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
})

async function produto(marca: string, nome: string, opcoes: { ativo?: boolean } = {}): Promise<Produto> {
  const criado = await criarProduto(prisma, nome)
  return prisma.produto.update({
    where: { id: criado.id },
    data: { marca, ...(opcoes.ativo === false ? { ativo: false } : {}) },
  })
}

function unidade(
  de: Produto,
  diasAteVencer: number,
  status?: StatusUnidade,
): Promise<UnidadeProduto> {
  return criarUnidade(prisma, {
    produtoId: de.id,
    registradoPorId: gestor.id,
    diasAteVencer,
    ...(status ? { status } : {}),
  })
}

function pedir(corpo: object, usuario: Usuario | null = gestor) {
  return app.inject({
    method: 'POST',
    url: '/unidades/etiquetas',
    payload: corpo,
    ...(usuario ? { cookies: cookieDeSessao(app, usuario) } : {}),
  })
}

type Folha = {
  etiquetas: Array<{
    id: string
    codigoQr: string
    dataValidade: string
    svg: string
    produto: { id: string; nome: string; marca: string }
  }>
  total: number
  pagina: number
  tamanhoPagina: number
}

function folha(resposta: { body: string }): Folha {
  return JSON.parse(resposta.body)
}

describe('quais produtos e unidades entram', () => {
  it('traz as unidades em estoque só dos produtos escolhidos', async () => {
    const a = await produto('Natura', 'Kaiak')
    const b = await produto('Boticário', 'Malbec')
    const fora = await produto('Avon', 'Far Away')
    const ua = await unidade(a, 30)
    const ub = await unidade(b, 30)
    await unidade(fora, 30)

    const resposta = await pedir({ produtoIds: [a.id, b.id] })

    expect(resposta.statusCode).toBe(200)
    const { etiquetas, total } = folha(resposta)
    expect(total).toBe(2)
    expect(etiquetas.map((e) => e.id).sort()).toEqual([ua.id, ub.id].sort())
    // A etiqueta é a mesma da folha de um produto: símbolo e produto embutido.
    expect(etiquetas[0]?.svg).toContain('<svg')
    expect(etiquetas[0]?.produto.nome).toBeDefined()
  })

  it('com "todos", traz todo produto com unidade em estoque, e só unidades em estoque', async () => {
    const a = await produto('Natura', 'Kaiak')
    const b = await produto('Boticário', 'Malbec')
    const semEstoque = await produto('Avon', 'Far Away')
    const ua = await unidade(a, 30)
    const ub = await unidade(b, 30)
    await unidade(a, 30, StatusUnidade.VENDIDA)
    await unidade(semEstoque, 30, StatusUnidade.DESCARTADA)

    const { etiquetas, total } = folha(await pedir({ todos: true }))

    expect(total).toBe(2)
    expect(etiquetas.map((e) => e.id).sort()).toEqual([ua.id, ub.id].sort())
  })

  it('inclui produto inativo e unidade vencida, que ainda estão na prateleira', async () => {
    const inativo = await produto('Natura', 'Kaiak', { ativo: false })
    const vencida = await unidade(inativo, -5)

    const { etiquetas } = folha(await pedir({ produtoIds: [inativo.id] }))

    expect(etiquetas.map((e) => e.id)).toEqual([vencida.id])
  })

  it('ignora id de produto que não existe', async () => {
    const a = await produto('Natura', 'Kaiak')
    const ua = await unidade(a, 30)

    const resposta = await pedir({
      produtoIds: [a.id, '00000000-0000-4000-8000-000000000000'],
    })

    expect(resposta.statusCode).toBe(200)
    expect(folha(resposta).etiquetas.map((e) => e.id)).toEqual([ua.id])
  })

  it('produto escolhido sem estoque é lista vazia, não erro', async () => {
    const a = await produto('Natura', 'Kaiak')

    const resposta = await pedir({ produtoIds: [a.id] })

    expect(resposta.statusCode).toBe(200)
    expect(folha(resposta)).toMatchObject({ etiquetas: [], total: 0 })
  })
})

describe('ordem da folha', () => {
  it('agrupa por marca, depois nome, e dentro do produto segue a validade', async () => {
    const natKaiak = await produto('Natura', 'Kaiak')
    const botMalbec = await produto('Boticário', 'Malbec')
    const natEssencial = await produto('Natura', 'Essencial')

    // Criadas fora de ordem, para que a ordem da resposta não seja acidente.
    const kaiakTarde = await unidade(natKaiak, 90)
    const malbec = await unidade(botMalbec, 60)
    const kaiakCedo = await unidade(natKaiak, 10)
    const essencial = await unidade(natEssencial, 5)

    const { etiquetas } = folha(await pedir({ todos: true }))

    expect(etiquetas.map((e) => e.id)).toEqual([
      malbec.id, // Boticário
      essencial.id, // Natura — Essencial
      kaiakCedo.id, // Natura — Kaiak, a que vence antes primeiro (FIFO)
      kaiakTarde.id,
    ])
  })

  it('não intercala dois produtos de marca e nome iguais', async () => {
    const um = await produto('Natura', 'Kaiak')
    const outro = await produto('Natura', 'Kaiak')
    for (const dias of [10, 20, 30]) {
      await unidade(um, dias)
      await unidade(outro, dias)
    }

    const { etiquetas } = folha(await pedir({ todos: true }))
    const sequencia = etiquetas.map((e) => e.produto.id)

    // Cada produto aparece num bloco contíguo: no máximo uma troca.
    const trocas = sequencia.filter((id, i) => i > 0 && id !== sequencia[i - 1]).length
    expect(trocas).toBe(1)
  })

  it('a paginação continua de onde parou, sem repetir nem pular', async () => {
    const a = await produto('Natura', 'Kaiak')
    const b = await produto('Boticário', 'Malbec')
    for (const dias of [5, 15, 25]) {
      await unidade(a, dias)
      await unidade(b, dias)
    }

    const inteira = folha(await pedir({ todos: true }))
    const primeira = folha(await pedir({ todos: true, pagina: 1, tamanhoPagina: 4 }))
    const segunda = folha(await pedir({ todos: true, pagina: 2, tamanhoPagina: 4 }))

    expect(primeira).toMatchObject({ total: 6, pagina: 1, tamanhoPagina: 4 })
    expect(segunda.etiquetas).toHaveLength(2)
    expect([...primeira.etiquetas, ...segunda.etiquetas].map((e) => e.id)).toEqual(
      inteira.etiquetas.map((e) => e.id),
    )
  })
})

describe('corpo do pedido', () => {
  it.each([
    ['vazio', {}],
    ['os dois juntos', { todos: true, produtoIds: ['00000000-0000-4000-8000-000000000000'] }],
    ['lista vazia', { produtoIds: [] }],
    ['id que não é UUID', { produtoIds: ['abc'] }],
    ['todos falso', { todos: false }],
    ['página grande demais', { todos: true, tamanhoPagina: 501 }],
  ])('recusa corpo %s com 400', async (_caso, corpo) => {
    const resposta = await pedir(corpo)

    expect(resposta.statusCode).toBe(400)
    expect(JSON.parse(resposta.body)).toHaveProperty('mensagem')
  })
})

describe('quem pode pedir', () => {
  it('recusa atendente com 403', async () => {
    expect((await pedir({ todos: true }, atendente)).statusCode).toBe(403)
  })

  it('recusa sem sessão com 401', async () => {
    expect((await pedir({ todos: true }, null)).statusCode).toBe(401)
  })

  it('não grava nada no EventoLog', async () => {
    const a = await produto('Natura', 'Kaiak')
    await unidade(a, 30)
    const antes = await prisma.eventoLog.count()

    await pedir({ todos: true })

    expect(await prisma.eventoLog.count()).toBe(antes)
  })
})
