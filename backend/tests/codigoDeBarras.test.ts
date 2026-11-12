import bcrypt from 'bcryptjs'
import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Mesma estratégia de `produto.test.ts`: Prisma em dublê, porque o que esta
// suíte prova é o contrato da rota de T47 — papel, ordem dos passos e
// tradução de cada resposta da fonte —, não a persistência. A fonte externa
// também é dublê: `fetch` é substituído por caso, e nenhum teste sai à rede.
vi.mock('../src/db/prisma.js', () => ({
  prisma: {
    usuario: { findUnique: vi.fn() },
    produto: { findUnique: vi.fn(), findMany: vi.fn() },
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

const EAN = '7891000325858'
const TOKEN = 'token-de-teste-que-nao-pode-vazar'

const TINTA = {
  id: '33333333-3333-3333-3333-333333333333',
  codigoInterno: EAN,
  nome: 'Alta Moda 6.1',
  marca: 'Alfaparf',
  categoria: 'Coloração',
  ativo: true,
}

/** Um corpo de resposta da fonte no formato da documentação do SI5. */
const DA_FONTE = {
  codbar: EAN,
  produto: '  COLORACAO   CREME 6.1  LOURO ESCURO ',
  marca: 'MARCA X',
  categoria: 'Tonalizante',
  ncm: '33059000',
  imagem_url: 'https://global.si5.com.br/imagens/7891000325858.webp',
}

const buscarUsuario = vi.mocked(prisma.usuario.findUnique)
const buscarProduto = vi.mocked(prisma.produto.findUnique)
const listarProdutos = vi.mocked(prisma.produto.findMany)
const fetchFalso = vi.fn<typeof fetch>()

function respostaJson(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GET /produtos/codigo-de-barras/:codigo (T47)', () => {
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
    buscarUsuario.mockReset()
    buscarProduto.mockReset().mockResolvedValue(null)
    listarProdutos.mockReset().mockResolvedValue([])
    fetchFalso.mockReset()
    vi.stubGlobal('fetch', fetchFalso)
    vi.stubEnv('SI5_TOKEN', TOKEN)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
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

  function consultar(codigo: string, sessao: string | null = sessaoGestor) {
    return app.inject({
      method: 'GET',
      url: `/produtos/codigo-de-barras/${encodeURIComponent(codigo)}`,
      cookies: sessao ? { [NOME_COOKIE_SESSAO]: sessao } : {},
    })
  }

  describe('papel', () => {
    it('recusa sem sessão, sem consultar nada', async () => {
      const resposta = await consultar(EAN, null)

      expect(resposta.statusCode).toBe(401)
      expect(buscarProduto).not.toHaveBeenCalled()
      expect(fetchFalso).not.toHaveBeenCalled()
    })

    it('recusa ATENDENTE com 403: só quem cadastra gasta a cota da fonte', async () => {
      const resposta = await consultar(EAN, sessaoAtendente)

      expect(resposta.statusCode).toBe(403)
      expect(fetchFalso).not.toHaveBeenCalled()
    })
  })

  describe('catálogo da loja primeiro', () => {
    it('responde JA_CADASTRADO com o produto, sem consultar a fonte', async () => {
      buscarProduto.mockResolvedValueOnce(TINTA)

      const resposta = await consultar(EAN)

      expect(resposta.statusCode).toBe(200)
      expect(resposta.json()).toEqual({ situacao: 'JA_CADASTRADO', produto: TINTA })
      expect(buscarProduto).toHaveBeenCalledWith({ where: { codigoInterno: EAN } })
      expect(fetchFalso).not.toHaveBeenCalled()
    })

    it('procura também o código que não é GTIN, como o SEMCOD da loja', async () => {
      const semCodigo = { ...TINTA, codigoInterno: 'SEMCOD-001' }
      buscarProduto.mockResolvedValueOnce(semCodigo)

      const resposta = await consultar('semcod-001')

      expect(resposta.json()).toEqual({ situacao: 'JA_CADASTRADO', produto: semCodigo })
      expect(buscarProduto).toHaveBeenCalledWith({ where: { codigoInterno: 'SEMCOD-001' } })
    })

    it('normaliza como o cadastro e tira os espaços do meio do código', async () => {
      buscarProduto.mockResolvedValueOnce(TINTA)

      await consultar(' 7 891000 325858 ')

      expect(buscarProduto).toHaveBeenCalledWith({ where: { codigoInterno: EAN } })
    })
  })

  describe('código que não pode ser código de barras', () => {
    it('recusa com 400 pelo formato, sem consultar a fonte', async () => {
      const resposta = await consultar('PRF-021')

      expect(resposta.statusCode).toBe(400)
      expect(resposta.json()).toEqual({
        erro: 'CODIGO_DE_BARRAS_INVALIDO',
        mensagem: 'O código de barras tem só números, com 8, 12, 13 ou 14 dígitos.',
      })
      expect(fetchFalso).not.toHaveBeenCalled()
    })

    it('recusa com 400 pelo dígito verificador, dizendo que foi digitado errado', async () => {
      const resposta = await consultar('7891000325859')

      expect(resposta.statusCode).toBe(400)
      expect(resposta.json()).toMatchObject({ erro: 'CODIGO_DE_BARRAS_INVALIDO' })
      expect(resposta.json().mensagem).toMatch(/digitado errado/)
      expect(fetchFalso).not.toHaveBeenCalled()
    })

    it('recusa código longo demais pelo schema', async () => {
      const resposta = await consultar('1'.repeat(21))

      expect(resposta.statusCode).toBe(400)
      expect(buscarProduto).not.toHaveBeenCalled()
    })
  })

  describe('fonte externa', () => {
    it('responde ENCONTRADO com a sugestão na forma dos campos do cadastro', async () => {
      fetchFalso.mockResolvedValueOnce(respostaJson(200, DA_FONTE))

      const resposta = await consultar(EAN)

      expect(resposta.statusCode).toBe(200)
      expect(resposta.json()).toEqual({
        situacao: 'ENCONTRADO',
        fonte: 'SI5 Global',
        sugestao: {
          codigoInterno: EAN,
          // Espaços das pontas e repetidos no meio saem; a caixa fica.
          nome: 'COLORACAO CREME 6.1 LOURO ESCURO',
          marca: 'MARCA X',
          categoria: 'Tonalizante',
          imagemUrl: DA_FONTE.imagem_url,
        },
      })
    })

    it('consulta o GTIN no endereço da fonte, com o token no cabeçalho', async () => {
      fetchFalso.mockResolvedValueOnce(respostaJson(200, DA_FONTE))

      await consultar(EAN)

      expect(fetchFalso).toHaveBeenCalledTimes(1)
      const [url, opcoes] = fetchFalso.mock.calls[0]!
      expect(url).toBe(`https://global.si5.com.br/api/produtos/${EAN}`)
      expect(opcoes?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` })
      expect(opcoes?.signal).toBeInstanceOf(AbortSignal)
    })

    it('nunca devolve o token na resposta', async () => {
      fetchFalso.mockResolvedValueOnce(respostaJson(200, { ...DA_FONTE, marca: null }))

      const resposta = await consultar(EAN)

      expect(resposta.body).not.toContain(TOKEN)
    })

    it('devolve marca, categoria e imagem nulas quando a fonte não as tem', async () => {
      fetchFalso.mockResolvedValueOnce(
        respostaJson(200, { codbar: EAN, produto: 'Henna Pó', marca: null, imagem_url: null }),
      )

      const resposta = await consultar(EAN)

      expect(resposta.json().sugestao).toEqual({
        codigoInterno: EAN,
        nome: 'Henna Pó',
        marca: null,
        categoria: null,
        imagemUrl: null,
      })
    })

    it('descarta imagem que não é https', async () => {
      fetchFalso.mockResolvedValueOnce(
        respostaJson(200, { ...DA_FONTE, imagem_url: 'http://exemplo.com/foto.webp' }),
      )

      const resposta = await consultar(EAN)

      expect(resposta.json().sugestao.imagemUrl).toBeNull()
    })

    it('troca a categoria da fonte pela grafia da loja quando é a mesma categoria', async () => {
      listarProdutos.mockResolvedValueOnce([
        { categoria: 'Coloração' },
        { categoria: 'Henna' },
      ] as never)
      fetchFalso.mockResolvedValueOnce(respostaJson(200, { ...DA_FONTE, categoria: 'COLORACAO' }))

      const resposta = await consultar(EAN)

      expect(resposta.json().sugestao.categoria).toBe('Coloração')
    })

    it('mantém a categoria da fonte como veio quando a loja não a tem', async () => {
      listarProdutos.mockResolvedValueOnce([{ categoria: 'Coloração' }] as never)
      fetchFalso.mockResolvedValueOnce(
        respostaJson(200, { ...DA_FONTE, categoria: 'Higiene E Beleza' }),
      )

      const resposta = await consultar(EAN)

      expect(resposta.json().sugestao.categoria).toBe('Higiene E Beleza')
    })

    it('responde NAO_ENCONTRADO quando a fonte responde 404', async () => {
      fetchFalso.mockResolvedValueOnce(respostaJson(404, { message: 'Not Found' }))

      const resposta = await consultar(EAN)

      expect(resposta.statusCode).toBe(200)
      expect(resposta.json()).toEqual({ situacao: 'NAO_ENCONTRADO' })
    })

    it('responde NAO_ENCONTRADO quando a fonte acha o código mas não tem o nome', async () => {
      fetchFalso.mockResolvedValueOnce(respostaJson(200, { ...DA_FONTE, produto: '   ' }))

      const resposta = await consultar(EAN)

      expect(resposta.json()).toEqual({ situacao: 'NAO_ENCONTRADO' })
    })

    it('responde INDISPONIVEL por LIMITE_DIARIO quando a cota do dia acabou (429)', async () => {
      fetchFalso.mockResolvedValueOnce(respostaJson(429, { message: 'Too Many Requests' }))

      const resposta = await consultar(EAN)

      expect(resposta.statusCode).toBe(200)
      expect(resposta.json()).toEqual({ situacao: 'INDISPONIVEL', motivo: 'LIMITE_DIARIO' })
    })

    it.each([
      ['token recusado (401)', () => respostaJson(401, { message: 'Unauthenticated.' })],
      ['erro do servidor da fonte (500)', () => respostaJson(500, {})],
      [
        'resposta que não é JSON',
        () => new Response('<html>manutenção</html>', { status: 200 }),
      ],
    ])('responde INDISPONIVEL por FALHA com %s', async (_caso, resposta) => {
      fetchFalso.mockResolvedValueOnce(resposta())

      const http = await consultar(EAN)

      expect(http.statusCode).toBe(200)
      expect(http.json()).toEqual({ situacao: 'INDISPONIVEL', motivo: 'FALHA' })
    })

    it.each([
      ['falha de rede', new TypeError('fetch failed')],
      ['tempo limite esgotado', new DOMException('The operation timed out.', 'TimeoutError')],
    ])('responde INDISPONIVEL por FALHA com %s', async (_caso, falha) => {
      fetchFalso.mockRejectedValueOnce(falha)

      const resposta = await consultar(EAN)

      expect(resposta.statusCode).toBe(200)
      expect(resposta.json()).toEqual({ situacao: 'INDISPONIVEL', motivo: 'FALHA' })
    })

    it('responde INDISPONIVEL por NAO_CONFIGURADA sem token, sem consultar a fonte', async () => {
      vi.stubEnv('SI5_TOKEN', '')

      const resposta = await consultar(EAN)

      expect(resposta.statusCode).toBe(200)
      expect(resposta.json()).toEqual({ situacao: 'INDISPONIVEL', motivo: 'NAO_CONFIGURADA' })
      expect(fetchFalso).not.toHaveBeenCalled()
    })
  })
})
