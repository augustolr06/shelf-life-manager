import bcrypt from 'bcryptjs'
import { Papel, Prisma } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Mesma estratégia de T03: o Prisma Client é substituído por um duplo. O que
// T04 precisa provar é o contrato das rotas (papel, validação, tradução de
// erro do banco em status HTTP), não a persistência. Os testes com banco real
// chegam em T06/T07, onde o objeto de teste é o lock da RNF02.
vi.mock('../src/db/prisma.js', () => ({
  prisma: {
    usuario: { findUnique: vi.fn() },
    produto: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      // Existe no dublê só para que o teste do DELETE possa provar que
      // nenhuma rota o aciona.
      delete: vi.fn(),
    },
  },
}))

import { prisma } from '../src/db/prisma.js'
import { buildApp } from '../src/buildApp.js'
import { NOME_COOKIE_SESSAO } from '../src/modules/auth/cookie.js'

const SENHA = 'estoque123'
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

const ID_PRODUTO = '33333333-3333-3333-3333-333333333333'

const PERFUME = {
  id: ID_PRODUTO,
  codigoInterno: 'PRF-001',
  nome: 'Eau de Parfum 50ml',
  marca: 'Marca Exemplo',
  categoria: 'Perfumaria',
  ativo: true,
}

const DADOS_VALIDOS = {
  codigoInterno: PERFUME.codigoInterno,
  nome: PERFUME.nome,
  marca: PERFUME.marca,
  categoria: PERFUME.categoria,
}

function erroPrisma(code: string) {
  return new Prisma.PrismaClientKnownRequestError('violação simulada', {
    code,
    clientVersion: 'teste',
  })
}

const buscarUsuario = vi.mocked(prisma.usuario.findUnique)
const criar = vi.mocked(prisma.produto.create)
const listar = vi.mocked(prisma.produto.findMany)
const contar = vi.mocked(prisma.produto.count)
const buscar = vi.mocked(prisma.produto.findUnique)
const atualizar = vi.mocked(prisma.produto.update)
const excluir = vi.mocked(prisma.produto.delete)

describe('CRUD de Produto (RF02)', () => {
  let app: FastifyInstance
  let sessaoGestor: string
  let sessaoAtendente: string

  beforeAll(async () => {
    app = buildApp()
    await app.ready()

    sessaoGestor = await logar(GESTOR)
    sessaoAtendente = await logar(ATENDENTE)
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    for (const dublê of [buscarUsuario, criar, listar, contar, buscar, atualizar, excluir]) {
      dublê.mockReset()
    }
  })

  async function logar(usuario: typeof GESTOR): Promise<string> {
    buscarUsuario.mockResolvedValueOnce(usuario)

    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: usuario.email, senha: SENHA },
    })

    const cookie = resposta.cookies.find((c) => c.name === NOME_COOKIE_SESSAO)
    if (!cookie) throw new Error('login não devolveu cookie de sessão')
    return cookie.value
  }

  describe('POST /produtos', () => {
    it('cria o produto e responde 201', async () => {
      criar.mockResolvedValueOnce(PERFUME)

      const resposta = await app.inject({
        method: 'POST',
        url: '/produtos',
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
        payload: DADOS_VALIDOS,
      })

      expect(resposta.statusCode).toBe(201)
      expect(resposta.json()).toEqual({ produto: PERFUME })
    })

    it('normaliza o código interno para maiúsculas e sem espaços', async () => {
      criar.mockResolvedValueOnce(PERFUME)

      await app.inject({
        method: 'POST',
        url: '/produtos',
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
        payload: { ...DADOS_VALIDOS, codigoInterno: '  prf-001 ', nome: ' Eau de Parfum 50ml ' },
      })

      // Sem isso, "prf-001" e "PRF-001" seriam SKUs distintos e a restrição
      // de unicidade não pegaria a duplicata.
      expect(criar).toHaveBeenCalledWith({
        data: { ...DADOS_VALIDOS, codigoInterno: 'PRF-001', nome: 'Eau de Parfum 50ml' },
      })
    })

    it('responde 409 quando o código interno já existe', async () => {
      criar.mockRejectedValueOnce(erroPrisma('P2002'))

      const resposta = await app.inject({
        method: 'POST',
        url: '/produtos',
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
        payload: DADOS_VALIDOS,
      })

      expect(resposta.statusCode).toBe(409)
      expect(resposta.json()).toMatchObject({ erro: 'CODIGO_INTERNO_EM_USO' })
    })

    it('recusa campo obrigatório ausente antes de tocar no banco', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: '/produtos',
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
        payload: { codigoInterno: 'PRF-002', nome: 'Sem marca nem categoria' },
      })

      expect(resposta.statusCode).toBe(400)
      expect(criar).not.toHaveBeenCalled()
    })

    it('recusa campo de texto vazio', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: '/produtos',
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
        payload: { ...DADOS_VALIDOS, nome: '' },
      })

      expect(resposta.statusCode).toBe(400)
      expect(criar).not.toHaveBeenCalled()
    })

    it('bloqueia ATENDENTE com 403', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: '/produtos',
        cookies: { [NOME_COOKIE_SESSAO]: sessaoAtendente },
        payload: DADOS_VALIDOS,
      })

      expect(resposta.statusCode).toBe(403)
      expect(criar).not.toHaveBeenCalled()
    })

    it('bloqueia requisição sem sessão com 401', async () => {
      const resposta = await app.inject({ method: 'POST', url: '/produtos', payload: DADOS_VALIDOS })

      expect(resposta.statusCode).toBe(401)
    })
  })

  describe('GET /produtos', () => {
    beforeEach(() => {
      listar.mockResolvedValue([PERFUME])
      contar.mockResolvedValue(1)
    })

    it('oculta inativos por padrão', async () => {
      const resposta = await app.inject({
        method: 'GET',
        url: '/produtos',
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
      })

      expect(resposta.statusCode).toBe(200)
      expect(resposta.json()).toEqual({
        produtos: [PERFUME],
        total: 1,
        pagina: 1,
        tamanhoPagina: 20,
      })
      expect(listar).toHaveBeenCalledWith(expect.objectContaining({ where: { ativo: true } }))
    })

    it('inclui inativos quando o filtro é explícito', async () => {
      await app.inject({
        method: 'GET',
        url: '/produtos?incluirInativos=true',
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
      })

      expect(listar).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
    })

    it('busca por nome ou código interno, sem diferenciar maiúsculas', async () => {
      await app.inject({
        method: 'GET',
        url: '/produtos?busca=parfum',
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
      })

      expect(listar).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ativo: true,
            OR: [
              { nome: { contains: 'parfum', mode: 'insensitive' } },
              { codigoInterno: { contains: 'parfum', mode: 'insensitive' } },
            ],
          },
        }),
      )
    })

    it('pagina o resultado', async () => {
      const resposta = await app.inject({
        method: 'GET',
        url: '/produtos?pagina=3&tamanhoPagina=10',
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
      })

      expect(listar).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }))
      expect(resposta.json()).toMatchObject({ pagina: 3, tamanhoPagina: 10 })
    })

    it('recusa tamanho de página acima do limite', async () => {
      const resposta = await app.inject({
        method: 'GET',
        url: '/produtos?tamanhoPagina=1000',
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
      })

      expect(resposta.statusCode).toBe(400)
      expect(listar).not.toHaveBeenCalled()
    })

    it('permite ATENDENTE consultar o catálogo', async () => {
      const resposta = await app.inject({
        method: 'GET',
        url: '/produtos',
        cookies: { [NOME_COOKIE_SESSAO]: sessaoAtendente },
      })

      expect(resposta.statusCode).toBe(200)
    })

    it('exige sessão', async () => {
      const resposta = await app.inject({ method: 'GET', url: '/produtos' })

      expect(resposta.statusCode).toBe(401)
    })
  })

  describe('GET /produtos/:id', () => {
    it('devolve o produto', async () => {
      buscar.mockResolvedValueOnce(PERFUME)

      const resposta = await app.inject({
        method: 'GET',
        url: `/produtos/${ID_PRODUTO}`,
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
      })

      expect(resposta.statusCode).toBe(200)
      expect(resposta.json()).toEqual({ produto: PERFUME })
    })

    it('responde 404 para id inexistente', async () => {
      buscar.mockResolvedValueOnce(null)

      const resposta = await app.inject({
        method: 'GET',
        url: `/produtos/${ID_PRODUTO}`,
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
      })

      expect(resposta.statusCode).toBe(404)
      expect(resposta.json()).toMatchObject({ erro: 'PRODUTO_NAO_ENCONTRADO' })
    })
  })

  describe('PATCH /produtos/:id', () => {
    it('altera apenas os campos enviados', async () => {
      atualizar.mockResolvedValueOnce({ ...PERFUME, nome: 'Eau de Parfum 100ml' })

      const resposta = await app.inject({
        method: 'PATCH',
        url: `/produtos/${ID_PRODUTO}`,
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
        payload: { nome: 'Eau de Parfum 100ml' },
      })

      expect(resposta.statusCode).toBe(200)
      expect(atualizar).toHaveBeenCalledWith({
        where: { id: ID_PRODUTO },
        data: { nome: 'Eau de Parfum 100ml' },
      })
    })

    it('reativa um produto inativado por engano', async () => {
      atualizar.mockResolvedValueOnce(PERFUME)

      await app.inject({
        method: 'PATCH',
        url: `/produtos/${ID_PRODUTO}`,
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
        payload: { ativo: true },
      })

      expect(atualizar).toHaveBeenCalledWith({
        where: { id: ID_PRODUTO },
        data: { ativo: true },
      })
    })

    it('responde 404 para produto inexistente', async () => {
      atualizar.mockRejectedValueOnce(erroPrisma('P2025'))

      const resposta = await app.inject({
        method: 'PATCH',
        url: `/produtos/${ID_PRODUTO}`,
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
        payload: { nome: 'Qualquer' },
      })

      expect(resposta.statusCode).toBe(404)
    })

    it('responde 409 quando o novo código interno já pertence a outro produto', async () => {
      atualizar.mockRejectedValueOnce(erroPrisma('P2002'))

      const resposta = await app.inject({
        method: 'PATCH',
        url: `/produtos/${ID_PRODUTO}`,
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
        payload: { codigoInterno: 'PRF-002' },
      })

      expect(resposta.statusCode).toBe(409)
      expect(resposta.json()).toMatchObject({ erro: 'CODIGO_INTERNO_EM_USO' })
    })

    it('recusa corpo vazio', async () => {
      const resposta = await app.inject({
        method: 'PATCH',
        url: `/produtos/${ID_PRODUTO}`,
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
        payload: {},
      })

      expect(resposta.statusCode).toBe(400)
      expect(atualizar).not.toHaveBeenCalled()
    })

    it('bloqueia ATENDENTE com 403', async () => {
      const resposta = await app.inject({
        method: 'PATCH',
        url: `/produtos/${ID_PRODUTO}`,
        cookies: { [NOME_COOKIE_SESSAO]: sessaoAtendente },
        payload: { nome: 'Qualquer' },
      })

      expect(resposta.statusCode).toBe(403)
      expect(atualizar).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /produtos/:id', () => {
    it('inativa em vez de excluir fisicamente', async () => {
      atualizar.mockResolvedValueOnce({ ...PERFUME, ativo: false })

      const resposta = await app.inject({
        method: 'DELETE',
        url: `/produtos/${ID_PRODUTO}`,
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
      })

      expect(resposta.statusCode).toBe(200)
      expect(resposta.json()).toEqual({ produto: { ...PERFUME, ativo: false } })
      expect(atualizar).toHaveBeenCalledWith({
        where: { id: ID_PRODUTO },
        data: { ativo: false },
      })
      // A garantia central do histórico que sustenta a pesquisa: nenhum
      // `delete` chega ao banco.
      expect(excluir).not.toHaveBeenCalled()
    })

    it('responde 404 para produto inexistente', async () => {
      atualizar.mockRejectedValueOnce(erroPrisma('P2025'))

      const resposta = await app.inject({
        method: 'DELETE',
        url: `/produtos/${ID_PRODUTO}`,
        cookies: { [NOME_COOKIE_SESSAO]: sessaoGestor },
      })

      expect(resposta.statusCode).toBe(404)
    })

    it('bloqueia ATENDENTE com 403', async () => {
      const resposta = await app.inject({
        method: 'DELETE',
        url: `/produtos/${ID_PRODUTO}`,
        cookies: { [NOME_COOKIE_SESSAO]: sessaoAtendente },
      })

      expect(resposta.statusCode).toBe(403)
      expect(atualizar).not.toHaveBeenCalled()
    })
  })
})
