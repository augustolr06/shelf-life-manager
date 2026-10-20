import { useCallback, useEffect, useState } from 'react'
import { verificarBackend } from '../services/saude'

/**
 * Se a tela alcança o backend, para o portão de offline (RNF07,
 * `docs/arquitetura.md` seção 6). Nasceu na tela de leitura (T10) e saiu dela
 * em T32, quando a consulta de unidade virou a segunda tela que não funciona
 * sem o servidor.
 */
export type EstadoConexao = 'verificando' | 'online' | 'offline'

/**
 * Dois sinais, o barato primeiro: `navigator.onLine` descarta o caso óbvio sem
 * ida à rede, e `/health` confirma que existe caminho até o backend — porque
 * `onLine` só sabe que há uma rede, não que ela chega ao servidor.
 */
export function useConexao() {
  const [conexao, setConexao] = useState<EstadoConexao>('verificando')

  const verificar = useCallback(async () => {
    setConexao('verificando')
    if (!navigator.onLine) {
      setConexao('offline')
      return
    }
    setConexao((await verificarBackend()) ? 'online' : 'offline')
  }, [])

  useEffect(() => {
    void verificar()

    // Eventos do navegador, sem varredura periódica: sondar de tempos em
    // tempos gastaria bateria e rede do celular do balcão sem informar mais.
    const aoVoltar = () => void verificar()
    const aoCair = () => setConexao('offline')
    window.addEventListener('online', aoVoltar)
    window.addEventListener('offline', aoCair)

    return () => {
      window.removeEventListener('online', aoVoltar)
      window.removeEventListener('offline', aoCair)
    }
  }, [verificar])

  return { conexao, verificar: () => void verificar() }
}
