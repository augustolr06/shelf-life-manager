/**
 * O envio da notificação push (RF08, T19b).
 *
 * Roda contra PostgreSQL de verdade porque o que se verifica são regras sobre
 * as **linhas**: quem é alvo (o papel do dono do aparelho, conferido no momento
 * do envio) e o que acontece com a inscrição morta (apagada no 410). O
 * remetente, esse sim, é falso — o que se testa é a regra, não a biblioteca
 * nem a rede, do mesmo modo que a suíte do agendador de T18 injeta a varredura.
 *
 * Contrato: tasks/T19b-notificacao-push.md.
 */

import { Papel, type PrismaClient, type Usuario } from '@prisma/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/db/prisma.js', async () => {
  const { clienteCompartilhadoDeTeste } = await import('../apoio/bancoDeTeste.js')
  return { prisma: clienteCompartilhadoDeTeste() }
})

import {
  enviarNotificacoesPush,
  type DestinoPush,
  type RemetentePush,
} from '../../src/modules/push/envioPush.js'
import type { AlertaEmitido } from '../../src/modules/push/mensagemPush.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { criarUsuario } from '../apoio/cenario.js'

let prisma: PrismaClient
let gestor: Usuario
let atendente: Usuario

/** Um remetente que só anota o que recebeu. */
function remetenteQueAnota(): { enviar: RemetentePush; enviados: { destino: DestinoPush; payload: string }[] } {
  const enviados: { destino: DestinoPush; payload: string }[] = []
  return {
    enviados,
    enviar: async (destino, payload) => {
      enviados.push({ destino, payload })
    },
  }
}

/** O erro que o serviço de push devolve, no formato que a `web-push` lança. */
function erroDePush(statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(`push respondeu ${statusCode}`), { statusCode })
}

/** Um logger mudo, para as falhas esperadas não poluírem a saída da suíte. */
const logMudo = { warn: () => {} }

function inscrever(usuario: Usuario, endpoint: string) {
  return prisma.inscricaoPush.create({
    data: { endpoint, p256dh: 'p256dh', auth: 'auth', usuarioId: usuario.id },
  })
}

const UM_ALERTA: AlertaEmitido[] = [{ unidadeId: 'unidade-1', diasAntecedencia: 30, canal: 'PUSH' }]

beforeAll(async () => {
  await prepararBancoDeTeste()
  prisma = clienteCompartilhadoDeTeste()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await limparBanco(prisma)
  gestor = await criarUsuario(prisma, Papel.GESTOR)
  atendente = await criarUsuario(prisma, Papel.ATENDENTE)
  process.env.VAPID_PUBLIC_KEY = 'chave-publica-de-teste'
  process.env.VAPID_PRIVATE_KEY = 'chave-privada-de-teste'
})

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
})

describe('quem recebe', () => {
  it('envia uma notificação por aparelho, e não uma por unidade alertada', async () => {
    await inscrever(gestor, 'https://push.exemplo.local/celular')
    const lote: AlertaEmitido[] = Array.from({ length: 40 }, (_, indice) => ({
      unidadeId: `unidade-${indice}`,
      diasAntecedencia: 30,
      canal: 'PUSH',
    }))
    const remetente = remetenteQueAnota()

    const resumo = await enviarNotificacoesPush(lote, { enviar: remetente.enviar })

    expect(resumo.notificacoesEnviadas).toBe(1)
    expect(remetente.enviados).toHaveLength(1)
    expect(JSON.parse(remetente.enviados[0]!.payload)).toEqual({
      titulo: '40 unidades perto do vencimento',
      corpo: 'Janela de 30 dias. Toque para ver a lista.',
      url: '/alertas',
    })
  })

  it('notifica cada aparelho inscrito do gestor', async () => {
    await inscrever(gestor, 'https://push.exemplo.local/celular')
    await inscrever(gestor, 'https://push.exemplo.local/computador')
    const remetente = remetenteQueAnota()

    const resumo = await enviarNotificacoesPush(UM_ALERTA, { enviar: remetente.enviar })

    expect(resumo.notificacoesEnviadas).toBe(2)
  })

  it('ignora o aparelho de quem é ATENDENTE no momento do envio', async () => {
    await inscrever(atendente, 'https://push.exemplo.local/celular-da-atendente')
    const remetente = remetenteQueAnota()

    const resumo = await enviarNotificacoesPush(UM_ALERTA, { enviar: remetente.enviar })

    expect(resumo.notificacoesEnviadas).toBe(0)
    expect(remetente.enviados).toHaveLength(0)
  })

  it('para de notificar o aparelho cujo dono foi rebaixado a ATENDENTE', async () => {
    await inscrever(gestor, 'https://push.exemplo.local/celular')
    await prisma.usuario.update({ where: { id: gestor.id }, data: { papel: Papel.ATENDENTE } })
    const remetente = remetenteQueAnota()

    const resumo = await enviarNotificacoesPush(UM_ALERTA, { enviar: remetente.enviar })

    // A inscrição continua no banco: o que mudou foi o papel, e promover a
    // pessoa de volta deve devolver a notificação sem reinscrever o aparelho.
    expect(resumo.notificacoesEnviadas).toBe(0)
    expect(await prisma.inscricaoPush.count()).toBe(1)
  })
})

describe('o que dispara notificação', () => {
  it('não notifica quando a janela é in-app', async () => {
    await inscrever(gestor, 'https://push.exemplo.local/celular')
    const remetente = remetenteQueAnota()

    const resumo = await enviarNotificacoesPush(
      [{ unidadeId: 'unidade-1', diasAntecedencia: 30, canal: 'IN_APP' }],
      { enviar: remetente.enviar },
    )

    expect(resumo.notificacoesEnviadas).toBe(0)
    expect(remetente.enviados).toHaveLength(0)
  })

  it('não notifica quando a passagem não emitiu nada', async () => {
    await inscrever(gestor, 'https://push.exemplo.local/celular')
    const remetente = remetenteQueAnota()

    const resumo = await enviarNotificacoesPush([], { enviar: remetente.enviar })

    expect(resumo.notificacoesEnviadas).toBe(0)
    expect(remetente.enviados).toHaveLength(0)
  })

  it('notifica a janela AMBOS, que é in-app e push ao mesmo tempo', async () => {
    await inscrever(gestor, 'https://push.exemplo.local/celular')
    const remetente = remetenteQueAnota()

    const resumo = await enviarNotificacoesPush(
      [{ unidadeId: 'unidade-1', diasAntecedencia: 7, canal: 'AMBOS' }],
      { enviar: remetente.enviar },
    )

    expect(resumo.notificacoesEnviadas).toBe(1)
  })
})

describe('aparelho que não responde mais', () => {
  it('apaga a inscrição no 410 (inscrição expirada)', async () => {
    await inscrever(gestor, 'https://push.exemplo.local/aparelho-sumido')

    const resumo = await enviarNotificacoesPush(UM_ALERTA, {
      enviar: async () => {
        throw erroDePush(410)
      },
      log: logMudo,
    })

    expect(resumo.inscricoesRemovidas).toBe(1)
    expect(resumo.notificacoesEnviadas).toBe(0)
    expect(await prisma.inscricaoPush.count()).toBe(0)
  })

  it('apaga a inscrição no 404 (aparelho desconhecido do serviço de push)', async () => {
    await inscrever(gestor, 'https://push.exemplo.local/aparelho-sumido')

    await enviarNotificacoesPush(UM_ALERTA, {
      enviar: async () => {
        throw erroDePush(404)
      },
      log: logMudo,
    })

    expect(await prisma.inscricaoPush.count()).toBe(0)
  })

  it('mantém a inscrição quando a falha é do serviço, não do aparelho (500)', async () => {
    await inscrever(gestor, 'https://push.exemplo.local/celular')

    const resumo = await enviarNotificacoesPush(UM_ALERTA, {
      enviar: async () => {
        throw erroDePush(500)
      },
      log: logMudo,
    })

    expect(resumo.falhas).toBe(1)
    expect(resumo.inscricoesRemovidas).toBe(0)
    expect(await prisma.inscricaoPush.count()).toBe(1)
  })

  it('a falha de um aparelho não impede a notificação do outro', async () => {
    await inscrever(gestor, 'https://push.exemplo.local/aparelho-sumido')
    await inscrever(gestor, 'https://push.exemplo.local/celular')

    const resumo = await enviarNotificacoesPush(UM_ALERTA, {
      enviar: async (destino) => {
        if (destino.endpoint.endsWith('aparelho-sumido')) throw erroDePush(410)
      },
      log: logMudo,
    })

    expect(resumo.notificacoesEnviadas).toBe(1)
    expect(resumo.inscricoesRemovidas).toBe(1)
  })

  it('não lança: uma falha de push não pode derrubar quem chamou', async () => {
    await inscrever(gestor, 'https://push.exemplo.local/celular')

    await expect(
      enviarNotificacoesPush(UM_ALERTA, {
        enviar: async () => {
          throw new Error('rede fora do ar')
        },
        log: logMudo,
      }),
    ).resolves.toMatchObject({ falhas: 1 })
  })
})

describe('servidor sem chaves VAPID', () => {
  it('não envia nada e não apaga inscrição nenhuma', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    await inscrever(gestor, 'https://push.exemplo.local/celular')

    // Sem `enviar` injetado: é o remetente de verdade que precisa se recusar a
    // existir quando não há chave.
    const resumo = await enviarNotificacoesPush(UM_ALERTA, { log: logMudo })

    expect(resumo).toEqual({ notificacoesEnviadas: 0, inscricoesRemovidas: 0, falhas: 0 })
    expect(await prisma.inscricaoPush.count()).toBe(1)
  })
})
