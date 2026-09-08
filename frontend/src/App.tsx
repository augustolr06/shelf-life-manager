import { useEffect, useState } from 'react'
import { TelaLogin } from './pages/TelaLogin'
import { TelaProdutos } from './pages/TelaProdutos'
import { TelaRecebimento } from './pages/TelaRecebimento'
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

/**
 * Navegação por estado, sem biblioteca de roteamento. T03b registrou que o
 * roteamento entraria quando fosse necessário; com duas telas ainda não é —
 * o custo (URL própria por tela, histórico do navegador) só se paga a partir
 * do fluxo de leitura de QR, em T10.
 */
type Aba = 'produtos' | 'recebimento'

export function App() {
  const [sessao, setSessao] = useState<EstadoSessao>({ situacao: 'verificando' })
  const [aviso, setAviso] = useState<string | null>(null)
  const [aba, setAba] = useState<Aba>('produtos')

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

  // Recebimento é restrito a GESTOR (RF03). Esconder a aba é conveniência de
  // interface: quem recusa continua sendo o 403 do backend (RNF04).
  const podeReceber = usuario.papel === 'GESTOR'

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

      {podeReceber && (
        <nav className="abas" aria-label="Seções do sistema">
          {(
            [
              ['produtos', 'Catálogo de produtos'],
              ['recebimento', 'Registrar recebimento'],
            ] as const
          ).map(([chave, rotulo]) => (
            <button
              key={chave}
              type="button"
              className={aba === chave ? 'aba ativa' : 'aba'}
              aria-current={aba === chave ? 'page' : undefined}
              onClick={() => setAba(chave)}
            >
              {rotulo}
            </button>
          ))}
        </nav>
      )}

      <main>
        {aba === 'recebimento' && podeReceber ? (
          <TelaRecebimento />
        ) : (
          <TelaProdutos usuario={usuario} />
        )}
      </main>
    </div>
  )
}
