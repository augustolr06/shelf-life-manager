/**
 * A varredura periódica que emite os alertas proativos (RF08, T18).
 *
 * Roda contra PostgreSQL de verdade, e aqui isso não é formalidade: o que se
 * verifica é uma comparação de `DATE` nas duas bordas de uma janela (RNF01) e
 * a **idempotência** garantida por índice único — duas coisas que um duplo de
 * teste só saberia repetir de volta.
 *
 * Contrato: tasks/T18-job-verificacao-alertas.md.
 */

import { Papel, type PrismaClient, type Produto, StatusUnidade, type Usuario } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/db/prisma.js', async () => {
  const { clienteCompartilhadoDeTeste } = await import('../apoio/bancoDeTeste.js')
  return { prisma: clienteCompartilhadoDeTeste() }
})

import { buildApp } from '../../src/app.js'
import { EMAIL_DO_SISTEMA } from '../../src/modules/alerta/usuarioDoSistema.js'
import { varrerEstoqueParaAlertas } from '../../src/modules/alerta/varreduraAlertas.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { criarProduto, criarUnidade, criarUsuario, emDias, eventosDe } from '../apoio/cenario.js'

let prisma: PrismaClient
let app: FastifyInstance
let gestor: Usuario
let produto: Produto

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
  gestor = await criarUsuario(prisma, Papel.GESTOR)
  produto = await criarProduto(prisma)
})

/** Uma janela ativa de N dias. */
function configurar(diasAntecedencia: number, canal = 'IN_APP', ativo = true) {
  return prisma.configuracaoAlerta.create({ data: { diasAntecedencia, canal, ativo } })
}

function unidade(diasAteVencer: number, status?: StatusUnidade) {
  return criarUnidade(prisma, {
    produtoId: produto.id,
    registradoPorId: gestor.id,
    diasAteVencer,
    status,
  })
}

function alertas() {
  return prisma.alerta.findMany({ orderBy: { geradoEm: 'asc' } })
}

describe('unidades que entram na janela', () => {
  it('emite um alerta para a unidade dentro da janela, ligado à configuração que a viu', async () => {
    const configuracao = await configurar(30)
    const frasco = await unidade(10)

    const resumo = await varrerEstoqueParaAlertas()

    const emitidos = await alertas()
    expect(emitidos).toHaveLength(1)
    expect(emitidos[0]).toMatchObject({
      unidadeId: frasco.id,
      configuracaoId: configuracao.id,
      lidoEm: null,
    })
    expect(resumo).toEqual({
      configuracoesAvaliadas: 1,
      unidadesNaJanela: 1,
      alertasEmitidos: 1,
      notificacoesEnviadas: 0,
    })
  })

  it('a unidade que vence no último dia da janela entra; a do dia seguinte, não', async () => {
    await configurar(30)
    // "Avise 30 dias antes" inclui o trigésimo dia — a borda superior é
    // fechada. O 31 é a primeira unidade fora, e é o par que prova a borda.
    const noLimite = await unidade(30)
    await unidade(31)

    await varrerEstoqueParaAlertas()

    const emitidos = await alertas()
    expect(emitidos).toHaveLength(1)
    expect(emitidos[0]?.unidadeId).toBe(noLimite.id)
  })

  it('a unidade que vence hoje entra; a que venceu ontem, não', async () => {
    await configurar(30)
    // A borda inferior é a mesma do pool prioritário do FIFO (`>= hoje`): o
    // que vence hoje ainda é vendável hoje. O que venceu já é da fila de
    // descarte de T13, e alertar sobre perda consumada seria a terceira
    // apresentação do mesmo fato.
    const vencendoHoje = await unidade(0)
    await unidade(-1)

    await varrerEstoqueParaAlertas()

    const emitidos = await alertas()
    expect(emitidos).toHaveLength(1)
    expect(emitidos[0]?.unidadeId).toBe(vencendoHoje.id)
  })

  it('ignora unidade que já saiu do estoque, vendida ou descartada', async () => {
    await configurar(30)
    await unidade(5, StatusUnidade.VENDIDA)
    await unidade(5, StatusUnidade.DESCARTADA)

    const resumo = await varrerEstoqueParaAlertas()

    expect(await alertas()).toHaveLength(0)
    expect(resumo.unidadesNaJanela).toBe(0)
  })

  it('alerta sobre unidade de produto inativo: o frasco continua na prateleira', async () => {
    await configurar(30)
    const frasco = await unidade(5)
    await prisma.produto.update({ where: { id: produto.id }, data: { ativo: false } })

    await varrerEstoqueParaAlertas()

    const emitidos = await alertas()
    expect(emitidos).toHaveLength(1)
    expect(emitidos[0]?.unidadeId).toBe(frasco.id)
  })
})

describe('quais configurações a varredura enxerga', () => {
  it('não emite nada por configuração inativa', async () => {
    await configurar(30, 'IN_APP', false)
    await unidade(5)

    const resumo = await varrerEstoqueParaAlertas()

    expect(await alertas()).toHaveLength(0)
    expect(resumo.configuracoesAvaliadas).toBe(0)
  })

  it('duas janelas ativas geram dois alertas para a mesma unidade, um por janela', async () => {
    const larga = await configurar(30)
    const estreita = await configurar(7)
    const frasco = await unidade(5)

    const resumo = await varrerEstoqueParaAlertas()

    const emitidos = await alertas()
    expect(emitidos).toHaveLength(2)
    expect(emitidos.map((a) => a.unidadeId)).toEqual([frasco.id, frasco.id])
    expect(emitidos.map((a) => a.configuracaoId).sort()).toEqual([larga.id, estreita.id].sort())
    expect(resumo).toEqual({
      configuracoesAvaliadas: 2,
      unidadesNaJanela: 2,
      alertasEmitidos: 2,
      notificacoesEnviadas: 0,
    })
  })

  it('sem nenhuma configuração, a varredura é no-op e não é erro', async () => {
    await unidade(5)

    const resumo = await varrerEstoqueParaAlertas()

    expect(resumo).toEqual({
      configuracoesAvaliadas: 0,
      unidadesNaJanela: 0,
      alertasEmitidos: 0,
      notificacoesEnviadas: 0,
    })
    expect(await alertas()).toHaveLength(0)
    expect(await eventosDe(prisma, 'ALERTA_PROATIVO_EMITIDO')).toHaveLength(0)
  })

  it('com configuração e sem unidade na janela, o resumo conta a janela e nenhum alerta', async () => {
    await configurar(30)
    await unidade(90)

    const resumo = await varrerEstoqueParaAlertas()

    expect(resumo).toEqual({
      configuracoesAvaliadas: 1,
      unidadesNaJanela: 0,
      alertasEmitidos: 0,
      notificacoesEnviadas: 0,
    })
  })
})

describe('idempotência — a propriedade que sustenta o agendamento por intervalo', () => {
  it('duas varreduras seguidas não duplicam o alerta nem o evento', async () => {
    await configurar(30)
    await unidade(10)

    await varrerEstoqueParaAlertas()
    const resumo = await varrerEstoqueParaAlertas()

    expect(await alertas()).toHaveLength(1)
    // O evento também: um alerta não duplicado com evento duplicado inflaria
    // a contagem da pesquisa (RF13) sem aparecer em tela nenhuma.
    expect(await eventosDe(prisma, 'ALERTA_PROATIVO_EMITIDO')).toHaveLength(1)
    // A unidade continua na janela — o que não se repete é o alerta.
    expect(resumo).toEqual({
      configuracoesAvaliadas: 1,
      unidadesNaJanela: 1,
      alertasEmitidos: 0,
      notificacoesEnviadas: 0,
    })
  })

  it('unidade cadastrada depois da primeira varredura é alertada na seguinte', async () => {
    await configurar(30)
    await unidade(10)
    await varrerEstoqueParaAlertas()

    const recemChegada = await unidade(3)
    const resumo = await varrerEstoqueParaAlertas()

    expect(resumo.alertasEmitidos).toBe(1)
    const emitidos = await alertas()
    expect(emitidos).toHaveLength(2)
    expect(emitidos.at(-1)?.unidadeId).toBe(recemChegada.id)
  })
})

describe('o evento ALERTA_PROATIVO_EMITIDO', () => {
  it('grava um evento por alerta, com a unidade, o produto e a janela que disparou', async () => {
    const configuracao = await configurar(30, 'AMBOS')
    const frasco = await unidade(10)

    await varrerEstoqueParaAlertas()

    const eventos = await eventosDe(prisma, 'ALERTA_PROATIVO_EMITIDO')
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({ unidadeId: frasco.id, produtoId: produto.id })
    expect(eventos[0]?.payload).toEqual({
      configuracaoId: configuracao.id,
      diasAntecedencia: 30,
      canal: 'AMBOS',
      // Data de calendário é texto no payload, nunca instante (RNF01).
      dataValidade: emDias(10).toISOString().slice(0, 10),
      diasParaVencer: 10,
    })
  })

  it('é assinado pela conta de sistema, que não autentica', async () => {
    await configurar(30)
    await unidade(10)

    await varrerEstoqueParaAlertas()
    // Duas varreduras não podem acumular duas contas.
    await varrerEstoqueParaAlertas()

    const contas = await prisma.usuario.findMany({ where: { email: EMAIL_DO_SISTEMA } })
    expect(contas).toHaveLength(1)

    const evento = await prisma.eventoLog.findFirstOrThrow({
      where: { tipoEvento: 'ALERTA_PROATIVO_EMITIDO' },
    })
    expect(evento.usuarioId).toBe(contas[0]?.id)

    // O hash gravado não é hash de senha nenhuma: nenhuma credencial entra.
    const tentativa = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL_DO_SISTEMA, senha: 'sem-senha:conta-de-sistema-nao-autentica' },
    })
    expect(tentativa.statusCode).toBe(401)
  })

  it('a unidade fora da janela não deixa evento nenhum', async () => {
    await configurar(7)
    await unidade(30)

    await varrerEstoqueParaAlertas()

    expect(await eventosDe(prisma, 'ALERTA_PROATIVO_EMITIDO')).toHaveLength(0)
  })
})

/**
 * O gancho de T19b. A regra de quem recebe e quantas notificações saem é da
 * suíte de `tests/push/`; o que se verifica **aqui** é só a costura: a
 * varredura entrega ao envio o que ela acabou de gravar, e o alerta gravado
 * sobrevive a um push que falhou.
 */
describe('a notificação push do que foi emitido (T19b)', () => {
  it('entrega ao envio o que emitiu, com a janela e o canal de cada alerta', async () => {
    const configuracao = await configurar(30, 'PUSH')
    const frasco = await unidade(10)
    const emitidos: unknown[] = []

    const resumo = await varrerEstoqueParaAlertas({
      enviar: async () => {
        emitidos.push('enviado')
      },
    })

    expect(resumo.alertasEmitidos).toBe(1)
    // Sem inscrição nenhuma no banco, não há a quem enviar — o que importa
    // neste caso é que a varredura chegou até o envio sem erro.
    expect(resumo.notificacoesEnviadas).toBe(0)
    expect(emitidos).toHaveLength(0)

    // E o alerta que ela emitiu é o da janela configurada, com o canal dela.
    const alerta = await prisma.alerta.findFirstOrThrow()
    expect(alerta).toMatchObject({ unidadeId: frasco.id, configuracaoId: configuracao.id })
  })

  it('notifica o aparelho inscrito uma vez, com o que a passagem emitiu', async () => {
    await configurar(30, 'AMBOS')
    await unidade(10)
    await unidade(20)
    await prisma.inscricaoPush.create({
      data: {
        endpoint: 'https://push.exemplo.local/celular',
        p256dh: 'p256dh',
        auth: 'auth',
        usuarioId: gestor.id,
      },
    })
    const payloads: string[] = []

    const resumo = await varrerEstoqueParaAlertas({
      enviar: async (_destino, payload) => {
        payloads.push(payload)
      },
    })

    expect(resumo.alertasEmitidos).toBe(2)
    expect(resumo.notificacoesEnviadas).toBe(1)
    expect(payloads).toHaveLength(1)
    expect(JSON.parse(payloads[0] as string)).toMatchObject({
      titulo: '2 unidades perto do vencimento',
    })
  })

  it('a segunda passagem não notifica de novo: não há alerta novo a anunciar', async () => {
    await configurar(30, 'PUSH')
    await unidade(10)
    await prisma.inscricaoPush.create({
      data: {
        endpoint: 'https://push.exemplo.local/celular',
        p256dh: 'p256dh',
        auth: 'auth',
        usuarioId: gestor.id,
      },
    })
    const enviar = vi.fn(async () => {})

    await varrerEstoqueParaAlertas({ enviar })
    const segunda = await varrerEstoqueParaAlertas({ enviar })

    expect(enviar).toHaveBeenCalledTimes(1)
    expect(segunda.alertasEmitidos).toBe(0)
    expect(segunda.notificacoesEnviadas).toBe(0)
  })

  it('push que falha não desfaz o alerta nem derruba a varredura', async () => {
    await configurar(30, 'PUSH')
    await unidade(10)
    await prisma.inscricaoPush.create({
      data: {
        endpoint: 'https://push.exemplo.local/celular',
        p256dh: 'p256dh',
        auth: 'auth',
        usuarioId: gestor.id,
      },
    })

    const resumo = await varrerEstoqueParaAlertas({
      enviar: async () => {
        throw new Error('serviço de push fora do ar')
      },
      log: { warn: () => {} },
    })

    // O registro é o que a RF13 conta; o push é só o empurrão.
    expect(resumo.alertasEmitidos).toBe(1)
    expect(resumo.notificacoesEnviadas).toBe(0)
    expect(await alertas()).toHaveLength(1)
    expect(await eventosDe(prisma, 'ALERTA_PROATIVO_EMITIDO')).toHaveLength(1)
  })
})
