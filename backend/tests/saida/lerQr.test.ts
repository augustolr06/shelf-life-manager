/**
 * `POST /saidas/ler` — o núcleo do sistema exposto pela API (RF05, RF06).
 *
 * Roda contra PostgreSQL de verdade, como T06/T07: o que se prova aqui inclui
 * o laço de revalidação do RF06 atravessando requisições HTTP distintas, e ele
 * depende do EventoLog e da comparação de `DATE` reais. O Prisma Client do app
 * é redirecionado para o banco de teste — é o destino que muda, não o
 * comportamento.
 *
 * Contrato: tasks/T08-endpoint-leitura-qr.md · docs/arquitetura.md seções 4 e 5.
 *
 * Revista em T33, antes de T33b: ler deixou de vender. `CONFIRMAR` passou a
 * significar "pode ser vendida", e a venda é `POST /saidas/finalizar`
 * (`finalizar.test.ts`). Os casos que mudaram estão marcados com `T33`.
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

const ROTA = '/saidas/ler'

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

/**
 * Uma leitura, como o balcão faz: uma requisição por vez, sem estado no
 * servidor entre elas. O carrinho, quando existe, vem do cliente (T33).
 */
function ler(codigoQr: string, usuario: Usuario = atendente, noCarrinho?: string[]) {
  return app.inject({
    method: 'POST',
    url: ROTA,
    cookies: cookieDeSessao(app, usuario),
    payload: { codigoQr, ...(noCarrinho ? { noCarrinho } : {}) },
  })
}

function finalizar(unidadeIds: string[], usuario: Usuario = atendente) {
  return finalizarCarrinho(app, usuario, unidadeIds)
}

describe('POST /saidas/ler — acesso', () => {
  it('recusa leitura sem sessão', async () => {
    const unidade = await novaUnidade(30)

    const resposta = await app.inject({ method: 'POST', url: ROTA, payload: { codigoQr: unidade.codigoQr } })

    expect(resposta.statusCode).toBe(401)
    expect(resposta.json().erro).toBe('NAO_AUTENTICADO')
    // Sem sessão não há leitura, e sem leitura não pode haver evento: o
    // denominador do indicador da RF12 não pode contar requisição recusada.
    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(0)
  })

  it('aceita ATENDENTE e GESTOR — ler QR é atribuição das duas funções', async () => {
    const gestor = await criarUsuario(prisma, Papel.GESTOR)
    const daAtendente = await novaUnidade(30)
    const doGestor = await novaUnidade(30)

    expect((await ler(daAtendente.codigoQr)).statusCode).toBe(200)
    expect((await ler(doGestor.codigoQr, gestor)).statusCode).toBe(200)
  })

  it('recusa corpo sem código antes de qualquer leitura', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: ROTA,
      cookies: cookieDeSessao(app, atendente),
      payload: {},
    })

    expect(resposta.statusCode).toBe(400)
    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(0)
  })

  it('ignora usuarioId proposto pelo corpo — a leitura é de quem tem a sessão', async () => {
    const outra = await criarUsuario(prisma, Papel.ATENDENTE)
    const unidade = await novaUnidade(10)

    const resposta = await app.inject({
      method: 'POST',
      url: ROTA,
      cookies: cookieDeSessao(app, atendente),
      payload: { codigoQr: unidade.codigoQr, usuarioId: outra.id },
    })

    // O `additionalProperties: false` do schema faz o Fastify **descartar** o
    // campo extra, não recusar a requisição (é o `removeAdditional` do AJV, o
    // mesmo comportamento das rotas de T04/T05). Por isso a resposta é 200: o
    // que garante a atribuição não é a recusa do corpo, é a rota nunca ler
    // dali — o usuário vem da sessão (RF01, RF12). T33: a leitura não cria
    // mais Saida, então a atribuição se confere no evento.
    expect(resposta.statusCode).toBe(200)
    const eventos = await eventosDe(prisma, 'LEITURA_QR_SAIDA')
    expect(eventos[0]?.usuarioId).toBe(atendente.id)
  })
})

describe('POST /saidas/ler — os quatro vereditos, todos em 200', () => {
  it('código desconhecido volta como veredito, não como 404', async () => {
    const resposta = await ler('PRF-ZZZZZZ')

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toMatchObject({
      veredito: 'ERRO',
      motivo: 'QR_NAO_ENCONTRADO',
      codigoQr: 'PRF-ZZZZZZ',
    })
    expect(resposta.json().mensagem).toBeTruthy()

    // A leitura de etiqueta danificada é dado da pesquisa (RF12): ela conta.
    const eventos = await eventosDe(prisma, 'LEITURA_QR_SAIDA')
    expect(eventos).toHaveLength(1)
    expect(eventos[0]?.unidadeId).toBeNull()
  })

  it('texto fora do formato do código também vira veredito, não 400', async () => {
    const resposta = await ler('etiqueta rasgada')

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().motivo).toBe('QR_NAO_ENCONTRADO')
    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(1)
  })

  it('unidade já baixada volta como ERRO / UNIDADE_JA_BAIXADA', async () => {
    const vendida = await novaUnidade(30, StatusUnidade.VENDIDA)

    const resposta = await ler(vendida.codigoQr)

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toMatchObject({ veredito: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
  })

  it('unidade vencida volta como EXCECAO_VENCIDO e permanece intacta', async () => {
    const vencida = await novaUnidade(-1)

    const resposta = await ler(vencida.codigoQr)
    const corpo = resposta.json()

    expect(resposta.statusCode).toBe(200)
    expect(corpo.veredito).toBe('EXCECAO_VENCIDO')
    expect(corpo.unidade.id).toBe(vencida.id)
    // T08 só devolve o veredito; os três caminhos da seção 6.1 são T11.
    const naoTocada = await prisma.unidadeProduto.findUniqueOrThrow({ where: { id: vencida.id } })
    expect(naoTocada.status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(await prisma.saida.count()).toBe(0)
  })

  it('unidade não-prioritária volta como BLOQUEAR_FIFO, com as duas unidades', async () => {
    const maisAntiga = await novaUnidade(10)
    const maisNova = await novaUnidade(90)

    const resposta = await ler(maisNova.codigoQr)
    const corpo = resposta.json()

    expect(resposta.statusCode).toBe(200)
    expect(corpo.veredito).toBe('BLOQUEAR_FIFO')
    expect(corpo.unidadeLida.id).toBe(maisNova.id)
    expect(corpo.unidadeCorreta.id).toBe(maisAntiga.id)
    expect(corpo.tentativas).toBe(1)
    // Bloqueio não baixa nada.
    expect(await prisma.saida.count()).toBe(0)
  })

  it('unidade prioritária volta como CONFIRMAR e continua no estoque (T33)', async () => {
    // Antes de T33 a resposta era fato consumado: a baixa acontecia dentro da
    // transação da leitura. Agora CONFIRMAR quer dizer "pode ser vendida", e a
    // unidade vai para o carrinho da tela.
    const unidade = await novaUnidade(10)

    const resposta = await ler(unidade.codigoQr)

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().veredito).toBe('CONFIRMAR')
    expect(resposta.json().unidade.id).toBe(unidade.id)

    const naoBaixada = await prisma.unidadeProduto.findUniqueOrThrow({ where: { id: unidade.id } })
    expect(naoBaixada.status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(await prisma.saida.count()).toBe(0)
    expect(await eventosDe(prisma, 'SAIDA_CONFIRMADA')).toHaveLength(0)
  })

  it('a mensagem de CONFIRMAR não diz que a saída foi registrada (T33)', async () => {
    // A tela exibe o texto do servidor (RNF04). Dizer "Saída registrada" para
    // uma unidade que só foi liberada levaria a atendente a não confirmar o
    // carrinho.
    const unidade = await novaUnidade(10)

    const corpo = (await ler(unidade.codigoQr)).json()

    expect(corpo.mensagem).toBeTruthy()
    expect(corpo.mensagem).not.toMatch(/registrada/i)
  })
})

describe('POST /saidas/ler — forma da resposta', () => {
  it('traz o produto embutido em cada unidade', async () => {
    await novaUnidade(10)
    const maisNova = await novaUnidade(90)

    const corpo = (await ler(maisNova.codigoQr)).json()

    for (const unidade of [corpo.unidadeLida, corpo.unidadeCorreta]) {
      expect(unidade.produto).toEqual({
        id: perfume.id,
        codigoInterno: perfume.codigoInterno,
        nome: perfume.nome,
        marca: perfume.marca,
      })
    }
  })

  it('serializa a validade como data de calendário, não como instante', async () => {
    const unidade = await novaUnidade(10)

    const corpo = (await ler(unidade.codigoQr)).json()

    // RNF01: `AAAA-MM-DD`. Um instante ISO escorregaria um dia conforme o fuso
    // de quem lê a resposta.
    expect(corpo.unidade.dataValidade).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(corpo.unidade.dataValidade).toBe(unidade.dataValidade.toISOString().slice(0, 10))
  })

  it('a mensagem do bloqueio nomeia o produto e a validade da unidade correta', async () => {
    const maisAntiga = await novaUnidade(10)
    const maisNova = await novaUnidade(90)

    const corpo = (await ler(maisNova.codigoQr)).json()
    const [ano, mes, dia] = maisAntiga.dataValidade.toISOString().slice(0, 10).split('-')

    // A tela exibe o que vem daqui; ela não monta texto a partir do veredito
    // (RNF04).
    expect(corpo.mensagem).toContain(`${dia}/${mes}/${ano}`)
    expect(corpo.mensagem).toContain(maisAntiga.codigoQr)
  })
})

describe('POST /saidas/ler — entrada manual (fallback do RF05)', () => {
  it('aceita o código digitado em minúsculas e com espaços', async () => {
    const unidade = await novaUnidade(10)
    const digitado = ` ${unidade.codigoQr.toLowerCase()} `

    const resposta = await ler(digitado)

    expect(resposta.json().veredito).toBe('CONFIRMAR')
    // O código ecoado é o normalizado — é ele que identifica a unidade.
    expect(resposta.json().codigoQr).toBe(unidade.codigoQr)
  })
})

describe('POST /saidas/ler — unidades no carrinho (`noCarrinho`, T33)', () => {
  it('a de validade maior é liberada quando a de validade menor já está no carrinho', async () => {
    const janeiro = await novaUnidade(10)
    const fevereiro = await novaUnidade(40)

    const resposta = await ler(fevereiro.codigoQr, atendente, [janeiro.id])

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().veredito).toBe('CONFIRMAR')
    expect(await eventosDe(prisma, 'ALERTA_FIFO_DISPARADO')).toHaveLength(0)
  })

  it('sem a lista, a mesma leitura é bloqueada — a rota não guarda carrinho', async () => {
    await novaUnidade(10)
    const fevereiro = await novaUnidade(40)

    expect((await ler(fevereiro.codigoQr)).json().veredito).toBe('BLOQUEAR_FIFO')
  })

  it('recusa lista com id fora do formato, e nenhuma leitura é registrada', async () => {
    const unidade = await novaUnidade(10)

    const resposta = await ler(unidade.codigoQr, atendente, ['PRF-ABC123'])

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('CORPO_INVALIDO')
    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(0)
  })

  it('recusa lista acima do teto da confirmação (50), e nenhuma leitura é registrada', async () => {
    // Mesmo teto de `/saidas/finalizar`: uma lista maior descreve um carrinho
    // que não poderia ser confirmado.
    const unidade = await novaUnidade(10)
    const lista = Array.from({ length: 51 }, () => randomUUID())

    const resposta = await ler(unidade.codigoQr, atendente, lista)

    expect(resposta.statusCode).toBe(400)
    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(0)
  })
})

describe('POST /saidas/ler — o laço de revalidação (RF06)', () => {
  it('bloqueia, revalida a cada nova leitura e libera quando vem a certa', async () => {
    const maisAntiga = await novaUnidade(10)
    const intermediaria = await novaUnidade(40)
    const maisNova = await novaUnidade(90)

    // Cada leitura é uma requisição independente: o servidor não guarda nada
    // entre elas (PRD 6.2), e mesmo assim o laço avança.
    const primeira = (await ler(maisNova.codigoQr)).json()
    expect(primeira.veredito).toBe('BLOQUEAR_FIFO')
    expect(primeira.tentativas).toBe(1)

    const segunda = (await ler(intermediaria.codigoQr)).json()
    expect(segunda.veredito).toBe('BLOQUEAR_FIFO')
    expect(segunda.tentativas).toBe(2)
    expect(segunda.unidadeCorreta.id).toBe(maisAntiga.id)

    const terceira = (await ler(maisAntiga.codigoQr)).json()
    expect(terceira.veredito).toBe('CONFIRMAR')

    // T33: o ciclo fecha na confirmação do carrinho, com o mesmo total.
    await finalizar([maisAntiga.id])
    const saida = await prisma.saida.findUniqueOrThrow({ where: { unidadeId: maisAntiga.id } })
    expect(saida.tentativasAteAcerto).toBe(2)
    expect(saida.alertaFifoDisparado).toBe(true)
  })

  it('ciclo abandonado não deixa nada para limpar', async () => {
    await novaUnidade(10)
    const maisNova = await novaUnidade(90)

    // A atendente bloqueia e desiste — o cliente mudou de ideia.
    expect((await ler(maisNova.codigoQr)).json().veredito).toBe('BLOQUEAR_FIFO')

    // Nenhuma reserva, nenhum contador, nenhum status intermediário: o único
    // resíduo é o EventoLog, que é append-only de propósito (RNF05).
    expect(await prisma.saida.count()).toBe(0)
    const unidades = await prisma.unidadeProduto.findMany()
    expect(unidades.every((u) => u.status === StatusUnidade.EM_ESTOQUE)).toBe(true)
    expect(await eventosDe(prisma, 'ALERTA_FIFO_DISPARADO')).toHaveLength(1)
  })

  it('reler a unidade liberada e não vendida libera de novo (T33)', async () => {
    // Não há reserva no servidor (PRD 6.2). Evitar o item repetido no
    // carrinho é da tela (T34).
    const unidade = await novaUnidade(10)

    expect((await ler(unidade.codigoQr)).json().veredito).toBe('CONFIRMAR')
    expect((await ler(unidade.codigoQr)).json().veredito).toBe('CONFIRMAR')

    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(2)
    expect(await prisma.saida.count()).toBe(0)
  })

  it('reler a unidade já vendida devolve UNIDADE_JA_BAIXADA', async () => {
    // T33: "vendida" passou a ser depois da confirmação, não depois da leitura.
    const unidade = await novaUnidade(10)

    expect((await ler(unidade.codigoQr)).json().veredito).toBe('CONFIRMAR')
    await finalizar([unidade.id])
    const relida = (await ler(unidade.codigoQr)).json()

    expect(relida.veredito).toBe('ERRO')
    expect(relida.motivo).toBe('UNIDADE_JA_BAIXADA')
    // A segunda leitura também conta como leitura.
    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(2)
    expect(await prisma.saida.count()).toBe(1)
  })
})
