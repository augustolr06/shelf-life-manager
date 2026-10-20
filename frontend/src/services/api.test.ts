import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aoExpirarSessao, ErroApi, requisitarApi } from './api'
import { respostaFalsa } from './testes/respostaFalsa'

const buscar = vi.fn<typeof fetch>()

const EXPIRADA = () =>
  respostaFalsa(401, {
    erro: 'NAO_AUTENTICADO',
    mensagem: 'Sessão ausente ou expirada. Faça login novamente.',
  })

describe('requisitarApi — aviso de sessão expirada (T30)', () => {
  const ouvinte = vi.fn()
  let remover: () => void

  beforeEach(() => {
    buscar.mockReset()
    ouvinte.mockReset()
    vi.stubGlobal('fetch', buscar)
    remover = aoExpirarSessao(ouvinte)
  })

  afterEach(() => {
    remover()
    vi.unstubAllGlobals()
  })

  it('avisa o ouvinte no 401 NAO_AUTENTICADO, e a falha continua chegando a quem pediu', async () => {
    buscar.mockResolvedValue(EXPIRADA())

    const falha = await requisitarApi('/produtos').catch((erro: unknown) => erro)

    expect(ouvinte).toHaveBeenCalledTimes(1)
    expect(falha).toBeInstanceOf(ErroApi)
    expect(falha).toMatchObject({ status: 401, codigo: 'NAO_AUTENTICADO' })
  })

  it('não avisa no 403 PAPEL_INSUFICIENTE: a sessão vale, o papel é que não alcança', async () => {
    buscar.mockResolvedValue(
      respostaFalsa(403, { erro: 'PAPEL_INSUFICIENTE', mensagem: 'Seu papel não permite.' }),
    )

    await expect(requisitarApi('/usuarios')).rejects.toBeInstanceOf(ErroApi)
    expect(ouvinte).not.toHaveBeenCalled()
  })

  it('não avisa no 401 de outro código, como a credencial errada do login', async () => {
    buscar.mockResolvedValue(
      respostaFalsa(401, { erro: 'CREDENCIAL_INVALIDA', mensagem: 'E-mail ou senha inválidos.' }),
    )

    await expect(requisitarApi('/qualquer')).rejects.toBeInstanceOf(ErroApi)
    expect(ouvinte).not.toHaveBeenCalled()
  })

  it('não avisa quando a chamada diz que 401 ali não é expiração', async () => {
    buscar.mockResolvedValue(EXPIRADA())

    await expect(
      requisitarApi('/auth/me', {}, { avisaSessaoExpirada: false }),
    ).rejects.toBeInstanceOf(ErroApi)
    expect(ouvinte).not.toHaveBeenCalled()
  })

  it('deixa de avisar depois que o ouvinte é removido', async () => {
    buscar.mockResolvedValue(EXPIRADA())
    remover()

    await expect(requisitarApi('/produtos')).rejects.toBeInstanceOf(ErroApi)
    expect(ouvinte).not.toHaveBeenCalled()
  })
})
