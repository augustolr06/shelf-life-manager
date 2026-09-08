/**
 * Os três caminhos da unidade vencida (PRD seção 6.1, T11).
 *
 * Roda contra PostgreSQL de verdade, como T06/T07/T08/T09: o objeto de teste
 * inclui o lock da RNF02, a comparação de `DATE` da RNF01 e a revalidação do
 * FIFO dentro da mesma transação da correção — nada disso existe fora do banco.
 *
 * Contrato: tasks/T11-excecao-vencido-backend.md · docs/arquitetura.md seção 5.
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

import { buildApp } from '../../src/app.js'
import { MOTIVO_PADRAO_DE_DESCARTE } from '../../src/modules/excecao-vencido/excecaoVencido.service.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { cookieDeSessao, criarProduto, criarUnidade, criarUsuario, eventosDe } from '../apoio/cenario.js'
import { hojeComoData } from '../../src/shared/data.js'

const CORRIGIR = '/excecao-vencido/corrigir'
const DESCARTAR = '/excecao-vencido/descartar'
const OVERRIDE = '/excecao-vencido/override'

const JUSTIFICATIVA = 'Cliente ciente do prazo, desconto combinado no balcão.'

/** Um agrupador de atendimento, como o `crypto.randomUUID()` da tela geraria. */
const SESSAO = '3f6d1c6e-6f9b-4a3a-9c6a-1f2b3c4d5e6f'

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

function novaUnidade(diasAteVencer: number, status?: StatusUnidade): Promise<UnidadeProduto> {
  return criarUnidade(prisma, {
    produtoId: perfume.id,
    registradoPorId: gestor.id,
    diasAteVencer,
    ...(status ? { status } : {}),
  })
}

function chamar(rota: string, corpo: Record<string, unknown>, usuario: Usuario = gestor) {
  return app.inject({
    method: 'POST',
    url: rota,
    cookies: cookieDeSessao(app, usuario),
    payload: corpo,
  })
}

/** A data de calendário a N dias de hoje, no formato que a API aceita. */
function validadeEm(dias: number): string {
  const hoje = hojeComoData()
  const data = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + dias))
  return data.toISOString().slice(0, 10)
}

function recarregar(unidade: UnidadeProduto): Promise<UnidadeProduto> {
  return prisma.unidadeProduto.findUniqueOrThrow({ where: { id: unidade.id } })
}

function ler(codigoQr: string, usuario: Usuario = atendente) {
  return app.inject({
    method: 'POST',
    url: '/saidas/ler',
    cookies: cookieDeSessao(app, usuario),
    payload: { codigoQr },
  })
}

describe('exceção de unidade vencida — acesso (RF01, PRD 6.1)', () => {
  it('recusa os três caminhos sem sessão', async () => {
    const vencida = await novaUnidade(-5)

    const respostas = await Promise.all([
      app.inject({ method: 'POST', url: CORRIGIR, payload: { unidadeId: vencida.id, dataValidade: validadeEm(30) } }),
      app.inject({ method: 'POST', url: DESCARTAR, payload: { unidadeId: vencida.id } }),
      app.inject({ method: 'POST', url: OVERRIDE, payload: { unidadeId: vencida.id, justificativa: JUSTIFICATIVA } }),
    ])

    expect(respostas.map((r) => r.statusCode)).toEqual([401, 401, 401])
    expect((await recarregar(vencida)).status).toBe(StatusUnidade.EM_ESTOQUE)
  })

  it('atendente não corrige validade nem autoriza venda de unidade vencida', async () => {
    const vencida = await novaUnidade(-5)

    const correcao = await chamar(CORRIGIR, { unidadeId: vencida.id, dataValidade: validadeEm(30) }, atendente)
    const override = await chamar(OVERRIDE, { unidadeId: vencida.id, justificativa: JUSTIFICATIVA }, atendente)

    expect(correcao.statusCode).toBe(403)
    expect(override.statusCode).toBe(403)
    expect(correcao.json().erro).toBe('PAPEL_INSUFICIENTE')
    // A escalação de papel do override é a fricção deliberada da seção 6.1: a
    // tentativa recusada não pode deixar rastro de venda nenhum.
    expect(await prisma.saida.count()).toBe(0)
    expect(await eventosDe(prisma, 'VENDA_VENCIDA_AUTORIZADA')).toHaveLength(0)
  })

  it('atendente descarta — constatar a perda é de quem está no balcão', async () => {
    const vencida = await novaUnidade(-5)

    const resposta = await chamar(DESCARTAR, { unidadeId: vencida.id }, atendente)

    expect(resposta.statusCode).toBe(201)
    const descarte = await prisma.descarte.findUniqueOrThrow({ where: { unidadeId: vencida.id } })
    expect(descarte.usuarioId).toBe(atendente.id)
  })
})

describe('exceção de unidade vencida — pré-condições comuns aos três caminhos', () => {
  const inexistente = '00000000-0000-4000-8000-000000000000'

  it('unidade inexistente devolve 404 nos três', async () => {
    const respostas = await Promise.all([
      chamar(CORRIGIR, { unidadeId: inexistente, dataValidade: validadeEm(30) }),
      chamar(DESCARTAR, { unidadeId: inexistente }),
      chamar(OVERRIDE, { unidadeId: inexistente, justificativa: JUSTIFICATIVA }),
    ])

    expect(respostas.map((r) => r.statusCode)).toEqual([404, 404, 404])
    expect(respostas.map((r) => r.json().erro)).toEqual([
      'UNIDADE_NAO_ENCONTRADA',
      'UNIDADE_NAO_ENCONTRADA',
      'UNIDADE_NAO_ENCONTRADA',
    ])
  })

  it('unidade já baixada devolve 409 nos três', async () => {
    const vendida = await novaUnidade(-5, StatusUnidade.VENDIDA)
    const descartada = await novaUnidade(-5, StatusUnidade.DESCARTADA)

    const respostas = await Promise.all([
      chamar(CORRIGIR, { unidadeId: vendida.id, dataValidade: validadeEm(30) }),
      chamar(DESCARTAR, { unidadeId: descartada.id }),
      chamar(OVERRIDE, { unidadeId: vendida.id, justificativa: JUSTIFICATIVA }),
    ])

    expect(respostas.map((r) => r.statusCode)).toEqual([409, 409, 409])
    expect(respostas.map((r) => r.json().erro)).toEqual([
      'UNIDADE_JA_BAIXADA',
      'UNIDADE_JA_BAIXADA',
      'UNIDADE_JA_BAIXADA',
    ])
  })

  it('unidade não vencida devolve 409 nos três — a exceção só existe para o que venceu', async () => {
    const valida = await novaUnidade(30)

    const respostas = await Promise.all([
      chamar(CORRIGIR, { unidadeId: valida.id, dataValidade: validadeEm(60) }),
      chamar(DESCARTAR, { unidadeId: valida.id }),
      chamar(OVERRIDE, { unidadeId: valida.id, justificativa: JUSTIFICATIVA }),
    ])

    expect(respostas.map((r) => r.statusCode)).toEqual([409, 409, 409])
    expect(respostas.map((r) => r.json().erro)).toEqual([
      'UNIDADE_NAO_VENCIDA',
      'UNIDADE_NAO_VENCIDA',
      'UNIDADE_NAO_VENCIDA',
    ])
    expect((await recarregar(valida)).status).toBe(StatusUnidade.EM_ESTOQUE)
  })

  it('unidade que vence hoje não está vencida — a fronteira é a mesma do FIFO (RNF01)', async () => {
    const venceHoje = await novaUnidade(0)

    const resposta = await chamar(DESCARTAR, { unidadeId: venceHoje.id }, atendente)

    expect(resposta.statusCode).toBe(409)
    expect(resposta.json().erro).toBe('UNIDADE_NAO_VENCIDA')
  })

  it('o override não é atalho para furar o FIFO: unidade válida fora de ordem continua bloqueada', async () => {
    // A mais antiga fica em estoque; a gestora tenta autorizar a saída da
    // outra pelo caminho da exceção. Sem a pré-condição de vencimento, este
    // seria o contorno do bloqueio do RF06 para quem tem o papel.
    await novaUnidade(10)
    const foraDeOrdem = await novaUnidade(60)

    const resposta = await chamar(OVERRIDE, { unidadeId: foraDeOrdem.id, justificativa: JUSTIFICATIVA })

    expect(resposta.statusCode).toBe(409)
    expect(resposta.json().erro).toBe('UNIDADE_NAO_VENCIDA')
    expect((await recarregar(foraDeOrdem)).status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(await prisma.saida.count()).toBe(0)
  })
})

describe('caminho 1 — correção de dado (PRD 6.1)', () => {
  it('atualiza a validade e registra VALIDADE_CORRIGIDA com o valor anterior', async () => {
    const vencida = await novaUnidade(-40)
    const anterior = vencida.dataValidade.toISOString().slice(0, 10)
    const nova = validadeEm(200)

    const resposta = await chamar(CORRIGIR, { unidadeId: vencida.id, dataValidade: nova })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().correcao).toEqual({ dataValidadeAnterior: anterior, dataValidadeNova: nova })
    expect((await recarregar(vencida)).dataValidade.toISOString().slice(0, 10)).toBe(nova)

    const [evento] = await eventosDe(prisma, 'VALIDADE_CORRIGIDA')
    expect(evento?.unidadeId).toBe(vencida.id)
    expect(evento?.produtoId).toBe(perfume.id)
    expect(evento?.usuarioId).toBe(gestor.id)
    expect(evento?.payload).toMatchObject({
      codigoQr: vencida.codigoQr,
      dataValidadeAnterior: anterior,
      dataValidadeNova: nova,
      sessaoVendaId: null,
    })
  })

  it('revalida o FIFO do zero: corrigida para a mais antiga do pool, confirma a saída', async () => {
    await novaUnidade(90)
    const vencida = await novaUnidade(-3)

    const resposta = await chamar(CORRIGIR, { unidadeId: vencida.id, dataValidade: validadeEm(10) })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().revalidacao.veredito).toBe('CONFIRMAR')
    // Não existe `POST /saidas/confirmar` (T09): quando a revalidação confirma,
    // a venda já aconteceu dentro da mesma transação da correção.
    expect((await recarregar(vencida)).status).toBe(StatusUnidade.VENDIDA)
    expect(await prisma.saida.count({ where: { unidadeId: vencida.id } })).toBe(1)
  })

  it('revalida o FIFO do zero: se outra é mais antiga, a correção termina em bloqueio', async () => {
    const maisAntiga = await novaUnidade(5)
    const vencida = await novaUnidade(-3)

    const resposta = await chamar(CORRIGIR, { unidadeId: vencida.id, dataValidade: validadeEm(90) })

    const corpo = resposta.json()
    expect(corpo.revalidacao.veredito).toBe('BLOQUEAR_FIFO')
    expect(corpo.revalidacao.unidadeCorreta.id).toBe(maisAntiga.id)
    // Corrigida, sim; vendida, não — a correção não é um passe livre.
    expect((await recarregar(vencida)).status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(await eventosDe(prisma, 'ALERTA_FIFO_DISPARADO')).toHaveLength(1)
  })

  it('aceita correção para outra data passada e devolve EXCECAO_VENCIDO de novo', async () => {
    // O erro de digitação pode ter sido de dia ou de mês, não só de ano.
    // Exigir data futura transformaria a correção em lavagem de estoque vencido.
    const vencida = await novaUnidade(-400)

    const resposta = await chamar(CORRIGIR, { unidadeId: vencida.id, dataValidade: validadeEm(-10) })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().revalidacao.veredito).toBe('EXCECAO_VENCIDO')
    expect((await recarregar(vencida)).status).toBe(StatusUnidade.EM_ESTOQUE)
  })

  it('recusa correção que não corrige nada', async () => {
    const vencida = await novaUnidade(-5)

    const resposta = await chamar(CORRIGIR, {
      unidadeId: vencida.id,
      dataValidade: vencida.dataValidade.toISOString().slice(0, 10),
    })

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('VALIDADE_INALTERADA')
    expect(await eventosDe(prisma, 'VALIDADE_CORRIGIDA')).toHaveLength(0)
  })

  it('recusa data fora do formato de calendário antes de tocar no banco (RNF01)', async () => {
    const vencida = await novaUnidade(-5)

    const resposta = await chamar(CORRIGIR, { unidadeId: vencida.id, dataValidade: '2027-02-30' })

    expect(resposta.statusCode).toBe(400)
    expect(await eventosDe(prisma, 'VALIDADE_CORRIGIDA')).toHaveLength(0)
  })

  it('a revalidação grava LEITURA_QR_SAIDA, como qualquer passagem pela validação (RF12)', async () => {
    const vencida = await novaUnidade(-5)

    await chamar(CORRIGIR, { unidadeId: vencida.id, dataValidade: validadeEm(30), sessaoVendaId: SESSAO })

    const leituras = await eventosDe(prisma, 'LEITURA_QR_SAIDA')
    expect(leituras).toHaveLength(1)
    expect(leituras[0]?.payload).toMatchObject({ veredito: 'CONFIRMAR', sessaoVendaId: SESSAO })
  })
})

describe('caminho 2 — baixa por descarte (PRD 6.1, RF11)', () => {
  it('cria o Descarte, muda o status e registra DESCARTE_REGISTRADO', async () => {
    const vencida = await novaUnidade(-7)

    const resposta = await chamar(DESCARTAR, { unidadeId: vencida.id, motivo: 'Frasco vencido há uma semana.' })

    expect(resposta.statusCode).toBe(201)
    expect(resposta.json().resultado).toBe('DESCARTE_REGISTRADO')
    expect(resposta.json().unidade.produto.nome).toBe(perfume.nome)

    expect((await recarregar(vencida)).status).toBe(StatusUnidade.DESCARTADA)

    const descarte = await prisma.descarte.findUniqueOrThrow({ where: { unidadeId: vencida.id } })
    expect(descarte.motivo).toBe('Frasco vencido há uma semana.')
    expect(descarte.usuarioId).toBe(gestor.id)

    const [evento] = await eventosDe(prisma, 'DESCARTE_REGISTRADO')
    expect(evento?.unidadeId).toBe(vencida.id)
    expect(evento?.payload).toMatchObject({
      codigoQr: vencida.codigoQr,
      dataValidade: vencida.dataValidade.toISOString().slice(0, 10),
      motivo: 'Frasco vencido há uma semana.',
      sessaoVendaId: null,
    })
  })

  it('motivo ausente vira o texto padrão — a fricção fica no override, não aqui', async () => {
    const vencida = await novaUnidade(-7)

    await chamar(DESCARTAR, { unidadeId: vencida.id }, atendente)

    const descarte = await prisma.descarte.findUniqueOrThrow({ where: { unidadeId: vencida.id } })
    expect(descarte.motivo).toBe(MOTIVO_PADRAO_DE_DESCARTE)
  })

  it('grava o agrupador de atendimento no evento', async () => {
    const vencida = await novaUnidade(-7)

    await chamar(DESCARTAR, { unidadeId: vencida.id, sessaoVendaId: SESSAO })

    const [evento] = await eventosDe(prisma, 'DESCARTE_REGISTRADO')
    expect(evento?.payload).toMatchObject({ sessaoVendaId: SESSAO })
  })

  it('depois do descarte a leitura do mesmo código devolve UNIDADE_JA_BAIXADA', async () => {
    const vencida = await novaUnidade(-7)
    await chamar(DESCARTAR, { unidadeId: vencida.id })

    const resposta = await ler(vencida.codigoQr)

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toMatchObject({ veredito: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
  })

  it('não cria Saida nenhuma: descarte é perda, não venda', async () => {
    const vencida = await novaUnidade(-7)

    await chamar(DESCARTAR, { unidadeId: vencida.id })

    expect(await prisma.saida.count()).toBe(0)
  })
})

describe('caminho 3 — override de venda (PRD 6.1)', () => {
  it('cria a Saida marcada como venda de unidade vencida, com justificativa e autorizador', async () => {
    const vencida = await novaUnidade(-2)

    const resposta = await chamar(OVERRIDE, { unidadeId: vencida.id, justificativa: JUSTIFICATIVA })

    expect(resposta.statusCode).toBe(201)
    expect(resposta.json().resultado).toBe('VENDA_VENCIDA_AUTORIZADA')
    expect(resposta.json().saida.autorizadoPor).toEqual({ id: gestor.id, nome: gestor.nome })

    const saida = await prisma.saida.findUniqueOrThrow({ where: { unidadeId: vencida.id } })
    expect(saida.vendaDeUnidadeVencida).toBe(true)
    expect(saida.justificativaOverride).toBe(JUSTIFICATIVA)
    expect(saida.autorizadoPorId).toBe(gestor.id)
    expect(saida.usuarioId).toBe(gestor.id)
    expect((await recarregar(vencida)).status).toBe(StatusUnidade.VENDIDA)
  })

  it('não conta como acerto de FIFO: esta venda não passou pelo laço (RF12)', async () => {
    const vencida = await novaUnidade(-2)

    await chamar(OVERRIDE, { unidadeId: vencida.id, justificativa: JUSTIFICATIVA })

    const saida = await prisma.saida.findUniqueOrThrow({ where: { unidadeId: vencida.id } })
    expect(saida.alertaFifoDisparado).toBe(false)
    expect(saida.tentativasAteAcerto).toBe(0)
    // Nem passa pela validação: nenhuma leitura nova é inventada pelo override.
    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(0)
  })

  it('registra VENDA_VENCIDA_AUTORIZADA com a justificativa e quem autorizou', async () => {
    const vencida = await novaUnidade(-2)

    await chamar(OVERRIDE, { unidadeId: vencida.id, justificativa: JUSTIFICATIVA, sessaoVendaId: SESSAO })

    const [evento] = await eventosDe(prisma, 'VENDA_VENCIDA_AUTORIZADA')
    expect(evento?.unidadeId).toBe(vencida.id)
    expect(evento?.payload).toMatchObject({
      codigoQr: vencida.codigoQr,
      dataValidade: vencida.dataValidade.toISOString().slice(0, 10),
      justificativa: JUSTIFICATIVA,
      autorizadoPorId: gestor.id,
      sessaoVendaId: SESSAO,
    })
  })

  it('grava o agrupador na Saida, como qualquer saída do atendimento', async () => {
    const vencida = await novaUnidade(-2)

    await chamar(OVERRIDE, { unidadeId: vencida.id, justificativa: JUSTIFICATIVA, sessaoVendaId: SESSAO })

    const saida = await prisma.saida.findUniqueOrThrow({ where: { unidadeId: vencida.id } })
    expect(saida.sessaoVendaId).toBe(SESSAO)
  })

  it('recusa override sem justificativa', async () => {
    const vencida = await novaUnidade(-2)

    const resposta = await chamar(OVERRIDE, { unidadeId: vencida.id })

    expect(resposta.statusCode).toBe(400)
    expect(await prisma.saida.count()).toBe(0)
  })

  it('recusa justificativa curta demais — "ok" não é justificativa permanente', async () => {
    const vencida = await novaUnidade(-2)

    const resposta = await chamar(OVERRIDE, { unidadeId: vencida.id, justificativa: 'ok' })

    expect(resposta.statusCode).toBe(400)
    expect((await recarregar(vencida)).status).toBe(StatusUnidade.EM_ESTOQUE)
  })
})

describe('exceção de unidade vencida — concorrência (RNF02)', () => {
  // O lock é o que faz a segunda transação enxergar o desfecho da primeira e
  // responder 409 por estado. Sem ele, ela leria a linha antiga e estouraria na
  // restrição `@unique` de `Descarte.unidadeId` — que também impede a dupla
  // baixa, mas como exceção de banco no meio do atendimento.

  it('dois descartes simultâneos: um registra, o outro recebe 409', async () => {
    const vencida = await novaUnidade(-7)

    const respostas = await Promise.all([
      chamar(DESCARTAR, { unidadeId: vencida.id }, atendente),
      chamar(DESCARTAR, { unidadeId: vencida.id }, gestor),
    ])

    expect(respostas.map((r) => r.statusCode).sort()).toEqual([201, 409])
    expect(respostas.some((r) => r.statusCode === 409 && r.json().erro === 'UNIDADE_JA_BAIXADA')).toBe(true)
    expect(await prisma.descarte.count({ where: { unidadeId: vencida.id } })).toBe(1)
  })

  it('descarte e override simultâneos: só um caminho resolve a unidade', async () => {
    const vencida = await novaUnidade(-7)

    const respostas = await Promise.all([
      chamar(DESCARTAR, { unidadeId: vencida.id }, atendente),
      chamar(OVERRIDE, { unidadeId: vencida.id, justificativa: JUSTIFICATIVA }, gestor),
    ])

    expect(respostas.map((r) => r.statusCode).sort()).toEqual([201, 409])
    const descartes = await prisma.descarte.count({ where: { unidadeId: vencida.id } })
    const saidas = await prisma.saida.count({ where: { unidadeId: vencida.id } })
    expect(descartes + saidas).toBe(1)
  })

  it('descarte e leitura de QR simultâneos não produzem baixa dupla', async () => {
    const vencida = await novaUnidade(-7)

    const [descarte, leitura] = await Promise.all([
      chamar(DESCARTAR, { unidadeId: vencida.id }, atendente),
      ler(vencida.codigoQr),
    ])

    expect(descarte.statusCode).toBe(201)
    // A leitura de unidade vencida nunca baixa nada — ela ramifica para a
    // exceção. O que este caso prova é que a corrida não deixa a unidade num
    // estado que a leitura interprete como vendável.
    expect(['EXCECAO_VENCIDO', 'ERRO']).toContain(leitura.json().veredito)
    expect((await recarregar(vencida)).status).toBe(StatusUnidade.DESCARTADA)
    expect(await prisma.saida.count()).toBe(0)
  })
})
