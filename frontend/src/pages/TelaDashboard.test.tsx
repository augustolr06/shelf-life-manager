import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaDashboard } from './TelaDashboard'
import { respostaFalsa } from '../services/testes/respostaFalsa'
import type { Dashboard, HistoricoDeSaidas, SaidaNoHistorico } from '../services/dashboard'

/**
 * O painel da RF13 (T21).
 *
 * A tela não calcula nada: faixa, taxa, período padrão e o que é "vencido" vêm
 * decididos do servidor (RNF04). O que estes testes verificam é justamente
 * isso — que a primeira carga vai **sem** `de`/`ate` e adota o intervalo
 * ecoado, que as cinco faixas aparecem inclusive zeradas, e que a distinção
 * entre "sem saídas no período" e "0% de acerto" sobrevive na exibição, já que
 * ela é o motivo de o backend devolver `null` em vez de `0`.
 */

/** Na ordem em que o servidor devolve as faixas: da mais urgente para a menos. */
const ROTULOS_DAS_FAIXAS = [
  'Já vencidas',
  'Vencem em até 7 dias',
  'Vencem em 8 a 30 dias',
  'Vencem em 31 a 90 dias',
  'Vencem em mais de 90 dias',
]

const PAINEL: Dashboard = {
  periodo: { de: '2026-08-11', ate: '2026-09-09' },
  estoque: {
    unidadesEmEstoque: 13,
    porFaixaDeVencimento: [
      { faixa: 'VENCIDA', unidades: 1 },
      { faixa: 'ATE_7_DIAS', unidades: 0 },
      { faixa: 'DE_8_A_30_DIAS', unidades: 2 },
      { faixa: 'DE_31_A_90_DIAS', unidades: 3 },
      { faixa: 'ACIMA_DE_90_DIAS', unidades: 7 },
    ],
  },
  saidas: { total: 13, naPrimeiraLeitura: 11, taxaAcertoPrimeiraLeitura: 0.8462 },
  fifo: { alertasDisparados: 5, substituicoesEfetivas: 2 },
  perdas: { descartes: 4, unidadesVencidasEmEstoque: 1 },
  overrides: { total: 0 },
}

const PAINEL_VAZIO: Dashboard = {
  periodo: { de: '2026-08-11', ate: '2026-09-09' },
  estoque: {
    unidadesEmEstoque: 0,
    porFaixaDeVencimento: PAINEL.estoque.porFaixaDeVencimento.map(({ faixa }) => ({
      faixa,
      unidades: 0,
    })),
  },
  saidas: { total: 0, naPrimeiraLeitura: 0, taxaAcertoPrimeiraLeitura: null },
  fifo: { alertasDisparados: 0, substituicoesEfetivas: 0 },
  perdas: { descartes: 0, unidadesVencidasEmEstoque: 0 },
  overrides: { total: 0 },
}

const SAIDA_COMUM: SaidaNoHistorico = {
  id: 'saida-1',
  dataHora: '2026-09-08T17:32:00.000Z',
  tentativasAteAcerto: 0,
  alertaFifoDisparado: false,
  vendaDeUnidadeVencida: false,
  justificativaOverride: null,
  sessaoVendaId: 'sessao-1',
  usuario: { id: 'usuario-1', nome: 'Ana Atendente' },
  autorizadoPor: null,
  unidade: {
    id: 'unidade-1',
    codigoQr: 'PRF-JC95FJ',
    dataValidade: '2027-03-01',
    produto: {
      id: 'produto-1',
      codigoInterno: 'PRF-001',
      nome: 'Eau de Parfum 50ml',
      marca: 'Marca Exemplo',
    },
  },
}

const SAIDA_OVERRIDE: SaidaNoHistorico = {
  ...SAIDA_COMUM,
  id: 'saida-2',
  vendaDeUnidadeVencida: true,
  justificativaOverride: 'Cliente ciente da validade, item de mostruário',
  autorizadoPor: { id: 'usuario-2', nome: 'Gisele Gestora' },
  unidade: { ...SAIDA_COMUM.unidade, id: 'unidade-2', codigoQr: 'PRF-6KJXCQ' },
}

function historico(
  saidas: SaidaNoHistorico[],
  extras: { total?: number; pagina?: number; tamanhoPagina?: number } = {},
): HistoricoDeSaidas {
  return {
    saidas,
    total: extras.total ?? saidas.length,
    pagina: extras.pagina ?? 1,
    tamanhoPagina: extras.tamanhoPagina ?? 20,
    periodo: PAINEL.periodo,
  }
}

const buscar = vi.fn<typeof fetch>()

/**
 * Responde por rota, e não por ordem de chamada: a tela dispara as duas
 * requisições em paralelo, e amarrar o teste à ordem delas testaria o
 * escalonador do navegador em vez da tela.
 */
function responder(
  painel: Dashboard | (() => Response),
  lista: HistoricoDeSaidas | (() => Response) = historico([SAIDA_COMUM]),
) {
  buscar.mockImplementation(async (entrada: RequestInfo | URL) => {
    const url = String(entrada)
    if (url.includes('/dashboard/saidas')) {
      return typeof lista === 'function' ? lista() : respostaFalsa(200, lista)
    }
    return typeof painel === 'function' ? painel() : respostaFalsa(200, painel)
  })
}

/** As URLs pedidas a cada rota, na ordem em que a tela as pediu. */
function urlsDe(rota: 'painel' | 'historico'): string[] {
  return buscar.mock.calls
    .map(([entrada]) => String(entrada))
    .filter((url) =>
      rota === 'historico' ? url.includes('/dashboard/saidas') : !url.includes('/dashboard/saidas'),
    )
}

function montar() {
  return render(
    <MemoryRouter>
      <TelaDashboard />
    </MemoryRouter>,
  )
}

describe('TelaDashboard (RF13)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pede as duas rotas sem período e adota o intervalo que o servidor ecoou', async () => {
    responder(PAINEL)
    montar()

    await screen.findByRole('heading', { name: /11\/08\/2026 a 09\/09\/2026/ })

    // Nenhuma das duas URLs leva `de`/`ate`: quem decide o recorte padrão é o
    // servidor, e a tela nem sabe calcular "hoje menos 29 dias".
    expect(urlsDe('painel')).toEqual([expect.not.stringContaining('de=')])
    expect(urlsDe('historico')).toEqual([expect.not.stringContaining('de=')])

    // O período que preenche os campos é o que voltou ecoado — a tela não o
    // calculou.
    expect(screen.getByLabelText('De')).toHaveValue('2026-08-11')
    expect(screen.getByLabelText('Até')).toHaveValue('2026-09-09')
  })

  it('mostra as cinco faixas de vencimento, inclusive a que está zerada', async () => {
    responder(PAINEL)
    montar()

    // Faixa que some da tela viraria buraco no gráfico e sugeriria dado não
    // apurado onde há ausência de unidades — que é informação legítima.
    for (const rotulo of ROTULOS_DAS_FAIXAS) {
      expect(await screen.findByText(rotulo)).toBeInTheDocument()
    }

    const zerada = screen.getByText('Vencem em até 7 dias').closest('li')
    expect(zerada).toHaveTextContent('0')
  })

  it('separa o bloqueio de FIFO da substituição efetiva — os dois números da RF13', async () => {
    responder(PAINEL)
    montar()

    const bloqueios = await screen.findByText('bloqueio(s) de FIFO')
    expect(bloqueios.closest('div')).toHaveTextContent('5')

    const substituicoes = screen.getByText('substituição(ões) efetiva(s)')
    expect(substituicoes.closest('div')).toHaveTextContent('2')
  })

  it('aplica o período pedido nas duas rotas e passa a exibir o novo intervalo', async () => {
    responder(PAINEL)
    montar()
    await screen.findByLabelText('De')

    responder({ ...PAINEL, periodo: { de: '2026-09-01', ate: '2026-09-05' } })

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-09-05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar período' }))

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /01\/09\/2026 a 05\/09\/2026/ }),
      ).toBeInTheDocument()
    })

    // O mesmo recorte foi para as duas rotas: um período por bloco produziria
    // um painel em que o agregado fala de agosto e a lista de setembro.
    expect(urlsDe('painel').at(-1)).toContain('de=2026-09-01&ate=2026-09-05')
    expect(urlsDe('historico').at(-1)).toContain('de=2026-09-01&ate=2026-09-05')
  })

  it('exibe a recusa do servidor para intervalo invertido, sem julgar o período por conta própria', async () => {
    responder(PAINEL)
    montar()
    await screen.findByLabelText('De')

    responder(
      () =>
        respostaFalsa(400, {
          erro: 'PERIODO_INVALIDO',
          mensagem: 'A data inicial do período não pode ser posterior à data final.',
        }),
      () =>
        respostaFalsa(400, {
          erro: 'PERIODO_INVALIDO',
          mensagem: 'A data inicial do período não pode ser posterior à data final.',
        }),
    )

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-09-30' } })
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-09-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar período' }))

    // A mensagem exibida é a que o backend escreveu, e o intervalo invertido
    // chegou a ser enviado: a recusa é dele (RNF04).
    const avisos = await screen.findAllByRole('alert')
    expect(avisos[0]).toHaveTextContent('não pode ser posterior à data final')
    expect(urlsDe('painel').at(-1)).toContain('de=2026-09-30&ate=2026-09-01')
  })

  it('diz "sem saídas no período" quando a taxa é nula, e não 0%', async () => {
    responder(PAINEL_VAZIO, historico([]))
    montar()

    expect(await screen.findByText('sem saídas no período')).toBeInTheDocument()
    // O par oposto do teste seguinte: nenhuma venda e nenhum acerto são fatos
    // diferentes, e é por isso que o backend devolve `null` em vez de `0`.
    expect(screen.queryByText('0,0%')).not.toBeInTheDocument()
  })

  it('exibe 0,0% quando houve saída e nenhuma foi na primeira leitura', async () => {
    responder({
      ...PAINEL,
      saidas: { total: 4, naPrimeiraLeitura: 0, taxaAcertoPrimeiraLeitura: 0 },
    })
    montar()

    expect(await screen.findByText('0,0%')).toBeInTheDocument()
    expect(screen.queryByText('sem saídas no período')).not.toBeInTheDocument()
  })

  it('formata a taxa do servidor como percentual de uma casa, sem recalculá-la', async () => {
    responder(PAINEL)
    montar()

    expect(await screen.findByText('84,6%')).toBeInTheDocument()
    expect(screen.getByText(/acerto na primeira leitura \(11 de 13\)/)).toBeInTheDocument()
  })

  it('avisa que a taxa inclui os overrides, que não passaram pela validação de FIFO', async () => {
    responder({ ...PAINEL, overrides: { total: 2 } })
    montar()

    expect(
      await screen.findByText(/inclui 2 venda\(s\) autorizada\(s\) de unidade vencida/),
    ).toBeInTheDocument()
  })

  it('mostra as unidades vencidas em estoque no bloco do agora, apontando para a fila de descarte', async () => {
    responder(PAINEL)
    montar()

    const nota = await screen.findByText(/unidade\(s\) vencida\(s\) ainda em estoque/)
    expect(nota).toHaveTextContent('1')
    expect(screen.getByRole('link', { name: /fila de descarte/ })).toHaveAttribute(
      'href',
      '/descartes',
    )
  })

  it('detalha o override no histórico com justificativa e quem autorizou', async () => {
    responder(PAINEL, historico([SAIDA_OVERRIDE]))
    montar()

    expect(await screen.findByText('Venda de unidade vencida autorizada')).toBeInTheDocument()
    expect(
      screen.getByText('"Cliente ciente da validade, item de mostruário"'),
    ).toBeInTheDocument()
    expect(screen.getByText('Autorizada por Gisele Gestora')).toBeInTheDocument()
  })

  it('não inventa justificativa nem autorizador na saída comum', async () => {
    responder(PAINEL, historico([SAIDA_COMUM]))
    montar()

    expect(await screen.findByText('Eau de Parfum 50ml')).toBeInTheDocument()
    expect(screen.queryByText('Venda de unidade vencida autorizada')).not.toBeInTheDocument()
    expect(screen.queryByText(/Autorizada por/)).not.toBeInTheDocument()
    expect(screen.getByText('Ana Atendente')).toBeInTheDocument()
  })

  it('filtra só os overrides e volta à primeira página ao trocar o filtro', async () => {
    responder(PAINEL, historico([SAIDA_COMUM, SAIDA_OVERRIDE], { total: 40 }))
    montar()
    await screen.findByText('Venda de unidade vencida autorizada')

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    await waitFor(() => expect(urlsDe('historico').at(-1)).toContain('pagina=2'))

    fireEvent.click(
      screen.getByLabelText('Mostrar só as vendas autorizadas de unidade vencida'),
    )

    await waitFor(() => {
      const ultima = urlsDe('historico').at(-1)
      expect(ultima).toContain('apenasOverrides=true')
      // A página 3 do conjunto maior costuma não existir no menor.
      expect(ultima).not.toContain('pagina=2')
    })
  })

  it('pagina o histórico sem recarregar os agregados', async () => {
    responder(PAINEL, historico([SAIDA_COMUM], { total: 40 }))
    montar()
    await screen.findByText('Ana Atendente')

    const painelAntes = urlsDe('painel').length

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))

    await waitFor(() => expect(urlsDe('historico').at(-1)).toContain('pagina=2'))
    // São duas rotas de propósito: mudar de página no histórico não é motivo
    // para recontar o estoque inteiro.
    expect(urlsDe('painel')).toHaveLength(painelAntes)
  })

  it('mostra zeros e as cinco faixas no período sem movimento, em vez de tela vazia', async () => {
    responder(PAINEL_VAZIO, historico([]))
    montar()

    expect(await screen.findByText('Nenhuma saída registrada no período.')).toBeInTheDocument()

    // As cinco faixas continuam na tela, todas zeradas: um painel que some
    // quando não há o que contar some justamente no começo do piloto.
    for (const rotulo of ROTULOS_DAS_FAIXAS) {
      expect(screen.getByText(rotulo).closest('li')).toHaveTextContent('0')
    }

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('mostra o erro de carregamento sem derrubar a tela', async () => {
    responder(
      () => respostaFalsa(500, { erro: 'ERRO_INTERNO', mensagem: 'Falha inesperada.' }),
      () => respostaFalsa(500, { erro: 'ERRO_INTERNO', mensagem: 'Falha inesperada.' }),
    )
    montar()

    const avisos = await screen.findAllByRole('alert')
    expect(avisos[0]).toHaveTextContent('Falha inesperada.')
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })
})
