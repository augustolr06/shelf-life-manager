import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const PAINEL_VAZIO = () =>
  respostaFalsa(200, {
    periodo: { de: '2026-09-22', ate: '2026-10-21' },
    hoje: '2026-10-21',
    estoque: {
      unidadesEmEstoque: 0,
      porFaixaDeVencimento: [
        'VENCIDA',
        'ATE_7_DIAS',
        'DE_8_A_30_DIAS',
        'DE_31_A_90_DIAS',
        'ACIMA_DE_90_DIAS',
      ].map((faixa) => ({ faixa, unidades: 0 })),
      proximoVencimento: null,
    },
    saidas: { total: 0, naPrimeiraLeitura: 0, taxaAcertoPrimeiraLeitura: null },
    fifo: { alertasDisparados: 0, substituicoesEfetivas: 0 },
    perdas: { descartes: 0, unidadesVencidasEmEstoque: 0 },
    overrides: { total: 0 },
  })
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

    // Nome e papel no rodapé do menu desde T41, que tirou a barra do topo.
    expect(await screen.findByText('Gestora de Loja')).toBeInTheDocument()
    expect(screen.getByText(/^gestor ·/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument()
    // A tela de domínio de T04 é renderizada dentro do ramo autenticado.
    expect(screen.getByRole('heading', { level: 1, name: /^catálogo$/i })).toBeInTheDocument()
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

    montar('/venda')
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
      fireEvent.click(await screen.findByRole('link', { name: /^recebimento$/i }))

      expect(
        await screen.findByRole('heading', { level: 1, name: /^recebimento$/i }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { level: 1, name: /^catálogo$/i }),
      ).not.toBeInTheDocument()
    })

    it('leva o GESTOR ao Início quando entra pela raiz (T42)', async () => {
      rotear({ 'GET /auth/me': SESSAO_ATIVA, 'GET /dashboard': PAINEL_VAZIO })

      montar('/')

      expect(
        await screen.findByRole('heading', { level: 1, name: /, gestora$/i }),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page')
    })

    it('leva a ATENDENTE direto à venda, que é o que ela faz no sistema', async () => {
      rotear({ 'GET /auth/me': SESSAO_ATENDENTE, 'GET /health': BACKEND_DE_PE })

      montar('/')

      expect(await screen.findByRole('heading', { name: /^venda$/i })).toBeInTheDocument()
    })

    it('leva o endereço antigo da leitura à tela de venda (T34)', async () => {
      rotear({ 'GET /auth/me': SESSAO_ATENDENTE, 'GET /health': BACKEND_DE_PE })

      // Favorito e PWA instalado antes de T34 ainda abrem `/leitura`.
      montar('/leitura')

      expect(await screen.findByRole('heading', { name: /^venda$/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /^venda$/i })).toHaveAttribute('href', '/venda')
    })

    it('oferece a consulta de produto à ATENDENTE (T32)', async () => {
      rotear({ 'GET /auth/me': SESSAO_ATENDENTE, 'GET /health': BACKEND_DE_PE })

      montar('/consulta')

      expect(
        await screen.findByRole('heading', { name: /consultar produto/i }),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /consultar produto/i })).toHaveAttribute(
        'href',
        '/consulta',
      )
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
      expect(await screen.findByRole('heading', { name: /^venda$/i })).toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: /recebimento/i }),
      ).not.toBeInTheDocument()
    })

    it('manda ao login quem chega numa rota interna sem sessão', async () => {
      rotear({ 'GET /auth/me': SEM_SESSAO })

      montar('/venda')

      expect(await screen.findByLabelText(/senha/i)).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /^venda$/i })).not.toBeInTheDocument()
    })
  })

  describe('navegação por tarefa (T41)', () => {
    const SEM_ALERTAS = () =>
      respostaFalsa(200, { alertas: [], total: 0, naoLidos: 0, pagina: 1, tamanhoPagina: 1 })
    const TRES_NAO_LIDOS = () =>
      respostaFalsa(200, { alertas: [], total: 4, naoLidos: 3, pagina: 1, tamanhoPagina: 1 })
    const SETE_NA_FILA = () =>
      respostaFalsa(200, { unidades: [], total: 7, pagina: 1, tamanhoPagina: 20 })

    /**
     * O formato da navegação vem de `matchMedia`, que o jsdom não tem. Sem
     * este dublê, o `App` monta o menu do computador.
     */
    function simularLargura(largura: number) {
      vi.stubGlobal('matchMedia', (consulta: string) => ({
        matches: largura <= Number(/max-width:\s*([\d.]+)px/.exec(consulta)?.[1]),
        media: consulta,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    }

    /** Os rótulos das listas de um grupo do menu, na ordem. */
    function itensDoGrupo(grupo: string) {
      return within(screen.getByRole('list', { name: grupo }))
        .getAllByRole('link')
        .map((link) => link.textContent)
    }

    it('agrupa as telas do gestor por tarefa, com os rótulos novos e as mesmas rotas', async () => {
      rotear({
        'GET /auth/me': SESSAO_ATIVA,
        'GET /produtos': CATALOGO_VAZIO,
        'GET /alertas?tamanhoPagina=1': SEM_ALERTAS,
        'GET /descartes/pendentes': SETE_NA_FILA,
      })

      montar()
      await screen.findByRole('navigation', { name: 'Menu principal' })

      expect(itensDoGrupo('Operação')).toEqual([
        'Venda',
        'Consultar produto',
        'Recebimento',
        'Etiquetas',
      ])
      expect(itensDoGrupo('Gestão')).toEqual([
        'Relatórios',
        'Catálogo',
        'Contas de acesso',
        'Configurar alertas',
      ])
      expect(screen.getByRole('link', { name: /^relatórios$/i })).toHaveAttribute(
        'href',
        '/dashboard',
      )
      expect(screen.getByRole('link', { name: /^catálogo$/i })).toHaveAttribute('aria-current', 'page')
      expect(screen.getByRole('link', { name: 'Minha senha' })).toHaveAttribute(
        'href',
        '/minha-senha',
      )
    })

    it('põe o Início do gestor no topo do menu, fora dos grupos (T42)', async () => {
      rotear({
        'GET /auth/me': SESSAO_ATIVA,
        'GET /produtos': CATALOGO_VAZIO,
        'GET /alertas?tamanhoPagina=1': SEM_ALERTAS,
        'GET /descartes/pendentes': SETE_NA_FILA,
      })

      montar()
      const menu = await screen.findByRole('navigation', { name: 'Menu principal' })

      const links = within(menu).getAllByRole('link')
      expect(links[0]).toHaveTextContent('Início')
      expect(links[0]).toHaveAttribute('href', '/inicio')
      for (const grupo of ['Operação', 'Validade', 'Gestão']) {
        expect(itensDoGrupo(grupo)).not.toContain('Início')
      }
    })

    it('mostra à atendente só Venda, Consultar e Catálogo, sem grupo de validade', async () => {
      rotear({ 'GET /auth/me': SESSAO_ATENDENTE, 'GET /health': BACKEND_DE_PE })

      montar('/venda')
      await screen.findByRole('navigation', { name: 'Menu principal' })

      expect(itensDoGrupo('Operação')).toEqual(['Venda', 'Consultar produto'])
      expect(itensDoGrupo('Gestão')).toEqual(['Catálogo'])
      expect(screen.queryByRole('list', { name: 'Validade' })).not.toBeInTheDocument()
      // O Início é do gestor: tudo nele vem de `GET /dashboard`, que é GESTOR.
      expect(screen.queryByRole('link', { name: 'Início' })).not.toBeInTheDocument()
      expect(screen.getByText('Atendente de Balcão')).toBeInTheDocument()
    })

    it('conta a fila de descarte no distintivo, pelo total de GET /descartes/pendentes', async () => {
      rotear({
        'GET /auth/me': SESSAO_ATIVA,
        'GET /produtos': CATALOGO_VAZIO,
        'GET /alertas?tamanhoPagina=1': TRES_NAO_LIDOS,
        'GET /descartes/pendentes': SETE_NA_FILA,
      })

      montar()

      expect(await screen.findByLabelText('7 unidade(s) na fila de descarte')).toHaveTextContent('7')
      expect(within(screen.getByRole('list', { name: 'Validade' })).getAllByRole('link')).toHaveLength(2)
      expect(await screen.findByLabelText('3 alerta(s) não lido(s)')).toBeInTheDocument()
    })

    it('não marca Alertas como atual enquanto a tela é a configuração deles', async () => {
      rotear({
        'GET /auth/me': SESSAO_ATIVA,
        'GET /alertas?tamanhoPagina=1': SEM_ALERTAS,
        'GET /descartes/pendentes': SETE_NA_FILA,
        'GET /configuracao-alerta': () => respostaFalsa(200, { configuracoes: [] }),
      })

      montar('/alertas/configuracao')

      expect(await screen.findByRole('link', { name: /configurar alertas/i })).toHaveAttribute(
        'aria-current',
        'page',
      )
      expect(screen.getByRole('link', { name: /^alertas$/i })).not.toHaveAttribute('aria-current')
    })

    it('no tablet, recolhe o menu aos ícones com o nome no aria-label e expande pelo botão', async () => {
      simularLargura(768)
      rotear({
        'GET /auth/me': SESSAO_ATIVA,
        'GET /produtos': CATALOGO_VAZIO,
        'GET /alertas?tamanhoPagina=1': SEM_ALERTAS,
        'GET /descartes/pendentes': SETE_NA_FILA,
      })

      montar()

      const descarte = await screen.findByRole('link', {
        name: 'Descarte, 7 unidade(s) na fila de descarte',
      })
      expect(descarte).toHaveAttribute('title', 'Descarte')
      expect(descarte).not.toHaveTextContent('Descarte')

      const menu = screen.getByRole('button', { name: 'Menu' })
      expect(menu).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(menu)
      expect(menu).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('link', { name: /^descarte/i })).toHaveTextContent('Descarte')

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(menu).toHaveAttribute('aria-expanded', 'false')
    })

    it('no celular, dá ao gestor a barra inferior com Venda, Consultar, Validade e Mais', async () => {
      simularLargura(360)
      rotear({
        'GET /auth/me': SESSAO_ATIVA,
        'GET /health': BACKEND_DE_PE,
        'GET /alertas?tamanhoPagina=1': TRES_NAO_LIDOS,
        'GET /descartes/pendentes': SETE_NA_FILA,
      })

      montar('/venda')

      const barra = await screen.findByRole('navigation', { name: 'Menu principal' })
      await within(barra).findByText('7')
      expect(
        within(barra)
          .getAllByRole('link')
          .map((link) => link.getAttribute('aria-label')),
      ).toEqual(['Venda', 'Consultar', 'Validade, 7 unidade(s) na fila de descarte'])
      expect(within(barra).getByRole('link', { name: 'Venda' })).toHaveAttribute(
        'aria-current',
        'page',
      )
      expect(within(barra).getByRole('link', { name: /^validade/i })).toHaveAttribute(
        'href',
        '/descartes',
      )
      expect(within(barra).getByRole('button', { name: 'Mais' })).toBeInTheDocument()
    })

    it('abre a folha "Mais" com o resto do menu e o rodapé, e devolve o foco ao fechar', async () => {
      simularLargura(360)
      rotear({
        'GET /auth/me': SESSAO_ATIVA,
        'GET /health': BACKEND_DE_PE,
        'GET /alertas?tamanhoPagina=1': TRES_NAO_LIDOS,
        'GET /descartes/pendentes': SETE_NA_FILA,
      })

      montar('/venda')
      const mais = await screen.findByRole('button', { name: 'Mais' })
      fireEvent.click(mais)

      const folha = screen.getByRole('dialog', { name: 'Mais' })
      expect(mais).toHaveAttribute('aria-expanded', 'true')
      expect(within(folha).getByRole('button', { name: 'Fechar' })).toHaveFocus()
      // Venda, Consultar e Descarte já estão na barra; os alertas, não.
      expect(
        within(within(folha).getByRole('list', { name: 'Operação' }))
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['Recebimento', 'Etiquetas'])
      expect(within(folha).getByRole('link', { name: /^alertas/i })).toHaveAttribute(
        'href',
        '/alertas',
      )
      expect(within(folha).getByRole('button', { name: 'Sair' })).toBeInTheDocument()

      fireEvent.keyDown(folha, { key: 'Escape' })

      expect(screen.queryByRole('dialog', { name: 'Mais' })).not.toBeInTheDocument()
      expect(mais).toHaveFocus()
    })

    it('no celular, dá à atendente só Venda, Consultar e Mais', async () => {
      simularLargura(360)
      rotear({ 'GET /auth/me': SESSAO_ATENDENTE, 'GET /health': BACKEND_DE_PE })

      montar('/venda')

      const barra = await screen.findByRole('navigation', { name: 'Menu principal' })
      expect(within(barra).getAllByRole('link').map((link) => link.textContent)).toEqual([
        'Venda',
        'Consultar',
      ])
      fireEvent.click(within(barra).getByRole('button', { name: 'Mais' }))
      const folha = screen.getByRole('dialog', { name: 'Mais' })
      // Só o grupo Gestão sobra para ela, com o Catálogo.
      expect(within(folha).getAllByRole('list')).toHaveLength(1)
      expect(within(folha).getByRole('link', { name: 'Catálogo' })).toBeInTheDocument()
    })

    it('no celular, põe as abas Descarte | Alertas no topo das telas de validade', async () => {
      simularLargura(360)
      rotear({
        'GET /auth/me': SESSAO_ATIVA,
        'GET /alertas?tamanhoPagina=1': TRES_NAO_LIDOS,
        'GET /descartes/pendentes': SETE_NA_FILA,
      })

      montar('/descartes')

      const abas = await screen.findByRole('navigation', { name: 'Validade' })
      await within(abas).findByText('3')
      expect(within(abas).getByRole('link', { name: /^descarte/i })).toHaveAttribute(
        'aria-current',
        'page',
      )
      expect(within(abas).getByRole('link', { name: /^alertas/i })).toHaveAttribute(
        'href',
        '/alertas',
      )
      expect(within(abas).getByLabelText('7 unidade(s) na fila de descarte')).toBeInTheDocument()
      // Em `/descartes`, o atalho "Validade" da barra fica marcado como página.
      expect(screen.getByRole('link', { name: /^validade/i })).toHaveAttribute(
        'aria-current',
        'page',
      )
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
        await screen.findByRole('heading', { level: 1, name: /configurar alertas/i }),
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
