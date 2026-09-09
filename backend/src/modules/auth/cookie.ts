import type { CookieSerializeOptions } from '@fastify/cookie'
import { env } from '../../shared/env.js'

/** Nome do cookie de sessão. Também é o cookie que o @fastify/jwt lê. */
export const NOME_COOKIE_SESSAO = 'sessao'

/** Validade do token e do cookie: uma jornada de trabalho. */
export const DURACAO_SESSAO_SEGUNDOS = 8 * 60 * 60

/**
 * Em desenvolvimento, backend e frontend são `localhost` em portas diferentes
 * — ainda same-site, e `'lax'` basta. Em produção eles são hosts distintos
 * (o frontend em uma hospedagem estática, a API em outra), o que é cross-site
 * para o navegador: com `'lax'` o cookie de sessão é **descartado silenciosamente**
 * na resposta do login e toda rota protegida passa a responder 401 — a falha
 * não aparece em teste nenhum, porque `app.inject()` não é um navegador.
 *
 * `'none'` exige `secure`, e é por isso que os dois andam juntos aqui: um
 * cookie `SameSite=None` sem `Secure` é recusado por todos os navegadores
 * atuais. Ambos ligam pelo mesmo `NODE_ENV`, de propósito — não deve existir
 * combinação em que um esteja ligado e o outro não.
 *
 * Se um dia frontend e API dividirem o mesmo domínio registrável
 * (`app.loja.com` e `api.loja.com`), isto pode voltar a `'lax'`: seria
 * same-site de novo, e um cookie que não viaja para terceiros é a opção mais
 * conservadora das duas.
 */
const emProducao = env.NODE_ENV === 'production'

export const opcoesCookieSessao: CookieSerializeOptions = {
  // O token nunca é lido por JavaScript do frontend — o navegador o envia
  // sozinho. Isso mantém a RNF04 honesta: o frontend não inspeciona o papel
  // para decidir nada, só recebe o que o backend responde.
  httpOnly: true,
  sameSite: emProducao ? 'none' : 'lax',
  secure: emProducao,
  path: '/',
  maxAge: DURACAO_SESSAO_SEGUNDOS,
}
