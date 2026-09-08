import { useEffect, useState, type ReactElement } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { TelaLeituraQr } from './pages/TelaLeituraQr'
import { TelaLogin } from './pages/TelaLogin'
import { TelaProdutos } from './pages/TelaProdutos'
import { TelaRecebimento } from './pages/TelaRecebimento'
import { buscarSessaoAtual, encerrarSessao, rotuloPapel, type Papel, type Usuario } from './services/auth'

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
 * Uma rota por tela, decidido pelo orientando em T10 (2026-09-08). T03b e T05
 * tinham adiado o roteamento para cá.
 *
 * O `App` continua sendo o guardião de sessão; o que mudou é que ele decide
 * *rota* em vez de ramo de render. Esconder rota por papel é conveniência de
 * interface — quem recusa de fato é o 403 do backend (RNF04).
 */
type Tela = {
  caminho: string
  rotulo: string
  papeis: readonly Papel[]
  elemento: (usuario: Usuario) => ReactElement
}

const TELAS: readonly Tela[] = [
  {
    caminho: '/leitura',
    rotulo: 'Leitura de QR',
    // Mesma lista da rota `POST /saidas/ler` no backend.
    papeis: ['ATENDENTE', 'GESTOR'],
    // O papel decide quais dos três caminhos da unidade vencida aparecem (T12).
    elemento: (usuario) => <TelaLeituraQr usuario={usuario} />,
  },
  {
    caminho: '/produtos',
    rotulo: 'Catálogo de produtos',
    papeis: ['ATENDENTE', 'GESTOR'],
    elemento: (usuario) => <TelaProdutos usuario={usuario} />,
  },
  {
    caminho: '/recebimento',
    rotulo: 'Registrar recebimento',
    papeis: ['GESTOR'],
    elemento: () => <TelaRecebimento />,
  },
]

/**
 * Para onde `/` leva. A atendente cai na leitura porque é a única coisa que
 * ela faz no sistema; o gestor cai no catálogo, que é de onde o trabalho dele
 * começa.
 */
function rotaInicial(usuario: Usuario): string {
  return usuario.papel === 'ATENDENTE' ? '/leitura' : '/produtos'
}

export function App() {
  const [sessao, setSessao] = useState<EstadoSessao>({ situacao: 'verificando' })
  const [aviso, setAviso] = useState<string | null>(null)
  const navegar = useNavigate()

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
      navegar('/login', { replace: true })
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
        <Routes>
          <Route
            path="/login"
            element={
              <TelaLogin
                aoAutenticar={(usuario) => {
                  setSessao({ situacao: 'autenticado', usuario })
                  navegar(rotaInicial(usuario), { replace: true })
                }}
              />
            }
          />
          {/* Sem sessão, qualquer URL leva ao login. `replace` para que o
              botão voltar do celular não devolva à rota protegida. */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </>
    )
  }

  const { usuario } = sessao
  const inicial = rotaInicial(usuario)
  const visiveis = TELAS.filter((tela) => tela.papeis.includes(usuario.papel))

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

      <nav className="abas" aria-label="Seções do sistema">
        {visiveis.map((tela) => (
          <NavLink
            key={tela.caminho}
            to={tela.caminho}
            className={({ isActive }) => (isActive ? 'aba ativa' : 'aba')}
          >
            {tela.rotulo}
          </NavLink>
        ))}
      </nav>

      <main>
        <Routes>
          {visiveis.map((tela) => (
            <Route key={tela.caminho} path={tela.caminho} element={tela.elemento(usuario)} />
          ))}
          {/* Rota de tela que o papel não alcança, `/login` já autenticado e
              URL desconhecida caem todas no mesmo lugar: a tela inicial do
              papel. */}
          <Route path="*" element={<Navigate to={inicial} replace />} />
        </Routes>
      </main>
    </div>
  )
}
