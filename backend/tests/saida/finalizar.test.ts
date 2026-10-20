/**
 * `POST /saidas/finalizar` — a confirmação do carrinho (T33b).
 *
 * ESCRITA ANTES DA ROTA EXISTIR (T33), como a suíte de T06 foi escrita antes
 * de T07. Enquanto T33b não existir, os casos falham com 404 de rota
 * inexistente, e esse é o vermelho esperado.
 *
 * Desde T33, ler o QR valida sem dar baixa, e a unidade liberada vai para um
 * carrinho que existe só no navegador. A venda acontece aqui: o servidor
 * revalida cada item sob lock e só então cria a `Saida`. Roda contra
 * PostgreSQL de verdade, pelos mesmos motivos de `lerQr.test.ts`.
 *
 * Contrato: tasks/T33-testes-avaliacao-efetivacao.md ·
 * tasks/T33b-avaliacao-efetivacao-backend.md.
 */

import { Papel, type PrismaClient, type Produto, StatusUnidade, type UnidadeProduto, type Usuario } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/db/prisma.js', async () => {
  const { clienteCompartilhadoDeTeste } = await import('../apoio/bancoDeTeste.js')
  return { prisma: clienteCompartilhadoDeTeste() }
})

import { buildApp } from '../../src/buildApp.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import {
  cookieDeSessao,
  criarProduto,
  criarUnidade,
  criarUsuario,
  eventosDe,
  finalizarCarrinho,
} from '../apoio/cenario.js'

const ROTA = '/saidas/finalizar'

/** Teto de itens por confirmação, fixado aqui para T33b (sugestão do arquivo da tarefa). */
const TETO_DE_ITENS = 50

let prisma: PrismaClient
let app: FastifyInstance
let atendente: Usuario
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
  perfume = await criarProduto(prisma)
})

function novaUnidade(diasAteVencer: number, status?: StatusUnidade): Promise<UnidadeProduto> {
  return criarUnidade(prisma, {
    produtoId: perfume.id,
    registradoPorId: atendente.id,
    diasAteVencer,
    ...(status ? { status } : {}),
  })
}

function finalizar(unidadeIds: string[], usuario: Usuario = atendente, sessaoVendaId?: string) {
  return finalizarCarrinho(app, usuario, unidadeIds, sessaoVendaId)
}

function ler(codigoQr: string, noCarrinho?: string[]) {
  return app.inject({
    method: 'POST',
    url: '/saidas/ler',
    cookies: cookieDeSessao(app, atendente),
    payload: { codigoQr, ...(noCarrinho ? { noCarrinho } : {}) },
  })
}

function recarregar(unidade: UnidadeProduto): Promise<UnidadeProduto> {
  return prisma.unidadeProduto.findUniqueOrThrow({ where: { id: unidade.id } })
}

describe('POST /saidas/finalizar — acesso', () => {
  it('recusa sem sessão, e nada é baixado', async () => {
    const unidade = await novaUnidade(30)

    const resposta = await app.inject({ method: 'POST', url: ROTA, payload: { unidadeIds: [unidade.id] } })

    expect(resposta.statusCode).toBe(401)
    expect(resposta.json().erro).toBe('NAO_AUTENTICADO')
    expect((await recarregar(unidade)).status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(await prisma.saida.count()).toBe(0)
  })

  it('aceita ATENDENTE e GESTOR — vender é atribuição das duas funções', async () => {
    const gestor = await criarUsuario(prisma, Papel.GESTOR)
    const daAtendente = await novaUnidade(30)
    const doGestor = await novaUnidade(30)

    expect((await finalizar([daAtendente.id])).statusCode).toBe(200)
    expect((await finalizar([doGestor.id], gestor)).statusCode).toBe(200)
  })

  it('ignora usuarioId proposto pelo corpo — a venda é de quem tem a sessão', async () => {
    const outra = await criarUsuario(prisma, Papel.ATENDENTE)
    const unidade = await novaUnidade(30)

    const resposta = await app.inject({
      method: 'POST',
      url: ROTA,
      cookies: cookieDeSessao(app, atendente),
      payload: { unidadeIds: [unidade.id], usuarioId: outra.id },
    })

    expect(resposta.statusCode).toBe(200)
    const saida = await prisma.saida.findUniqueOrThrow({ where: { unidadeId: unidade.id } })
    expect(saida.usuarioId).toBe(atendente.id)
  })
})

describe('POST /saidas/finalizar — corpo', () => {
  it('recusa carrinho vazio com 400', async () => {
    const resposta = await finalizar([])

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('CORPO_INVALIDO')
  })

  it(`recusa mais de ${TETO_DE_ITENS} itens com 400, antes de tocar no banco`, async () => {
    const ids = Array.from({ length: TETO_DE_ITENS + 1 }, () => randomUUID())

    const resposta = await finalizar(ids)

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('CORPO_INVALIDO')
  })

  it(`aceita exatamente ${TETO_DE_ITENS} itens`, async () => {
    const unidades: UnidadeProduto[] = []
    for (let i = 0; i < TETO_DE_ITENS; i += 1) unidades.push(await novaUnidade(30 + i))

    const resposta = await finalizar(unidades.map((u) => u.id))

    expect(resposta.statusCode).toBe(200)
    expect(await prisma.saida.count()).toBe(TETO_DE_ITENS)
  })

  it('recusa unidade repetida com 400, e nada é baixado', async () => {
    // O mesmo frasco duas vezes no carrinho é defeito do cliente. Processar
    // daria CONFIRMAR e depois UNIDADE_JA_BAIXADA para a mesma unidade, e a
    // tela teria que explicar um erro que a atendente não cometeu.
    const unidade = await novaUnidade(30)

    const resposta = await finalizar([unidade.id, unidade.id])

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('CORPO_INVALIDO')
    expect(await prisma.saida.count()).toBe(0)
  })

  it('recusa id fora do formato com 400', async () => {
    const resposta = await finalizar(['PRF-ABC123'])

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('CORPO_INVALIDO')
  })

  it('recusa sessaoVendaId malformado com 400, e nada é baixado', async () => {
    const unidade = await novaUnidade(30)

    const resposta = await finalizar([unidade.id], atendente, 'atendimento-42')

    expect(resposta.statusCode).toBe(400)
    expect(await prisma.saida.count()).toBe(0)
  })

  it('id que não é de unidade nenhuma: 404 UNIDADE_NAO_ENCONTRADA, e nenhum item é processado', async () => {
    // O carrinho guarda ids que a própria leitura devolveu, e unidade não é
    // apagada. Um id desconhecido só vem de cliente quebrado: a recusa é do
    // carrinho inteiro, como no item repetido, e não um veredito por item.
    // Mesmo código e mesmo status dos caminhos da unidade vencida (T11).
    const unidade = await novaUnidade(30)

    const resposta = await finalizar([unidade.id, randomUUID()])

    expect(resposta.statusCode).toBe(404)
    expect(resposta.json().erro).toBe('UNIDADE_NAO_ENCONTRADA')
    expect((await recarregar(unidade)).status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(await prisma.saida.count()).toBe(0)
  })
})

describe('POST /saidas/finalizar — a venda', () => {
  it('vende cada item: Saida, VENDIDA e SAIDA_CONFIRMADA', async () => {
    const primeira = await novaUnidade(10)
    const segunda = await novaUnidade(10)

    const resposta = await finalizar([primeira.id, segunda.id])

    expect(resposta.statusCode).toBe(200)
    for (const unidade of [primeira, segunda]) {
      expect((await recarregar(unidade)).status).toBe(StatusUnidade.VENDIDA)
      const saida = await prisma.saida.findUniqueOrThrow({ where: { unidadeId: unidade.id } })
      expect(saida.usuarioId).toBe(atendente.id)
    }
    expect(await eventosDe(prisma, 'SAIDA_CONFIRMADA')).toHaveLength(2)
  })

  it('não grava LEITURA_QR_SAIDA: confirmar não é ler (RF12)', async () => {
    const unidade = await novaUnidade(10)

    const resposta = await finalizar([unidade.id])

    expect(resposta.json().itens[0].veredito).toBe('CONFIRMAR')
    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(0)
  })

  it('responde um item por unidade, na ordem do corpo, com o veredito e o produto', async () => {
    const primeira = await novaUnidade(40)
    const segunda = await novaUnidade(10)

    const corpo = (await finalizar([primeira.id, segunda.id])).json()

    expect(corpo.itens).toHaveLength(2)
    expect(corpo.itens.map((item: { unidadeId: string }) => item.unidadeId)).toEqual([primeira.id, segunda.id])
    for (const item of corpo.itens) {
      // Cada item tem o mesmo formato da resposta de `/saidas/ler`, mais o id:
      // a tela lê o veredito por item, e não um resumo do carrinho (RNF04).
      expect(item).toMatchObject({ veredito: 'CONFIRMAR', mensagem: expect.any(String) })
      expect(item.unidade.produto).toMatchObject({ id: perfume.id, nome: perfume.nome })
    }
  })

  it('processa por validade crescente, decidida no servidor: o carrinho não bloqueia a si mesmo', async () => {
    // Corpo com a de fevereiro antes da de janeiro. Processada na ordem do
    // corpo, a de fevereiro seria barrada pela de janeiro, ainda EM_ESTOQUE.
    // Ordenar a fila não é decidir veredito: o veredito de cada item continua
    // vindo de `validarSaidaFifo`.
    const fevereiro = await novaUnidade(40)
    const janeiro = await novaUnidade(10)

    const corpo = (await finalizar([fevereiro.id, janeiro.id])).json()

    expect(corpo.itens.map((item: { veredito: string }) => item.veredito)).toEqual(['CONFIRMAR', 'CONFIRMAR'])
    expect(await eventosDe(prisma, 'ALERTA_FIFO_DISPARADO')).toHaveLength(0)
  })

  it('resultado parcial: o item barrado não desfaz os confirmados', async () => {
    // Cada item é um ciclo independente, numa transação própria (PRD 6.2).
    const outra = await criarUsuario(prisma, Papel.ATENDENTE)
    const livre = await novaUnidade(10)
    const disputada = await novaUnidade(10)
    await finalizar([disputada.id], outra)

    const resposta = await finalizar([livre.id, disputada.id])
    const corpo = resposta.json()

    expect(resposta.statusCode).toBe(200)
    expect(corpo.itens[0]).toMatchObject({ unidadeId: livre.id, veredito: 'CONFIRMAR' })
    expect(corpo.itens[1]).toMatchObject({
      unidadeId: disputada.id,
      veredito: 'ERRO',
      motivo: 'UNIDADE_JA_BAIXADA',
    })
    expect((await recarregar(livre)).status).toBe(StatusUnidade.VENDIDA)
    const saidaDaDisputada = await prisma.saida.findUniqueOrThrow({ where: { unidadeId: disputada.id } })
    expect(saidaDaDisputada.usuarioId).toBe(outra.id)
  })

  it('revalida em vez de confiar no carrinho: unidade vencida volta como EXCECAO_VENCIDO e não é vendida', async () => {
    const vencida = await novaUnidade(-2)
    const valida = await novaUnidade(10)

    const corpo = (await finalizar([vencida.id, valida.id])).json()

    expect(corpo.itens[0]).toMatchObject({ unidadeId: vencida.id, veredito: 'EXCECAO_VENCIDO' })
    expect(corpo.itens[1]).toMatchObject({ unidadeId: valida.id, veredito: 'CONFIRMAR' })
    expect((await recarregar(vencida)).status).toBe(StatusUnidade.EM_ESTOQUE)
  })

  it('unidade de validade menor que chegou depois da leitura: BLOQUEAR_FIFO apontando a nova', async () => {
    const fevereiro = await novaUnidade(40)
    expect((await ler(fevereiro.codigoQr)).json().veredito).toBe('CONFIRMAR')
    const janeiroQueChegou = await novaUnidade(10)

    const corpo = (await finalizar([fevereiro.id])).json()

    expect(corpo.itens[0]).toMatchObject({ unidadeId: fevereiro.id, veredito: 'BLOQUEAR_FIFO' })
    expect(corpo.itens[0].unidadeCorreta.id).toBe(janeiroQueChegou.id)
    expect((await recarregar(fevereiro)).status).toBe(StatusUnidade.EM_ESTOQUE)
  })

  it('grava o agrupador do atendimento em cada Saida', async () => {
    const sessao = randomUUID()
    const primeira = await novaUnidade(10)
    const segunda = await novaUnidade(20)

    await finalizar([primeira.id, segunda.id], atendente, sessao)

    const saidas = await prisma.saida.findMany()
    expect(saidas.map((s) => s.sessaoVendaId)).toEqual([sessao, sessao])
  })

  it('sem agrupador, a Saida fica com sessaoVendaId nulo', async () => {
    const unidade = await novaUnidade(10)

    await finalizar([unidade.id])

    expect((await prisma.saida.findUniqueOrThrow({ where: { unidadeId: unidade.id } })).sessaoVendaId).toBeNull()
  })
})

describe('POST /saidas/finalizar — o atendimento inteiro pela API', () => {
  it('bloqueio, leitura certa, segunda unidade no carrinho, confirmação', async () => {
    // A jornada J2 com carrinho: a atendente pega o frasco errado, é barrada,
    // pega o certo, e o cliente leva também um segundo frasco do mesmo
    // perfume. As duas leituras liberadas vão para o carrinho, e a venda
    // acontece de uma vez.
    const janeiro = await novaUnidade(10)
    const fevereiro = await novaUnidade(40)

    expect((await ler(fevereiro.codigoQr)).json().veredito).toBe('BLOQUEAR_FIFO')
    expect((await ler(janeiro.codigoQr)).json().veredito).toBe('CONFIRMAR')
    expect((await ler(fevereiro.codigoQr, [janeiro.id])).json().veredito).toBe('CONFIRMAR')
    expect(await prisma.saida.count()).toBe(0)

    const corpo = (await finalizar([janeiro.id, fevereiro.id])).json()

    expect(corpo.itens.map((item: { veredito: string }) => item.veredito)).toEqual(['CONFIRMAR', 'CONFIRMAR'])
    const saidaDe = (unidade: UnidadeProduto) =>
      prisma.saida.findUniqueOrThrow({ where: { unidadeId: unidade.id } })
    expect(await saidaDe(janeiro)).toMatchObject({ tentativasAteAcerto: 1, alertaFifoDisparado: true })
    expect(await saidaDe(fevereiro)).toMatchObject({ tentativasAteAcerto: 0, alertaFifoDisparado: false })
    // Três leituras, duas vendas: o denominador da RF12 conta leituras, não
    // confirmações.
    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(3)
  })

  it('confirmar duas vezes o mesmo carrinho não vende duas vezes', async () => {
    // A tela pode reenviar depois de uma queda de rede no meio da resposta.
    const unidade = await novaUnidade(10)

    await finalizar([unidade.id])
    const segunda = (await finalizar([unidade.id])).json()

    expect(segunda.itens[0]).toMatchObject({ veredito: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
    expect(await prisma.saida.count()).toBe(1)
  })
})
