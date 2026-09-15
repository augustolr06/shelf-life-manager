import { requisitarApi } from './api'
import type { Papel } from './auth'

/**
 * Uma conta de acesso como a gestão a vê (T22).
 *
 * Distinta do `Usuario` de `auth.ts`, que é **quem está logado** e vem do
 * `GET /auth/me`. São coisas diferentes: aquele é a identidade da sessão,
 * este é uma linha da tabela de contas — e só este tem `ativo`.
 */
export type Conta = {
  id: string
  nome: string
  email: string
  papel: Papel
  ativo: boolean
}

export type DadosNovaConta = {
  nome: string
  email: string
  papel: Papel
  senha: string
}

export async function listarContas(incluirInativas = false): Promise<Conta[]> {
  const consulta = incluirInativas ? '?incluirInativos=true' : ''
  const { usuarios } = await requisitarApi<{ usuarios: Conta[] }>(`/usuarios${consulta}`)
  return usuarios
}

export async function criarConta(dados: DadosNovaConta): Promise<Conta> {
  const { usuario } = await requisitarApi<{ usuario: Conta }>('/usuarios', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
  return usuario
}

export async function alterarConta(
  id: string,
  alteracoes: { nome?: string; papel?: Papel; ativo?: boolean },
): Promise<Conta> {
  const { usuario } = await requisitarApi<{ usuario: Conta }>(`/usuarios/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(alteracoes),
  })
  return usuario
}

/** Redefinição pelo GESTOR, sem a senha atual. Responde 204, sem corpo. */
export async function redefinirSenha(id: string, senha: string): Promise<void> {
  await requisitarApi<void>(`/usuarios/${id}/senha`, {
    method: 'PATCH',
    body: JSON.stringify({ senha }),
  })
}

/** Troca da própria senha. O backend usa a sessão; nenhum id sai daqui. */
export async function trocarPropriaSenha(senhaAtual: string, senhaNova: string): Promise<void> {
  await requisitarApi<void>('/usuarios/eu/senha', {
    method: 'PATCH',
    body: JSON.stringify({ senhaAtual, senhaNova }),
  })
}
