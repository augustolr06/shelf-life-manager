/**
 * As etiquetas imprimíveis de um produto (RF04, T14).
 *
 * Roda contra PostgreSQL de verdade, no padrão de T13: o que se prova aqui é
 * quais unidades entram na folha e em que ordem, e isso é consulta — um duplo
 * do Prisma estaria repetindo a resposta que se quer verificar. A geometria do
 * símbolo em si é a suíte unitária `tests/simboloQr.test.ts`.
 *
 * Contrato: tasks/T14-geracao-qr-unidade.md · docs/arquitetura.md seção 5.
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

import { buildApp } from '../../src/app.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { cookieDeSessao, criarProduto, criarUnidade, criarUsuario } from '../apoio/cenario.js'
import { LADO_DO_VIEWBOX } from '../../src/modules/unidade/simboloQr.js'

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

function rota(produtoId: string, parametros = ''): string {
  return `/produtos/${produtoId}/unidades/etiquetas${parametros}`
}

function novaUnidade(
  diasAteVencer: number,
  opcoes: { status?: StatusUnidade; produtoId?: string } = {},
): Promise<UnidadeProduto> {
  return criarUnidade(prisma, {
    produtoId: opcoes.produtoId ?? perfume.id,
    registradoPorId: gestor.id,
    diasAteVencer,
    ...(opcoes.status ? { status: opcoes.status } : {}),
  })
}

function pedirEtiquetas(produtoId: string, parametros = '', usuario: Usuario = gestor) {
  return app.inject({
    method: 'GET',
    url: rota(produtoId, parametros),
    cookies: cookieDeSessao(app, usuario),
  })
}

type EtiquetaNaResposta = {
  id: string
  codigoQr: string
  dataValidade: string
  svg: string
  produto: { id: string; codigoInterno: string; nome: string; marca: string }
}

function corpo(resposta: { body: string }): {
  etiquetas: EtiquetaNaResposta[]
  total: number
  pagina: number
  tamanhoPagina: number
} {
  return JSON.parse(resposta.body)
}

describe('quais unidades recebem etiqueta', () => {
  it('devolve uma etiqueta por unidade em estoque, com o símbolo do código dela', async () => {
    const unidade = await novaUnidade(90)

    const resposta = await pedirEtiquetas(perfume.id)
    const { etiquetas, total } = corpo(resposta)

    expect(resposta.statusCode).toBe(200)
    expect(total).toBe(1)
    expect(etiquetas).toHaveLength(1)
    expect(etiquetas[0]?.id).toBe(unidade.id)
    expect(etiquetas[0]?.codigoQr).toBe(unidade.codigoQr)
    expect(etiquetas[0]?.svg).toContain(`viewBox="0 0 ${LADO_DO_VIEWBOX} ${LADO_DO_VIEWBOX}"`)
  })

  it('traz o produto e a validade como data de calendário', async () => {
    await novaUnidade(90)

    const { etiquetas } = corpo(await pedirEtiquetas(perfume.id))

    // A etiqueta impressa mostra a validade a olho nu, além do símbolo — mas
    // quem formata para humano é a tela (T15); aqui é `AAAA-MM-DD` (RNF01).
    expect(etiquetas[0]?.dataValidade).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(etiquetas[0]).toMatchObject({
      produto: {
        id: perfume.id,
        nome: perfume.nome,
        marca: perfume.marca,
        codigoInterno: perfume.codigoInterno,
      },
    })
  })

  it('deixa de fora o que já saiu do estoque', async () => {
    // Frasco vendido ou descartado não está mais na prateleira para receber
    // etiqueta.
    const emEstoque = await novaUnidade(90)
    await novaUnidade(90, { status: StatusUnidade.VENDIDA })
    await novaUnidade(90, { status: StatusUnidade.DESCARTADA })

    const { etiquetas, total } = corpo(await pedirEtiquetas(perfume.id))

    expect(total).toBe(1)
    expect(etiquetas.map((e) => e.id)).toEqual([emEstoque.id])
  })

  it('inclui unidade vencida que ainda está em estoque', async () => {
    // O frasco existe e precisa de etiqueta para ser lido; quem decide o
    // destino dele são os três caminhos da seção 6.1 do PRD, não a impressão.
    const vencida = await novaUnidade(-10)

    const { etiquetas } = corpo(await pedirEtiquetas(perfume.id))

    expect(etiquetas.map((e) => e.id)).toContain(vencida.id)
  })

  it('não mistura unidades de outro produto', async () => {
    const outro = await criarProduto(prisma, 'Colônia 100ml')
    const daCasa = await novaUnidade(90)
    await novaUnidade(90, { produtoId: outro.id })

    const { etiquetas, total } = corpo(await pedirEtiquetas(perfume.id))

    expect(total).toBe(1)
    expect(etiquetas.map((e) => e.id)).toEqual([daCasa.id])
  })

  it('ordena pela validade mais próxima, como a folha será consumida', async () => {
    const tardia = await novaUnidade(180)
    const proxima = await novaUnidade(10)
    const media = await novaUnidade(60)

    const { etiquetas } = corpo(await pedirEtiquetas(perfume.id))

    expect(etiquetas.map((e) => e.id)).toEqual([proxima.id, media.id, tardia.id])
  })

  it('devolve etiquetas de produto inativo', async () => {
    // Inativar o SKU no catálogo não devolve à fábrica o frasco que está na
    // prateleira, e reimprimir a etiqueta rasgada dele continua legítimo —
    // mesma leitura que a fila de descarte de T13 faz do produto inativo.
    const unidade = await novaUnidade(90)
    await prisma.produto.update({ where: { id: perfume.id }, data: { ativo: false } })

    const { etiquetas } = corpo(await pedirEtiquetas(perfume.id))

    expect(etiquetas.map((e) => e.id)).toEqual([unidade.id])
  })
})

describe('filtro por unidade', () => {
  it('restringe às unidades pedidas', async () => {
    // O caso de uso principal: a tela acabou de cadastrar um lote e quer as
    // etiquetas daqueles frascos, não do estoque inteiro do SKU.
    const primeira = await novaUnidade(30)
    const segunda = await novaUnidade(60)
    await novaUnidade(90)

    const { etiquetas, total } = corpo(
      await pedirEtiquetas(perfume.id, `?unidadeIds=${primeira.id}&unidadeIds=${segunda.id}`),
    )

    expect(total).toBe(2)
    expect(etiquetas.map((e) => e.id)).toEqual([primeira.id, segunda.id])
  })

  it('aceita um id só', async () => {
    // A query com chave repetida vira array; com uma ocorrência só, vira
    // escalar. O schema precisa aceitar os dois.
    const unidade = await novaUnidade(30)
    await novaUnidade(60)

    const { etiquetas } = corpo(await pedirEtiquetas(perfume.id, `?unidadeIds=${unidade.id}`))

    expect(etiquetas.map((e) => e.id)).toEqual([unidade.id])
  })

  it('ignora id que não pertence ao produto ou que já saiu do estoque', async () => {
    // A lista vem de uma tela que pode estar desatualizada. Recusar a folha
    // inteira por causa de um frasco vendido no meio-tempo faria a gestora
    // perder as outras etiquetas.
    const outro = await criarProduto(prisma, 'Colônia 100ml')
    const valida = await novaUnidade(30)
    const deOutroProduto = await novaUnidade(30, { produtoId: outro.id })
    const vendida = await novaUnidade(30, { status: StatusUnidade.VENDIDA })

    const resposta = await pedirEtiquetas(
      perfume.id,
      `?unidadeIds=${valida.id}&unidadeIds=${deOutroProduto.id}&unidadeIds=${vendida.id}`,
    )

    expect(resposta.statusCode).toBe(200)
    expect(corpo(resposta).etiquetas.map((e) => e.id)).toEqual([valida.id])
  })
})

describe('paginação', () => {
  it('conta o conjunto inteiro, não a página', async () => {
    for (const dias of [10, 20, 30]) await novaUnidade(dias)

    const primeira = corpo(await pedirEtiquetas(perfume.id, '?tamanhoPagina=2'))
    const segunda = corpo(await pedirEtiquetas(perfume.id, '?tamanhoPagina=2&pagina=2'))

    expect(primeira.total).toBe(3)
    expect(primeira.etiquetas).toHaveLength(2)
    expect(segunda.total).toBe(3)
    expect(segunda.etiquetas).toHaveLength(1)
    // Sem repetir nem pular: a segunda página continua de onde a primeira parou.
    expect(segunda.etiquetas.map((e) => e.id)).not.toContain(primeira.etiquetas[0]?.id)
  })

  it('recusa página maior que o teto de uma folha', async () => {
    const resposta = await pedirEtiquetas(perfume.id, '?tamanhoPagina=501')

    expect(resposta.statusCode).toBe(400)
    expect(JSON.parse(resposta.body).erro).toBe('CORPO_INVALIDO')
  })
})

describe('acesso e produto inexistente', () => {
  it('recusa atendente', async () => {
    // Etiquetar é a continuação do recebimento, não fluxo de balcão.
    const resposta = await pedirEtiquetas(perfume.id, '', atendente)

    expect(resposta.statusCode).toBe(403)
    expect(JSON.parse(resposta.body).erro).toBe('PAPEL_INSUFICIENTE')
  })

  it('recusa quem não está autenticado', async () => {
    const resposta = await app.inject({ method: 'GET', url: rota(perfume.id) })

    expect(resposta.statusCode).toBe(401)
  })

  it('responde 404 para produto inexistente', async () => {
    const resposta = await pedirEtiquetas('11111111-1111-1111-1111-111111111111')

    expect(resposta.statusCode).toBe(404)
    expect(JSON.parse(resposta.body).erro).toBe('PRODUTO_NAO_ENCONTRADO')
  })

  it('responde 200 com lista vazia quando não há o que etiquetar', async () => {
    // É o estado de quem já imprimiu tudo, não uma falha.
    const resposta = await pedirEtiquetas(perfume.id)

    expect(resposta.statusCode).toBe(200)
    expect(corpo(resposta)).toMatchObject({ etiquetas: [], total: 0 })
  })
})

describe('ponta a ponta com o cadastro em lote de T05', () => {
  it('etiqueta exatamente as unidades que o recebimento acabou de criar', async () => {
    const cadastro = await app.inject({
      method: 'POST',
      url: `/produtos/${perfume.id}/unidades`,
      cookies: cookieDeSessao(app, gestor),
      payload: { unidades: [{ dataValidade: '2027-01-31', quantidade: 3 }] },
    })
    const criadas: { id: string; codigoQr: string }[] = JSON.parse(cadastro.body).unidades

    const parametros = criadas.map((u) => `unidadeIds=${u.id}`).join('&')
    const { etiquetas } = corpo(await pedirEtiquetas(perfume.id, `?${parametros}`))

    expect(cadastro.statusCode).toBe(201)
    expect(etiquetas).toHaveLength(3)
    expect(etiquetas.map((e) => e.codigoQr).sort()).toEqual(criadas.map((u) => u.codigoQr).sort())
    for (const etiqueta of etiquetas) expect(etiqueta.svg).toContain('<svg')
  })
})
