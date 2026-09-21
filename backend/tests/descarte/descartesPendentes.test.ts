/**
 * A fila de descarte pendente (RF11, T13).
 *
 * Roda contra PostgreSQL de verdade como as suítes de T06–T11: o objeto de
 * teste é a comparação de `DATE` da RNF01 na borda do dia corrente, e a
 * coerência entre esta fila e a exclusão que o FIFO faz do pool prioritário —
 * nada disso existe fora do banco.
 *
 * Contrato: tasks/T13-fila-descarte-pendente.md · docs/arquitetura.md seção 5.
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
import { hojeComoData } from '../../src/shared/data.js'

const FILA = '/descartes/pendentes'

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

function consultar(parametros = '', usuario: Usuario = gestor) {
  return app.inject({
    method: 'GET',
    url: `${FILA}${parametros}`,
    cookies: cookieDeSessao(app, usuario),
  })
}

/** A data de calendário a N dias de hoje, no formato que a API devolve. */
function validadeEm(dias: number): string {
  const hoje = hojeComoData()
  const data = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + dias))
  return data.toISOString().slice(0, 10)
}

describe('fila de descarte pendente — acesso (RF01, RF11)', () => {
  it('recusa sem sessão', async () => {
    const resposta = await app.inject({ method: 'GET', url: FILA })

    expect(resposta.statusCode).toBe(401)
    expect(resposta.json().erro).toBe('NAO_AUTENTICADO')
  })

  it('recusa atendente: a fila é painel de gestão, não fluxo de balcão', async () => {
    await novaUnidade(-5)

    const resposta = await consultar('', atendente)

    expect(resposta.statusCode).toBe(403)
    expect(resposta.json().erro).toBe('PAPEL_INSUFICIENTE')
  })
})

describe('fila de descarte pendente — critério da fila (RF11, PRD 6.1)', () => {
  it('traz apenas unidade vencida e ainda em estoque', async () => {
    const vencida = await novaUnidade(-5)
    await novaUnidade(1)
    await novaUnidade(-5, { status: StatusUnidade.VENDIDA })
    await novaUnidade(-5, { status: StatusUnidade.DESCARTADA })

    const resposta = await consultar()

    expect(resposta.statusCode).toBe(200)
    const { unidades, total } = resposta.json()
    expect(total).toBe(1)
    expect(unidades.map((u: { id: string }) => u.id)).toEqual([vencida.id])
  })

  it('unidade que vence hoje fica fora — é a mesma borda que a mantém no pool do FIFO', async () => {
    // A cláusula desta fila é a negação exata do `dataValidade >= hoje` do
    // passo 4 de `validarSaidaFifo`. Se as duas divergirem nesta borda, a
    // unidade some das duas listas: não sai pelo FIFO e não aparece para o
    // gestor resolver.
    await novaUnidade(0)

    const resposta = await consultar()

    expect(resposta.json().total).toBe(0)
    expect(resposta.json().unidades).toEqual([])
  })

  it('unidade vencida ontem entra, com diasVencida = 1', async () => {
    await novaUnidade(-1)

    const [unidade] = (await consultar()).json().unidades

    expect(unidade.diasVencida).toBe(1)
    expect(unidade.dataValidade).toBe(validadeEm(-1))
  })

  it('unidade de produto inativo continua na fila', async () => {
    // Inativar o SKU no catálogo não devolve à fábrica o frasco que está na
    // prateleira: a perda continua sendo perda, e alguém precisa retirá-lo.
    const descontinuado = await criarProduto(prisma, 'Colônia descontinuada')
    const unidade = await novaUnidade(-10, { produtoId: descontinuado.id })
    await prisma.produto.update({ where: { id: descontinuado.id }, data: { ativo: false } })

    const { unidades } = (await consultar()).json()

    expect(unidades.map((u: { id: string }) => u.id)).toContain(unidade.id)
  })

  it('fila vazia é 200 com lista vazia, nunca 404', async () => {
    await novaUnidade(30)

    const resposta = await consultar()

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toMatchObject({ unidades: [], total: 0, pagina: 1, tamanhoPagina: 20 })
  })

  it('não grava evento nenhum: consultar a fila não é ato operacional', async () => {
    await novaUnidade(-5)

    await consultar()

    expect(await prisma.eventoLog.count()).toBe(0)
  })
})

describe('fila de descarte pendente — ordem e conteúdo', () => {
  it('ordena da mais vencida para a menos, misturando produtos', async () => {
    const outro = await criarProduto(prisma, 'Body splash 200ml')
    const maisAntiga = await novaUnidade(-90, { produtoId: outro.id })
    const doMeio = await novaUnidade(-30)
    const maisRecente = await novaUnidade(-2, { produtoId: outro.id })

    const { unidades } = (await consultar()).json()

    // A fila é do estoque inteiro: a urgência não se agrupa por SKU.
    expect(unidades.map((u: { id: string }) => u.id)).toEqual([maisAntiga.id, doMeio.id, maisRecente.id])
    expect(unidades.map((u: { diasVencida: number }) => u.diasVencida)).toEqual([90, 30, 2])
  })

  it('cada linha traz o produto embutido e a validade como data de calendário', async () => {
    const unidade = await novaUnidade(-7)

    const [linha] = (await consultar()).json().unidades

    expect(linha).toMatchObject({
      id: unidade.id,
      codigoQr: unidade.codigoQr,
      dataValidade: validadeEm(-7),
      diasVencida: 7,
      produto: {
        id: perfume.id,
        codigoInterno: perfume.codigoInterno,
        nome: perfume.nome,
        marca: perfume.marca,
      },
    })
    expect(typeof linha.dataEntrada).toBe('string')
  })
})

describe('fila de descarte pendente — paginação', () => {
  it('total conta a fila inteira, e as páginas não repetem nem pulam item', async () => {
    for (let dias = 1; dias <= 5; dias += 1) await novaUnidade(-dias)

    const primeira = await consultar('?pagina=1&tamanhoPagina=2')
    const segunda = await consultar('?pagina=2&tamanhoPagina=2')
    const terceira = await consultar('?pagina=3&tamanhoPagina=2')

    expect(primeira.json().total).toBe(5)
    expect(primeira.json().unidades).toHaveLength(2)
    expect(segunda.json().unidades).toHaveLength(2)
    expect(terceira.json().unidades).toHaveLength(1)

    const ids = [...primeira.json().unidades, ...segunda.json().unidades, ...terceira.json().unidades].map(
      (u: { id: string }) => u.id,
    )
    expect(new Set(ids).size).toBe(5)
  })

  it('recusa tamanho de página acima do máximo', async () => {
    const resposta = await consultar('?tamanhoPagina=500')

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('CORPO_INVALIDO')
  })
})

describe('fila de descarte pendente — coerência com os caminhos de T11', () => {
  function resolver(rota: string, corpo: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: rota,
      cookies: cookieDeSessao(app, gestor),
      payload: corpo,
    })
  }

  it('unidade descartada sai da fila', async () => {
    const vencida = await novaUnidade(-5)

    const descarte = await resolver('/excecao-vencido/descartar', { unidadeId: vencida.id })
    expect(descarte.statusCode).toBe(201)

    expect((await consultar()).json().total).toBe(0)
  })

  it('validade corrigida para o futuro tira a unidade da fila; para outro dia no passado, mantém', async () => {
    const vencida = await novaUnidade(-5)
    const erroDeDigitacao = await novaUnidade(-40)
    // Uma unidade prioritária do mesmo SKU, para que a revalidação da correção
    // termine em bloqueio de FIFO e não em venda: o que se quer observar aqui é
    // a unidade saindo da fila por deixar de estar vencida, não por ser vendida.
    await novaUnidade(1)

    await resolver('/excecao-vencido/corrigir', {
      unidadeId: vencida.id,
      dataValidade: validadeEm(60),
    })
    await resolver('/excecao-vencido/corrigir', {
      unidadeId: erroDeDigitacao.id,
      dataValidade: validadeEm(-3),
    })

    const { unidades, total } = (await consultar()).json()

    expect(total).toBe(1)
    // A fila e a resolução falam do mesmo estado, sob a mesma noção de hoje:
    // a unidade corrigida para outro dia no passado continua pendente, agora
    // com a contagem nova.
    expect(unidades[0]).toMatchObject({ id: erroDeDigitacao.id, diasVencida: 3 })
  })
})
