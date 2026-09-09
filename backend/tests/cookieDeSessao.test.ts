import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * O cookie de sessão é a única peça do sistema cujo comportamento correto em
 * produção é **diferente** do comportamento correto em desenvolvimento, e a
 * diferença não aparece em nenhum outro teste: `app.inject()` não é um
 * navegador, então um cookie que o Chrome descartaria passa por toda a suíte
 * sem reclamar. Estas asserções existem para cobrir exatamente esse vão.
 *
 * Arquivo solto em `tests/`, e não em subpasta: não toca o banco (convenção
 * de T14b, que é o que faz `npm run test:sem-banco` incluí-lo).
 */

/**
 * As opções são calculadas no momento do import, a partir de `shared/env.ts`.
 * Para ver os dois ramos é preciso reimportar o módulo com o ambiente trocado
 * — daí o `resetModules` antes de cada import dinâmico.
 */
async function opcoesCom(nodeEnv: string) {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', nodeEnv)
  const { opcoesCookieSessao } = await import('../src/modules/auth/cookie.js')
  return opcoesCookieSessao
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('opções do cookie de sessão', () => {
  it('em produção usa SameSite=None, porque frontend e API são cross-site', async () => {
    const opcoes = await opcoesCom('production')

    expect(opcoes.sameSite).toBe('none')
  })

  it('em produção marca o cookie como Secure', async () => {
    const opcoes = await opcoesCom('production')

    expect(opcoes.secure).toBe(true)
  })

  it('em desenvolvimento mantém SameSite=Lax, que basta para localhost', async () => {
    const opcoes = await opcoesCom('development')

    expect(opcoes.sameSite).toBe('lax')
    expect(opcoes.secure).toBe(false)
  })

  // A invariante, e não os dois casos acima, é o que realmente importa: o
  // navegador recusa `SameSite=None` sem `Secure`, e essa combinação
  // derrubaria o login inteiro sem erro de servidor nenhum.
  it.each(['production', 'development', 'test'])(
    'nunca emite SameSite=None sem Secure (NODE_ENV=%s)',
    async (nodeEnv) => {
      const opcoes = await opcoesCom(nodeEnv)

      if (opcoes.sameSite === 'none') expect(opcoes.secure).toBe(true)
    },
  )

  it('mantém o cookie inacessível ao JavaScript em qualquer ambiente', async () => {
    expect((await opcoesCom('production')).httpOnly).toBe(true)
    expect((await opcoesCom('development')).httpOnly).toBe(true)
  })
})
