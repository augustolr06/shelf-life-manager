import type { ReactNode } from 'react'
import type { EstadoConexao } from '../hooks/useConexao'

/**
 * Portão de offline (RNF07, `docs/arquitetura.md` seção 6), compartilhado pela
 * venda e pela consulta desde T32. O que cada tela não consegue fazer sem o
 * servidor é diferente, e por isso a explicação vem de quem usa o portão.
 */
export function PortaoOffline({
  estado,
  aoTentarDeNovo,
  children,
}: {
  estado: EstadoConexao
  aoTentarDeNovo: () => void
  children: ReactNode
}) {
  if (estado === 'verificando') {
    return <p role="status">Verificando conexão com o servidor…</p>
  }

  return (
    <div className="bloqueio-offline" role="alert">
      <h3>Sem conexão com o servidor</h3>
      <p>{children}</p>
      <button type="button" onClick={aoTentarDeNovo}>
        Tentar de novo
      </button>
    </div>
  )
}
