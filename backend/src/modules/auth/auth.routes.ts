import type { FastifyInstance } from 'fastify'
import { autenticar } from './auth.middleware.js'
import { autenticarCredenciais } from './auth.service.js'
import { DURACAO_SESSAO_SEGUNDOS, NOME_COOKIE_SESSAO, opcoesCookieSessao } from './cookie.js'
import type { PayloadToken } from './tipos.js'

const corpoLogin = {
  type: 'object',
  required: ['email', 'senha'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
    senha: { type: 'string', minLength: 1 },
  },
} as const

type CorpoLogin = { email: string; senha: string }

/**
 * O freio de força bruta do login (T23).
 *
 * Dez tentativas por minuto, por IP. O número é generoso de propósito: a loja
 * inteira sai por **um** endereço público, então o limite é compartilhado
 * entre as duas contas e precisa tolerar o erro de digitação de duas pessoas
 * diferentes no mesmo minuto sem trancar o balcão. Quem protege a senha de
 * verdade é o tamanho mínimo de 12 caracteres (`definirSenha`) somado ao custo
 * do bcrypt; este limite existe para tornar inviável a varredura automatizada,
 * não para ser a única defesa.
 *
 * Contado por IP, e não por e-mail: um atacante escolhe o e-mail que tenta, e
 * limitar por ele deixaria a varredura livre trocando o alvo a cada tentativa.
 * A contrapartida é a que está acima — o balcão compartilha a cota.
 *
 * **O contador é em memória do processo.** Em servidor único isso é exato; se
 * a hospedagem escolhida em T23 for serverless, cada instância passa a ter o
 * seu, e o limite efetivo vira o número de instâncias vezes dez. Continua
 * valendo como freio, mas deixa de ser um teto — registrado em
 * `docs/decisoes.md`, e é uma das coisas que a decisão de hospedagem muda.
 *
 * O corpo da recusa não é montado aqui: o plugin **lança** o erro, então quem
 * o formata é o `tratarErro` de T12b, como todo 4xx do Fastify neste projeto.
 */
const LIMITE_DE_LOGIN = { max: 10, timeWindow: '1 minute' } as const

export async function rotasAuth(app: FastifyInstance): Promise<void> {
  // RF01 — autenticação. Rota pública.
  app.post<{ Body: CorpoLogin }>(
    '/auth/login',
    { schema: { body: corpoLogin }, config: { rateLimit: LIMITE_DE_LOGIN } },
    async (request, reply) => {
      const { email, senha } = request.body
      const usuario = await autenticarCredenciais(email, senha)

      if (!usuario) {
        // Mensagem única para e-mail inexistente e senha errada: não informar
        // qual dos dois falhou.
        return reply.code(401).send({
          erro: 'CREDENCIAL_INVALIDA',
          mensagem: 'E-mail ou senha incorretos.',
        })
      }

      const payload: PayloadToken = {
        sub: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        papel: usuario.papel,
      }
      const token = app.jwt.sign(payload, { expiresIn: DURACAO_SESSAO_SEGUNDOS })

      return reply
        .setCookie(NOME_COOKIE_SESSAO, token, opcoesCookieSessao)
        .send({ usuario })
    },
  )

  // Encerrar sessão. Sem estado no servidor (JWT), então basta apagar o cookie.
  // As mesmas opções do cookie de sessão: o navegador só substitui um cookie
  // por outro de nome, path e domínio idênticos. (`clearCookie` sobrescreve
  // `maxAge`/`expires` por conta própria.)
  app.post('/auth/logout', async (_request, reply) =>
    reply.clearCookie(NOME_COOKIE_SESSAO, opcoesCookieSessao).code(204).send(),
  )

  // Rota protegida de referência: devolve quem está logado. O frontend a usa
  // para restaurar a sessão ao abrir o app.
  app.get('/auth/me', { preHandler: autenticar }, async (request) => ({
    usuario: request.usuario,
  }))
}
