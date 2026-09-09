import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * O gate que decide se o relógio da RF08 roda dentro deste processo (T23).
 *
 * Merece teste próprio por causa do modo de falhar: um valor mal digitado no
 * painel da hospedagem não derruba o servidor nem aparece em log de erro —
 * simplesmente nenhum alerta é emitido, e a queixa chega dias depois como
 * "o sistema parou de avisar". A regra escolhida é assimétrica de propósito:
 * só `false` e `0` desligam, qualquer outra coisa deixa ligado.
 */
async function agendadorInternoCom(valor: string | undefined) {
  vi.resetModules()
  if (valor === undefined) vi.stubEnv('ALERTA_AGENDADOR_INTERNO', '')
  else vi.stubEnv('ALERTA_AGENDADOR_INTERNO', valor)
  const { env } = await import('../src/shared/env.js')
  return env.ALERTA_AGENDADOR_INTERNO
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('ALERTA_AGENDADOR_INTERNO', () => {
  it('vem ligado quando a variável não foi definida (comportamento de T18)', async () => {
    expect(await agendadorInternoCom(undefined)).toBe(true)
  })

  it.each(['false', 'FALSE', ' false ', '0'])('desliga com %o', async (valor) => {
    expect(await agendadorInternoCom(valor)).toBe(false)
  })

  it.each(['true', '1', 'sim'])('liga com %o', async (valor) => {
    expect(await agendadorInternoCom(valor)).toBe(true)
  })

  // O caso que motiva o teste: quem quis desligar e digitou errado fica com o
  // agendador ligado (que é inofensivo onde há processo) em vez de ficar sem
  // relógio nenhum.
  it('mantém ligado diante de valor sem sentido, em vez de desligar por engano', async () => {
    expect(await agendadorInternoCom('flase')).toBe(true)
  })
})
