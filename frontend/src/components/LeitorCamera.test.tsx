import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LeitorCamera } from './LeitorCamera'

/**
 * `html5-qrcode` substituída por um dublê que guarda o callback de
 * decodificação. Assim o teste entrega quadros quando quiser, sem câmera e sem
 * imagem — o que jsdom não tem. O que continua sem cobertura é a biblioteca de
 * verdade num celular real (verificação manual de T10).
 */
const qr = vi.hoisted(() => ({
  aoDecodificar: null as ((texto: string) => void) | null,
  falhaAoIniciar: null as unknown,
  stop: vi.fn<() => Promise<void>>(),
  clear: vi.fn<() => void>(),
}))

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    stop = qr.stop
    clear = qr.clear

    async start(
      _camera: unknown,
      _configuracao: unknown,
      aoDecodificar: (texto: string) => void,
    ): Promise<void> {
      if (qr.falhaAoIniciar) throw qr.falhaAoIniciar
      qr.aoDecodificar = aoDecodificar
    }
  },
}))

/** Monta o leitor e espera a câmera "ligar" — o import da biblioteca é dinâmico. */
async function montar(props: Partial<Parameters<typeof LeitorCamera>[0]> = {}) {
  const aoLer = vi.fn()
  const aoFalhar = vi.fn()
  const tela = render(<LeitorCamera aoLer={aoLer} aoFalhar={aoFalhar} {...props} />)
  if (!qr.falhaAoIniciar) await waitFor(() => expect(qr.aoDecodificar).not.toBeNull())
  return { ...tela, aoLer, aoFalhar }
}

function quadros(...textos: string[]) {
  act(() => {
    for (const texto of textos) qr.aoDecodificar?.(texto)
  })
}

describe('LeitorCamera', () => {
  beforeEach(() => {
    qr.aoDecodificar = null
    qr.falhaAoIniciar = null
    qr.stop.mockReset().mockResolvedValue(undefined)
    qr.clear.mockReset()
  })

  describe("modo 'unica' (T31)", () => {
    it('emite só o primeiro código e para a câmera', async () => {
      const { aoLer } = await montar({ modo: 'unica' })

      quadros('PRF-AAAAAA', 'PRF-AAAAAA', 'PRF-BBBBBB')

      expect(aoLer).toHaveBeenCalledTimes(1)
      expect(aoLer).toHaveBeenCalledWith('PRF-AAAAAA')
      // Parou sozinho, sem esperar quem o usa desmontá-lo.
      expect(qr.stop).toHaveBeenCalledTimes(1)
    })

    it('descarta os quadros que chegam enquanto o stop() ainda não terminou', async () => {
      qr.stop.mockReturnValue(new Promise(() => {}))
      const { aoLer } = await montar({ modo: 'unica' })

      quadros('PRF-AAAAAA')
      quadros('PRF-AAAAAA', 'PRF-AAAAAA')

      expect(aoLer).toHaveBeenCalledTimes(1)
    })

    it('lê de novo numa montagem nova', async () => {
      const primeira = await montar({ modo: 'unica' })
      quadros('PRF-AAAAAA')
      primeira.unmount()

      qr.aoDecodificar = null
      const segunda = await montar({ modo: 'unica' })
      quadros('PRF-AAAAAA')

      expect(segunda.aoLer).toHaveBeenCalledTimes(1)
    })
  })

  describe("modo 'continua' (padrão)", () => {
    it('emite cada quadro e mantém a câmera ligada', async () => {
      const { aoLer } = await montar()

      quadros('PRF-AAAAAA', 'PRF-AAAAAA', 'PRF-BBBBBB')

      expect(aoLer).toHaveBeenCalledTimes(3)
      expect(qr.stop).not.toHaveBeenCalled()
    })

    it('desliga a câmera ao desmontar', async () => {
      const { unmount } = await montar()

      unmount()

      await waitFor(() => expect(qr.clear).toHaveBeenCalled())
      expect(qr.stop).toHaveBeenCalledTimes(1)
    })
  })

  it('traduz a permissão negada para o balcão', async () => {
    qr.falhaAoIniciar = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    const { aoFalhar } = await montar({ modo: 'unica' })

    await waitFor(() =>
      expect(aoFalhar).toHaveBeenCalledWith(expect.stringMatching(/permissão de câmera negada/i)),
    )
  })
})
