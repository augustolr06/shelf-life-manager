import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'

/**
 * Tratamento uniforme dos erros que o **Fastify** gera (`docs/arquitetura.md`
 * seção 5). As recusas de negócio não passam por aqui: as rotas as escrevem à
 * mão com `reply.code().send()`, em português e com o código específico do
 * caso (`UNIDADE_NAO_VENCIDA`, `PAPEL_INSUFICIENTE`, ...), que é sempre melhor
 * que qualquer texto genérico.
 *
 * O que passa por aqui é o que ninguém redigiu: violação de JSON Schema, corpo
 * malformado e exceção não tratada. Antes desta camada isso saía no formato do
 * framework, em inglês — e a tela do balcão exibia literalmente
 * `body/justificativa must NOT have fewer than 10 characters` (achado de T12).
 */

/**
 * Mensagem única para toda recusa de schema. Traduzir regra a regra do ajv
 * (mínimo, formato, tipo, propriedade desconhecida) seria declarar uma segunda
 * vez as restrições que o schema já declara e que as telas já espelham — duas
 * cópias para manter em sincronia. Quem orienta o usuário é o formulário; esta
 * mensagem é a rede embaixo, para quando a tela não antecipou e para os
 * clientes que não são a tela.
 */
export const MENSAGEM_CORPO_INVALIDO =
  'Alguns campos do formulário não foram aceitos. Confira os dados e tente de novo.'

/** Demais recusas do próprio Fastify: JSON malformado, content-type não suportado. */
export const MENSAGEM_REQUISICAO_INVALIDA =
  'A requisição não pôde ser processada. Confira os dados e tente de novo.'

/**
 * Texto fixo do 500. O detalhe da exceção fica **só** no log do servidor: um
 * erro do Prisma carrega nome de tabela, de coluna e, na violação de
 * unicidade, o próprio valor que colidiu — que pode ser dado de negócio
 * (RNF09).
 */
export const MENSAGEM_ERRO_INTERNO =
  'Erro interno no servidor. Tente novamente em instantes.'

export const MENSAGEM_ROTA_NAO_ENCONTRADA = 'Endereço não encontrado neste servidor.'

/**
 * Excesso de tentativas (T23). Mora aqui, e não no `errorResponseBuilder` do
 * `@fastify/rate-limit`, porque o plugin **lança** o que aquele construtor
 * devolve: o objeto cai neste handler de qualquer jeito, e formatar dos dois
 * lados criaria duas fontes para o mesmo corpo de erro — foi assim que a
 * primeira versão desta tarefa respondeu 500 no lugar de 429, com o formato
 * certo escrito no lugar que não decide.
 */
export const MENSAGEM_MUITAS_TENTATIVAS =
  'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.'

/**
 * Nomeia os campos recusados a partir de `error.validation` — a lista
 * estruturada do ajv, nunca por leitura da mensagem em inglês.
 *
 * `instancePath` vem no formato JSON Pointer (`/unidades/2/dataValidade`) e é
 * convertido para a notação que o desenvolvedor lê no schema
 * (`unidades[2].dataValidade`). Campo ausente e propriedade desconhecida não
 * têm `instancePath` — o nome está em `params`.
 *
 * Duas particularidades da configuração padrão do ajv no Fastify, conferidas
 * em teste e que limitam o que este array pode prometer:
 *
 * - `allErrors: false` — a validação para na primeira falha, então `campos`
 *   traz um campo por vez, não a lista completa do que está errado. É pista de
 *   diagnóstico, não relatório de formulário.
 * - `removeAdditional: true` — propriedade fora do schema é apagada do corpo
 *   antes da validação, não recusada. O ramo de `additionalProperty` abaixo
 *   praticamente não dispara hoje; fica como rede caso essa configuração mude.
 */
function camposRecusados(validation: NonNullable<FastifyError['validation']>): string[] {
  const campos = validation.map((falha) => {
    const params = falha.params as { missingProperty?: string; additionalProperty?: string }
    const nomeSolto = params.missingProperty ?? params.additionalProperty
    const caminho = falha.instancePath
      .split('/')
      .filter((segmento) => segmento !== '')
      .map((segmento) => (/^\d+$/.test(segmento) ? `[${segmento}]` : `.${segmento}`))
      .join('')
      // O primeiro segmento não leva ponto: `.justificativa` -> `justificativa`.
      .replace(/^\./, '')

    if (nomeSolto) return caminho === '' ? nomeSolto : `${caminho}.${nomeSolto}`
    return caminho
  })

  // Um mesmo campo pode falhar em mais de uma regra (tipo e formato, por
  // exemplo) e apareceria repetido.
  return [...new Set(campos.filter((campo) => campo !== ''))]
}

/**
 * Handler único da instância. Registrado em `app.ts` — e não em `server.ts` —
 * para que os testes com `app.inject()` exercitem o mesmo app que roda em
 * produção.
 */
export function tratarErro(
  erro: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (erro.validation) {
    return reply.code(400).send({
      erro: 'CORPO_INVALIDO',
      mensagem: MENSAGEM_CORPO_INVALIDO,
      // Fica fora da `mensagem` de propósito: é nome de campo do JSON, útil
      // para diagnóstico e não necessariamente o rótulo que o usuário vê.
      campos: camposRecusados(erro.validation),
    })
  }

  const status = erro.statusCode ?? 500

  // Excesso de tentativas tem código próprio porque a orientação ao usuário é
  // outra: não há nada errado nos dados, o que falta é esperar. Vem antes do
  // ramo genérico de 4xx, que diria "confira os dados e tente de novo".
  if (status === 429) {
    return reply.code(429).send({
      erro: 'MUITAS_TENTATIVAS',
      mensagem: MENSAGEM_MUITAS_TENTATIVAS,
    })
  }

  // Erro de cliente que o Fastify já classificou (JSON malformado, por
  // exemplo). O status é preservado: esta camada troca o corpo da resposta,
  // não o veredito HTTP.
  if (status >= 400 && status < 500) {
    return reply.code(status).send({
      erro: 'REQUISICAO_INVALIDA',
      mensagem: MENSAGEM_REQUISICAO_INVALIDA,
    })
  }

  // Como o handler substitui o padrão do Fastify, registrar o erro passa a ser
  // responsabilidade nossa — e é o único lugar onde ele ainda existe por
  // inteiro.
  request.log.error({ err: erro }, 'erro não tratado')

  return reply.code(500).send({
    erro: 'ERRO_INTERNO',
    mensagem: MENSAGEM_ERRO_INTERNO,
  })
}

/**
 * Rota inexistente no mesmo formato das demais falhas, para que o cliente não
 * precise distinguir dois formatos de erro conforme o que deu errado.
 */
export function tratarRotaNaoEncontrada(_request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.code(404).send({
    erro: 'ROTA_NAO_ENCONTRADA',
    mensagem: MENSAGEM_ROTA_NAO_ENCONTRADA,
  })
}
