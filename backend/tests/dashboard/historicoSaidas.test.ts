/**
 * O histórico de saídas (RF13, T20) — o único item do requisito que é lista.
 *
 * Contrato: tasks/T20-endpoints-dashboard.md · docs/arquitetura.md seção 5.
 */

import { Papel, type PrismaClient, type Produto, StatusUnidade, type Usuario } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/db/prisma.js', async () => {
  const { clienteCompartilhadoDeTeste } = await import('../apoio/bancoDeTeste.js')
  return { prisma: clienteCompartilhadoDeTeste() }
})

import { buildApp } from '../../src/app.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { cookieDeSessao, criarProduto, criarUnidade, criarUsuario } from '../apoio/cenario.js'

const HISTORICO = '/dashboard/saidas'
const JUSTIFICATIVA = 'Cliente ciente do vencimento e insistiu na compra.'
const SESSAO = '3f1a6d2e-9c47-4b0e-8a51-2d6f7c8b9e10'

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

function novaUnidade(diasAteVencer: number, status?: StatusUnidade) {
  return criarUnidade(prisma, {
    produtoId: perfume.id,
    registradoPorId: gestor.id,
    diasAteVencer,
    ...(status ? { status } : {}),
  })
}

function consultar(parametros = '', usuario: Usuario = gestor) {
  return app.inject({
    method: 'GET',
    url: `${HISTORICO}${parametros}`,
    cookies: cookieDeSessao(app, usuario),
  })
}

function dataEm(dias: number): string {
  const agora = new Date()
  const data = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + dias)
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${data.getFullYear()}-${mes}-${dia}`
}

function instanteEm(dias: number, hora = 12): Date {
  const agora = new Date()
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + dias, hora)
}

async function saidaGravada(opcoes: {
  diasAtras: number
  hora?: number
  tentativasAteAcerto?: number
  override?: boolean
  sessaoVendaId?: string
}) {
  const unidade = await novaUnidade(30, StatusUnidade.VENDIDA)
  const tentativas = opcoes.tentativasAteAcerto ?? 0
  return prisma.saida.create({
    data: {
      unidadeId: unidade.id,
      usuarioId: atendente.id,
      dataHora: instanteEm(-opcoes.diasAtras, opcoes.hora ?? 12),
      tentativasAteAcerto: tentativas,
      alertaFifoDisparado: tentativas > 0,
      vendaDeUnidadeVencida: opcoes.override ?? false,
      ...(opcoes.override ? { justificativaOverride: JUSTIFICATIVA, autorizadoPorId: gestor.id } : {}),
      ...(opcoes.sessaoVendaId ? { sessaoVendaId: opcoes.sessaoVendaId } : {}),
    },
  })
}

describe('histórico de saídas — acesso (RF01, RF13)', () => {
  it('recusa sem sessão', async () => {
    const resposta = await app.inject({ method: 'GET', url: HISTORICO })

    expect(resposta.statusCode).toBe(401)
    expect(resposta.json().erro).toBe('NAO_AUTENTICADO')
  })

  it('recusa atendente', async () => {
    const resposta = await consultar('', atendente)

    expect(resposta.statusCode).toBe(403)
    expect(resposta.json().erro).toBe('PAPEL_INSUFICIENTE')
  })
})

describe('histórico de saídas — conteúdo da linha', () => {
  it('traz a unidade com o produto embutido, quem vendeu e o esforço da leitura', async () => {
    await saidaGravada({ diasAtras: 1, tentativasAteAcerto: 2, sessaoVendaId: SESSAO })

    const [linha] = (await consultar()).json().saidas

    expect(linha).toMatchObject({
      tentativasAteAcerto: 2,
      alertaFifoDisparado: true,
      vendaDeUnidadeVencida: false,
      justificativaOverride: null,
      sessaoVendaId: SESSAO,
      usuario: { id: atendente.id, nome: atendente.nome },
      // A saída comum não tem quem autorize: só o override tem.
      autorizadoPor: null,
      unidade: {
        produto: { id: perfume.id, codigoInterno: perfume.codigoInterno, nome: perfume.nome },
      },
    })
    // Instante, não data de calendário: uma saída acontece a uma hora do dia.
    expect(linha.dataHora).toMatch(/T/)
    // A validade continua sendo data de calendário, como em toda a API (RNF01).
    expect(linha.unidade.dataValidade).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('o override traz justificativa e quem autorizou', async () => {
    const vencida = await novaUnidade(-3)

    await app.inject({
      method: 'POST',
      url: '/excecao-vencido/override',
      cookies: cookieDeSessao(app, gestor),
      payload: { unidadeId: vencida.id, justificativa: JUSTIFICATIVA },
    })

    const [linha] = (await consultar()).json().saidas

    expect(linha).toMatchObject({
      vendaDeUnidadeVencida: true,
      justificativaOverride: JUSTIFICATIVA,
      autorizadoPor: { id: gestor.id, nome: gestor.nome },
      // Não passou pelo laço do FIFO.
      tentativasAteAcerto: 0,
      alertaFifoDisparado: false,
    })
  })
})

describe('histórico de saídas — ordem, período e paginação', () => {
  it('ordena da mais recente para a mais antiga', async () => {
    const antiga = await saidaGravada({ diasAtras: 5 })
    const recente = await saidaGravada({ diasAtras: 1 })
    const doMeio = await saidaGravada({ diasAtras: 3 })

    const { saidas } = (await consultar()).json()

    expect(saidas.map((s: { id: string }) => s.id)).toEqual([recente.id, doMeio.id, antiga.id])
  })

  it('respeita o período, com as duas pontas inclusivas', async () => {
    await saidaGravada({ diasAtras: 4, hora: 23 })
    await saidaGravada({ diasAtras: 3, hora: 0 })
    await saidaGravada({ diasAtras: 1, hora: 23 })
    await saidaGravada({ diasAtras: 0, hora: 0 })

    const corpo = (await consultar(`?de=${dataEm(-3)}&ate=${dataEm(-1)}`)).json()

    expect(corpo.total).toBe(2)
    expect(corpo.periodo).toEqual({ de: dataEm(-3), ate: dataEm(-1) })
  })

  it('total conta o período inteiro, e as páginas não repetem nem pulam', async () => {
    for (let dias = 1; dias <= 5; dias += 1) await saidaGravada({ diasAtras: dias })

    const primeira = await consultar('?pagina=1&tamanhoPagina=2')
    const segunda = await consultar('?pagina=2&tamanhoPagina=2')
    const terceira = await consultar('?pagina=3&tamanhoPagina=2')

    expect(primeira.json().total).toBe(5)
    expect(primeira.json().saidas).toHaveLength(2)
    expect(terceira.json().saidas).toHaveLength(1)

    const ids = [
      ...primeira.json().saidas,
      ...segunda.json().saidas,
      ...terceira.json().saidas,
    ].map((s: { id: string }) => s.id)
    expect(new Set(ids).size).toBe(5)
  })

  it('pagina de forma estável quando duas saídas dividem o mesmo instante', async () => {
    // Sem desempate por `id`, a ordem entre elas ficaria a critério do banco e
    // uma poderia aparecer nas duas páginas — ou em nenhuma.
    const mesmoInstante = instanteEm(-1, 9)
    for (const _ of [1, 2, 3, 4]) {
      const unidade = await novaUnidade(30, StatusUnidade.VENDIDA)
      await prisma.saida.create({
        data: { unidadeId: unidade.id, usuarioId: atendente.id, dataHora: mesmoInstante },
      })
    }

    const primeira = await consultar('?pagina=1&tamanhoPagina=2')
    const segunda = await consultar('?pagina=2&tamanhoPagina=2')

    const ids = [...primeira.json().saidas, ...segunda.json().saidas].map((s: { id: string }) => s.id)
    expect(new Set(ids).size).toBe(4)
  })

  it('recusa período invertido com 400 PERIODO_INVALIDO', async () => {
    const resposta = await consultar(`?de=${dataEm(0)}&ate=${dataEm(-10)}`)

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('PERIODO_INVALIDO')
  })

  it('recusa tamanho de página acima do máximo', async () => {
    const resposta = await consultar('?tamanhoPagina=500')

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('CORPO_INVALIDO')
  })
})

describe('histórico de saídas — filtro de overrides (RF13, PRD 6.1)', () => {
  it('apenasOverrides traz só a venda autorizada de unidade vencida', async () => {
    await saidaGravada({ diasAtras: 1 })
    const override = await saidaGravada({ diasAtras: 2, override: true })

    const corpo = (await consultar('?apenasOverrides=true')).json()

    expect(corpo.total).toBe(1)
    expect(corpo.saidas.map((s: { id: string }) => s.id)).toEqual([override.id])
    expect(corpo.saidas[0].justificativaOverride).toBe(JUSTIFICATIVA)
  })

  it('sem o filtro, o histórico traz as duas', async () => {
    await saidaGravada({ diasAtras: 1 })
    await saidaGravada({ diasAtras: 2, override: true })

    expect((await consultar()).json().total).toBe(2)
  })
})

describe('histórico de saídas — estado inicial e efeitos colaterais', () => {
  it('período sem saída é 200 com lista vazia, nunca 404', async () => {
    const resposta = await consultar()

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toMatchObject({ saidas: [], total: 0, pagina: 1, tamanhoPagina: 20 })
  })

  it('não grava evento nenhum', async () => {
    await saidaGravada({ diasAtras: 1 })

    await consultar()

    expect(await prisma.eventoLog.count()).toBe(0)
  })
})
