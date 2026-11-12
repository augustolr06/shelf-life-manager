import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaRecebimento } from './TelaRecebimento'
import { encontrarAviso, renderizarComAvisos } from '../services/testes/avisos'
import { respostaFalsa } from '../services/testes/respostaFalsa'

/**
 * A câmera real não existe no jsdom (ver `LeitorCamera.tsx`). O dublê guarda
 * com que modo e tipo de leitura foi montado e deixa o teste "pôr um código na
 * frente dela" (T48).
 */
const camera = vi.hoisted(() => ({ modo: null as string | null, leitura: null as string | null }))

vi.mock('../components/LeitorCamera', () => ({
  LeitorCamera: function LeitorCameraDublado({
    aoLer,
    aoFalhar,
    modo = 'continua',
    leitura = 'qr',
  }: {
    aoLer: (texto: string) => void
    aoFalhar: (mensagem: string) => void
    modo?: string
    leitura?: string
  }) {
    camera.modo = modo
    camera.leitura = leitura
    return (
      <div data-testid="camera-dublada">
        <button type="button" onClick={() => aoLer(EAN)}>
          simular leitura
        </button>
        <button type="button" onClick={() => aoFalhar('Permissão de câmera negada.')}>
          simular falha de câmera
        </button>
      </div>
    )
  },
}))

const EAN = '7891000325858'

const ID_PRODUTO = '33333333-3333-3333-3333-333333333333'

const PERFUME = {
  id: ID_PRODUTO,
  codigoInterno: 'PRF-001',
  nome: 'Eau de Parfum 50ml',
  marca: 'Marca Exemplo',
  categoria: 'Perfumaria',
  ativo: true,
}

function catalogo(produtos = [PERFUME], total = produtos.length) {
  return respostaFalsa(200, { produtos, total, pagina: 1, tamanhoPagina: 20 })
}

function unidade(codigoQr: string, dataValidade: string) {
  return {
    id: `unidade-${codigoQr}`,
    produtoId: ID_PRODUTO,
    codigoQr,
    dataValidade: `${dataValidade}T00:00:00.000Z`,
    status: 'EM_ESTOQUE',
    dataEntrada: '2026-09-07T00:00:00.000Z',
    registradoPorId: '11111111-1111-1111-1111-111111111111',
  }
}

const buscar = vi.fn<typeof fetch>()

/**
 * A tela ganhou um botão que navega para a folha de etiquetas (T15), então
 * passou a precisar de roteador. O destino é um dublê que mostra o estado de
 * rota recebido — é por ele que as unidades do lote viajam, e não pela URL.
 */
function DestinoDasEtiquetas() {
  return <pre data-testid="estado-recebido">{JSON.stringify(useLocation().state)}</pre>
}

function renderizarRecebimento() {
  return renderizarComAvisos(
    <MemoryRouter initialEntries={['/recebimento']}>
      <Routes>
        <Route path="/recebimento" element={<TelaRecebimento />} />
        <Route path="/etiquetas" element={<DestinoDasEtiquetas />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Preenche a linha de validade de índice `indice`. */
function preencherLinha(indice: number, validade: string, quantidade?: number) {
  fireEvent.change(screen.getByLabelText(`Validade`, { selector: `#validade-${indice}` }), {
    target: { value: validade },
  })
  if (quantidade !== undefined) {
    fireEvent.change(screen.getByLabelText('Unidades', { selector: `#quantidade-${indice}` }), {
      target: { value: String(quantidade) },
    })
  }
}

function campoProduto() {
  return screen.getByRole('combobox', { name: 'Produto' })
}

/** Abre o seletor de produto (T28) e escolhe o perfume na lista. */
async function selecionarProduto() {
  act(() => campoProduto().focus())
  fireEvent.click(await screen.findByRole('option', { name: /Eau de Parfum 50ml/ }))
}

/** Espera a primeira página do catálogo, que o seletor pede ao montar. */
async function esperarCatalogo() {
  await waitFor(() => expect(buscar).toHaveBeenCalledTimes(1))
}

/** Corpo JSON da última chamada ao backend. */
function ultimoCorpo(): unknown {
  const [, init] = buscar.mock.calls[buscar.mock.calls.length - 1] ?? []
  return JSON.parse(String((init as RequestInit).body))
}

describe('TelaRecebimento (RF03)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('carrega o catálogo para escolher o produto', async () => {
    buscar.mockResolvedValueOnce(catalogo())

    renderizarRecebimento()
    act(() => campoProduto().focus())

    expect(await screen.findByRole('option', { name: /PRF-001/ })).toBeInTheDocument()
    // Sem `incluirInativos`: o backend recusa receber unidade de produto
    // inativo, então oferecê-lo levaria só ao 409.
    expect(buscar).toHaveBeenCalledWith(
      'http://localhost:3333/produtos',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('envia um lote com validades diferentes na mesma requisição', async () => {
    buscar.mockResolvedValueOnce(catalogo()).mockResolvedValueOnce(
      respostaFalsa(201, {
        unidades: [
          unidade('PRF-AB12CD', '2027-03-01'),
          unidade('PRF-EF34GH', '2026-11-30'),
          unidade('PRF-JK56MN', '2026-11-30'),
        ],
        avisos: [],
      }),
    )

    renderizarRecebimento()
    await selecionarProduto()

    preencherLinha(0, '2027-03-01')
    fireEvent.click(screen.getByRole('button', { name: /adicionar outra validade/i }))
    preencherLinha(1, '2026-11-30', 2)
    fireEvent.click(screen.getByRole('button', { name: /^registrar recebimento$/i }))

    // O cenário que motiva o projeto: entrega mista, uma requisição só.
    await waitFor(() =>
      expect(ultimoCorpo()).toEqual({
        unidades: [
          { dataValidade: '2027-03-01', quantidade: 1 },
          { dataValidade: '2026-11-30', quantidade: 2 },
        ],
      }),
    )
    expect(buscar).toHaveBeenLastCalledWith(
      `http://localhost:3333/produtos/${ID_PRODUTO}/unidades`,
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('mostra os códigos gerados pelo servidor', async () => {
    buscar
      .mockResolvedValueOnce(catalogo())
      .mockResolvedValueOnce(
        respostaFalsa(201, { unidades: [unidade('PRF-AB12CD', '2027-03-01')], avisos: [] }),
      )

    renderizarRecebimento()
    await selecionarProduto()
    preencherLinha(0, '2027-03-01')
    fireEvent.click(screen.getByRole('button', { name: /^registrar recebimento$/i }))

    // O código vem do backend; a tela nunca o inventa.
    expect(await screen.findByText('PRF-AB12CD')).toBeInTheDocument()
    expect(screen.getByText('01/03/2027')).toBeInTheDocument()
    expect((await encontrarAviso('1 unidade(s) registrada(s).')).tipo).toBe('success')
  })

  it('exibe o aviso de unidade já vencida sem tratá-lo como erro', async () => {
    buscar.mockResolvedValueOnce(catalogo()).mockResolvedValueOnce(
      respostaFalsa(201, {
        unidades: [unidade('PRF-AB12CD', '2020-01-01')],
        avisos: [
          {
            codigo: 'UNIDADE_JA_VENCIDA',
            dataValidade: '2020-01-01',
            quantidade: 1,
            mensagem: '1 unidade(s) foram cadastradas já vencidas (validade 2020-01-01).',
          },
        ],
      }),
    )

    renderizarRecebimento()
    await selecionarProduto()
    preencherLinha(0, '2020-01-01')
    fireEvent.click(screen.getByRole('button', { name: /^registrar recebimento$/i }))

    // Cadastro concluído — o aviso acompanha as unidades, não as substitui.
    expect(await screen.findByText('PRF-AB12CD')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/já vencidas/i)
  })

  it('mostra a recusa do backend com a mensagem que ele escreveu', async () => {
    buscar.mockResolvedValueOnce(catalogo()).mockResolvedValueOnce(
      respostaFalsa(409, {
        erro: 'PRODUTO_INATIVO',
        mensagem: 'Este produto está inativo. Reative-o no catálogo antes de receber unidades.',
      }),
    )

    renderizarRecebimento()
    await selecionarProduto()
    preencherLinha(0, '2027-03-01')
    fireEvent.click(screen.getByRole('button', { name: /^registrar recebimento$/i }))

    // RNF04: a tela reflete o veredito do backend, não inventa o seu.
    expect((await encontrarAviso(/está inativo/i)).tipo).toBe('error')
    expect(screen.queryByText(/unidade\(s\) cadastrada\(s\)/i)).not.toBeInTheDocument()
  })

  it('só habilita o envio com produto escolhido e todas as validades preenchidas', async () => {
    buscar.mockResolvedValueOnce(catalogo())

    renderizarRecebimento()
    await esperarCatalogo()

    const enviar = screen.getByRole('button', { name: /^registrar recebimento$/i })
    expect(enviar).toBeDisabled()

    await selecionarProduto()
    expect(enviar).toBeDisabled()

    preencherLinha(0, '2027-03-01')
    expect(enviar).toBeEnabled()
  })

  it('texto digitado sem escolher um produto não vira recebimento', async () => {
    buscar.mockResolvedValue(catalogo())

    renderizarRecebimento()
    await selecionarProduto()
    preencherLinha(0, '2027-03-01')
    expect(screen.getByRole('button', { name: /^registrar recebimento$/i })).toBeEnabled()

    // Editar o nome escolhido desfaz a escolha (T28): o texto que sobra na
    // caixa não é um produto.
    fireEvent.change(campoProduto(), { target: { value: 'Eau de Parfum' } })
    expect(screen.getByRole('button', { name: /^registrar recebimento$/i })).toBeDisabled()

    // Nem o Enter no campo, que submeteria o formulário, chega ao servidor.
    fireEvent.submit(campoProduto().closest('form') as HTMLFormElement)
    await act(async () => {})
    expect(buscar.mock.calls.some(([url]) => String(url).includes('/unidades'))).toBe(false)
  })

  it('limpa as linhas depois do envio para não duplicar etiquetas', async () => {
    buscar
      .mockResolvedValueOnce(catalogo())
      .mockResolvedValueOnce(
        respostaFalsa(201, { unidades: [unidade('PRF-AB12CD', '2027-03-01')], avisos: [] }),
      )

    renderizarRecebimento()
    await selecionarProduto()
    preencherLinha(0, '2027-03-01')
    fireEvent.click(screen.getByRole('button', { name: /^registrar recebimento$/i }))

    await screen.findByText('PRF-AB12CD')
    // Reenviar o mesmo lote por engano geraria unidades físicas inexistentes.
    expect(screen.getByLabelText('Validade', { selector: '#validade-0' })).toHaveValue('')
    expect(screen.getByRole('button', { name: /^registrar recebimento$/i })).toBeDisabled()
  })

  it('leva as unidades recém-cadastradas para a folha de etiquetas', async () => {
    buscar
      .mockResolvedValueOnce(catalogo())
      .mockResolvedValueOnce(
        respostaFalsa(201, {
          unidades: [unidade('PRF-AB12CD', '2027-03-01'), unidade('PRF-EF34GH', '2026-11-30')],
          avisos: [],
        }),
      )

    renderizarRecebimento()
    await selecionarProduto()
    preencherLinha(0, '2027-03-01')
    fireEvent.click(screen.getByRole('button', { name: /^registrar recebimento$/i }))

    await screen.findByText('PRF-AB12CD')
    fireEvent.click(screen.getByRole('button', { name: /imprimir etiquetas destas unidades/i }))

    // Os ids vão por estado de rota: 500 UUIDs numa query string seriam ~18 KB.
    expect(JSON.parse(screen.getByTestId('estado-recebido').textContent ?? '')).toEqual({
      produtoId: ID_PRODUTO,
      produtoNome: PERFUME.nome,
      unidadeIds: ['unidade-PRF-AB12CD', 'unidade-PRF-EF34GH'],
    })
  })

  it('remove uma linha de validade, mantendo ao menos uma', async () => {
    buscar.mockResolvedValueOnce(catalogo())

    renderizarRecebimento()
    await esperarCatalogo()

    expect(screen.getByRole('button', { name: /remover validade 1/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /adicionar outra validade/i }))
    fireEvent.click(screen.getByRole('button', { name: /remover validade 2/i }))

    expect(screen.queryByLabelText('Validade', { selector: '#validade-1' })).not.toBeInTheDocument()
  })

  describe('leitura do código de barras pela câmera (T48)', () => {
    const TINTA = {
      ...PERFUME,
      id: '44444444-4444-4444-4444-444444444444',
      codigoInterno: EAN,
      nome: 'Alta Moda 6.1',
    }

    /** A resposta de `GET /produtos?codigoInterno=…`, em fila; o resto é o catálogo do seletor. */
    const procurarCodigo = vi.fn<() => Promise<Response>>()

    function simularLargura(largura: number) {
      vi.stubGlobal('matchMedia', (consulta: string) => ({
        matches: largura <= Number(/max-width:\s*([\d.]+)px/.exec(consulta)?.[1]),
        media: consulta,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    }

    function lerComACamera() {
      fireEvent.click(screen.getByRole('button', { name: 'Ler código de barras' }))
      fireEvent.click(screen.getByRole('button', { name: 'simular leitura' }))
    }

    beforeEach(() => {
      procurarCodigo.mockReset()
      camera.modo = null
      camera.leitura = null
      buscar.mockImplementation(async (entrada, init) =>
        String(entrada).includes('codigoInterno=')
          ? procurarCodigo()
          : String(entrada).endsWith('/unidades') && init?.method === 'POST'
            ? respostaFalsa(201, { unidades: [unidade('PRF-AB12CD', '2027-03-01')], avisos: [] })
            : catalogo(),
      )
      simularLargura(360)
    })

    it('no computador, não oferece a câmera', async () => {
      simularLargura(1280)
      renderizarRecebimento()
      await esperarCatalogo()

      expect(screen.queryByRole('button', { name: 'Ler código de barras' })).not.toBeInTheDocument()
    })

    it('abre a câmera em leitura única, só para código de barras', async () => {
      renderizarRecebimento()
      await esperarCatalogo()

      fireEvent.click(screen.getByRole('button', { name: 'Ler código de barras' }))

      expect(camera.modo).toBe('unica')
      expect(camera.leitura).toBe('codigo-de-barras')
      fireEvent.click(screen.getByRole('button', { name: 'Desligar câmera' }))
      expect(screen.queryByTestId('camera-dublada')).not.toBeInTheDocument()
    })

    it('código de produto ativo escolhe o produto, e o recebimento sai para ele', async () => {
      procurarCodigo.mockResolvedValueOnce(catalogo([TINTA]))
      renderizarRecebimento()
      await esperarCatalogo()

      lerComACamera()

      expect(await screen.findByRole('status')).toHaveTextContent(
        `“Alta Moda 6.1” escolhido pelo código de barras ${EAN}.`,
      )
      expect(buscar).toHaveBeenCalledWith(
        `http://localhost:3333/produtos?codigoInterno=${EAN}&incluirInativos=true`,
        expect.objectContaining({ credentials: 'include' }),
      )
      // O downshift troca o texto da caixa num efeito, uma renderização depois
      // de o produto ser escolhido.
      await waitFor(() => expect(campoProduto()).toHaveValue('Alta Moda 6.1'))
      // A câmera desligou sozinha ao ler (T31).
      expect(screen.queryByTestId('camera-dublada')).not.toBeInTheDocument()

      preencherLinha(0, '2027-03-01')
      fireEvent.click(screen.getByRole('button', { name: /^registrar recebimento$/i }))

      await waitFor(() =>
        expect(buscar).toHaveBeenLastCalledWith(
          `http://localhost:3333/produtos/${TINTA.id}/unidades`,
          expect.objectContaining({ method: 'POST' }),
        ),
      )
    })

    it('código de produto inativo avisa e não escolhe nada', async () => {
      procurarCodigo.mockResolvedValueOnce(catalogo([{ ...TINTA, ativo: false }]))
      renderizarRecebimento()
      await esperarCatalogo()

      lerComACamera()

      const aviso = await screen.findByRole('alert')
      expect(aviso).toHaveTextContent(
        `O código ${EAN} é de “Alta Moda 6.1”, que está inativo e não recebe unidades.`,
      )
      expect(campoProduto()).toHaveValue('')
      preencherLinha(0, '2027-03-01')
      expect(screen.getByRole('button', { name: /^registrar recebimento$/i })).toBeDisabled()
    })

    it('código que o catálogo não tem avisa e leva ao Catálogo', async () => {
      procurarCodigo.mockResolvedValueOnce(catalogo([]))
      renderizarRecebimento()
      await esperarCatalogo()

      lerComACamera()

      expect(await screen.findByRole('alert')).toHaveTextContent(
        `Nenhum produto do catálogo tem o código ${EAN}. Cadastre-o no Catálogo antes de receber.`,
      )
      expect(screen.getByRole('link', { name: 'Ir para o Catálogo' })).toHaveAttribute(
        'href',
        `/produtos?busca=${EAN}`,
      )
      expect(campoProduto()).toHaveValue('')
    })

    it('escolher outro produto no seletor tira a nota da leitura', async () => {
      procurarCodigo.mockResolvedValueOnce(catalogo([TINTA]))
      renderizarRecebimento()
      await esperarCatalogo()

      lerComACamera()
      await screen.findByRole('status')
      await selecionarProduto()

      expect(campoProduto()).toHaveValue(PERFUME.nome)
      expect(screen.queryByText(/escolhido pelo código de barras/)).not.toBeInTheDocument()
    })

    it('câmera que não abre vira aviso, e o seletor continua servindo', async () => {
      renderizarRecebimento()
      await esperarCatalogo()

      fireEvent.click(screen.getByRole('button', { name: 'Ler código de barras' }))
      fireEvent.click(screen.getByRole('button', { name: 'simular falha de câmera' }))

      expect(screen.getByRole('alert')).toHaveTextContent('Permissão de câmera negada.')
      expect(screen.queryByTestId('camera-dublada')).not.toBeInTheDocument()
      expect(campoProduto()).toBeInTheDocument()
    })

    it('falha ao procurar o código vira toast', async () => {
      procurarCodigo.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      renderizarRecebimento()
      await esperarCatalogo()

      lerComACamera()

      expect((await encontrarAviso(/Não foi possível falar com o servidor/)).tipo).toBe('error')
      expect(screen.getByRole('button', { name: 'Ler código de barras' })).toBeEnabled()
    })
  })
})
