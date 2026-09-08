import { requisitarApi } from './api'

/**
 * Verificação de alcance do backend, usada pelo portão de offline da tela de
 * leitura (RNF07, `docs/arquitetura.md` seção 6).
 *
 * `/health` é liveness puro e não toca no banco (decisão de 2026-09-07): o que
 * esta função responde é "existe caminho até o servidor", não "o sistema está
 * pronto". Banco fora com backend de pé passa por aqui e falha depois, na
 * leitura, como erro comum.
 */
export async function verificarBackend(): Promise<boolean> {
  try {
    await requisitarApi<{ status: string }>('/health')
    return true
  } catch {
    // Rede fora, CORS, 500: para o portão são todos a mesma coisa — não dá
    // para validar FIFO agora. Por isso não distingue, e não lança.
    return false
  }
}
