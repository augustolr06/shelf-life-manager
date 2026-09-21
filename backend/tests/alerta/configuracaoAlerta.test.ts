/**
 * CRUD da configuração de alerta proativo (RF08, T17).
 *
 * Roda contra PostgreSQL de verdade como as suítes de T06–T13. Aqui não há
 * lock nem comparação de `DATE` a exercitar, mas há duas coisas que só o banco
 * responde: que o `DELETE` **não apaga a linha** (o corpo da resposta não
 * prova isso) e que a recusa de antecedência duplicada é do estado
 * persistido, não de um duplo de teste.
 *
 * Contrato: tasks/T17-configuracao-alerta.md · docs/arquitetura.md seção 5.
 */

import { Papel, type PrismaClient, type Usuario } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/db/prisma.js', async () => {
  const { clienteCompartilhadoDeTeste } = await import('../apoio/bancoDeTeste.js')
  return { prisma: clienteCompartilhadoDeTeste() }
})

import { buildApp } from '../../src/buildApp.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { cookieDeSessao, criarUsuario } from '../apoio/cenario.js'

const ROTA = '/configuracao-alerta'

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

function comoGestor(opcoes: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: unknown }) {
  return app.inject({ ...opcoes, cookies: cookieDeSessao(app, gestor) })
}

function criar(diasAntecedencia: number, canal = 'IN_APP') {
  return comoGestor({ method: 'POST', url: ROTA, payload: { diasAntecedencia, canal } })
}

describe('POST /configuracao-alerta', () => {
  it('cria a janela e devolve 201 com o que foi persistido', async () => {
    const resposta = await criar(30)

    expect(resposta.statusCode).toBe(201)
    const { configuracao } = resposta.json()
    expect(configuracao).toMatchObject({ diasAntecedencia: 30, canal: 'IN_APP' })

    const noBanco = await prisma.configuracaoAlerta.findUniqueOrThrow({
      where: { id: configuracao.id },
    })
    expect(noBanco.diasAntecedencia).toBe(30)
    expect(noBanco.canal).toBe('IN_APP')
  })

  it('nasce ativa sem que o corpo diga nada sobre isso', async () => {
    const resposta = await criar(15)

    expect(resposta.json().configuracao.ativo).toBe(true)
  })

  it('aceita os três canais e recusa qualquer outro', async () => {
    for (const [indice, canal] of ['IN_APP', 'PUSH', 'AMBOS'].entries()) {
      const resposta = await criar(10 + indice, canal)
      expect(resposta.statusCode).toBe(201)
      expect(resposta.json().configuracao.canal).toBe(canal)
    }

    const recusada = await criar(90, 'SMS')
    expect(recusada.statusCode).toBe(400)
    expect(recusada.json().erro).toBe('CORPO_INVALIDO')
  })

  it('aceita as bordas 1 e 365 e recusa 0, 366 e não-inteiro', async () => {
    expect((await criar(1)).statusCode).toBe(201)
    expect((await criar(365)).statusCode).toBe(201)

    for (const invalido of [0, 366, 7.5]) {
      const resposta = await criar(invalido)
      expect(resposta.statusCode, `dias = ${invalido}`).toBe(400)
      expect(resposta.json().erro).toBe('CORPO_INVALIDO')
    }
  })
})

describe('GET /configuracao-alerta', () => {
  it('lista vazia é 200, não 404', async () => {
    const resposta = await comoGestor({ method: 'GET', url: ROTA })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().configuracoes).toEqual([])
  })

  it('ordena da janela mais larga para a mais estreita e inclui as inativas', async () => {
    await criar(7)
    await criar(60)
    const media = await criar(30)
    await comoGestor({ method: 'DELETE', url: `${ROTA}/${media.json().configuracao.id}` })

    const { configuracoes } = (await comoGestor({ method: 'GET', url: ROTA })).json()

    expect(configuracoes.map((c: { diasAntecedencia: number }) => c.diasAntecedencia)).toEqual([60, 30, 7])
    // A inativa vem junto: sem ela na lista, a interface não teria como
    // reativá-la, e inativar é o desfazer do DELETE.
    expect(configuracoes.map((c: { ativo: boolean }) => c.ativo)).toEqual([true, false, true])
  })
})

describe('PATCH /configuracao-alerta/:id', () => {
  it('altera cada um dos três campos', async () => {
    const { id } = (await criar(30)).json().configuracao

    const dias = await comoGestor({ method: 'PATCH', url: `${ROTA}/${id}`, payload: { diasAntecedencia: 45 } })
    expect(dias.json().configuracao.diasAntecedencia).toBe(45)

    const canal = await comoGestor({ method: 'PATCH', url: `${ROTA}/${id}`, payload: { canal: 'AMBOS' } })
    expect(canal.json().configuracao.canal).toBe('AMBOS')

    const situacao = await comoGestor({ method: 'PATCH', url: `${ROTA}/${id}`, payload: { ativo: false } })
    expect(situacao.json().configuracao.ativo).toBe(false)

    const noBanco = await prisma.configuracaoAlerta.findUniqueOrThrow({ where: { id } })
    expect(noBanco).toMatchObject({ diasAntecedencia: 45, canal: 'AMBOS', ativo: false })
  })

  it('recusa corpo vazio com o formato de erro da API', async () => {
    const { id } = (await criar(30)).json().configuracao

    const resposta = await comoGestor({ method: 'PATCH', url: `${ROTA}/${id}`, payload: {} })

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('CORPO_INVALIDO')
  })

  it('id inexistente é 404 CONFIGURACAO_NAO_ENCONTRADA', async () => {
    const resposta = await comoGestor({
      method: 'PATCH',
      url: `${ROTA}/8f1d0f7a-0000-4000-8000-000000000000`,
      payload: { diasAntecedencia: 10 },
    })

    expect(resposta.statusCode).toBe(404)
    expect(resposta.json().erro).toBe('CONFIGURACAO_NAO_ENCONTRADA')
  })
})

describe('DELETE /configuracao-alerta/:id', () => {
  it('inativa e mantém a linha no banco', async () => {
    const { id } = (await criar(30)).json().configuracao

    const resposta = await comoGestor({ method: 'DELETE', url: `${ROTA}/${id}` })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().configuracao.ativo).toBe(false)

    // O corpo da resposta não prova que a linha sobreviveu — o `Alerta` de
    // T18 aponta para ela por FK obrigatória, e apagá-la levaria junto o
    // histórico de alertas emitidos.
    const noBanco = await prisma.configuracaoAlerta.findUnique({ where: { id } })
    expect(noBanco).not.toBeNull()
    expect(noBanco?.ativo).toBe(false)
  })

  it('reativar por PATCH desfaz a inativação', async () => {
    const { id } = (await criar(30)).json().configuracao
    await comoGestor({ method: 'DELETE', url: `${ROTA}/${id}` })

    const resposta = await comoGestor({ method: 'PATCH', url: `${ROTA}/${id}`, payload: { ativo: true } })

    expect(resposta.json().configuracao.ativo).toBe(true)
  })

  it('id inexistente é 404', async () => {
    const resposta = await comoGestor({
      method: 'DELETE',
      url: `${ROTA}/8f1d0f7a-0000-4000-8000-000000000000`,
    })

    expect(resposta.statusCode).toBe(404)
    expect(resposta.json().erro).toBe('CONFIGURACAO_NAO_ENCONTRADA')
  })
})

describe('antecedência duplicada entre configurações ativas', () => {
  it('recusa a segunda ativa com a mesma antecedência', async () => {
    await criar(30)

    // Canal diferente não torna a janela diferente: duas configurações de 30
    // dias fariam T18 gerar dois Alerta para a mesma unidade no mesmo dia.
    const resposta = await criar(30, 'PUSH')

    expect(resposta.statusCode).toBe(409)
    expect(resposta.json().erro).toBe('ANTECEDENCIA_JA_CONFIGURADA')
    expect(await prisma.configuracaoAlerta.count()).toBe(1)
  })

  it('aceita a mesma antecedência quando a anterior está inativa', async () => {
    const { id } = (await criar(30)).json().configuracao
    await comoGestor({ method: 'DELETE', url: `${ROTA}/${id}` })

    const resposta = await criar(30, 'AMBOS')

    expect(resposta.statusCode).toBe(201)
    expect(await prisma.configuracaoAlerta.count()).toBe(2)
  })

  it('recusa reativar uma inativa cuja antecedência voltou a colidir', async () => {
    const { id } = (await criar(30)).json().configuracao
    await comoGestor({ method: 'DELETE', url: `${ROTA}/${id}` })
    await criar(30, 'PUSH')

    // O corpo só traz `ativo`; a colisão é do estado resultante.
    const resposta = await comoGestor({ method: 'PATCH', url: `${ROTA}/${id}`, payload: { ativo: true } })

    expect(resposta.statusCode).toBe(409)
    expect(resposta.json().erro).toBe('ANTECEDENCIA_JA_CONFIGURADA')
  })

  it('recusa mover uma ativa para a antecedência de outra ativa', async () => {
    await criar(30)
    const { id } = (await criar(7)).json().configuracao

    const resposta = await comoGestor({
      method: 'PATCH',
      url: `${ROTA}/${id}`,
      payload: { diasAntecedencia: 30 },
    })

    expect(resposta.statusCode).toBe(409)
  })

  it('alterar o canal da própria configuração não colide consigo mesma', async () => {
    const { id } = (await criar(30)).json().configuracao

    const resposta = await comoGestor({ method: 'PATCH', url: `${ROTA}/${id}`, payload: { canal: 'PUSH' } })

    expect(resposta.statusCode).toBe(200)
  })
})

describe('papel e sessão', () => {
  const chamadas = [
    { method: 'GET' as const, url: ROTA },
    { method: 'POST' as const, url: ROTA, payload: { diasAntecedencia: 30, canal: 'IN_APP' } },
    { method: 'PATCH' as const, url: `${ROTA}/8f1d0f7a-0000-4000-8000-000000000000`, payload: { ativo: false } },
    { method: 'DELETE' as const, url: `${ROTA}/8f1d0f7a-0000-4000-8000-000000000000` },
  ]

  it('recusa a atendente com 403 nas quatro rotas', async () => {
    for (const chamada of chamadas) {
      const resposta = await app.inject({ ...chamada, cookies: cookieDeSessao(app, atendente) })
      expect(resposta.statusCode, `${chamada.method} ${chamada.url}`).toBe(403)
      expect(resposta.json().erro).toBe('PAPEL_INSUFICIENTE')
    }
  })

  it('recusa sem cookie com 401 nas quatro rotas', async () => {
    for (const chamada of chamadas) {
      const resposta = await app.inject(chamada)
      expect(resposta.statusCode, `${chamada.method} ${chamada.url}`).toBe(401)
      expect(resposta.json().erro).toBe('NAO_AUTENTICADO')
    }
  })
})

describe('EventoLog', () => {
  it('nenhuma rota desta tarefa grava evento', async () => {
    const { id } = (await criar(30)).json().configuracao
    await comoGestor({ method: 'PATCH', url: `${ROTA}/${id}`, payload: { diasAntecedencia: 45 } })
    await comoGestor({ method: 'DELETE', url: `${ROTA}/${id}` })
    await comoGestor({ method: 'GET', url: ROTA })

    // Os nove tipos do PRD são lista fechada e nenhum descreve mudança de
    // configuração. A consequência — alterar a janela no meio do piloto não
    // deixa rastro — está declarada em docs/notas-para-artigo.md.
    expect(await prisma.eventoLog.count()).toBe(0)
  })
})
