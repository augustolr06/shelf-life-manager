/**
 * EventoLog como instrumento de pesquisa (RF12, RNF05) e o que falta do
 * registro de saída (RF07).
 *
 * Roda contra PostgreSQL de verdade porque o objeto de teste está no banco: a
 * garantia de append-only é um trigger, e um duplo do Prisma que "simulasse" a
 * recusa estaria só repetindo a resposta que se quer verificar — foi
 * exatamente esse o argumento de T06 para trocar mock por banco real.
 *
 * Contrato: tasks/T09-registro-saida-evento-log.md · docs/arquitetura.md seções 3 a 5.
 */

import { randomUUID } from 'node:crypto'
import { Papel, type PrismaClient, type Produto, type Usuario } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/db/prisma.js', async () => {
  const { clienteCompartilhadoDeTeste } = await import('../apoio/bancoDeTeste.js')
  return { prisma: clienteCompartilhadoDeTeste() }
})

import { buildApp } from '../../src/buildApp.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { cookieDeSessao, criarProduto, criarUnidade, criarUsuario, emDias, eventosDe } from '../apoio/cenario.js'

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

/** Um evento qualquer, para ter o que tentar alterar. */
function gravarEvento() {
  return prisma.eventoLog.create({
    data: {
      tipoEvento: 'LEITURA_QR_SAIDA',
      usuarioId: atendente.id,
      payload: { codigoQr: 'PRF-AAAAAA' },
    },
  })
}

describe('EventoLog é append-only (RNF05)', () => {
  it('aceita INSERT', async () => {
    const evento = await gravarEvento()

    expect(evento.id).toBeDefined()
    expect(await prisma.eventoLog.count()).toBe(1)
  })

  it('recusa UPDATE pelo client do Prisma', async () => {
    const evento = await gravarEvento()

    await expect(
      prisma.eventoLog.update({ where: { id: evento.id }, data: { tipoEvento: 'SAIDA_CONFIRMADA' } }),
    ).rejects.toThrow(/append-only/i)

    const preservado = await prisma.eventoLog.findUniqueOrThrow({ where: { id: evento.id } })
    expect(preservado.tipoEvento).toBe('LEITURA_QR_SAIDA')
  })

  it('recusa DELETE pelo client do Prisma', async () => {
    const evento = await gravarEvento()

    await expect(prisma.eventoLog.delete({ where: { id: evento.id } })).rejects.toThrow(/append-only/i)
    expect(await prisma.eventoLog.count()).toBe(1)
  })

  it('recusa UPDATE e DELETE em SQL cru — a trava não é do código da aplicação', async () => {
    await gravarEvento()

    // É este o caminho que motiva o trigger: quem chega por `psql` ou pelo
    // Prisma Studio no meio do piloto não passa por módulo nenhum.
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "EventoLog" SET "tipoEvento" = 'ADULTERADO'`),
    ).rejects.toThrow(/append-only/i)
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "EventoLog"`)).rejects.toThrow(/append-only/i)

    expect(await prisma.eventoLog.count()).toBe(1)
  })

  it('recusa também a alteração em massa, não só a de uma linha', async () => {
    await gravarEvento()
    await gravarEvento()

    await expect(
      prisma.eventoLog.updateMany({ data: { usuarioId: gestor.id } }),
    ).rejects.toThrow(/append-only/i)
    await expect(prisma.eventoLog.deleteMany({})).rejects.toThrow(/append-only/i)

    expect(await prisma.eventoLog.count()).toBe(2)
  })

  it('a mensagem da recusa cita a RNF05 e a operação — quem esbarrar nela precisa entender', async () => {
    const evento = await gravarEvento()

    await expect(
      prisma.eventoLog.update({ where: { id: evento.id }, data: { payload: {} } }),
    ).rejects.toThrow(/RNF05.*UPDATE|UPDATE.*RNF05/s)
  })
})

describe('UNIDADE_CADASTRADA (RF12)', () => {
  function receber(unidades: { dataValidade: string; quantidade?: number }[]) {
    return app.inject({
      method: 'POST',
      url: `/produtos/${perfume.id}/unidades`,
      cookies: cookieDeSessao(app, gestor),
      payload: { unidades },
    })
  }

  /** Uma data de calendário `AAAA-MM-DD`, como a API a recebe. */
  function validadeEmDias(dias: number): string {
    return emDias(dias).toISOString().slice(0, 10)
  }

  it('grava um evento por unidade cadastrada, não um por lote', async () => {
    const resposta = await receber([
      { dataValidade: validadeEmDias(200), quantidade: 2 },
      { dataValidade: validadeEmDias(400) },
    ])

    expect(resposta.statusCode).toBe(201)

    const eventos = await eventosDe(prisma, 'UNIDADE_CADASTRADA')
    expect(eventos).toHaveLength(3)
  })

  it('cada evento aponta a unidade, o produto e quem registrou', async () => {
    const resposta = await receber([{ dataValidade: validadeEmDias(200) }])
    const [unidade] = resposta.json().unidades as { id: string; codigoQr: string }[]

    const [evento] = await eventosDe(prisma, 'UNIDADE_CADASTRADA')

    expect(evento).toMatchObject({
      unidadeId: unidade?.id,
      produtoId: perfume.id,
      usuarioId: gestor.id,
    })
  })

  it('o payload leva o código, a validade como texto de calendário e o tamanho do lote', async () => {
    const validade = validadeEmDias(200)
    const resposta = await receber([{ dataValidade: validade, quantidade: 3 }])
    const [primeira] = resposta.json().unidades as { codigoQr: string }[]

    const eventos = await eventosDe(prisma, 'UNIDADE_CADASTRADA')
    const payloads = eventos.map((e) => e.payload as Record<string, unknown>)

    expect(payloads).toContainEqual({
      codigoQr: primeira?.codigoQr,
      // Texto `AAAA-MM-DD`, nunca instante: serializada como instante, a data
      // voltaria da análise sujeita a escorregar um dia por fuso (RNF01).
      dataValidade: validade,
      unidadesNoLote: 3,
    })
  })

  it('lote recusado não deixa evento de cadastro que não aconteceu', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: `/produtos/${randomUUID()}/unidades`,
      cookies: cookieDeSessao(app, gestor),
      payload: { unidades: [{ dataValidade: validadeEmDias(200) }] },
    })

    expect(resposta.statusCode).toBe(404)
    expect(await eventosDe(prisma, 'UNIDADE_CADASTRADA')).toHaveLength(0)
  })
})

describe('sessaoVendaId no registro de saída (RF07)', () => {
  function ler(codigoQr: string, sessaoVendaId?: string) {
    return app.inject({
      method: 'POST',
      url: '/saidas/ler',
      cookies: cookieDeSessao(app, atendente),
      payload: { codigoQr, ...(sessaoVendaId === undefined ? {} : { sessaoVendaId }) },
    })
  }

  function novaUnidade(diasAteVencer: number) {
    return criarUnidade(prisma, {
      produtoId: perfume.id,
      registradoPorId: atendente.id,
      diasAteVencer,
    })
  }

  it('grava o agrupador na Saida quando o cliente o envia', async () => {
    const unidade = await novaUnidade(30)
    const sessao = randomUUID()

    const resposta = await ler(unidade.codigoQr, sessao)

    expect(resposta.json().veredito).toBe('CONFIRMAR')
    const saida = await prisma.saida.findUniqueOrThrow({ where: { unidadeId: unidade.id } })
    expect(saida.sessaoVendaId).toBe(sessao)
  })

  it('a Saida fica com sessaoVendaId nulo quando o campo não vem', async () => {
    const unidade = await novaUnidade(30)

    await ler(unidade.codigoQr)

    const saida = await prisma.saida.findUniqueOrThrow({ where: { unidadeId: unidade.id } })
    expect(saida.sessaoVendaId).toBeNull()
  })

  it('a leitura bloqueada também fica atribuída ao atendimento', async () => {
    // Sem isso, o denominador de "quantos atendimentos esbarraram no FIFO"
    // (RF13) contaria só as leituras que deram certo.
    await novaUnidade(10)
    const errada = await novaUnidade(90)
    const sessao = randomUUID()

    const resposta = await ler(errada.codigoQr, sessao)

    expect(resposta.json().veredito).toBe('BLOQUEAR_FIFO')
    const [leitura] = await eventosDe(prisma, 'LEITURA_QR_SAIDA')
    expect((leitura?.payload as Record<string, unknown>).sessaoVendaId).toBe(sessao)
  })

  it('a chave existe no payload mesmo sem agrupador, com valor nulo', async () => {
    const unidade = await novaUnidade(30)

    await ler(unidade.codigoQr)

    // Chave que às vezes falta no JSON é armadilha na hora da análise.
    const [leitura] = await eventosDe(prisma, 'LEITURA_QR_SAIDA')
    expect(leitura?.payload as Record<string, unknown>).toHaveProperty('sessaoVendaId', null)
  })

  it('recusa agrupador malformado com 400, e nenhuma leitura é registrada', async () => {
    const unidade = await novaUnidade(30)

    const resposta = await ler(unidade.codigoQr, 'atendimento-42')

    // Assimetria deliberada com o `codigoQr`, que T08 decidiu não recusar: um
    // código torto vem do mundo físico e é dado da pesquisa; um agrupador
    // torto só vem de cliente quebrado, e aceitá-lo produziria relatório de
    // atendimento errado sem nenhum sinal.
    expect(resposta.statusCode).toBe(400)
    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(0)
    expect(await prisma.saida.count()).toBe(0)
  })
})
