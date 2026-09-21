import bcrypt from 'bcryptjs'
import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Sem banco (convenção de T14b: arquivo solto). O que se prova aqui é
// autorização, auto-proteção e o que **não** aparece nas respostas — nada
// disso depende de persistência.
vi.mock('../src/db/prisma.js', () => ({
  prisma: {
    usuario: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from '../src/db/prisma.js'
import { buildApp } from '../src/buildApp.js'
import { NOME_COOKIE_SESSAO } from '../src/modules/auth/cookie.js'
import { EMAIL_DO_SISTEMA } from '../src/modules/alerta/usuarioDoSistema.js'

const buscar = vi.mocked(prisma.usuario.findUnique)
const listar = vi.mocked(prisma.usuario.findMany)
const criar = vi.mocked(prisma.usuario.create)
const atualizar = vi.mocked(prisma.usuario.update)

const SENHA = 'senha-de-teste-2026'
const SENHA_HASH = bcrypt.hashSync(SENHA, 10)

const GESTOR = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Gestora de Loja',
  email: 'gestor@estoque.local',
  senhaHash: SENHA_HASH,
  papel: Papel.GESTOR,
  ativo: true,
}

const ATENDENTE = {
  id: '22222222-2222-2222-2222-222222222222',
  nome: 'Atendente de Balcão',
  email: 'atendente@estoque.local',
  senhaHash: SENHA_HASH,
  papel: Papel.ATENDENTE,
  ativo: true,
}

const SISTEMA = {
  id: '33333333-3333-3333-3333-333333333333',
  nome: 'Sistema (varredura automática)',
  email: EMAIL_DO_SISTEMA,
  senhaHash: 'sem-senha:conta-de-sistema-nao-autentica',
  papel: Papel.ATENDENTE,
  ativo: true,
}

const CONHECIDOS = [GESTOR, ATENDENTE, SISTEMA]

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  // Busca por e-mail (login) e por id (as rotas de gestão) atendidas pelo
  // mesmo mock, para que um teste possa logar e agir na mesma requisição.
  buscar.mockImplementation((argumentos: { where: { email?: string; id?: string } }) => {
    const { email, id } = argumentos.where
    const achado = CONHECIDOS.find((u) => (email ? u.email === email : u.id === id))
    return Promise.resolve(achado ?? null) as never
  })
  atualizar.mockImplementation(((argumentos: { where: { id: string }; data: object }) => {
    const alvo = CONHECIDOS.find((u) => u.id === argumentos.where.id) ?? GESTOR
    return Promise.resolve({ ...alvo, ...argumentos.data })
  }) as never)
  app = buildApp()
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

async function logar(usuario: typeof GESTOR): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: usuario.email, senha: SENHA },
  })
  const cookie = resposta.cookies.find((c) => c.name === NOME_COOKIE_SESSAO)
  if (!cookie) throw new Error(`login falhou: ${resposta.statusCode} ${resposta.body}`)
  return cookie.value
}

function comSessao(cookie: string) {
  return { [NOME_COOKIE_SESSAO]: cookie }
}

describe('autorização das rotas de usuário', () => {
  it.each([
    ['GET', '/usuarios', undefined],
    ['POST', '/usuarios', { nome: 'X', email: 'x@y.com', papel: 'ATENDENTE', senha: SENHA }],
    ['PATCH', `/usuarios/${GESTOR.id}`, { nome: 'Outro nome' }],
    ['PATCH', `/usuarios/${GESTOR.id}/senha`, { senha: SENHA }],
  ])('recusa %s %s sem sessão, com 401', async (method, url, payload) => {
    const resposta = await app.inject({ method: method as 'GET', url, payload })

    expect(resposta.statusCode).toBe(401)
  })

  it.each([
    ['GET', '/usuarios', undefined],
    ['POST', '/usuarios', { nome: 'X', email: 'x@y.com', papel: 'ATENDENTE', senha: SENHA }],
    ['PATCH', `/usuarios/${GESTOR.id}`, { nome: 'Outro nome' }],
    ['PATCH', `/usuarios/${GESTOR.id}/senha`, { senha: SENHA }],
  ])('recusa %s %s para ATENDENTE, com 403', async (method, url, payload) => {
    const cookie = await logar(ATENDENTE)

    const resposta = await app.inject({
      method: method as 'GET',
      url,
      payload,
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(403)
    expect(resposta.json()).toMatchObject({ erro: 'PAPEL_INSUFICIENTE' })
  })
})

describe('GET /usuarios', () => {
  it('não devolve senhaHash de ninguém', async () => {
    listar.mockResolvedValue([GESTOR, ATENDENTE] as never)
    const cookie = await logar(GESTOR)

    const resposta = await app.inject({ method: 'GET', url: '/usuarios', cookies: comSessao(cookie) })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.body).not.toContain('senhaHash')
    expect(resposta.body).not.toContain(SENHA_HASH)
    expect(resposta.json().usuarios).toHaveLength(2)
  })

  // A conta que assina a varredura (T18) não é uma pessoa da loja.
  it('exclui a conta de sistema da consulta', async () => {
    listar.mockResolvedValue([] as never)
    const cookie = await logar(GESTOR)

    await app.inject({ method: 'GET', url: '/usuarios', cookies: comSessao(cookie) })

    expect(listar.mock.calls[0][0]).toMatchObject({
      where: { email: { not: EMAIL_DO_SISTEMA }, ativo: true },
    })
  })

  it('inclui inativos quando pedido', async () => {
    listar.mockResolvedValue([] as never)
    const cookie = await logar(GESTOR)

    await app.inject({
      method: 'GET',
      url: '/usuarios?incluirInativos=true',
      cookies: comSessao(cookie),
    })

    expect(listar.mock.calls[0][0]?.where).not.toHaveProperty('ativo')
  })
})

describe('POST /usuarios', () => {
  const NOVA = { nome: '  Nova Atendente  ', email: '  Nova@Loja.COM ', papel: 'ATENDENTE' }

  it('cria e responde 201 sem devolver a senha', async () => {
    criar.mockImplementation(((a: { data: object }) =>
      Promise.resolve({ id: 'novo', ativo: true, ...a.data })) as never)
    const cookie = await logar(GESTOR)

    const resposta = await app.inject({
      method: 'POST',
      url: '/usuarios',
      payload: { ...NOVA, senha: SENHA },
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(201)
    expect(resposta.body).not.toContain(SENHA)
    expect(resposta.body).not.toContain('senhaHash')
  })

  // Sem isto, `Nova@Loja.COM` e `nova@loja.com` viram duas contas para o
  // Postgres e a mesma pessoa para a loja — o `@unique` não pega a caixa.
  it('normaliza e-mail e nome antes de gravar, e grava hash', async () => {
    criar.mockImplementation(((a: { data: object }) =>
      Promise.resolve({ id: 'novo', ativo: true, ...a.data })) as never)
    const cookie = await logar(GESTOR)

    await app.inject({
      method: 'POST',
      url: '/usuarios',
      payload: { ...NOVA, senha: SENHA },
      cookies: comSessao(cookie),
    })

    const gravado = criar.mock.calls[0][0].data as { email: string; nome: string; senhaHash: string }
    expect(gravado.email).toBe('nova@loja.com')
    expect(gravado.nome).toBe('Nova Atendente')
    expect(gravado.senhaHash).not.toBe(SENHA)
    expect(await bcrypt.compare(SENHA, gravado.senhaHash)).toBe(true)
  })

  it('recusa senha curta com mensagem que diz o mínimo', async () => {
    const cookie = await logar(GESTOR)

    const resposta = await app.inject({
      method: 'POST',
      url: '/usuarios',
      payload: { ...NOVA, senha: 'curta' },
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json()).toMatchObject({ erro: 'SENHA_CURTA' })
    expect(resposta.json().mensagem).toContain('12')
    expect(criar).not.toHaveBeenCalled()
  })

  it('recusa e-mail já usado com 409', async () => {
    const { Prisma } = await import('@prisma/client')
    criar.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'teste',
      }),
    )
    const cookie = await logar(GESTOR)

    const resposta = await app.inject({
      method: 'POST',
      url: '/usuarios',
      payload: { ...NOVA, senha: SENHA },
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(409)
    expect(resposta.json()).toMatchObject({ erro: 'EMAIL_EM_USO' })
  })
})

describe('PATCH /usuarios/:id — auto-proteção', () => {
  it('permite ao gestor mudar o próprio nome', async () => {
    const cookie = await logar(GESTOR)

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${GESTOR.id}`,
      payload: { nome: 'Gestora com outro nome' },
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(200)
  })

  // O último gestor que se rebaixa tranca a loja para fora da gestão.
  it.each([
    ['rebaixar', { papel: 'ATENDENTE' }],
    ['desativar', { ativo: false }],
  ])('recusa o gestor %s a si mesmo', async (_caso, payload) => {
    const cookie = await logar(GESTOR)

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${GESTOR.id}`,
      payload,
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(409)
    expect(resposta.json()).toMatchObject({ erro: 'ALVO_E_VOCE_MESMO' })
    expect(atualizar).not.toHaveBeenCalled()
  })

  it('permite desativar outra pessoa', async () => {
    const cookie = await logar(GESTOR)

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${ATENDENTE.id}`,
      payload: { ativo: false },
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().usuario).toMatchObject({ ativo: false })
  })

  it('recusa qualquer escrita na conta de sistema', async () => {
    const cookie = await logar(GESTOR)

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${SISTEMA.id}`,
      payload: { nome: 'Sistema renomeado' },
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(403)
    expect(resposta.json()).toMatchObject({ erro: 'CONTA_DE_SISTEMA' })
    expect(atualizar).not.toHaveBeenCalled()
  })

  it('responde 404 para id inexistente', async () => {
    const cookie = await logar(GESTOR)

    const resposta = await app.inject({
      method: 'PATCH',
      url: '/usuarios/44444444-4444-4444-4444-444444444444',
      payload: { nome: 'Fantasma' },
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(404)
  })
})

describe('PATCH /usuarios/:id/senha — redefinição pelo gestor', () => {
  it('redefine a senha de outra pessoa e responde 204 sem corpo', async () => {
    const cookie = await logar(GESTOR)

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${ATENDENTE.id}/senha`,
      payload: { senha: 'senha-nova-da-atendente' },
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(204)
    expect(resposta.body).toBe('')

    const { senhaHash } = atualizar.mock.calls[0][0].data as { senhaHash: string }
    expect(await bcrypt.compare('senha-nova-da-atendente', senhaHash)).toBe(true)
  })

  // A própria senha sempre exige a atual, inclusive para o gestor: a regra
  // fica fácil de explicar, e quem perdeu a própria senha não está logado.
  it('recusa redefinir a própria senha por aqui', async () => {
    const cookie = await logar(GESTOR)

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${GESTOR.id}/senha`,
      payload: { senha: 'outra-senha-bem-longa' },
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(409)
    expect(resposta.json()).toMatchObject({ erro: 'ALVO_E_VOCE_MESMO' })
    expect(atualizar).not.toHaveBeenCalled()
  })

  it('recusa redefinir a senha da conta de sistema', async () => {
    const cookie = await logar(GESTOR)

    const resposta = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${SISTEMA.id}/senha`,
      payload: { senha: 'senha-longa-o-suficiente' },
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(403)
    expect(atualizar).not.toHaveBeenCalled()
  })
})

describe('PATCH /usuarios/eu/senha — troca da própria senha', () => {
  it('troca quando a senha atual confere, para qualquer papel', async () => {
    const cookie = await logar(ATENDENTE)

    const resposta = await app.inject({
      method: 'PATCH',
      url: '/usuarios/eu/senha',
      payload: { senhaAtual: SENHA, senhaNova: 'minha-senha-nova-2026' },
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(204)
    const { senhaHash } = atualizar.mock.calls[0][0].data as { senhaHash: string }
    expect(await bcrypt.compare('minha-senha-nova-2026', senhaHash)).toBe(true)
  })

  it('recusa com 401 quando a senha atual está errada', async () => {
    const cookie = await logar(ATENDENTE)

    const resposta = await app.inject({
      method: 'PATCH',
      url: '/usuarios/eu/senha',
      payload: { senhaAtual: 'nao-e-a-minha-senha', senhaNova: 'minha-senha-nova-2026' },
      cookies: comSessao(cookie),
    })

    expect(resposta.statusCode).toBe(401)
    expect(resposta.json()).toMatchObject({ erro: 'SENHA_ATUAL_INCORRETA' })
    expect(atualizar).not.toHaveBeenCalled()
  })

  it('troca a senha de quem está na sessão, não a de um id enviado pelo cliente', async () => {
    const cookie = await logar(ATENDENTE)

    await app.inject({
      method: 'PATCH',
      url: '/usuarios/eu/senha',
      payload: { senhaAtual: SENHA, senhaNova: 'minha-senha-nova-2026' },
      cookies: comSessao(cookie),
    })

    expect(atualizar.mock.calls[0][0].where).toEqual({ id: ATENDENTE.id })
  })
})

describe('conta inativa', () => {
  // Sem isto a coluna seria decoração: a atendente desligada continuaria
  // entrando com a senha que já tinha.
  it('não autentica, e recusa igual a senha errada', async () => {
    const desligada = { ...ATENDENTE, ativo: false }
    buscar.mockImplementation((a: { where: { email?: string } }) =>
      Promise.resolve(a.where.email === desligada.email ? desligada : null) as never,
    )

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: desligada.email, senha: SENHA },
    })

    expect(resposta.statusCode).toBe(401)
    expect(resposta.json()).toMatchObject({ erro: 'CREDENCIAL_INVALIDA' })
  })
})
