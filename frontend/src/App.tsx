import { useEffect, useState } from 'react'
import { TelaLogin } from './pages/TelaLogin'
import { buscarSessaoAtual, encerrarSessao, rotuloPapel, type Usuario } from './services/auth'

/**
 * Três situações mutuamente exclusivas. `verificando` existe para que a tela
 * de login não pisque antes de sabermos se já há sessão — o cookie é
 * httpOnly, então essa resposta só chega do backend.
 */
type EstadoSessao =
  | { situacao: 'verificando' }
  | { situacao: 'anonimo' }
  | { situacao: 'autenticado'; usuario: Usuario }

export function App() {
  const [sessao, setSessao] = useState<EstadoSessao>({ situacao: 'verificando' })
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true

    buscarSessaoAtual()
      .then((usuario) => {
        if (!ativo) return
        setSessao(usuario ? { situacao: 'autenticado', usuario } : { situacao: 'anonimo' })
      })
      .catch((falha: unknown) => {
        if (!ativo) return
        // Backend fora do ar é diferente de "não está logado": cai na tela de
        // login, mas dizendo por quê, em vez de fingir sessão expirada.
        setAviso(falha instanceof Error ? falha.message : 'Falha ao verificar a sessão.')
        setSessao({ situacao: 'anonimo' })
      })

    return () => {
      ativo = false
    }
  }, [])

  async function sair() {
    try {
      await encerrarSessao()
      setAviso(null)
      setSessao({ situacao: 'anonimo' })
    } catch (falha) {
      // Se o logout não chegou ao servidor, o cookie continua válido — não
      // adianta fingir que a sessão acabou.
      setAviso(falha instanceof Error ? falha.message : 'Não foi possível sair.')
    }
  }

  if (sessao.situacao === 'verificando') {
    return (
      <main className="tela-carregando">
        <p role="status">Verificando sessão…</p>
      </main>
    )
  }

  if (sessao.situacao === 'anonimo') {
    return (
      <>
        {aviso && (
          <p className="aviso" role="alert">
            {aviso}
          </p>
        )}
        <TelaLogin aoAutenticar={(usuario) => setSessao({ situacao: 'autenticado', usuario })} />
      </>
    )
  }

  const { usuario } = sessao

  return (
    <div className="aplicacao">
      <header className="barra-topo">
        <h1>Controle de Estoque FIFO por Validade</h1>
        <div className="identidade">
          <span>
            {usuario.nome} — {rotuloPapel(usuario.papel)}
          </span>
          <button type="button" onClick={sair}>
            Sair
          </button>
        </div>
      </header>

      {aviso && (
        <p className="aviso" role="alert">
          {aviso}
        </p>
      )}

      <main>
        {/* As telas de domínio entram aqui a partir de T04 (produtos). */}
        <p>Sessão ativa. As telas do sistema chegam a partir de T04.</p>
      </main>
    </div>
  )
}
