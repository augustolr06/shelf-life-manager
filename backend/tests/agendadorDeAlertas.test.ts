/**
 * O agendador da varredura de alertas (T18).
 *
 * Sem banco, de propósito: o que se verifica aqui é comportamento de relógio
 * — roda ao subir, repete, não se sobrepõe, sobrevive a erro —, e a varredura
 * entra injetada. Por isso o arquivo fica solto em `tests/` e não em
 * `tests/alerta/`, que é a pasta das suítes que exigem PostgreSQL (T14b).
 *
 * Contrato: tasks/T18-job-verificacao-alertas.md.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  iniciarAgendadorDeAlertas,
  type LogDoAgendador,
} from '../src/modules/alerta/agendador.js'
import type { ResumoDaVarredura } from '../src/modules/alerta/varreduraAlertas.js'

const UMA_HORA = 60 * 60 * 1000

const RESUMO_VAZIO: ResumoDaVarredura = {
  configuracoesAvaliadas: 0,
  unidadesNaJanela: 0,
  alertasEmitidos: 0,
}

function logDeTeste(): LogDoAgendador {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

/** Uma varredura cujo término este teste controla. */
function varreduraSuspensa() {
  let concluir!: () => void
  const varrer = vi.fn(
    () =>
      new Promise<ResumoDaVarredura>((resolve) => {
        concluir = () => resolve(RESUMO_VAZIO)
      }),
  )
  return { varrer, concluir: () => concluir() }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('iniciarAgendadorDeAlertas', () => {
  it('varre uma vez assim que sobe, sem esperar o primeiro intervalo', async () => {
    // Reiniciar o servidor não pode adiar o alerta em um dia inteiro. É
    // seguro porque a varredura é idempotente.
    const varrer = vi.fn(async () => RESUMO_VAZIO)
    const log = logDeTeste()

    const agendador = iniciarAgendadorDeAlertas({ intervaloHoras: 24, log, varrer })
    await vi.advanceTimersByTimeAsync(0)

    expect(varrer).toHaveBeenCalledTimes(1)
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: 'inicialização' }),
      expect.stringContaining('concluída'),
    )
    agendador.parar()
  })

  it('repete a cada intervalo configurado', async () => {
    const varrer = vi.fn(async () => RESUMO_VAZIO)
    const agendador = iniciarAgendadorDeAlertas({ intervaloHoras: 24, log: logDeTeste(), varrer })

    await vi.advanceTimersByTimeAsync(0)
    expect(varrer).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(24 * UMA_HORA)
    expect(varrer).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(24 * UMA_HORA)
    expect(varrer).toHaveBeenCalledTimes(3)

    agendador.parar()
  })

  it('não dispara antes da hora', async () => {
    const varrer = vi.fn(async () => RESUMO_VAZIO)
    const agendador = iniciarAgendadorDeAlertas({ intervaloHoras: 24, log: logDeTeste(), varrer })

    await vi.advanceTimersByTimeAsync(23 * UMA_HORA)

    expect(varrer).toHaveBeenCalledTimes(1)
    agendador.parar()
  })

  it('ignora o tique enquanto a varredura anterior não termina', async () => {
    // Duas passagens simultâneas competiriam pelas mesmas unidades, e o índice
    // único recusaria a segunda com erro — log de falha para descrever uma
    // situação que não é falha.
    const { varrer, concluir } = varreduraSuspensa()
    const log = logDeTeste()
    const agendador = iniciarAgendadorDeAlertas({ intervaloHoras: 1, log, varrer })

    await vi.advanceTimersByTimeAsync(0)
    expect(varrer).toHaveBeenCalledTimes(1)

    // Três tiques passam com a primeira varredura ainda em andamento.
    await vi.advanceTimersByTimeAsync(3 * UMA_HORA)
    expect(varrer).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledTimes(3)

    concluir()
    await vi.advanceTimersByTimeAsync(0)

    // Terminada a anterior, o tique seguinte volta a varrer.
    await vi.advanceTimersByTimeAsync(UMA_HORA)
    expect(varrer).toHaveBeenCalledTimes(2)

    agendador.parar()
  })

  it('varredura que falha é logada e não interrompe o agendamento', async () => {
    // O balcão precisa continuar vendendo se o job quebrar.
    const varrer = vi
      .fn<() => Promise<ResumoDaVarredura>>()
      .mockRejectedValueOnce(new Error('banco fora do ar'))
      .mockResolvedValue(RESUMO_VAZIO)
    const log = logDeTeste()
    const agendador = iniciarAgendadorDeAlertas({ intervaloHoras: 24, log, varrer })

    await vi.advanceTimersByTimeAsync(0)
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ erro: 'banco fora do ar' }),
      expect.stringContaining('falhou'),
    )

    await vi.advanceTimersByTimeAsync(24 * UMA_HORA)
    expect(varrer).toHaveBeenCalledTimes(2)
    expect(log.info).toHaveBeenCalledTimes(1)

    agendador.parar()
  })

  it('o resumo da varredura vai para o log', async () => {
    const resumo: ResumoDaVarredura = {
      configuracoesAvaliadas: 2,
      unidadesNaJanela: 43,
      alertasEmitidos: 7,
    }
    const log = logDeTeste()
    const agendador = iniciarAgendadorDeAlertas({
      intervaloHoras: 24,
      log,
      varrer: async () => resumo,
    })

    await vi.advanceTimersByTimeAsync(0)

    expect(log.info).toHaveBeenCalledWith(expect.objectContaining(resumo), expect.any(String))
    agendador.parar()
  })

  it('parar interrompe os tiques seguintes', async () => {
    const varrer = vi.fn(async () => RESUMO_VAZIO)
    const agendador = iniciarAgendadorDeAlertas({ intervaloHoras: 24, log: logDeTeste(), varrer })

    await vi.advanceTimersByTimeAsync(0)
    agendador.parar()

    await vi.advanceTimersByTimeAsync(72 * UMA_HORA)

    expect(varrer).toHaveBeenCalledTimes(1)
  })
})
