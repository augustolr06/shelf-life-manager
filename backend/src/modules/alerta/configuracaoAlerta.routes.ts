import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import {
  ANTECEDENCIA_MAXIMA,
  ANTECEDENCIA_MINIMA,
  CANAIS,
  atualizarConfiguracao,
  criarConfiguracao,
  inativarConfiguracao,
  listarConfiguracoes,
  type AlteracaoConfiguracao,
  type DadosConfiguracao,
} from './configuracaoAlerta.service.js'

/**
 * A configuração da janela de antecedência dos alertas proativos (RF08).
 *
 * **Só GESTOR**, nas quatro rotas: é parâmetro de gestão, decidido com tempo,
 * e mexer nele muda o que o sistema avisa a todo mundo. A atendente não
 * configura alerta — ela recebe (T19).
 *
 * A seção 5 de `docs/arquitetura.md` previa `GET/POST`; `PATCH` e `DELETE`
 * entraram aqui, com a inativação em vez da exclusão física
 * (`docs/decisoes.md`, 2026-09-08).
 */

const dias = {
  type: 'integer',
  minimum: ANTECEDENCIA_MINIMA,
  maximum: ANTECEDENCIA_MAXIMA,
} as const

// O conjunto fechado vem do serviço, não é redigitado aqui: duas listas de
// canais divergiriam, e a que divergiria seria a que ninguém lê.
const canal = { type: 'string', enum: [...CANAIS] } as const

const corpoCriacao = {
  type: 'object',
  required: ['diasAntecedencia', 'canal'],
  additionalProperties: false,
  properties: { diasAntecedencia: dias, canal },
} as const

const corpoAlteracao = {
  type: 'object',
  // Ao menos um campo, como em `PATCH /produtos/:id`: corpo vazio é engano de
  // quem chama, não alteração de nada.
  minProperties: 1,
  additionalProperties: false,
  properties: {
    diasAntecedencia: dias,
    canal,
    // Reativar é o desfazer do `DELETE`. Sem isto, uma inativação por engano
    // não teria como ser corrigida pela API.
    ativo: { type: 'boolean' },
  },
} as const

const parametrosId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const

const NAO_ENCONTRADA = {
  erro: 'CONFIGURACAO_NAO_ENCONTRADA',
  mensagem: 'Configuração de alerta não encontrada.',
}

const ANTECEDENCIA_EM_USO = {
  erro: 'ANTECEDENCIA_JA_CONFIGURADA',
  mensagem:
    'Já existe uma configuração ativa com essa antecedência. ' +
    'Altere a existente em vez de criar uma segunda.',
}

export async function rotasConfiguracaoAlerta(app: FastifyInstance): Promise<void> {
  const somenteGestor = { preHandler: [autenticar, exigirPapel(Papel.GESTOR)] }

  app.get('/configuracao-alerta', somenteGestor, async () => {
    // Lista vazia é 200 com `configuracoes: []`: "a loja ainda não configurou
    // nenhuma janela" é resposta legítima, e é o estado inicial.
    return { configuracoes: await listarConfiguracoes() }
  })

  app.post<{ Body: DadosConfiguracao }>(
    '/configuracao-alerta',
    { ...somenteGestor, schema: { body: corpoCriacao } },
    async (request, reply) => {
      const resultado = await criarConfiguracao(request.body)

      if (!resultado.ok) return reply.code(409).send(ANTECEDENCIA_EM_USO)

      return reply.code(201).send({ configuracao: resultado.configuracao })
    },
  )

  app.patch<{ Params: { id: string }; Body: AlteracaoConfiguracao }>(
    '/configuracao-alerta/:id',
    { ...somenteGestor, schema: { params: parametrosId, body: corpoAlteracao } },
    async (request, reply) => {
      const resultado = await atualizarConfiguracao(request.params.id, request.body)

      if (!resultado.ok) {
        return resultado.motivo === 'ANTECEDENCIA_JA_CONFIGURADA'
          ? reply.code(409).send(ANTECEDENCIA_EM_USO)
          : reply.code(404).send(NAO_ENCONTRADA)
      }

      return { configuracao: resultado.configuracao }
    },
  )

  // Inativa (`ativo = false`); nunca exclui fisicamente — ver o serviço.
  // Responde com a configuração para que a interface confirme o novo estado
  // sem uma segunda requisição, como faz `DELETE /produtos/:id`.
  app.delete<{ Params: { id: string } }>(
    '/configuracao-alerta/:id',
    { ...somenteGestor, schema: { params: parametrosId } },
    async (request, reply) => {
      const configuracao = await inativarConfiguracao(request.params.id)

      if (!configuracao) return reply.code(404).send(NAO_ENCONTRADA)

      return { configuracao }
    },
  )
}
