import type { CookieSerializeOptions } from '@fastify/cookie'
import { env } from '../../shared/env.js'

/** Nome do cookie de sessão. Também é o cookie que o @fastify/jwt lê. */
export const NOME_COOKIE_SESSAO = 'sessao'

/** Validade do token e do cookie: uma jornada de trabalho. */
export const DURACAO_SESSAO_SEGUNDOS = 8 * 60 * 60

export const opcoesCookieSessao: CookieSerializeOptions = {
  // O token nunca é lido por JavaScript do frontend — o navegador o envia
  // sozinho. Isso mantém a RNF04 honesta: o frontend não inspeciona o papel
  // para decidir nada, só recebe o que o backend responde.
  httpOnly: true,
  // Backend e frontend rodam no mesmo site em desenvolvimento (localhost em
  // portas diferentes ainda é same-site), então 'lax' basta. Se um dia forem
  // domínios distintos, isto vira 'none' + secure obrigatório.
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/',
  maxAge: DURACAO_SESSAO_SEGUNDOS,
}
