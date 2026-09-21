/**
 * Os agregados do dashboard (RF13, T20).
 *
 * Roda contra PostgreSQL de verdade, como as suítes desde T06. O objeto de
 * teste é justamente o que não existe fora do banco: a comparação de `DATE` nas
 * bordas das faixas de vencimento (RNF01) e o recorte de período sobre colunas
 * de instante, que é onde o fuso do servidor pode escorregar um dia.
 *
 * Boa parte dos números é conferida **passando pelos endpoints reais** de T08,
 * T09 e T11, e não inserindo linhas à mão: o painel precisa contar o que o
 * núcleo grava, não o que a suíte imagina que ele grava.
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

import { buildApp } from '../../src/buildApp.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { cookieDeSessao, criarProduto, criarUnidade, criarUsuario } from '../apoio/cenario.js'
import { hojeComoData, textoDeData } from '../../src/shared/data.js'

const DASHBOARD = '/dashboard'
const JUSTIFICATIVA = 'Cliente ciente do vencimento e insistiu na compra.'

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

function novaUnidade(diasAteVencer: number, opcoes: { status?: StatusUnidade; produtoId?: string } = {}) {
  return criarUnidade(prisma, {
    produtoId: opcoes.produtoId ?? perfume.id,
    registradoPorId: gestor.id,
    diasAteVencer,
    ...(opcoes.status ? { status: opcoes.status } : {}),
  })
}

function consultar(parametros = '', usuario: Usuario = gestor) {
  return app.inject({
    method: 'GET',
    url: `${DASHBOARD}${parametros}`,
    cookies: cookieDeSessao(app, usuario),
  })
}

function chamar(rota: string, corpo: Record<string, unknown>, usuario: Usuario = gestor) {
  return app.inject({ method: 'POST', url: rota, cookies: cookieDeSessao(app, usuario), payload: corpo })
}

/**
 * A data de calendário a N dias de hoje, no formato da API — derivada dos
 * componentes **locais**, que é a noção de "hoje" do servidor (`hojeComoData`).
 */
function dataEm(dias: number): string {
  const agora = new Date()
  const data = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + dias)
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${data.getFullYear()}-${mes}-${dia}`
}

/** Um instante dentro do dia a N dias de hoje, na hora local indicada. */
function instanteEm(dias: number, hora = 12): Date {
  const agora = new Date()
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + dias, hora)
}

/** Uma saída já gravada, posicionada no tempo — o que o painel vai contar. */
async function saidaGravada(opcoes: {
  diasAtras: number
  hora?: number
  tentativasAteAcerto?: number
  vendaDeUnidadeVencida?: boolean
}) {
  const unidade = await novaUnidade(30, { status: StatusUnidade.VENDIDA })
  const tentativas = opcoes.tentativasAteAcerto ?? 0
  return prisma.saida.create({
    data: {
      unidadeId: unidade.id,
      usuarioId: atendente.id,
      dataHora: instanteEm(-opcoes.diasAtras, opcoes.hora ?? 12),
      tentativasAteAcerto: tentativas,
      alertaFifoDisparado: tentativas > 0,
      vendaDeUnidadeVencida: opcoes.vendaDeUnidadeVencida ?? false,
      ...(opcoes.vendaDeUnidadeVencida
        ? { justificativaOverride: JUSTIFICATIVA, autorizadoPorId: gestor.id }
        : {}),
    },
  })
}

async function descarteGravado(diasAtras: number, hora = 12) {
  const unidade = await novaUnidade(-5, { status: StatusUnidade.DESCARTADA })
  return prisma.descarte.create({
    data: {
      unidadeId: unidade.id,
      usuarioId: gestor.id,
      dataHora: instanteEm(-diasAtras, hora),
      motivo: 'Vencida na prateleira',
    },
  })
}

function faixa(corpo: { estoque: { porFaixaDeVencimento: { faixa: string; unidades: number }[] } }, nome: string) {
  return corpo.estoque.porFaixaDeVencimento.find((contagem) => contagem.faixa === nome)?.unidades
}

describe('dashboard — acesso (RF01, RF13)', () => {
  it('recusa sem sessão', async () => {
    const resposta = await app.inject({ method: 'GET', url: DASHBOARD })

    expect(resposta.statusCode).toBe(401)
    expect(resposta.json().erro).toBe('NAO_AUTENTICADO')
  })

  it('recusa atendente: o painel é decisão comercial e dado de pesquisa, não balcão', async () => {
    const resposta = await consultar('', atendente)

    expect(resposta.statusCode).toBe(403)
    expect(resposta.json().erro).toBe('PAPEL_INSUFICIENTE')
  })
})

describe('dashboard — faixas de vencimento (RF13)', () => {
  it('põe cada unidade na faixa da sua borda', async () => {
    // As sete bordas das cinco faixas, uma unidade em cada.
    for (const dias of [-1, 0, 7, 8, 30, 31, 90, 91]) await novaUnidade(dias)

    const corpo = (await consultar()).json()

    expect(faixa(corpo, 'VENCIDA')).toBe(1) // -1
    expect(faixa(corpo, 'ATE_7_DIAS')).toBe(2) // 0 e 7
    expect(faixa(corpo, 'DE_8_A_30_DIAS')).toBe(2) // 8 e 30
    expect(faixa(corpo, 'DE_31_A_90_DIAS')).toBe(2) // 31 e 90
    expect(faixa(corpo, 'ACIMA_DE_90_DIAS')).toBe(1) // 91
  })

  it('a unidade que vence hoje abre a primeira faixa não-vencida, não a de vencidas', async () => {
    // É a mesma borda do passo 4 de `validarSaidaFifo` e da fila de T13:
    // vender hoje o que vence hoje é legítimo, e o painel não pode contradizer
    // o fluxo de saída.
    await novaUnidade(0)

    const corpo = (await consultar()).json()

    expect(faixa(corpo, 'VENCIDA')).toBe(0)
    expect(faixa(corpo, 'ATE_7_DIAS')).toBe(1)
  })

  it('as cinco faixas saem sempre, inclusive zeradas, e somam o estoque', async () => {
    for (const dias of [-3, 2, 45, 200]) await novaUnidade(dias)

    const corpo = (await consultar()).json()

    expect(corpo.estoque.porFaixaDeVencimento.map((c: { faixa: string }) => c.faixa)).toEqual([
      'VENCIDA',
      'ATE_7_DIAS',
      'DE_8_A_30_DIAS',
      'DE_31_A_90_DIAS',
      'ACIMA_DE_90_DIAS',
    ])
    // Faixa vazia é zero, não ausência: buraco na lista viraria buraco no
    // gráfico da T21 e sugeriria dado que não foi apurado.
    expect(faixa(corpo, 'DE_8_A_30_DIAS')).toBe(0)

    const soma = corpo.estoque.porFaixaDeVencimento.reduce(
      (total: number, contagem: { unidades: number }) => total + contagem.unidades,
      0,
    )
    expect(soma).toBe(corpo.estoque.unidadesEmEstoque)
    expect(soma).toBe(4)
  })

  it('conta só o que está em estoque; vendida e descartada ficam de fora', async () => {
    await novaUnidade(10)
    await novaUnidade(10, { status: StatusUnidade.VENDIDA })
    await novaUnidade(-10, { status: StatusUnidade.DESCARTADA })

    const corpo = (await consultar()).json()

    expect(corpo.estoque.unidadesEmEstoque).toBe(1)
    expect(faixa(corpo, 'VENCIDA')).toBe(0)
  })

  it('unidade de produto inativo continua contando: o frasco está na prateleira', async () => {
    const descontinuado = await criarProduto(prisma, 'Colônia descontinuada')
    await novaUnidade(20, { produtoId: descontinuado.id })
    await prisma.produto.update({ where: { id: descontinuado.id }, data: { ativo: false } })

    expect((await consultar()).json().estoque.unidadesEmEstoque).toBe(1)
  })

  it('as vencidas em estoque repetem a faixa VENCIDA, e é a mesma conta da fila de T13', async () => {
    for (const dias of [-1, -30]) await novaUnidade(dias)

    const corpo = (await consultar()).json()
    const fila = await app.inject({
      method: 'GET',
      url: '/descartes/pendentes',
      cookies: cookieDeSessao(app, gestor),
    })

    expect(corpo.perdas.unidadesVencidasEmEstoque).toBe(2)
    expect(corpo.perdas.unidadesVencidasEmEstoque).toBe(faixa(corpo, 'VENCIDA'))
    // Uma definição só de "vencido" no sistema inteiro.
    expect(corpo.perdas.unidadesVencidasEmEstoque).toBe(fila.json().total)
  })
})

describe('dashboard — recorte de período (RF13)', () => {
  it('usa os últimos 30 dias quando não recebe de/ate', async () => {
    await saidaGravada({ diasAtras: 0 })
    await saidaGravada({ diasAtras: 29 })
    await saidaGravada({ diasAtras: 40 })

    const corpo = (await consultar()).json()

    expect(corpo.periodo).toEqual({ de: dataEm(-29), ate: dataEm(0) })
    // 30 dias são hoje mais os 29 anteriores; a de 40 dias atrás fica fora.
    expect(corpo.saidas.total).toBe(2)
  })

  it('inclui as duas pontas do período e exclui os dias vizinhos', async () => {
    await saidaGravada({ diasAtras: 4, hora: 23 })
    await saidaGravada({ diasAtras: 3, hora: 0 })
    await saidaGravada({ diasAtras: 1, hora: 23 })
    await saidaGravada({ diasAtras: 0, hora: 0 })

    const corpo = (await consultar(`?de=${dataEm(-3)}&ate=${dataEm(-1)}`)).json()

    expect(corpo.saidas.total).toBe(2)
    expect(corpo.periodo).toEqual({ de: dataEm(-3), ate: dataEm(-1) })
  })

  it('a venda da noite conta no dia em que aconteceu na loja, não no dia UTC', async () => {
    // Em BRT (UTC-3), 22h de hoje é 01h de amanhã em UTC. Com o corte ancorado
    // na meia-noite UTC — o que `dataDeString()` faria —, esta venda cairia no
    // relatório de amanhã e sumiria do de hoje. É a mesma classe de erro que a
    // RNF01 evita na validade, entrando pela porta do recorte.
    await saidaGravada({ diasAtras: 0, hora: 22 })

    const corpo = (await consultar(`?de=${dataEm(0)}&ate=${dataEm(0)}`)).json()

    expect(corpo.saidas.total).toBe(1)
  })

  it('o estoque ignora o período: é fotografia do agora', async () => {
    await novaUnidade(15)

    // Um período inteiramente no passado, sem nenhum fato dentro.
    const corpo = (await consultar(`?de=${dataEm(-200)}&ate=${dataEm(-190)}`)).json()

    expect(corpo.estoque.unidadesEmEstoque).toBe(1)
    expect(corpo.saidas.total).toBe(0)
  })

  it('recusa período invertido com 400 PERIODO_INVALIDO', async () => {
    const resposta = await consultar(`?de=${dataEm(0)}&ate=${dataEm(-10)}`)

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('PERIODO_INVALIDO')
    expect(resposta.json().mensagem).toMatch(/posterior/)
  })

  it('aceita período de um dia só', async () => {
    await saidaGravada({ diasAtras: 2 })

    const corpo = (await consultar(`?de=${dataEm(-2)}&ate=${dataEm(-2)}`)).json()

    expect(corpo.saidas.total).toBe(1)
  })

  it('recusa data malformada com 400 CORPO_INVALIDO', async () => {
    const resposta = await consultar('?de=ontem')

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('CORPO_INVALIDO')
    expect(resposta.json().campos).toContain('de')
  })
})

describe('dashboard — FIFO e taxa de acerto (RF12, RF13)', () => {
  it('conta bloqueio e substituição efetiva a partir do que o núcleo grava', async () => {
    // Cenário do PRD: duas unidades do mesmo SKU, a atendente pega a de
    // validade mais longa duas vezes antes de pegar a certa.
    const prioritaria = await novaUnidade(10)
    const errada = await novaUnidade(60)

    const ler = (codigoQr: string) => chamar('/saidas/ler', { codigoQr }, atendente)
    expect((await ler(errada.codigoQr)).json().veredito).toBe('BLOQUEAR_FIFO')
    expect((await ler(errada.codigoQr)).json().veredito).toBe('BLOQUEAR_FIFO')
    expect((await ler(prioritaria.codigoQr)).json().veredito).toBe('CONFIRMAR')

    const corpo = (await consultar()).json()

    // O "vs." literal da RF13: dois bloqueios, uma substituição efetiva.
    expect(corpo.fifo).toEqual({ alertasDisparados: 2, substituicoesEfetivas: 1 })
    expect(corpo.saidas).toEqual({
      total: 1,
      naPrimeiraLeitura: 0,
      taxaAcertoPrimeiraLeitura: 0,
    })
  })

  it('venda na primeira leitura dá taxa 1 e nenhum bloqueio', async () => {
    const unidade = await novaUnidade(10)

    await chamar('/saidas/ler', { codigoQr: unidade.codigoQr }, atendente)

    const corpo = (await consultar()).json()

    expect(corpo.fifo).toEqual({ alertasDisparados: 0, substituicoesEfetivas: 0 })
    expect(corpo.saidas.taxaAcertoPrimeiraLeitura).toBe(1)
  })

  it('taxa é null, nunca 0, quando não houve saída no período', async () => {
    await novaUnidade(10)

    const corpo = (await consultar()).json()

    // "0% de acerto" e "nenhuma venda ainda" são fatos opostos.
    expect(corpo.saidas).toEqual({ total: 0, naPrimeiraLeitura: 0, taxaAcertoPrimeiraLeitura: null })
  })

  it('arredonda a taxa a quatro casas', async () => {
    await saidaGravada({ diasAtras: 1 })
    for (const _ of [1, 2]) await saidaGravada({ diasAtras: 1, tentativasAteAcerto: 1 })

    const corpo = (await consultar()).json()

    expect(corpo.saidas.taxaAcertoPrimeiraLeitura).toBe(0.3333)
  })

  it('o bloqueio fora do período não entra na contagem', async () => {
    const prioritaria = await novaUnidade(10)
    const errada = await novaUnidade(60)
    await chamar('/saidas/ler', { codigoQr: errada.codigoQr }, atendente)
    await chamar('/saidas/ler', { codigoQr: prioritaria.codigoQr }, atendente)

    const corpo = (await consultar(`?de=${dataEm(-10)}&ate=${dataEm(-5)}`)).json()

    expect(corpo.fifo).toEqual({ alertasDisparados: 0, substituicoesEfetivas: 0 })
  })
})

describe('dashboard — perdas e overrides (RF09, RF13, PRD 6.1)', () => {
  it('conta o descarte do período e tira a unidade do estoque', async () => {
    const vencida = await novaUnidade(-5)

    await chamar('/excecao-vencido/descartar', { unidadeId: vencida.id, motivo: 'Frasco vencido' })

    const corpo = (await consultar()).json()

    expect(corpo.perdas.descartes).toBe(1)
    expect(corpo.estoque.unidadesEmEstoque).toBe(0)
    // O mesmo frasco visto pelos dois recortes: saiu do estoque de agora e
    // entrou na perda do período.
    expect(corpo.perdas.unidadesVencidasEmEstoque).toBe(0)
  })

  it('descarte fora do período não conta', async () => {
    await descarteGravado(60)

    expect((await consultar()).json().perdas.descartes).toBe(0)
  })

  it('o override conta como override e como saída, mas não como substituição efetiva', async () => {
    const vencida = await novaUnidade(-2)

    await chamar('/excecao-vencido/override', { unidadeId: vencida.id, justificativa: JUSTIFICATIVA })

    const corpo = (await consultar()).json()

    expect(corpo.overrides.total).toBe(1)
    expect(corpo.saidas.total).toBe(1)
    // Não passou pelo laço do FIFO: `tentativasAteAcerto` é 0 e nenhum
    // `ALERTA_FIFO_DISPARADO` foi gravado.
    expect(corpo.fifo).toEqual({ alertasDisparados: 0, substituicoesEfetivas: 0 })
  })

  it('venda comum não infla o contador de override', async () => {
    const unidade = await novaUnidade(10)

    await chamar('/saidas/ler', { codigoQr: unidade.codigoQr }, atendente)

    expect((await consultar()).json().overrides.total).toBe(0)
  })
})

describe('dashboard — estado inicial e efeitos colaterais', () => {
  it('banco vazio responde 200 com tudo zerado e as cinco faixas presentes', async () => {
    const resposta = await consultar()

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toMatchObject({
      estoque: { unidadesEmEstoque: 0 },
      saidas: { total: 0, naPrimeiraLeitura: 0, taxaAcertoPrimeiraLeitura: null },
      fifo: { alertasDisparados: 0, substituicoesEfetivas: 0 },
      perdas: { descartes: 0, unidadesVencidasEmEstoque: 0 },
      overrides: { total: 0 },
    })
    expect(resposta.json().estoque.porFaixaDeVencimento).toHaveLength(5)
  })

  it('não grava evento nenhum: consultar o painel não é ato operacional', async () => {
    await novaUnidade(10)

    await consultar()

    // E menos ainda nesta tabela, que é de onde o painel lê.
    expect(await prisma.eventoLog.count()).toBe(0)
  })

  it('o período volta ecoado no formato de data de calendário', async () => {
    const corpo = (await consultar(`?de=${dataEm(-7)}&ate=${dataEm(0)}`)).json()

    expect(corpo.periodo).toEqual({ de: dataEm(-7), ate: textoDeData(hojeComoData()) })
  })
})
