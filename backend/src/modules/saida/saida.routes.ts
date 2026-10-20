import { Papel } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { autenticar, exigirPapel } from '../auth/auth.middleware.js'
import { finalizarCarrinho, lerCodigoQr } from './saida.service.js'

/**
 * Comprimento máximo do texto aceito como código. Generoso em relação aos 10
 * caracteres do formato atual (`PRF-XXXXXX`), porque o formato é provisório
 * até a RNF08 (T16) — mas limitado, porque o campo é livre e vai direto para
 * uma consulta e para o `EventoLog`. Exportado para a consulta de unidade
 * (T32), que recebe o mesmo texto da mesma etiqueta.
 */
export const MAXIMO_CODIGO = 64

/**
 * Teto de unidades num carrinho (T33). Folgado para um balcão de perfumaria e
 * curto o bastante para que a confirmação, uma transação por item, termine em
 * tempo de resposta. Vale também para `noCarrinho`: uma lista maior descreve
 * um carrinho que não poderia ser confirmado.
 */
export const MAXIMO_ITENS_DO_CARRINHO = 50

/** O id de uma unidade, como a leitura o devolveu. */
const idDeUnidade = { type: 'string', format: 'uuid' } as const

/**
 * As unidades já liberadas no atendimento, que saem do pool do FIFO na leitura
 * (T33). Exportado para a correção de validade (T11), que revalida como uma
 * leitura e tem o mesmo problema.
 */
export const listaNoCarrinho = {
  type: 'array',
  maxItems: MAXIMO_ITENS_DO_CARRINHO,
  items: idDeUnidade,
} as const

/** Mesmo agrupador opcional de atendimento da leitura. */
const agrupador = { type: 'string', format: 'uuid' } as const

const corpoLeitura = {
  type: 'object',
  required: ['codigoQr'],
  // O usuário vem da sessão, nunca do corpo: toda leitura é atribuível a quem
  // a fez (RF01, RF12).
  additionalProperties: false,
  properties: {
    codigoQr: { type: 'string', minLength: 1, maxLength: MAXIMO_CODIGO },
    // Agrupador opcional de atendimento, gerado no cliente (PRD seção 5). Ao
    // contrário do `codigoQr`, aqui o formato **é** exigido: um código de QR
    // torto vem do mundo físico e é dado da pesquisa (T08); um `sessaoVendaId`
    // torto só vem de cliente quebrado, e aceitá-lo em silêncio produziria
    // relatório de atendimento errado sem nenhum sinal.
    sessaoVendaId: agrupador,
    noCarrinho: listaNoCarrinho,
  },
} as const

const corpoFinalizacao = {
  type: 'object',
  required: ['unidadeIds'],
  additionalProperties: false,
  properties: {
    // Ids, e não códigos: o carrinho guarda o que o servidor identificou na
    // leitura (T33). Repetido é recusado — o mesmo frasco duas vezes daria
    // CONFIRMAR e depois UNIDADE_JA_BAIXADA, um erro que a atendente não
    // cometeu.
    unidadeIds: {
      type: 'array',
      minItems: 1,
      maxItems: MAXIMO_ITENS_DO_CARRINHO,
      uniqueItems: true,
      items: idDeUnidade,
    },
    sessaoVendaId: agrupador,
  },
} as const

export async function rotasSaida(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { codigoQr: string; sessaoVendaId?: string; noCarrinho?: string[] } }>(
    '/saidas/ler',
    {
      // Ler QR no balcão é atribuição das duas funções (docs/arquitetura.md
      // seção 5). A lista é explícita mesmo cobrindo todos os papéis de hoje:
      // um papel novo no enum não deve ganhar acesso ao fluxo de saída por
      // omissão.
      preHandler: [autenticar, exigirPapel(Papel.ATENDENTE, Papel.GESTOR)],
      schema: { body: corpoLeitura },
    },
    async (request, reply) => {
      const resposta = await lerCodigoQr(
        request.body.codigoQr,
        request.usuario.id,
        request.body.sessaoVendaId,
        request.body.noCarrinho,
      )

      // 200 para todo veredito, inclusive bloqueio e código desconhecido: a
      // leitura foi processada e registrada, e o veredito é o resultado dela,
      // não uma falha de protocolo. Codificar o veredito no status faria a
      // tela decidir pelo status em vez de pelo veredito — a porta que a RNF04
      // fecha (docs/decisoes.md, 2026-09-08).
      return reply.code(200).send(resposta)
    },
  )

  // A venda (T33b). Desde T33, ler não baixa: a unidade liberada vai para o
  // carrinho da tela, e é aqui que ela sai do estoque, revalidada sob lock.
  app.post<{ Body: { unidadeIds: string[]; sessaoVendaId?: string } }>(
    '/saidas/finalizar',
    {
      preHandler: [autenticar, exigirPapel(Papel.ATENDENTE, Papel.GESTOR)],
      schema: { body: corpoFinalizacao },
    },
    async (request, reply) => {
      const resultado = await finalizarCarrinho(
        request.body.unidadeIds,
        request.usuario.id,
        request.body.sessaoVendaId,
      )

      // Mesmo código e status dos caminhos da unidade vencida (T11): a tela
      // afirmou uma unidade que não existe, e isso é falha do pedido, não
      // veredito de item.
      if (!resultado.ok) {
        return reply.code(404).send({
          erro: 'UNIDADE_NAO_ENCONTRADA',
          mensagem: 'Uma unidade do carrinho não foi encontrada. Leia os itens novamente.',
        })
      }

      // 200 mesmo com itens barrados, pelo motivo da leitura: cada item foi
      // processado, e o veredito dele é o resultado, não falha de protocolo.
      return reply.code(200).send({ itens: resultado.itens })
    },
  )
}
