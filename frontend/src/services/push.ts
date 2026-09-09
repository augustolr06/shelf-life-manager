import { requisitarApi } from './api'

/**
 * A inscrição deste aparelho na notificação push (RF08, T19b no backend).
 *
 * Como os demais módulos de serviço, este só espelha o backend. O que ele
 * **não** faz é falar com o navegador: pedir permissão, achar o service worker
 * e criar a inscrição é trabalho do componente `NotificacoesDoAparelho`, que é
 * onde essas APIs podem ser dubladas em teste. Aqui só entram as três chamadas
 * de API.
 */

export type ChavesDoAparelho = {
  p256dh: string
  auth: string
}

/** A chave pública VAPID do servidor, exigida pelo navegador para inscrever. */
export async function buscarChavePublicaPush(): Promise<string> {
  const { chavePublica } = await requisitarApi<{ chavePublica: string }>('/push/chave-publica')
  return chavePublica
}

export async function inscreverAparelho(dados: {
  endpoint: string
  chaves: ChavesDoAparelho
}): Promise<void> {
  await requisitarApi<{ inscricao: { id: string; criadoEm: string } }>('/push/inscricoes', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export async function desinscreverAparelho(endpoint: string): Promise<void> {
  await requisitarApi<void>('/push/inscricoes', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  })
}
