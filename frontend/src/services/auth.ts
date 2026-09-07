import { ErroApi, requisitarApi } from './api'

export type Papel = 'ATENDENTE' | 'GESTOR'

/** Espelha o que `GET /auth/me` e `POST /auth/login` devolvem (T03). */
export type Usuario = {
  id: string
  nome: string
  email: string
  papel: Papel
}

export async function autenticar(email: string, senha: string): Promise<Usuario> {
  const { usuario } = await requisitarApi<{ usuario: Usuario }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, senha }),
  })
  return usuario
}

export async function encerrarSessao(): Promise<void> {
  await requisitarApi<void>('/auth/logout', { method: 'POST' })
}

/**
 * Restaura a sessão ao abrir o app. Devolve `null` quando não há sessão — o
 * cookie é httpOnly, então perguntar ao backend é a única forma de saber.
 * Qualquer outra falha (rede, servidor fora) é propagada: "não sei" e "não
 * está logado" são situações diferentes para quem chama.
 */
export async function buscarSessaoAtual(): Promise<Usuario | null> {
  try {
    const { usuario } = await requisitarApi<{ usuario: Usuario }>('/auth/me')
    return usuario
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status === 401) return null
    throw erro
  }
}

/** Rótulo do papel para exibição. Informativo apenas — quem autoriza é o backend. */
export function rotuloPapel(papel: Papel): string {
  return papel === 'GESTOR' ? 'Gestor' : 'Atendente'
}
