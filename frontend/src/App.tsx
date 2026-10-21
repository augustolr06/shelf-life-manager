import { startTransition, useEffect, useState, type ReactElement } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Avisos } from './components/Avisos'
import { Dialogo } from './components/Dialogo'
import { ProvedorConfirmacao } from './components/DialogoConfirmacao'
import {
  AbasValidade,
  BarraInferior,
  MenuLateral,
  type Contagens,
  type ItemMenu,
} from './components/Navegacao'
import { useFormatoDaTela } from './hooks/useFormatoDaTela'
import { TelaAlertas } from './pages/TelaAlertas'
import { TelaConfiguracaoAlerta } from './pages/TelaConfiguracaoAlerta'
import { TelaConsulta } from './pages/TelaConsulta'
import { TelaDashboard } from './pages/TelaDashboard'
import { TelaDescartesPendentes } from './pages/TelaDescartesPendentes'
import { TelaEtiquetas } from './pages/TelaEtiquetas'
import { TelaInicio } from './pages/TelaInicio'
import { TelaLogin } from './pages/TelaLogin'
import { TelaProdutos } from './pages/TelaProdutos'
import { TelaUsuarios } from './pages/TelaUsuarios'
import { TelaVenda } from './pages/TelaVenda'
import { TelaMinhaSenha } from './pages/TelaMinhaSenha'
import { TelaRecebimento } from './pages/TelaRecebimento'
import { contarAlertasNaoLidos } from './services/alertas'
import { aoExpirarSessao } from './services/api'
import { avisar } from './services/avisos'
import { buscarSessaoAtual, encerrarSessao, type Papel, type Usuario } from './services/auth'
import { listarDescartesPendentes } from './services/descartes'

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
 * O que o `App` empresta a uma tela além do usuário: os contadores que a
 * navegação exibe — alertas não lidos (T19) e unidades na fila de descarte
 * (T41) — e os canais de volta para eles. Cada um é recalculado pela tela
 * dona da lista; o Início (T42) só lê.
 */
type RecursosDaTela = {
  contagens: Contagens
  aoAtualizarNaoLidos: (naoLidos: number) => void
  aoAtualizarPendentes: (pendentes: number) => void
}

type Tela = ItemMenu & {
  papeis: readonly Papel[]
  elemento: (usuario: Usuario, recursos: RecursosDaTela) => ReactElement
}

/**
 * Na ordem do menu da especificação do redesign (T41). O `rotulo` é o do menu
 * e também o título (`<h1>`) da tela; as rotas não mudaram com os rótulos,
 * porque testes, favoritos e o roteiro manual dependem delas.
 */
const TELAS: readonly Tela[] = [
  {
    caminho: '/inicio',
    rotulo: 'Início',
    // Sem grupo, acima deles. No celular fica na folha "Mais": a barra
    // inferior é das tarefas de balcão e da validade.
    noTopo: true,
    icone: 'inicio',
    // Mesma lista de `GET /dashboard`, de onde vem tudo o que a tela mostra.
    papeis: ['GESTOR'],
    elemento: (usuario, recursos) => (
      <TelaInicio usuario={usuario} alertasNaoLidos={recursos.contagens.alertasNaoLidos} />
    ),
  },
  {
    // Era `/leitura` até T34, quando ler deixou de ser vender e a tela ganhou o
    // carrinho. O caminho antigo redireciona para cá (`REDIRECIONAMENTOS`).
    caminho: '/venda',
    rotulo: 'Venda',
    grupo: 'Operação',
    icone: 'venda',
    barraInferior: { rotulo: 'Venda', icone: 'venda' },
    // Mesma lista das rotas `POST /saidas/ler` e `POST /saidas/finalizar`.
    papeis: ['ATENDENTE', 'GESTOR'],
    // O papel decide quais dos três caminhos da unidade vencida aparecem (T12).
    elemento: (usuario) => <TelaVenda usuario={usuario} />,
  },
  {
    caminho: '/consulta',
    rotulo: 'Consultar produto',
    grupo: 'Operação',
    icone: 'consultar',
    barraInferior: { rotulo: 'Consultar', icone: 'consultar' },
    // Mesma lista de `GET /unidades/consulta/:codigoQr`: conferir um frasco
    // para responder a um cliente é pergunta de balcão (T32).
    papeis: ['ATENDENTE', 'GESTOR'],
    // Sem `usuario`: consultar não tem ramo por papel.
    elemento: () => <TelaConsulta />,
  },
  {
    caminho: '/recebimento',
    rotulo: 'Recebimento',
    grupo: 'Operação',
    icone: 'recebimento',
    papeis: ['GESTOR'],
    elemento: () => <TelaRecebimento />,
  },
  {
    caminho: '/etiquetas',
    rotulo: 'Etiquetas',
    grupo: 'Operação',
    icone: 'etiquetas',
    // Mesma lista da rota `GET /produtos/:id/unidades/etiquetas`: etiquetar é
    // recebimento de mercadoria, não fluxo de balcão (RF04).
    papeis: ['GESTOR'],
    // Sem `usuario`: o produto e as unidades a imprimir chegam pelo estado de
    // rota que a tela de recebimento manda, ou pelo seletor da própria tela.
    elemento: () => <TelaEtiquetas />,
  },
  {
    caminho: '/alertas',
    rotulo: 'Alertas',
    grupo: 'Validade',
    icone: 'alertas',
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
    caminho: '/descartes',
    rotulo: 'Descarte',
    grupo: 'Validade',
    icone: 'descarte',
    distintivo: 'descartesPendentes',
    // No celular, o atalho "Validade" abre o descarte, e os alertas ficam na
    // aba ao lado (`AbasValidade`).
    barraInferior: { rotulo: 'Validade', icone: 'validade', ativoTambemEm: ['/alertas'] },
    // Mesma lista da rota `GET /descartes/pendentes`: varredura de estoque é
    // trabalho de gestão, não de balcão (RF11).
    papeis: ['GESTOR'],
    elemento: (usuario, recursos) => (
      <TelaDescartesPendentes
        usuario={usuario}
        aoAtualizarPendentes={recursos.aoAtualizarPendentes}
      />
    ),
  },
  {
    caminho: '/dashboard',
    rotulo: 'Relatórios',
    grupo: 'Gestão',
    icone: 'relatorios',
    // Mesma lista das duas rotas de `/dashboard`: são decisão comercial e dado
    // de pesquisa, não ato de balcão (RF13).
    papeis: ['GESTOR'],
    // Sem `usuario`: a tela é GESTOR-only inteira e não tem ramo por papel.
    elemento: () => <TelaDashboard />,
  },
  {
    caminho: '/produtos',
    rotulo: 'Catálogo',
    grupo: 'Gestão',
    icone: 'catalogo',
    papeis: ['ATENDENTE', 'GESTOR'],
    elemento: (usuario) => <TelaProdutos usuario={usuario} />,
  },
  {
    caminho: '/usuarios',
    rotulo: 'Contas de acesso',
    grupo: 'Gestão',
    icone: 'contas',
    // Mesma lista das rotas de gestão de `/usuarios`: admitir, desligar e
    // trocar papel é ato de gestão, não de balcão (RF01, T22).
    papeis: ['GESTOR'],
    // Recebe `usuario` para saber qual linha é a de quem está logado — e é
    // só isso: a recusa de mexer no próprio acesso é do backend (409).
    elemento: (usuario) => <TelaUsuarios usuario={usuario} />,
  },
  {
    caminho: '/alertas/configuracao',
    // "Alertas" agora é a lista. O rótulo daqui diz o que esta tela faz: o
    // parâmetro, não o aviso.
    rotulo: 'Configurar alertas',
    grupo: 'Gestão',
    icone: 'configurar',
    // Mesma lista das quatro rotas de `/configuracao-alerta`: a janela de
    // antecedência é parâmetro de gestão, e mexer nela muda o que o sistema
    // avisa a todo mundo (RF08).
    papeis: ['GESTOR'],
    // Sem `usuario`: a tela é GESTOR-only inteira, não tem ramo por papel.
    elemento: () => <TelaConfiguracaoAlerta />,
  },
  {
    caminho: '/minha-senha',
    rotulo: 'Minha senha',
    // Sem `grupo`: o link fica no rodapé do usuário, ao lado do nome.
    icone: 'senha',
    // A única tela deste módulo que a atendente enxerga: trocar a própria
    // senha não é gestão de ninguém.
    papeis: ['ATENDENTE', 'GESTOR'],
    // Sem `usuario`: quem troca a senha é a sessão, e nenhum id sai da tela.
    elemento: () => <TelaMinhaSenha />,
  },
]

/**
 * Caminhos que mudaram de nome, para o que eles viraram. Favorito, atalho do
 * PWA instalado e roteiro impresso continuam chegando à tela certa.
 */
const REDIRECIONAMENTOS: Readonly<Record<string, string>> = {
  '/leitura': '/venda',
}

/**
 * Para onde `/` leva. A atendente cai na venda porque é a única coisa que
 * ela faz no sistema; o gestor cai no Início, que mostra primeiro o que
 * precisa de ação (T42 — até ali, era o catálogo).
 */
function rotaInicial(usuario: Usuario): string {
  return usuario.papel === 'ATENDENTE' ? '/venda' : '/inicio'
}

/**
 * A região dos toasts fica fora do guardião de sessão: montada uma vez, ela
 * sobrevive à troca entre login e área autenticada, e um aviso dado no
 * momento da troca não se perde (T29).
 *
 * O provedor de confirmação (T39) também fica aqui: um diálogo só para o app
 * inteiro, que qualquer tela pede com `useConfirmacao()`.
 */
export function App() {
  return (
    <>
      <Avisos />
      <ProvedorConfirmacao>
        <Aplicacao />
      </ProvedorConfirmacao>
    </>
  )
}

function Aplicacao() {
  const [sessao, setSessao] = useState<EstadoSessao>({ situacao: 'verificando' })
  /**
   * Por que a tela de login apareceu sem ninguém ter saído: o backend não
   * respondeu à verificação da sessão. É estado da tela, não resultado de
   * ação, e por isso não vira toast; a falha do "Sair" vira (T29).
   */
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
  /**
   * Quantas unidades vencidas esperam na fila de descarte (T41): o `total` da
   * primeira página de `GET /descartes/pendentes`. Mesma política do contador
   * de alertas — buscado ao autenticar, atualizado pela tela de descarte
   * quando ela recarrega a fila, sem polling.
   */
  const [descartesPendentes, setDescartesPendentes] = useState(0)
  const formato = useFormatoDaTela()
  /**
   * Uma requisição autenticada voltou 401 `NAO_AUTENTICADO` (T30). A sessão
   * continua `autenticado` até a pessoa clicar em "Entrar novamente": a tela
   * fica onde estava, por baixo do modal, e é dela que se guarda a rota.
   */
  const [sessaoExpirada, setSessaoExpirada] = useState(false)
  /**
   * De onde o modal de sessão expirada tirou a pessoa, para voltar lá depois
   * do login. Estado do `App`, e não estado de rota: na troca para o ramo
   * anônimo a rota coringa redireciona ao login antes da navegação chegar, e
   * o estado de rota se perderia no caminho.
   */
  const [voltarPara, setVoltarPara] = useState<string | null>(null)
  const navegar = useNavigate()
  const local = useLocation()

  useEffect(() => aoExpirarSessao(() => setSessaoExpirada(true)), [])

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
      setDescartesPendentes(0)
      return
    }

    let ativo = true

    // Falha aqui é silenciosa de propósito: o distintivo é conveniência, e um
    // alerta a mais ou a menos no número não justifica um aviso vermelho sobre
    // a tela que a gestora está usando. O erro de verdade aparece quando ela
    // abre a lista. O mesmo vale para a fila de descarte.
    contarAlertasNaoLidos()
      .then((naoLidos) => {
        if (ativo) setAlertasNaoLidos(naoLidos)
      })
      .catch(() => {})
    listarDescartesPendentes()
      .then((fila) => {
        if (ativo) setDescartesPendentes(fila.total)
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
      avisar.erro(falha, 'Não foi possível sair.')
    }
  }

  if (sessao.situacao === 'verificando') {
    return (
      <main className="tela-carregando">
        <p role="status">Verificando sessão…</p>
      </main>
    )
  }

  function entrarNovamente() {
    setSessaoExpirada(false)
    setVoltarPara(`${local.pathname}${local.search}`)
    setSessao({ situacao: 'anonimo' })
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
                  // Uma requisição que já estava no ar pode ter voltado 401
                  // depois do "Entrar novamente"; a sessão nova não herda o aviso.
                  setSessaoExpirada(false)
                  setVoltarPara(null)
                  // Sessão e rota na mesma transição, porque o roteador navega
                  // em transição: com a sessão aplicada antes, o ramo
                  // autenticado renderiza ainda em `/login`, e a rota coringa
                  // manda para a tela inicial por cima do retorno (T30).
                  startTransition(() => {
                    setSessao({ situacao: 'autenticado', usuario })
                    // Rota que o papel de quem entrou não alcança — outra
                    // pessoa entrou no mesmo aparelho — cai na rota coringa e
                    // vai para a tela inicial, como qualquer URL digitada.
                    navegar(voltarPara ?? rotaInicial(usuario), { replace: true })
                  })
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
  const contagens: Contagens = { alertasNaoLidos, descartesPendentes }
  const recursos: RecursosDaTela = {
    contagens,
    aoAtualizarNaoLidos: setAlertasNaoLidos,
    aoAtualizarPendentes: setDescartesPendentes,
  }
  const navegacao = { itens: visiveis, contagens, usuario, aoSair: sair }

  // Desde T41 não há barra do topo: a marca, o usuário e o sair moram no menu
  // lateral (computador e tablet) ou na folha "Mais" (celular). No celular a
  // barra inferior vem depois do conteúdo, para que a ordem de tabulação siga
  // a ordem em que ela aparece na tela.
  return (
    <div className={`aplicacao formato-${formato}`}>
      {formato !== 'celular' && (
        <MenuLateral {...navegacao} recolhivel={formato === 'tablet'} />
      )}

      <main>
        {formato === 'celular' && <AbasValidade itens={visiveis} contagens={contagens} />}
        <Routes>
          {visiveis.map((tela) => (
            <Route
              key={tela.caminho}
              path={tela.caminho}
              element={tela.elemento(usuario, recursos)}
            />
          ))}
          {Object.entries(REDIRECIONAMENTOS).map(([antigo, novo]) => (
            <Route key={antigo} path={antigo} element={<Navigate to={novo} replace />} />
          ))}
          {/* Rota de tela que o papel não alcança, `/login` já autenticado e
              URL desconhecida caem todas no mesmo lugar: a tela inicial do
              papel. */}
          <Route path="*" element={<Navigate to={inicial} replace />} />
        </Routes>
      </main>

      {formato === 'celular' && <BarraInferior {...navegacao} />}

      {/* Sem `aoCancelar`: não há tela para onde voltar, porque toda ação a
          partir daqui falharia. */}
      <Dialogo
        aberto={sessaoExpirada}
        titulo="Sessão expirada"
        acoes={
          <button type="button" onClick={entrarNovamente}>
            Entrar novamente
          </button>
        }
      >
        <p>Sua sessão expirou. Entre novamente para continuar.</p>
      </Dialogo>
    </div>
  )
}
