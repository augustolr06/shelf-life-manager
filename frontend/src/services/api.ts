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

export async function requisitarApi<T>(caminho: string, init: RequestInit = {}): Promise<T> {
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
    throw new ErroApi(
      resposta.status,
      // A mensagem exibida ao usuário é a que o backend escreveu. O frontend
      // só recorre a um texto próprio quando não recebeu nenhum.
      corpo?.mensagem ?? corpo?.message ?? 'Não foi possível concluir a operação.',
      corpo?.erro ?? null,
      corpo,
    )
  }

  // 204 (logout) não tem corpo para desserializar.
  if (resposta.status === 204) return undefined as T

  return (await lerJson<T>(resposta)) as T
}

/** Lê o JSON tolerando corpo vazio ou malformado, que não deve mascarar o status. */
async function lerJson<T>(resposta: Response): Promise<T | null> {
  try {
    return (await resposta.json()) as T
  } catch {
    return null
  }
}
