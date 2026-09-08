import bcrypt from 'bcryptjs'
import { Papel, Prisma, StatusUnidade } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Mesma estratégia de T03/T04: o Prisma Client é substituído por um duplo.
// O que T05 precisa provar é o contrato da rota — papel, validação do lote,
// geração do código, atribuição ao usuário da sessão. Os testes com banco real
// chegam em T06/T07, onde o objeto de teste é o lock da RNF02.
vi.mock('../src/db/prisma.js', () => ({
  prisma: {
    usuario: { findUnique: vi.fn() },
    produto: { findUnique: vi.fn() },
    unidadeProduto: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '../src/db/prisma.js'
import { buildApp } from '../src/app.js'
import { NOME_COOKIE_SESSAO } from '../src/modules/auth/cookie.js'
import { PADRAO_CODIGO_QR } from '../src/modules/unidade/codigoQr.js'

const SENHA = 'estoque123'
const SENHA_HASH = bcrypt.hashSync(SENHA, 10)

const GESTOR = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Gestora de Loja',
  email: 'gestor@estoque.local',
  senhaHash: SENHA_HASH,
  papel: Papel.GESTOR,
}

const ATENDENTE = {
  id: '22222222-2222-2222-2222-222222222222',
  nome: 'Atendente de Balcão',
  email: 'atendente@estoque.local',
  senhaHash: SENHA_HASH,
  papel: Papel.ATENDENTE,
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

const ROTA = `/produtos/${ID_PRODUTO}/unidades`

const buscarUsuario = vi.mocked(prisma.usuario.findUnique)
const buscarProduto = vi.mocked(prisma.produto.findUnique)
const criarUnidade = vi.mocked(prisma.unidadeProduto.create)
const transacao = vi.mocked(prisma.$transaction)

function erroPrisma(code: string) {
  return new Prisma.PrismaClientKnownRequestError('violação simulada', {
    code,
    clientVersion: 'teste',
  })
}

/** Os `data` de cada `create` disparado, na ordem. */
function dadosCriados(): { codigoQr: string; dataValidade: Date; registradoPorId: string }[] {
  return criarUnidade.mock.calls.map(([argumento]) => argumento.data)
}

describe('Cadastro de UnidadeProduto (RF03)', () => {
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
    for (const dublê of [buscarUsuario, buscarProduto, criarUnidade, transacao]) dublê.mockReset()

    buscarProduto.mockResolvedValue(PERFUME)

    let sequencial = 0
    criarUnidade.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        ({
          id: `unidade-${(sequencial += 1)}`,
          produtoId: ID_PRODUTO,
          status: StatusUnidade.EM_ESTOQUE,
          dataEntrada: new Date('2026-09-07T00:00:00.000Z'),
          ...data,
        }) as never,
    )

    // O duplo do `$transaction` executa o array de operações como o Prisma
    // faria: todas juntas, e qualquer rejeição derruba o conjunto.
    transacao.mockImplementation(async (operacoes: unknown) =>
      Promise.all(operacoes as Promise<unknown>[]),
    )
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

  function receber(payload: unknown, sessao = sessaoGestor) {
    return app.inject({
      method: 'POST',
      url: ROTA,
      cookies: { [NOME_COOKIE_SESSAO]: sessao },
      payload: payload as object,
    })
  }

  it('cadastra um lote com validades diferentes na mesma requisição', async () => {
    // O cenário que motiva o projeto: uma entrega mista, unidades do mesmo SKU
    // com validades distintas.
    const resposta = await receber({
      unidades: [{ dataValidade: '2027-03-01' }, { dataValidade: '2026-11-30' }],
    })

    expect(resposta.statusCode).toBe(201)
    expect(resposta.json().unidades).toHaveLength(2)
    expect(dadosCriados().map((d) => d.dataValidade)).toEqual([
      new Date('2027-03-01T00:00:00.000Z'),
      new Date('2026-11-30T00:00:00.000Z'),
    ])
  })

  it('cadastra uma unidade única', async () => {
    const resposta = await receber({ unidades: [{ dataValidade: '2027-03-01' }] })

    expect(resposta.statusCode).toBe(201)
    expect(resposta.json().unidades).toHaveLength(1)
    expect(criarUnidade).toHaveBeenCalledTimes(1)
  })

  it('expande a quantidade em unidades físicas independentes', async () => {
    // Três frascos com a mesma validade são três unidades, não um lote de
    // três: cada uma ganha o seu próprio código e é vendida separadamente.
    const resposta = await receber({ unidades: [{ dataValidade: '2027-03-01', quantidade: 3 }] })

    expect(resposta.statusCode).toBe(201)
    expect(criarUnidade).toHaveBeenCalledTimes(3)
    expect(new Set(dadosCriados().map((d) => d.codigoQr)).size).toBe(3)
  })

  it('grava o lote inteiro numa única transação', async () => {
    await receber({ unidades: [{ dataValidade: '2027-03-01', quantidade: 4 }] })

    // Meio recebimento gravado deixaria a gestora sem saber quais frascos já
    // têm etiqueta.
    expect(transacao).toHaveBeenCalledTimes(1)
  })

  it('gera um codigoQr único por unidade, no formato do módulo', async () => {
    const resposta = await receber({
      unidades: [{ dataValidade: '2027-03-01' }, { dataValidade: '2026-11-30', quantidade: 2 }],
    })

    const codigos = resposta.json().unidades.map((u: { codigoQr: string }) => u.codigoQr)

    expect(new Set(codigos).size).toBe(3)
    for (const codigo of codigos) expect(codigo).toMatch(PADRAO_CODIGO_QR)
  })

  it('atribui a unidade ao usuário da sessão, não ao corpo da requisição', async () => {
    await receber({ unidades: [{ dataValidade: '2027-03-01' }] })

    expect(dadosCriados()[0]?.registradoPorId).toBe(GESTOR.id)
  })

  it('não deixa o cliente escolher status nem codigoQr', async () => {
    const resposta = await receber({
      unidades: [{ dataValidade: '2027-03-01', status: 'VENDIDA', codigoQr: 'PRF-AAAAAA' }],
    })

    // `additionalProperties: false` com o ajv do Fastify descarta o campo em
    // vez de recusar a requisição. A garantia que importa é esta: o que o
    // cliente mandou não chega ao banco — o código é gerado no servidor e o
    // status vem do default do schema.
    expect(resposta.statusCode).toBe(201)
    expect(dadosCriados()[0]).not.toHaveProperty('status')
    expect(dadosCriados()[0]?.codigoQr).not.toBe('PRF-AAAAAA')
    expect(dadosCriados()[0]?.codigoQr).toMatch(PADRAO_CODIGO_QR)
  })

  it('deixa o status inicial a cargo do default do schema (EM_ESTOQUE)', async () => {
    await receber({ unidades: [{ dataValidade: '2027-03-01' }] })

    expect(dadosCriados()[0]).not.toHaveProperty('status')
  })

  it('avisa — sem recusar — quando a validade já passou', async () => {
    const resposta = await receber({
      unidades: [{ dataValidade: '2020-01-01', quantidade: 2 }, { dataValidade: '2099-12-31' }],
    })

    // Cadastrar unidade já vencida é legítimo: é o que acontece quando a loja
    // acha na prateleira um item que nunca foi registrado.
    expect(resposta.statusCode).toBe(201)
    expect(criarUnidade).toHaveBeenCalledTimes(3)
    expect(resposta.json().avisos).toEqual([
      expect.objectContaining({
        codigo: 'UNIDADE_JA_VENCIDA',
        dataValidade: '2020-01-01',
        quantidade: 2,
      }),
    ])
  })

  it('não avisa quando todas as validades são futuras', async () => {
    const resposta = await receber({ unidades: [{ dataValidade: '2099-12-31' }] })

    expect(resposta.json().avisos).toEqual([])
  })

  it('responde 404 para produto inexistente, sem gravar nada', async () => {
    buscarProduto.mockResolvedValueOnce(null)

    const resposta = await receber({ unidades: [{ dataValidade: '2027-03-01' }] })

    expect(resposta.statusCode).toBe(404)
    expect(resposta.json()).toMatchObject({ erro: 'PRODUTO_NAO_ENCONTRADO' })
    expect(criarUnidade).not.toHaveBeenCalled()
  })

  it('responde 409 para produto inativo', async () => {
    buscarProduto.mockResolvedValueOnce({ ...PERFUME, ativo: false })

    const resposta = await receber({ unidades: [{ dataValidade: '2027-03-01' }] })

    expect(resposta.statusCode).toBe(409)
    expect(resposta.json()).toMatchObject({ erro: 'PRODUTO_INATIVO' })
    expect(criarUnidade).not.toHaveBeenCalled()
  })

  it('regera o lote quando o banco recusa um codigoQr repetido', async () => {
    transacao.mockRejectedValueOnce(erroPrisma('P2002'))

    const resposta = await receber({ unidades: [{ dataValidade: '2027-03-01' }] })

    expect(resposta.statusCode).toBe(201)
    // Duas tentativas, com códigos diferentes entre si: a colisão vira um
    // retry invisível, não um erro na tela.
    const [primeiro, segundo] = dadosCriados().map((d) => d.codigoQr)
    expect(primeiro).not.toBe(segundo)
  })

  it('desiste com 503 se a colisão persistir', async () => {
    transacao.mockRejectedValue(erroPrisma('P2002'))

    const resposta = await receber({ unidades: [{ dataValidade: '2027-03-01' }] })

    expect(resposta.statusCode).toBe(503)
    expect(resposta.json()).toMatchObject({ erro: 'CODIGO_QR_INDISPONIVEL' })
  })

  describe('validação do corpo', () => {
    it('recusa lote vazio', async () => {
      const resposta = await receber({ unidades: [] })

      expect(resposta.statusCode).toBe(400)
      expect(criarUnidade).not.toHaveBeenCalled()
    })

    it('recusa unidade sem validade — a validade é o dado central do sistema', async () => {
      const resposta = await receber({ unidades: [{ quantidade: 2 }] })

      expect(resposta.statusCode).toBe(400)
    })

    it('recusa data inexistente no calendário', async () => {
      const resposta = await receber({ unidades: [{ dataValidade: '2027-02-30' }] })

      expect(resposta.statusCode).toBe(400)
    })

    it('recusa validade com hora — a coluna é DATE (RNF01)', async () => {
      const resposta = await receber({ unidades: [{ dataValidade: '2027-03-01T10:00:00Z' }] })

      expect(resposta.statusCode).toBe(400)
    })

    it('recusa quantidade zero ou fracionária', async () => {
      for (const quantidade of [0, 1.5, -3]) {
        const resposta = await receber({ unidades: [{ dataValidade: '2027-03-01', quantidade }] })
        expect(resposta.statusCode).toBe(400)
      }
    })

    it('recusa lote acima do teto total de unidades', async () => {
      const resposta = await receber({
        unidades: Array.from({ length: 4 }, () => ({
          dataValidade: '2027-03-01',
          quantidade: 200,
        })),
      })

      expect(resposta.statusCode).toBe(400)
      expect(resposta.json()).toMatchObject({ erro: 'LOTE_MUITO_GRANDE' })
      expect(criarUnidade).not.toHaveBeenCalled()
    })
  })

  describe('autorização', () => {
    it('bloqueia ATENDENTE com 403', async () => {
      const resposta = await receber({ unidades: [{ dataValidade: '2027-03-01' }] }, sessaoAtendente)

      expect(resposta.statusCode).toBe(403)
      expect(criarUnidade).not.toHaveBeenCalled()
    })

    it('bloqueia requisição sem sessão com 401', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: ROTA,
        payload: { unidades: [{ dataValidade: '2027-03-01' }] },
      })

      expect(resposta.statusCode).toBe(401)
    })
  })
})
