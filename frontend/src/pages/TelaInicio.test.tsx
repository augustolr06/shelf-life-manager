import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaInicio } from './TelaInicio'
import { respostaFalsa } from '../services/testes/respostaFalsa'
import type { Usuario } from '../services/auth'
import type { Dashboard } from '../services/dashboard'

/**
 * A tela Início do gestor (T42).
 *
 * Como os Relatórios, ela não calcula nada: a data do cabeçalho, os dias até
 * o próximo vencimento, a faixa e as contagens chegam prontos de
 * `GET /dashboard` (RNF04). Os testes conferem que cada número é o do servidor,
 * que os cartões levam às telas certas e que a busca escolhe entre Consulta e
 * Catálogo pelo que foi digitado.
 */

const GESTOR: Usuario = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Gestora de Loja',
  email: 'gestor@estoque.local',
  papel: 'GESTOR',
}

const PAINEL: Dashboard = {
  periodo: { de: '2026-09-22', ate: '2026-10-21' },
  hoje: '2026-10-21',
  estoque: {
    unidadesEmEstoque: 181,
    porFaixaDeVencimento: [
      { faixa: 'VENCIDA', unidades: 7 },
      { faixa: 'ATE_7_DIAS', unidades: 0 },
      { faixa: 'DE_8_A_30_DIAS', unidades: 1 },
      { faixa: 'DE_31_A_90_DIAS', unidades: 17 },
      { faixa: 'ACIMA_DE_90_DIAS', unidades: 156 },
    ],
    proximoVencimento: {
      unidade: {
        id: 'unidade-1',
        codigoQr: 'PRF-PC31SX',
        dataValidade: '2026-11-06',
        produto: { id: 'produto-1', codigoInterno: 'COD-1', nome: 'Loção Delta', marca: 'Marca' },
      },
      diasParaVencer: 16,
      faixa: 'DE_8_A_30_DIAS',
    },
  },
  saidas: { total: 4, naPrimeiraLeitura: 4, taxaAcertoPrimeiraLeitura: 1 },
  fifo: { alertasDisparados: 2, substituicoesEfetivas: 1 },
  perdas: { descartes: 3, unidadesVencidasEmEstoque: 7 },
  overrides: { total: 0 },
}

const buscar = vi.fn<typeof fetch>()

/** Mostra para onde a tela navegou, com a querystring. */
function Destino() {
  const { pathname, search } = useLocation()
  return <p data-testid="destino">{`${pathname}${search}`}</p>
}

function montar(alertasNaoLidos = 3) {
  return render(
    <MemoryRouter initialEntries={['/inicio']}>
      <Routes>
        <Route
          path="/inicio"
          element={<TelaInicio usuario={GESTOR} alertasNaoLidos={alertasNaoLidos} />}
        />
        <Route path="*" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** O cartão de atenção pelo texto do distintivo. */
function cartao(distintivo: string) {
  return screen.getByText(distintivo, { selector: '.distintivo' }).closest('article')!
}

describe('TelaInicio (T42)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mostra que está carregando até o servidor responder', async () => {
    buscar.mockReturnValue(new Promise(() => {}))
    montar()

    expect(screen.getByRole('status')).toHaveTextContent('Carregando…')
    // A saudação não depende do servidor; a data, sim, e não aparece antes.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/, Gestora$/)
    expect(screen.queryByText(/de outubro/)).not.toBeInTheDocument()
  })

  it('pede o painel sem período: os últimos 30 dias são decisão do servidor', async () => {
    buscar.mockResolvedValue(respostaFalsa(200, PAINEL))
    montar()

    await screen.findByText('Precisa da sua atenção')
    expect(buscar).toHaveBeenCalledWith(
      'http://localhost:3333/dashboard',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('escreve por extenso a data de hoje que veio do servidor', async () => {
    buscar.mockResolvedValue(respostaFalsa(200, PAINEL))
    montar()

    expect(await screen.findByText('Quarta-feira, 21 de outubro')).toBeInTheDocument()
  })

  it('mostra o erro do servidor no lugar dos cartões', async () => {
    buscar.mockResolvedValue(
      respostaFalsa(500, { erro: 'ERRO_INTERNO', mensagem: 'Erro interno do servidor.' }),
    )
    montar()

    expect(await screen.findByRole('alert')).toHaveTextContent('Erro interno do servidor.')
    expect(screen.queryByText('Precisa da sua atenção')).not.toBeInTheDocument()
    // A busca continua servindo, mesmo sem o painel.
    expect(screen.getByRole('searchbox', { name: 'Buscar produto ou código' })).toBeInTheDocument()
  })

  describe('os cartões de atenção', () => {
    it('vencidas: o número do servidor e o botão que leva ao descarte', async () => {
      buscar.mockResolvedValue(respostaFalsa(200, PAINEL))
      montar()
      await screen.findByText('Precisa da sua atenção')

      const vencidas = cartao('Vencidas')
      expect(vencidas).toHaveTextContent('7unidades ainda no estoque')
      expect(within(vencidas).getByRole('link', { name: 'Resolver descarte' })).toHaveAttribute(
        'href',
        '/descartes',
      )
    })

    it('vencidas zeradas: sem o botão vermelho, que chamaria para uma ação que não existe', async () => {
      buscar.mockResolvedValue(
        respostaFalsa(200, { ...PAINEL, perdas: { descartes: 0, unidadesVencidasEmEstoque: 0 } }),
      )
      montar()
      await screen.findByText('Precisa da sua atenção')

      const vencidas = cartao('Vencidas')
      expect(within(vencidas).queryByRole('link', { name: 'Resolver descarte' })).toBeNull()
      expect(within(vencidas).getByRole('link', { name: 'Ver descarte' })).toHaveAttribute(
        'href',
        '/descartes',
      )
    })

    it('alertas: o contador do menu e o link para a lista', async () => {
      buscar.mockResolvedValue(respostaFalsa(200, PAINEL))
      montar(1)
      await screen.findByText('Precisa da sua atenção')

      const alertas = cartao('Alertas')
      expect(alertas).toHaveTextContent('1alerta não lido')
      expect(within(alertas).getByRole('link', { name: 'Ver alertas' })).toHaveAttribute(
        'href',
        '/alertas',
      )
    })

    it('próximo vencimento: dias, produto, código e data do servidor, na cor da faixa', async () => {
      buscar.mockResolvedValue(respostaFalsa(200, PAINEL))
      montar()
      await screen.findByText('Precisa da sua atenção')

      const proximo = cartao('Próximo vencimento')
      expect(proximo).toHaveTextContent('16dias')
      expect(proximo).toHaveTextContent('Loção Delta · PRF-PC31SX · vence 06/11/2026')
      expect(within(proximo).getByText('Próximo vencimento')).toHaveClass('faixa-de_8_a_30_dias')
      expect(within(proximo).getByRole('link', { name: 'Ver unidade' })).toHaveAttribute(
        'href',
        '/consulta?codigo=PRF-PC31SX',
      )
    })

    it('próximo vencimento hoje: diz "Hoje", e não "0 dias"', async () => {
      buscar.mockResolvedValue(
        respostaFalsa(200, {
          ...PAINEL,
          estoque: {
            ...PAINEL.estoque,
            proximoVencimento: {
              ...PAINEL.estoque.proximoVencimento,
              diasParaVencer: 0,
              faixa: 'ATE_7_DIAS',
            },
          },
        }),
      )
      montar()
      await screen.findByText('Precisa da sua atenção')

      expect(cartao('Próximo vencimento')).toHaveTextContent(/^Próximo vencimentoHoje/)
    })

    it('sem próximo vencimento: o cartão diz que não há unidade a vencer', async () => {
      buscar.mockResolvedValue(
        respostaFalsa(200, {
          ...PAINEL,
          estoque: { ...PAINEL.estoque, proximoVencimento: null },
        }),
      )
      montar()
      await screen.findByText('Precisa da sua atenção')

      const proximo = cartao('Próximo vencimento')
      expect(proximo).toHaveTextContent('Nenhuma unidade em estoque a vencer.')
      expect(within(proximo).queryByRole('link')).toBeNull()
    })
  })

  describe('estoque por validade', () => {
    it('descreve a barra com as cinco faixas, e a legenda as repete com número', async () => {
      buscar.mockResolvedValue(respostaFalsa(200, PAINEL))
      montar()
      await screen.findByText('Precisa da sua atenção')

      expect(
        screen.getByRole('img', {
          name: '181 unidades: 7 vencidas, 0 em até 7 dias, 1 entre 8 e 30 dias, 17 entre 31 e 90 dias, 156 com mais de 90 dias',
        }),
      ).toBeInTheDocument()

      const legenda = screen
        .getAllByRole('listitem')
        .map((item) => item.textContent)
      expect(legenda).toEqual([
        'Vencidas7',
        'Até 7 dias0',
        '8 a 30 dias1',
        '31 a 90 dias17',
        '+90 dias156',
      ])
    })

    it('faixa zerada fica fora da barra, mas continua na legenda', async () => {
      buscar.mockResolvedValue(respostaFalsa(200, PAINEL))
      montar()
      await screen.findByText('Precisa da sua atenção')

      const barra = screen.getByRole('img', { name: /^181 unidades/ })
      expect(barra.querySelectorAll('.segmento')).toHaveLength(4)
      expect(barra.querySelector('.faixa-ate_7_dias')).toBeNull()
    })
  })

  describe('últimos 30 dias', () => {
    it('mostra saídas, acerto, descartes e bloqueios, com link para o relatório', async () => {
      buscar.mockResolvedValue(respostaFalsa(200, PAINEL))
      montar()
      await screen.findByText('Precisa da sua atenção')

      const periodo = screen.getByRole('region', { name: 'Últimos 30 dias' })
      expect(within(periodo).getByText('saídas registradas').nextSibling).toHaveTextContent('4')
      expect(within(periodo).getByText('acerto na 1ª leitura').nextSibling).toHaveTextContent(
        '100,0%',
      )
      expect(within(periodo).getByText('descartes').nextSibling).toHaveTextContent('3')
      expect(within(periodo).getByText('bloqueios de FIFO').nextSibling).toHaveTextContent('2')
      expect(within(periodo).getByRole('link', { name: 'Relatório' })).toHaveAttribute(
        'href',
        '/dashboard',
      )
    })

    it('sem saídas no período, o acerto não vira 0%', async () => {
      buscar.mockResolvedValue(
        respostaFalsa(200, {
          ...PAINEL,
          saidas: { total: 0, naPrimeiraLeitura: 0, taxaAcertoPrimeiraLeitura: null },
        }),
      )
      montar()
      await screen.findByText('Precisa da sua atenção')

      expect(screen.getByText('acerto na 1ª leitura').nextSibling).toHaveTextContent('sem saídas')
    })
  })

  describe('cabeçalho', () => {
    it('"Nova venda" leva à venda', async () => {
      buscar.mockResolvedValue(respostaFalsa(200, PAINEL))
      montar()

      expect(screen.getByRole('link', { name: 'Nova venda' })).toHaveAttribute('href', '/venda')
    })

    it('busca de código de etiqueta abre a Consulta com o código', async () => {
      buscar.mockResolvedValue(respostaFalsa(200, PAINEL))
      montar()

      const campo = screen.getByRole('searchbox', { name: 'Buscar produto ou código' })
      // Minúsculo e com espaço, como quem digita: a escolha da tela não
      // depende da caixa, e quem normaliza o código é o backend.
      fireEvent.change(campo, { target: { value: ' prf-pc31sx ' } })
      fireEvent.submit(campo)

      expect(await screen.findByTestId('destino')).toHaveTextContent('/consulta?codigo=prf-pc31sx')
    })

    it('busca de nome abre o Catálogo filtrado', async () => {
      buscar.mockResolvedValue(respostaFalsa(200, PAINEL))
      montar()

      const campo = screen.getByRole('searchbox', { name: 'Buscar produto ou código' })
      fireEvent.change(campo, { target: { value: 'Loção Delta' } })
      fireEvent.submit(campo)

      expect(await screen.findByTestId('destino')).toHaveTextContent(
        '/produtos?busca=Lo%C3%A7%C3%A3o+Delta',
      )
    })

    it('busca vazia não sai da tela', async () => {
      buscar.mockResolvedValue(respostaFalsa(200, PAINEL))
      montar()

      const campo = screen.getByRole('searchbox', { name: 'Buscar produto ou código' })
      fireEvent.change(campo, { target: { value: '   ' } })
      fireEvent.submit(campo)

      expect(screen.queryByTestId('destino')).not.toBeInTheDocument()
    })
  })
})
