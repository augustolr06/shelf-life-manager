// Importado só pelo efeito colateral: `shared/env.ts` é quem carrega o `.env`
// do processo, e este módulo lê variável de ambiente diretamente.
import '../../shared/env.js'

/**
 * O catálogo externo que o cadastro de produto consulta pelo código de barras
 * (T47): o SI5 Global (`global.si5.com.br`), no plano gratuito.
 *
 * Tudo que é específico da fonte mora neste arquivo — endereço, cabeçalho de
 * autenticação, nomes dos campos e significado de cada status —, e o resto do
 * sistema só conhece `FonteDeProduto`. A escolha da fonte é a parte mais frágil
 * da tarefa: o plano gratuito do Cosmos/Bluesoft, a base brasileira mais
 * completa, deixou de existir durante o projeto (`docs/decisoes.md`, T47).
 * Trocar de fonte é escrever outro arquivo como este.
 *
 * Nenhum desfecho daqui é erro para quem chama. Fonte fora do ar, cota do dia
 * esgotada ou servidor sem token viram `INDISPONIVEL`, e a tela cai no
 * preenchimento manual: a consulta é conveniência, e o cadastro nunca pode
 * depender dela.
 */

export type MotivoIndisponivel = 'NAO_CONFIGURADA' | 'LIMITE_DIARIO' | 'FALHA'

export type DadosDaFonte = {
  nome: string
  marca: string | null
  categoria: string | null
  imagemUrl: string | null
}

export type RespostaDaFonte =
  | { tipo: 'ENCONTRADO'; dados: DadosDaFonte }
  | { tipo: 'NAO_ENCONTRADO' }
  | { tipo: 'INDISPONIVEL'; motivo: MotivoIndisponivel }

/** O mínimo que a fonte usa do `request.log` do Fastify. */
export type RegistroDeAviso = {
  warn: (dados: Record<string, unknown>, mensagem: string) => void
}

export type FonteDeProduto = {
  /** Como a tela cita a fonte no card ("Fonte: SI5 Global"). */
  nome: string
  consultar(gtin: string, log: RegistroDeAviso): Promise<RespostaDaFonte>
}

const URL_CONSULTA = 'https://global.si5.com.br/api/produtos/'

/**
 * Teto de espera pela fonte. A gestora está olhando para o botão "Buscar
 * produto"; passado isso, vale mais cair no formulário do que continuar
 * esperando — e a função serverless da Vercel tem limite de duração próprio.
 */
export const TEMPO_LIMITE_MS = 5000

export const fonteSi5: FonteDeProduto = {
  nome: 'SI5 Global',

  async consultar(gtin, log) {
    // Lido a cada consulta, e não uma vez no import, pela mesma razão das
    // chaves VAPID (`modules/push/vapid.ts`): é configuração que pode faltar
    // sem que o servidor deixe de subir, e a suíte exercita os dois estados no
    // mesmo processo.
    const token = process.env.SI5_TOKEN?.trim()
    if (!token) return { tipo: 'INDISPONIVEL', motivo: 'NAO_CONFIGURADA' }

    let resposta: Response
    try {
      resposta = await fetch(`${URL_CONSULTA}${encodeURIComponent(gtin)}`, {
        headers: {
          // A documentação da fonte manda não usar o token no navegador: é
          // por isso que a consulta passa pelo backend. Ele nunca vai para
          // log nem para resposta.
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      })
    } catch (falha) {
      // Rede, DNS ou o tempo limite acima.
      log.warn(
        { fonte: 'SI5 Global', falha: falha instanceof Error ? falha.name : String(falha) },
        'consulta de código de barras sem resposta da fonte',
      )
      return { tipo: 'INDISPONIVEL', motivo: 'FALHA' }
    }

    // A fonte não cobra cota pelo 404, e é o desfecho comum para produto de
    // marca pequena.
    if (resposta.status === 404) return { tipo: 'NAO_ENCONTRADO' }
    if (resposta.status === 429) return { tipo: 'INDISPONIVEL', motivo: 'LIMITE_DIARIO' }
    if (!resposta.ok) {
      // 401 é token errado ou revogado: quem precisa saber é quem administra
      // o servidor, e o aviso no log é o lugar disso.
      log.warn(
        { fonte: 'SI5 Global', status: resposta.status },
        'consulta de código de barras recusada pela fonte',
      )
      return { tipo: 'INDISPONIVEL', motivo: 'FALHA' }
    }

    let corpo: unknown
    try {
      corpo = await resposta.json()
    } catch {
      log.warn({ fonte: 'SI5 Global' }, 'consulta de código de barras com resposta ilegível')
      return { tipo: 'INDISPONIVEL', motivo: 'FALHA' }
    }

    const campos = (corpo ?? {}) as Record<string, unknown>
    const nome = texto(campos.produto)
    // Sem nome, não há o que mostrar no card nem com o que cadastrar: para a
    // gestora, é o mesmo que a fonte não conhecer o código.
    if (!nome) return { tipo: 'NAO_ENCONTRADO' }

    return {
      tipo: 'ENCONTRADO',
      dados: {
        nome,
        marca: texto(campos.marca),
        categoria: texto(campos.categoria),
        imagemUrl: enderecoSeguro(campos.imagem_url),
      },
    }
  },
}

/**
 * Texto da fonte sem espaço sobrando nas pontas nem repetido no meio. Não
 * corta no limite de 120 caracteres do cadastro: cortar em silêncio é o que
 * T25 proibiu, e quem avisa do corte é a tela.
 */
function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const limpo = valor.replace(/\s+/g, ' ').trim()
  return limpo === '' ? null : limpo
}

/**
 * Só endereço `https:` vai para a tela, que o põe num `<img>`. Imagem por
 * `http:` seria bloqueada como conteúdo misto no app publicado em HTTPS, e
 * qualquer outro esquema não tem por que chegar ao navegador.
 */
function enderecoSeguro(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  try {
    return new URL(valor).protocol === 'https:' ? valor : null
  } catch {
    return null
  }
}
