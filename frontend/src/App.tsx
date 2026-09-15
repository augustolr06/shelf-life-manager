import { useEffect, useState, type ReactElement } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { TelaAlertas } from './pages/TelaAlertas'
import { TelaConfiguracaoAlerta } from './pages/TelaConfiguracaoAlerta'
import { TelaDashboard } from './pages/TelaDashboard'
import { TelaDescartesPendentes } from './pages/TelaDescartesPendentes'
import { TelaEtiquetas } from './pages/TelaEtiquetas'
import { TelaLeituraQr } from './pages/TelaLeituraQr'
import { TelaLogin } from './pages/TelaLogin'
import { TelaProdutos } from './pages/TelaProdutos'
import { TelaUsuarios } from './pages/TelaUsuarios'
import { TelaMinhaSenha } from './pages/TelaMinhaSenha'
import { TelaRecebimento } from './pages/TelaRecebimento'
import { contarAlertasNaoLidos } from './services/alertas'
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
/**
 * O que o `App` empresta a uma tela além do usuário. Hoje é só o contador de
 * alertas não lidos, que a tela de alertas recalcula e a navegação exibe (T19).
 */
type RecursosDaTela = {
  aoAtualizarNaoLidos: (naoLidos: number) => void
}

type Tela = {
  caminho: string
  rotulo: string
  papeis: readonly Papel[]
  /** Distintivo numérico ao lado do rótulo, quando houver o que mostrar. */
  distintivo?: 'alertasNaoLidos'
  elemento: (usuario: Usuario, recursos: RecursosDaTela) => ReactElement
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
    caminho: '/descartes',
    rotulo: 'Fila de descarte',
    // Mesma lista da rota `GET /descartes/pendentes`: varredura de estoque é
    // trabalho de gestão, não de balcão (RF11).
    papeis: ['GESTOR'],
    elemento: (usuario) => <TelaDescartesPendentes usuario={usuario} />,
  },
  {
    caminho: '/recebimento',
    rotulo: 'Registrar recebimento',
    papeis: ['GESTOR'],
    elemento: () => <TelaRecebimento />,
  },
  {
    caminho: '/alertas',
    rotulo: 'Alertas',
    // Mesma lista de `GET /alertas`: a jornada J3 do PRD termina em decisão
    // comercial, que não é ato de balcão (RF08, T19).
    papeis: ['GESTOR'],
    distintivo: 'alertasNaoLidos',
    // Sem `usuario`: a tela é GESTOR-only inteira. O que ela recebe é o canal
    // de volta para o contador da navegação.
    elemento: (_usuario, recursos) => (
      <TelaAlertas aoAtualizarNaoLidos={recursos.aoAtualizarNaoLidos} />
    ),
  },
  {
    caminho: '/alertas/configuracao',
    // "Alertas" agora é a lista. O rótulo daqui diz o que esta tela faz: o
    // parâmetro, não o aviso.
    rotulo: 'Configurar alertas',
    // Mesma lista das quatro rotas de `/configuracao-alerta`: a janela de
    // antecedência é parâmetro de gestão, e mexer nela muda o que o sistema
    // avisa a todo mundo (RF08).
    papeis: ['GESTOR'],
    // Sem `usuario`: a tela é GESTOR-only inteira, não tem ramo por papel.
    elemento: () => <TelaConfiguracaoAlerta />,
  },
  {
    caminho: '/dashboard',
    rotulo: 'Dashboard',
    // Mesma lista das duas rotas de `/dashboard`: são decisão comercial e dado
    // de pesquisa, não ato de balcão (RF13).
    papeis: ['GESTOR'],
    // Sem `usuario`: a tela é GESTOR-only inteira e não tem ramo por papel.
    elemento: () => <TelaDashboard />,
  },
  {
    caminho: '/usuarios',
    rotulo: 'Contas de acesso',
    // Mesma lista das rotas de gestão de `/usuarios`: admitir, desligar e
    // trocar papel é ato de gestão, não de balcão (RF01, T22).
    papeis: ['GESTOR'],
    // Recebe `usuario` para saber qual linha é a de quem está logado — e é
    // só isso: a recusa de mexer no próprio acesso é do backend (409).
    elemento: (usuario) => <TelaUsuarios usuario={usuario} />,
  },
  {
    caminho: '/minha-senha',
    rotulo: 'Minha senha',
    // A única tela deste módulo que a atendente enxerga: trocar a própria
    // senha não é gestão de ninguém.
    papeis: ['ATENDENTE', 'GESTOR'],
    // Sem `usuario`: quem troca a senha é a sessão, e nenhum id sai da tela.
    elemento: () => <TelaMinhaSenha />,
  },
  {
    caminho: '/etiquetas',
    rotulo: 'Etiquetas',
    // Mesma lista da rota `GET /produtos/:id/unidades/etiquetas`: etiquetar é
    // recebimento de mercadoria, não fluxo de balcão (RF04).
    papeis: ['GESTOR'],
    // Sem `usuario`: o produto e as unidades a imprimir chegam pelo estado de
    // rota que a tela de recebimento manda, ou pelo seletor da própria tela.
    elemento: () => <TelaEtiquetas />,
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
  /**
   * Quantos alertas proativos ainda não foram reconhecidos (T19).
   *
   * Buscado uma vez ao autenticar e atualizado pela própria tela de alertas —
   * sem `setInterval` batendo no servidor: o alerta é diário, e um contador
   * alguns minutos atrasado não muda decisão nenhuma, enquanto um polling
   * constante custaria bateria de celular no balcão para nada.
   */
  const [alertasNaoLidos, setAlertasNaoLidos] = useState(0)
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

  const gestorAutenticado = sessao.situacao === 'autenticado' && sessao.usuario.papel === 'GESTOR'

  useEffect(() => {
    if (!gestorAutenticado) {
      setAlertasNaoLidos(0)
      return
    }

    let ativo = true

    // Falha aqui é silenciosa de propósito: o distintivo é conveniência, e um
    // alerta a mais ou a menos no número não justifica um aviso vermelho sobre
    // a tela que a gestora está usando. O erro de verdade aparece quando ela
    // abre a lista.
    contarAlertasNaoLidos()
      .then((naoLidos) => {
        if (ativo) setAlertasNaoLidos(naoLidos)
      })
      .catch(() => {})

    return () => {
      ativo = false
    }
  }, [gestorAutenticado])

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
            // `end` para que `/alertas` não fique marcada como ativa enquanto
            // a tela aberta é `/alertas/configuracao`.
            end
            className={({ isActive }) => (isActive ? 'aba ativa' : 'aba')}
          >
            {tela.rotulo}
            {tela.distintivo === 'alertasNaoLidos' && alertasNaoLidos > 0 && (
              <span className="distintivo" aria-label={`${alertasNaoLidos} alerta(s) não lido(s)`}>
                {alertasNaoLidos}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <main>
        <Routes>
          {visiveis.map((tela) => (
            <Route
              key={tela.caminho}
              path={tela.caminho}
              element={tela.elemento(usuario, { aoAtualizarNaoLidos: setAlertasNaoLidos })}
            />
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
