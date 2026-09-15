import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import { TAMANHO_MINIMO_DE_SENHA } from '../auth/auth.service.js'
import { comoResposta } from './usuarioNaResposta.js'
import {
  atualizarUsuario,
  criarUsuario,
  listarUsuarios,
  redefinirSenha,
  trocarPropriaSenha,
  type AlteracoesDoUsuario,
  type DadosNovoUsuario,
  type Falha,
} from './usuario.service.js'

const campoNome = { type: 'string', minLength: 1, maxLength: 120 } as const
// Sem `minLength`: o piso de tamanho é regra de negócio e tem um dono só, o
// serviço (que o compartilha com o script de T23). Deixá-lo também no schema
// faria a recusa sair como `CORPO_INVALIDO` genérico — exatamente o que T12b
// existe para evitar — em vez do `SENHA_CURTA` que diz quantos caracteres
// faltam.
const campoSenha = { type: 'string', minLength: 1, maxLength: 200 } as const
const campoPapel = { type: 'string', enum: [Papel.ATENDENTE, Papel.GESTOR] } as const

const corpoCriacao = {
  type: 'object',
  required: ['nome', 'email', 'papel', 'senha'],
  additionalProperties: false,
  properties: {
    nome: campoNome,
    email: { type: 'string', format: 'email', maxLength: 200 },
    papel: campoPapel,
    senha: campoSenha,
  },
} as const

const corpoAtualizacao = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: { nome: campoNome, papel: campoPapel, ativo: { type: 'boolean' } },
} as const

const corpoRedefinicao = {
  type: 'object',
  required: ['senha'],
  additionalProperties: false,
  properties: { senha: campoSenha },
} as const

const corpoTrocaPropria = {
  type: 'object',
  required: ['senhaAtual', 'senhaNova'],
  additionalProperties: false,
  properties: {
    // Sem piso: a senha atual é o que ela for, inclusive mais curta que o
    // mínimo de hoje se foi criada antes dele. Validar tamanho aqui recusaria
    // a credencial certa por uma regra que não é sobre ela.
    senhaAtual: { type: 'string', minLength: 1, maxLength: 200 },
    senhaNova: campoSenha,
  },
} as const

const parametrosId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const

const consultaListagem = {
  type: 'object',
  additionalProperties: false,
  properties: { incluirInativos: { type: 'boolean', default: false } },
} as const

/** Cada motivo do serviço vira um status e um texto, num lugar só. */
const RECUSAS: Record<Falha, { status: number; corpo: { erro: string; mensagem: string } }> = {
  EMAIL_EM_USO: {
    status: 409,
    corpo: { erro: 'EMAIL_EM_USO', mensagem: 'Já existe uma conta com esse e-mail.' },
  },
  USUARIO_NAO_ENCONTRADO: {
    status: 404,
    corpo: { erro: 'USUARIO_NAO_ENCONTRADO', mensagem: 'Usuário não encontrado.' },
  },
  SENHA_CURTA: {
    status: 400,
    corpo: {
      erro: 'SENHA_CURTA',
      mensagem: `A senha precisa ter pelo menos ${TAMANHO_MINIMO_DE_SENHA} caracteres.`,
    },
  },
  CONTA_DE_SISTEMA: {
    status: 403,
    corpo: {
      erro: 'CONTA_DE_SISTEMA',
      mensagem: 'A conta usada pelo sistema não pode ser alterada.',
    },
  },
  ALVO_E_VOCE_MESMO: {
    status: 409,
    corpo: {
      erro: 'ALVO_E_VOCE_MESMO',
      mensagem:
        'Você não pode alterar o próprio acesso por aqui. Para trocar sua senha, use "Minha senha"; para mudar seu papel ou desativar sua conta, peça a outro gestor.',
    },
  },
  SENHA_ATUAL_INCORRETA: {
    status: 401,
    corpo: { erro: 'SENHA_ATUAL_INCORRETA', mensagem: 'Senha atual incorreta.' },
  },
}

export async function rotasUsuario(app: FastifyInstance): Promise<void> {
  const somenteGestor = { preHandler: [autenticar, exigirPapel(Papel.GESTOR)] }

  app.get<{ Querystring: { incluirInativos: boolean } }>(
    '/usuarios',
    { ...somenteGestor, schema: { querystring: consultaListagem } },
    async (request) => {
      const usuarios = await listarUsuarios(request.query.incluirInativos)
      return { usuarios: usuarios.map(comoResposta) }
    },
  )

  app.post<{ Body: DadosNovoUsuario }>(
    '/usuarios',
    {
      ...somenteGestor,
      schema: { body: corpoCriacao },
      // Apara o e-mail **antes** da validação, e não no serviço.
      //
      // `format: 'email'` recusa " nova@loja.com " — o espaço que o teclado do
      // celular e o autocompletar acrescentam ao colar. Sem este hook, esse
      // engano trivial sairia como `CORPO_INVALIDO` genérico ("confira os
      // dados"), que é exatamente a experiência que T12b existe para evitar:
      // a tela não diria o que está errado, porque nada está.
      //
      // O `toLowerCase` continua no serviço: ali é regra de unicidade, aqui é
      // tolerância de digitação.
      preValidation: async (request) => {
        const corpo = request.body as { email?: unknown } | undefined
        if (corpo && typeof corpo.email === 'string') corpo.email = corpo.email.trim()
      },
    },
    async (request, reply) => {
      const resultado = await criarUsuario(request.body)

      if (!resultado.ok) {
        const { status, corpo } = RECUSAS[resultado.motivo]
        return reply.code(status).send(corpo)
      }

      return reply.code(201).send({ usuario: comoResposta(resultado.usuario) })
    },
  )

  app.patch<{ Params: { id: string }; Body: AlteracoesDoUsuario }>(
    '/usuarios/:id',
    { ...somenteGestor, schema: { params: parametrosId, body: corpoAtualizacao } },
    async (request, reply) => {
      const resultado = await atualizarUsuario(request.params.id, request.body, request.usuario.id)

      if (!resultado.ok) {
        const { status, corpo } = RECUSAS[resultado.motivo]
        return reply.code(status).send(corpo)
      }

      return { usuario: comoResposta(resultado.usuario) }
    },
  )

  app.patch<{ Params: { id: string }; Body: { senha: string } }>(
    '/usuarios/:id/senha',
    { ...somenteGestor, schema: { params: parametrosId, body: corpoRedefinicao } },
    async (request, reply) => {
      const resultado = await redefinirSenha(
        request.params.id,
        request.body.senha,
        request.usuario.id,
      )

      if (!resultado.ok) {
        const { status, corpo } = RECUSAS[resultado.motivo]
        return reply.code(status).send(corpo)
      }

      // Sem corpo: a senha nova é a única novidade e ela não volta.
      return reply.code(204).send()
    },
  )

  // A única rota deste módulo que não é de gestão: qualquer papel troca a
  // própria senha, e a sessão diz de quem ela é — o `id` não vem do cliente.
  app.patch<{ Body: { senhaAtual: string; senhaNova: string } }>(
    '/usuarios/eu/senha',
    { preHandler: autenticar, schema: { body: corpoTrocaPropria } },
    async (request, reply) => {
      const resultado = await trocarPropriaSenha(
        request.usuario.id,
        request.body.senhaAtual,
        request.body.senhaNova,
      )

      if (!resultado.ok) {
        const { status, corpo } = RECUSAS[resultado.motivo]
        return reply.code(status).send(corpo)
      }

      return reply.code(204).send()
    },
  )
}
