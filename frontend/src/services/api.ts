/**
 * Camada única de acesso ao backend. Todo módulo de serviço passa por aqui —
 * é o que garante que nenhuma chamada esqueça `credentials: 'include'`, sem o
 * qual o navegador não envia o cookie de sessão httpOnly (T03).
 */

const URL_BASE: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3333'

/**
 * Falha vinda do backend. Carrega o status HTTP e o código de erro da
 * resposta para que a interface possa distinguir os casos que o backend já
 * distingue (401 `NAO_AUTENTICADO` vs. 403 `PAPEL_INSUFICIENTE`, por exemplo)
 * sem inventar julgamento próprio (RNF04).
 */
export class ErroApi extends Error {
  readonly status: number
  readonly codigo: string | null
  /**
   * O corpo inteiro da resposta de erro, para a recusa que traz mais que a
   * mensagem — a lista de linhas de uma planilha recusada (T24), por exemplo.
   */
  readonly corpo: unknown

  constructor(status: number, mensagem: string, codigo: string | null, corpo: unknown = null) {
    super(mensagem)
    this.name = 'ErroApi'
    this.status = status
    this.codigo = codigo
    this.corpo = corpo
  }
}

type CorpoErro = { erro?: string; mensagem?: string; message?: string }

const MENSAGEM_REDE =
  'Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.'

/**
 * Quem quer saber que a sessão expirou no meio do uso (T30). É o `App`, que
 * abre o modal de "entre novamente"; `services/` não conhece React, então o
 * aviso passa por um callback e não por contexto ou estado.
 */
let ouvinteSessaoExpirada: (() => void) | null = null

/** Registra o ouvinte e devolve a função que o remove, no formato de `useEffect`. */
export function aoExpirarSessao(ouvinte: () => void): () => void {
  ouvinteSessaoExpirada = ouvinte
  return () => {
    if (ouvinteSessaoExpirada === ouvinte) ouvinteSessaoExpirada = null
  }
}

/**
 * A recusa que significa "a sessão que existia não vale mais". Pelo par status
 * + código, e não pela mensagem: 403 `PAPEL_INSUFICIENTE` é outra situação, e o
 * 401 do login é `CREDENCIAL_INVALIDA`.
 */
export function eSessaoExpirada(falha: unknown): boolean {
  return falha instanceof ErroApi && falha.status === 401 && falha.codigo === 'NAO_AUTENTICADO'
}

type OpcoesRequisicao = {
  /**
   * `false` nas duas chamadas em que 401 não quer dizer "expirou": o
   * `GET /auth/me` da abertura do app (ali é "não está logado") e o
   * `POST /auth/login` (senha errada).
   */
  avisaSessaoExpirada?: boolean
}

export async function requisitarApi<T>(
  caminho: string,
  init: RequestInit = {},
  { avisaSessaoExpirada = true }: OpcoesRequisicao = {},
): Promise<T> {
  const enviaCorpo = init.body !== undefined

  let resposta: Response
  try {
    resposta = await fetch(`${URL_BASE}${caminho}`, {
      ...init,
      // Sem isto o cookie httpOnly não acompanha a requisição e toda rota
      // protegida responde 401.
      credentials: 'include',
      headers: {
        ...(enviaCorpo ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    // `fetch` só rejeita por falha de rede/CORS; resposta de erro do servidor
    // chega normalmente e é tratada abaixo.
    throw new ErroApi(0, MENSAGEM_REDE, 'SEM_RESPOSTA')
  }

  if (!resposta.ok) {
    const corpo = await lerJson<CorpoErro>(resposta)
    const erro = new ErroApi(
      resposta.status,
      // A mensagem exibida ao usuário é a que o backend escreveu. O frontend
      // só recorre a um texto próprio quando não recebeu nenhum.
      corpo?.mensagem ?? corpo?.message ?? 'Não foi possível concluir a operação.',
      corpo?.erro ?? null,
      corpo,
    )
    // A tela que pediu continua recebendo a falha: o aviso é a mais, para o
    // `App` cobrir a tela com o modal (T30).
    if (avisaSessaoExpirada && eSessaoExpirada(erro)) ouvinteSessaoExpirada?.()
    throw erro
  }

  // 204 (logout) não tem corpo para desserializar.
  if (resposta.status === 204) return undefined as T

  return (await lerJson<T>(resposta)) as T
}

/**
 * Os nomes de campo que acompanham a recusa `CORPO_INVALIDO` (T12b), para o
 * formulário apontar o campo pelo rótulo em vez de mostrar a mensagem genérica
 * (T25). São nomes do JSON (`nome`, `codigoInterno`), não rótulos de tela:
 * traduzi-los é papel de cada formulário.
 */
export function camposRecusados(corpo: unknown): string[] {
  const campos = (corpo as { campos?: unknown } | null)?.campos
  return Array.isArray(campos)
    ? campos.filter((campo): campo is string => typeof campo === 'string')
    : []
}

/** Lê o JSON tolerando corpo vazio ou malformado, que não deve mascarar o status. */
async function lerJson<T>(resposta: Response): Promise<T | null> {
  try {
    return (await resposta.json()) as T
  } catch {
    return null
  }
}
