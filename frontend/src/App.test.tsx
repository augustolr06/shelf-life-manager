import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { encontrarAviso, semAvisos } from './services/testes/avisos'
import { respostaFalsa } from './services/testes/respostaFalsa'

const GESTOR = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Gestora de Loja',
  email: 'gestor@estoque.local',
  papel: 'GESTOR' as const,
}

const ATENDENTE = {
  id: '22222222-2222-2222-2222-222222222222',
  nome: 'Atendente de Balcão',
  email: 'atendente@estoque.local',
  papel: 'ATENDENTE' as const,
}

const buscar = vi.fn<typeof fetch>()

const SESSAO_ATIVA = () => respostaFalsa(200, { usuario: GESTOR })
const SESSAO_ATENDENTE = () => respostaFalsa(200, { usuario: ATENDENTE })
const SEM_SESSAO = () =>
  respostaFalsa(401, { erro: 'NAO_AUTENTICADO', mensagem: 'Sessão ausente ou expirada.' })
const CATALOGO_VAZIO = () =>
  respostaFalsa(200, { produtos: [], total: 0, pagina: 1, tamanhoPagina: 20 })
const BACKEND_DE_PE = () => respostaFalsa(200, { status: 'ok', uptime: 1 })
const REDE_FORA = () => {
  throw new TypeError('Failed to fetch')
}

/**
 * O `App` autenticado dispara requisições de mais de um módulo (sessão e
 * catálogo), e a ordem entre elas não é o objeto do teste. Por isso o dublê
 * responde por rota, e não por sequência de chamadas.
 */
function rotear(rotas: Record<string, () => Response>) {
  buscar.mockImplementation(async (entrada, init) => {
    const caminho = String(entrada).replace('http://localhost:3333', '')
    const chave = `${init?.method ?? 'GET'} ${caminho}`
    const manipulador = rotas[chave]
    if (!manipulador) throw new Error(`rota não simulada no teste: ${chave}`)
    return manipulador()
  })
}

/**
 * Desde T10 cada tela tem URL própria, então o teste precisa dizer de onde
 * parte. O roteador de verdade (`BrowserRouter`) vive em `main.tsx`.
 */
function montar(rotaInicial = '/produtos') {
  return render(
    <MemoryRouter initialEntries={[rotaInicial]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App — guardião de sessão', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mostra a tela de login quando GET /auth/me responde 401', async () => {
    rotear({ 'GET /auth/me': SEM_SESSAO })

    montar()

    // Antes da resposta chegar não pode aparecer nem login nem conteúdo.
    expect(screen.getByRole('status')).toHaveTextContent(/verificando sessão/i)

    expect(await screen.findByLabelText(/e-mail/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/senha/i)).toBeInTheDocument()
  })

  it('restaura a sessão existente sem passar pela tela de login', async () => {
    rotear({ 'GET /auth/me': SESSAO_ATIVA, 'GET /produtos': CATALOGO_VAZIO })

    montar()

    expect(await screen.findByText(/gestora de loja — gestor/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument()
    // A tela de domínio de T04 é renderizada dentro do ramo autenticado.
    expect(screen.getByRole('heading', { name: /catálogo de produtos/i })).toBeInTheDocument()
  })

  it('separa a lista de alertas da configuração na navegação, com o contador de não lidos', async () => {
    // T19: "Alertas" passou a ser a lista; o formulário de T17 virou
    // "Configurar alertas". O contador vem do `naoLidos` da própria listagem,
    // buscado uma vez ao autenticar — sem polling.
    rotear({
      'GET /auth/me': SESSAO_ATIVA,
      'GET /produtos': CATALOGO_VAZIO,
      'GET /alertas?tamanhoPagina=1': () =>
        respostaFalsa(200, { alertas: [], total: 4, naoLidos: 3, pagina: 1, tamanhoPagina: 1 }),
    })

    montar()

    expect(await screen.findByRole('link', { name: /^alertas/i })).toHaveAttribute(
      'href',
      '/alertas',
    )
    expect(screen.getByRole('link', { name: /configurar alertas/i })).toHaveAttribute(
      'href',
      '/alertas/configuracao',
    )
    expect(await screen.findByLabelText('3 alerta(s) não lido(s)')).toHaveTextContent('3')
  })

  it('não mostra alertas nem contador para a atendente', async () => {
    // O distintivo não pode nem ser pedido: `GET /alertas` é GESTOR-only, e o
    // dublê recusa rota não simulada.
    rotear({ 'GET /auth/me': SESSAO_ATENDENTE, 'GET /health': BACKEND_DE_PE })

    montar('/leitura')
    await screen.findByRole('button', { name: /sair/i })

    expect(screen.queryByRole('link', { name: /alertas/i })).not.toBeInTheDocument()
  })

  it('envia o cookie de sessão em toda requisição', async () => {
    rotear({ 'GET /auth/me': SESSAO_ATIVA, 'GET /produtos': CATALOGO_VAZIO })

    montar()
    await screen.findByRole('button', { name: /sair/i })

    // Sem `credentials: 'include'` o navegador não manda o cookie httpOnly e
    // toda rota protegida responderia 401.
    for (const [, init] of buscar.mock.calls) {
      expect(init).toMatchObject({ credentials: 'include' })
    }
  })

  it('encerra a sessão no backend e volta para a tela de login', async () => {
    rotear({
      'GET /auth/me': SESSAO_ATIVA,
      'GET /produtos': CATALOGO_VAZIO,
      'POST /auth/logout': () => respostaFalsa(204),
    })

    montar()
    fireEvent.click(await screen.findByRole('button', { name: /sair/i }))

    expect(await screen.findByLabelText(/senha/i)).toBeInTheDocument()
    // `toHaveBeenCalledWith`, e não `LastCalledWith`: a busca do catálogo que
    // já estava no ar pode responder depois do logout, e a ordem entre as
    // duas não é o que este caso verifica.
    expect(buscar).toHaveBeenCalledWith(
      'http://localhost:3333/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('mantém a sessão aberta se o logout não chegar ao servidor', async () => {
    rotear({
      'GET /auth/me': SESSAO_ATIVA,
      'GET /produtos': CATALOGO_VAZIO,
      'POST /auth/logout': REDE_FORA,
    })

    montar()
    fireEvent.click(await screen.findByRole('button', { name: /sair/i }))

    // O cookie continua válido no navegador; fingir que a sessão acabou
    // deixaria a tela mentindo sobre o estado real.
    expect((await encontrarAviso(/não foi possível falar/i)).tipo).toBe('error')
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument()
  })

  it('cai na tela de login avisando quando o backend está inalcançável', async () => {
    rotear({ 'GET /auth/me': REDE_FORA })

    montar()

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/conexão/i))
    // O redirecionamento para `/login` é um passo do roteador, não do mesmo
    // render do aviso: por isso a espera.
    expect(await screen.findByLabelText(/e-mail/i)).toBeInTheDocument()
  })

  describe('roteamento entre telas (T10)', () => {
    it('troca do catálogo para o recebimento sem recarregar a página', async () => {
      rotear({ 'GET /auth/me': SESSAO_ATIVA, 'GET /produtos': CATALOGO_VAZIO })

      montar()
      fireEvent.click(await screen.findByRole('link', { name: /registrar recebimento/i }))

      expect(
        await screen.findByRole('heading', { name: /registrar recebimento/i }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { name: /catálogo de produtos/i }),
      ).not.toBeInTheDocument()
    })

    it('leva o GESTOR ao catálogo quando entra pela raiz', async () => {
      rotear({ 'GET /auth/me': SESSAO_ATIVA, 'GET /produtos': CATALOGO_VAZIO })

      montar('/')

      expect(
        await screen.findByRole('heading', { name: /catálogo de produtos/i }),
      ).toBeInTheDocument()
    })

    it('leva a ATENDENTE direto à leitura de QR, que é o que ela faz no sistema', async () => {
      rotear({ 'GET /auth/me': SESSAO_ATENDENTE, 'GET /health': BACKEND_DE_PE })

      montar('/')

      expect(await screen.findByRole('heading', { name: /leitura de qr/i })).toBeInTheDocument()
    })

    it('não oferece o recebimento à ATENDENTE, nem por link nem por URL', async () => {
      rotear({
        'GET /auth/me': SESSAO_ATENDENTE,
        'GET /produtos': CATALOGO_VAZIO,
        'GET /health': BACKEND_DE_PE,
      })

      montar('/recebimento')

      // A URL digitada à mão cai na tela inicial do papel, e o link nem
      // aparece. Conveniência de interface: quem recusa de fato é o 403 do
      // backend (RF03), coberto por `backend/tests/unidade.test.ts`.
      expect(await screen.findByRole('heading', { name: /leitura de qr/i })).toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: /registrar recebimento/i }),
      ).not.toBeInTheDocument()
    })

    it('manda ao login quem chega numa rota interna sem sessão', async () => {
      rotear({ 'GET /auth/me': SEM_SESSAO })

      montar('/leitura')

      expect(await screen.findByLabelText(/senha/i)).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /leitura de qr/i })).not.toBeInTheDocument()
    })
  })

  describe('sessão expirada no meio do uso (T30)', () => {
    const SESSAO_EXPIRADA = () =>
      respostaFalsa(401, {
        erro: 'NAO_AUTENTICADO',
        mensagem: 'Sessão ausente ou expirada. Faça login novamente.',
      })
    const SEM_JANELAS = () => respostaFalsa(200, { configuracoes: [] })

    it('cobre a tela com o modal quando uma tela recebe 401, com o foco no botão', async () => {
      rotear({ 'GET /auth/me': SESSAO_ATIVA, 'GET /configuracao-alerta': SESSAO_EXPIRADA })

      montar('/alertas/configuracao')

      const modal = await screen.findByRole('dialog', { name: /sessão expirada/i })
      expect(modal).toHaveAccessibleDescription(/entre novamente para continuar/i)
      expect(screen.getByRole('button', { name: /entrar novamente/i })).toHaveFocus()
    })

    it('não deixa toast de erro para trás quando a ação recusada é um clique', async () => {
      // O toast de erro não some sozinho e sobrevive ao login: se aparecesse,
      // continuaria na tela da sessão nova.
      rotear({
        'GET /auth/me': SESSAO_ATIVA,
        'GET /configuracao-alerta': SEM_JANELAS,
        'POST /configuracao-alerta': SESSAO_EXPIRADA,
      })

      montar('/alertas/configuracao')
      fireEvent.change(await screen.findByLabelText(/dias de antecedência/i), {
        target: { value: '30' },
      })
      fireEvent.click(screen.getByRole('button', { name: /adicionar janela/i }))

      expect(await screen.findByRole('dialog', { name: /sessão expirada/i })).toBeInTheDocument()
      expect(await semAvisos()).toBe(true)
    })

    it('leva ao login e, depois de entrar, devolve à rota em que a pessoa estava', async () => {
      let sessaoValida = false
      rotear({
        'GET /auth/me': SESSAO_ATIVA,
        'GET /configuracao-alerta': () => (sessaoValida ? SEM_JANELAS() : SESSAO_EXPIRADA()),
        'POST /auth/login': () => {
          sessaoValida = true
          return respostaFalsa(200, { usuario: GESTOR })
        },
      })

      montar('/alertas/configuracao')
      fireEvent.click(await screen.findByRole('button', { name: /entrar novamente/i }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      fireEvent.change(await screen.findByLabelText(/e-mail/i), {
        target: { value: GESTOR.email },
      })
      fireEvent.change(screen.getByLabelText(/senha/i), { target: { value: 'segredo123' } })
      fireEvent.click(screen.getByRole('button', { name: /entrar/i }))

      // A rota inicial do GESTOR é o catálogo; voltar à configuração prova
      // que a rota veio do modal, e não do papel.
      expect(
        await screen.findByRole('heading', { name: /alertas de vencimento próximo/i }),
      ).toBeInTheDocument()
      expect(await screen.findByText(/nenhuma janela de antecedência/i)).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('não abre o modal no 401 do GET /auth/me da abertura: ali é "não está logado"', async () => {
      rotear({ 'GET /auth/me': SEM_SESSAO })

      montar()

      expect(await screen.findByLabelText(/e-mail/i)).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('não abre o modal no 401 do login: é senha errada', async () => {
      rotear({
        'GET /auth/me': SEM_SESSAO,
        'POST /auth/login': () =>
          respostaFalsa(401, {
            erro: 'CREDENCIAL_INVALIDA',
            mensagem: 'E-mail ou senha inválidos.',
          }),
      })

      montar()
      fireEvent.change(await screen.findByLabelText(/e-mail/i), {
        target: { value: GESTOR.email },
      })
      fireEvent.change(screen.getByLabelText(/senha/i), { target: { value: 'errada' } })
      fireEvent.click(screen.getByRole('button', { name: /entrar/i }))

      expect(await screen.findByText(/e-mail ou senha inválidos/i)).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('não abre o modal no 403 PAPEL_INSUFICIENTE: a sessão continua valendo', async () => {
      rotear({
        'GET /auth/me': SESSAO_ATIVA,
        'GET /configuracao-alerta': () =>
          respostaFalsa(403, {
            erro: 'PAPEL_INSUFICIENTE',
            mensagem: 'Seu papel não permite esta ação.',
          }),
      })

      montar('/alertas/configuracao')

      expect(await screen.findByText(/seu papel não permite/i)).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
