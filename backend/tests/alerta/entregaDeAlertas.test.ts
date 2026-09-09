/**
 * A entrega do alerta proativo (RF08, T19): a listagem que o gestor vê e a
 * marcação de lido.
 *
 * Roda contra PostgreSQL de verdade, como as demais suítes de `tests/alerta/`.
 * O que só o banco responde aqui: que a ordenação por um campo da *relação*
 * (a validade da unidade) sai na ordem pedida, que `naoLidos` não segue o
 * filtro da página, e que a segunda marcação não escreve um segundo `lidoEm`
 * nem um segundo `ALERTA_LIDO`.
 *
 * Contrato: tasks/T19-entrega-do-alerta.md · docs/arquitetura.md seção 5.
 */

import { Papel, StatusUnidade, type PrismaClient, type Usuario } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/db/prisma.js', async () => {
  const { clienteCompartilhadoDeTeste } = await import('../apoio/bancoDeTeste.js')
  return { prisma: clienteCompartilhadoDeTeste() }
})

import { buildApp } from '../../src/app.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { cookieDeSessao, criarProduto, criarUnidade, criarUsuario, eventosDe } from '../apoio/cenario.js'

const ROTA = '/alertas'

let prisma: PrismaClient
let app: FastifyInstance
let atendente: Usuario
let gestor: Usuario
let produtoId: string

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
  produtoId = (await criarProduto(prisma)).id
})

function comoGestor(opcoes: { method: 'GET' | 'POST'; url: string }) {
  return app.inject({ ...opcoes, cookies: cookieDeSessao(app, gestor) })
}

function listar(consulta = ''): ReturnType<typeof comoGestor> {
  return comoGestor({ method: 'GET', url: `${ROTA}${consulta}` })
}

function janela(diasAntecedencia: number, canal = 'IN_APP') {
  return prisma.configuracaoAlerta.create({ data: { diasAntecedencia, canal } })
}

/**
 * Uma unidade posicionada no calendário, já alertada por uma janela — o estado
 * em que a varredura de T18 deixa o banco. Escrito direto, e não chamando a
 * varredura: o objeto de teste aqui é a entrega, e depender da emissão faria
 * uma falha de T18 aparecer como falha desta suíte.
 */
async function alertar(opcoes: {
  configuracaoId: string
  diasAteVencer: number
  status?: StatusUnidade
  lidoEm?: Date
}) {
  const unidade = await criarUnidade(prisma, {
    produtoId,
    registradoPorId: gestor.id,
    diasAteVencer: opcoes.diasAteVencer,
    status: opcoes.status ?? StatusUnidade.EM_ESTOQUE,
  })

  const alerta = await prisma.alerta.create({
    data: {
      unidadeId: unidade.id,
      configuracaoId: opcoes.configuracaoId,
      lidoEm: opcoes.lidoEm ?? null,
    },
  })

  return { unidade, alerta }
}

describe('GET /alertas', () => {
  it('lista o alerta com a unidade, a janela e os dias que faltam', async () => {
    const configuracao = await janela(30)
    const { unidade } = await alertar({ configuracaoId: configuracao.id, diasAteVencer: 12 })

    const resposta = await listar()
    const corpo = resposta.json()

    expect(resposta.statusCode).toBe(200)
    expect(corpo.total).toBe(1)
    expect(corpo.naoLidos).toBe(1)
    expect(corpo.pagina).toBe(1)
    expect(corpo.tamanhoPagina).toBe(20)
    expect(corpo.alertas).toHaveLength(1)

    const [item] = corpo.alertas
    expect(item.unidade.id).toBe(unidade.id)
    expect(item.unidade.codigoQr).toBe(unidade.codigoQr)
    expect(item.unidade.produto.id).toBe(produtoId)
    expect(item.janela).toEqual({
      configuracaoId: configuracao.id,
      diasAntecedencia: 30,
      canal: 'IN_APP',
    })
    expect(item.diasParaVencer).toBe(12)
    expect(item.situacao).toBe('NA_JANELA')
    expect(item.lidoEm).toBeNull()
    // Validade é data de calendário, nunca instante (RNF01); `geradoEm` é o
    // contrário: instante de quando a varredura rodou.
    expect(item.unidade.dataValidade).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(item.geradoEm).toContain('T')
  })

  it('conta como NA_JANELA a unidade que vence hoje', async () => {
    const configuracao = await janela(30)
    await alertar({ configuracaoId: configuracao.id, diasAteVencer: 0 })

    const [item] = (await listar()).json().alertas

    expect(item.diasParaVencer).toBe(0)
    expect(item.situacao).toBe('NA_JANELA')
  })

  it('mantém na lista, marcado como VENCIDA, o alerta cuja unidade venceu depois de emitido', async () => {
    // O caso que mede se a RF08 funcionou: a loja foi avisada e o frasco
    // venceu assim mesmo. Some-lo apagaria da tela justamente esse fato
    // (Decisão 3).
    const configuracao = await janela(30)
    await alertar({ configuracaoId: configuracao.id, diasAteVencer: -3 })

    const [item] = (await listar()).json().alertas

    expect(item.situacao).toBe('VENCIDA')
    expect(item.diasParaVencer).toBe(-3)
  })

  it('omite o alerta da unidade vendida', async () => {
    const configuracao = await janela(30)
    await alertar({
      configuracaoId: configuracao.id,
      diasAteVencer: 10,
      status: StatusUnidade.VENDIDA,
    })

    const corpo = (await listar()).json()

    expect(corpo.alertas).toHaveLength(0)
    expect(corpo.total).toBe(0)
    expect(corpo.naoLidos).toBe(0)
  })

  it('omite o alerta da unidade descartada', async () => {
    const configuracao = await janela(30)
    await alertar({
      configuracaoId: configuracao.id,
      diasAteVencer: 10,
      status: StatusUnidade.DESCARTADA,
    })

    expect((await listar()).json().alertas).toHaveLength(0)
  })

  it('mantém o alerta cuja janela foi inativada depois da emissão', async () => {
    // Inativar diz "não emita mais" (T17), não "desfaça o que foi emitido".
    const configuracao = await janela(30)
    await alertar({ configuracaoId: configuracao.id, diasAteVencer: 10 })
    await prisma.configuracaoAlerta.update({
      where: { id: configuracao.id },
      data: { ativo: false },
    })

    expect((await listar()).json().alertas).toHaveLength(1)
  })

  it('ordena por validade crescente, do mais urgente ao menos', async () => {
    const configuracao = await janela(60)
    await alertar({ configuracaoId: configuracao.id, diasAteVencer: 20 })
    await alertar({ configuracaoId: configuracao.id, diasAteVencer: 3 })
    await alertar({ configuracaoId: configuracao.id, diasAteVencer: 11 })

    const dias = (await listar()).json().alertas.map((a: { diasParaVencer: number }) => a.diasParaVencer)

    expect(dias).toEqual([3, 11, 20])
  })

  it('pagina sem perder o total da lista inteira', async () => {
    const configuracao = await janela(60)
    await alertar({ configuracaoId: configuracao.id, diasAteVencer: 5 })
    await alertar({ configuracaoId: configuracao.id, diasAteVencer: 9 })
    await alertar({ configuracaoId: configuracao.id, diasAteVencer: 14 })

    const primeira = (await listar('?tamanhoPagina=2')).json()
    const segunda = (await listar('?pagina=2&tamanhoPagina=2')).json()

    expect(primeira.alertas).toHaveLength(2)
    expect(segunda.alertas).toHaveLength(1)
    expect(primeira.total).toBe(3)
    expect(segunda.total).toBe(3)
    expect(segunda.alertas[0].diasParaVencer).toBe(14)
  })

  it('recusa tamanho de página acima do máximo', async () => {
    const resposta = await listar('?tamanhoPagina=500')

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erro).toBe('CORPO_INVALIDO')
  })

  it('filtra os já lidos com apenasNaoLidos, sem mexer no contador', async () => {
    const configuracao = await janela(30)
    await alertar({ configuracaoId: configuracao.id, diasAteVencer: 4, lidoEm: new Date() })
    await alertar({ configuracaoId: configuracao.id, diasAteVencer: 8 })

    const todos = (await listar()).json()
    const filtrados = (await listar('?apenasNaoLidos=true')).json()

    expect(todos.alertas).toHaveLength(2)
    expect(filtrados.alertas).toHaveLength(1)
    expect(filtrados.alertas[0].diasParaVencer).toBe(8)
    expect(filtrados.total).toBe(1)
    // O contador da navegação não depende de onde a gestora está olhando.
    expect(todos.naoLidos).toBe(1)
    expect(filtrados.naoLidos).toBe(1)
  })

  it('devolve lista vazia, e não 404, quando não há alerta nenhum', async () => {
    const resposta = await listar()

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toMatchObject({ alertas: [], total: 0, naoLidos: 0 })
  })

  it('não grava evento ao listar', async () => {
    const configuracao = await janela(30)
    await alertar({ configuracaoId: configuracao.id, diasAteVencer: 6 })

    await listar()

    expect(await prisma.eventoLog.count()).toBe(0)
  })

  it('recusa ATENDENTE com 403 e anônimo com 401', async () => {
    const comoAtendente = await app.inject({
      method: 'GET',
      url: ROTA,
      cookies: cookieDeSessao(app, atendente),
    })
    const anonimo = await app.inject({ method: 'GET', url: ROTA })

    expect(comoAtendente.statusCode).toBe(403)
    expect(comoAtendente.json().erro).toBe('PAPEL_INSUFICIENTE')
    expect(anonimo.statusCode).toBe(401)
  })
})

describe('POST /alertas/:id/lido', () => {
  it('marca o alerta e devolve o estado novo', async () => {
    const configuracao = await janela(30)
    const { alerta } = await alertar({ configuracaoId: configuracao.id, diasAteVencer: 7 })

    const resposta = await comoGestor({ method: 'POST', url: `${ROTA}/${alerta.id}/lido` })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json().alerta.lidoEm).not.toBeNull()

    const persistido = await prisma.alerta.findUniqueOrThrow({ where: { id: alerta.id } })
    expect(persistido.lidoEm).not.toBeNull()
  })

  it('grava um ALERTA_LIDO assinado pelo gestor, com o payload completo', async () => {
    const configuracao = await janela(30)
    const { alerta, unidade } = await alertar({ configuracaoId: configuracao.id, diasAteVencer: 9 })

    await comoGestor({ method: 'POST', url: `${ROTA}/${alerta.id}/lido` })

    const eventos = await eventosDe(prisma, 'ALERTA_LIDO')
    expect(eventos).toHaveLength(1)

    const [evento] = eventos
    expect(evento?.unidadeId).toBe(unidade.id)
    expect(evento?.produtoId).toBe(produtoId)
    // Assinado por quem leu — a conta de sistema de T18 assina só o que não
    // tem autor humano.
    expect(evento?.usuarioId).toBe(gestor.id)
    expect(evento?.payload).toMatchObject({
      alertaId: alerta.id,
      configuracaoId: configuracao.id,
      diasAntecedencia: 30,
      diasParaVencer: 9,
    })
    // Data de calendário no payload é texto, nunca instante.
    expect((evento?.payload as { dataValidade: string }).dataValidade).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    )
  })

  it('é idempotente: a segunda chamada mantém o instante e não grava outro evento', async () => {
    const configuracao = await janela(30)
    const { alerta } = await alertar({ configuracaoId: configuracao.id, diasAteVencer: 5 })

    const primeira = await comoGestor({ method: 'POST', url: `${ROTA}/${alerta.id}/lido` })
    const segunda = await comoGestor({ method: 'POST', url: `${ROTA}/${alerta.id}/lido` })

    expect(segunda.statusCode).toBe(200)
    expect(segunda.json().alerta.lidoEm).toBe(primeira.json().alerta.lidoEm)
    expect(await prisma.eventoLog.count({ where: { tipoEvento: 'ALERTA_LIDO' } })).toBe(1)
  })

  it('derruba o contador de não lidos', async () => {
    const configuracao = await janela(30)
    const { alerta } = await alertar({ configuracaoId: configuracao.id, diasAteVencer: 5 })
    await alertar({ configuracaoId: configuracao.id, diasAteVencer: 15 })

    expect((await listar()).json().naoLidos).toBe(2)

    await comoGestor({ method: 'POST', url: `${ROTA}/${alerta.id}/lido` })

    const depois = (await listar()).json()
    // O alerta lido continua na lista sem filtro: marcar não esconde nada.
    expect(depois.alertas).toHaveLength(2)
    expect(depois.naoLidos).toBe(1)
  })

  it('devolve 404 para id inexistente', async () => {
    const resposta = await comoGestor({
      method: 'POST',
      url: `${ROTA}/00000000-0000-4000-8000-000000000000/lido`,
    })

    expect(resposta.statusCode).toBe(404)
    expect(resposta.json().erro).toBe('ALERTA_NAO_ENCONTRADO')
  })

  it('recusa ATENDENTE com 403 e anônimo com 401', async () => {
    const configuracao = await janela(30)
    const { alerta } = await alertar({ configuracaoId: configuracao.id, diasAteVencer: 5 })
    const url = `${ROTA}/${alerta.id}/lido`

    const comoAtendente = await app.inject({
      method: 'POST',
      url,
      cookies: cookieDeSessao(app, atendente),
    })
    const anonimo = await app.inject({ method: 'POST', url })

    expect(comoAtendente.statusCode).toBe(403)
    expect(anonimo.statusCode).toBe(401)
    // E nada foi marcado por tentativa recusada.
    expect((await prisma.alerta.findUniqueOrThrow({ where: { id: alerta.id } })).lidoEm).toBeNull()
  })
})
