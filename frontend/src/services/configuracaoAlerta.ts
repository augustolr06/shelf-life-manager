import { requisitarApi } from './api'

/**
 * A janela de antecedência dos alertas proativos (RF08, T17 no backend).
 *
 * Como os outros módulos de serviço, este só espelha o que
 * `configuracaoAlerta.service.ts` devolve. Nenhuma regra vive aqui: o mínimo,
 * o máximo e a recusa de antecedência repetida são do servidor, e a tela só
 * exibe o que ele respondeu (RNF04).
 */

/**
 * Os três canais possíveis. `AMBOS` existe porque a RF08 fala em "in-app
 * **e/ou** push": a alternativa seria obrigar a gestora a manter duas
 * configurações espelhadas para a mesma janela.
 */
export const CANAIS = ['IN_APP', 'PUSH', 'AMBOS'] as const

export type Canal = (typeof CANAIS)[number]

export const ROTULO_CANAL: Record<Canal, string> = {
  IN_APP: 'No aplicativo',
  PUSH: 'Notificação push',
  AMBOS: 'No aplicativo e push',
}

export type ConfiguracaoAlerta = {
  id: string
  diasAntecedencia: number
  canal: Canal
  ativo: boolean
}

export type DadosConfiguracao = {
  diasAntecedencia: number
  canal: Canal
}

export type AlteracaoConfiguracao = Partial<DadosConfiguracao> & { ativo?: boolean }

export async function listarConfiguracoes(): Promise<ConfiguracaoAlerta[]> {
  const { configuracoes } = await requisitarApi<{ configuracoes: ConfiguracaoAlerta[] }>(
    '/configuracao-alerta',
  )
  return configuracoes
}

export async function criarConfiguracao(dados: DadosConfiguracao): Promise<ConfiguracaoAlerta> {
  const { configuracao } = await requisitarApi<{ configuracao: ConfiguracaoAlerta }>(
    '/configuracao-alerta',
    { method: 'POST', body: JSON.stringify(dados) },
  )
  return configuracao
}

export async function alterarConfiguracao(
  id: string,
  alteracao: AlteracaoConfiguracao,
): Promise<ConfiguracaoAlerta> {
  const { configuracao } = await requisitarApi<{ configuracao: ConfiguracaoAlerta }>(
    `/configuracao-alerta/${id}`,
    { method: 'PATCH', body: JSON.stringify(alteracao) },
  )
  return configuracao
}

/**
 * `DELETE` inativa, nunca exclui — o backend é quem garante isso. A linha
 * sobrevive porque os alertas já emitidos apontam para ela (T18/T19).
 */
export async function inativarConfiguracao(id: string): Promise<ConfiguracaoAlerta> {
  const { configuracao } = await requisitarApi<{ configuracao: ConfiguracaoAlerta }>(
    `/configuracao-alerta/${id}`,
    { method: 'DELETE' },
  )
  return configuracao
}

export function reativarConfiguracao(id: string): Promise<ConfiguracaoAlerta> {
  return alterarConfiguracao(id, { ativo: true })
}
