import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaEtiquetas, type ImpressaoPedida } from './TelaEtiquetas'
import { respostaFalsa } from '../services/testes/respostaFalsa'

/**
 * Folha de etiquetas para impressão (RF04, T15).
 *
 * O que estes testes conseguem provar é o que é verificável em unidade: que a
 * folha reflete a resposta do servidor, que o símbolo entregue por ele chega ao
 * documento, que a chamada leva exatamente as unidades pedidas e que o tamanho
 * escolhido chega ao DOM.
 *
 * O que eles **não** provam: que a etiqueta tem 20 mm no papel, que oito cabem
 * numa linha ou que a câmera lê o símbolo colado num frasco. O jsdom não faz
 * layout, e a legibilidade física é a RNF08 — conferida no navegador e, de
 * verdade, só em T16.
 */

const ID_PRODUTO = '33333333-3333-3333-3333-333333333333'

const PERFUME = {
  id: ID_PRODUTO,
  codigoInterno: 'PRF-001',
  nome: 'Eau de Parfum 50ml',
  marca: 'Marca Exemplo',
  categoria: 'Perfumaria',
  ativo: true,
}

/**
 * Um SVG com a mesma forma do que `simboloQr.ts` devolve: `viewBox` de 29
 * (21 módulos mais a zona de silêncio), sem largura, altura, id, class nem
 * style — e, como o de verdade, sem nenhum texto dentro.
 */
function simbolo(codigoQr: string) {
  return `<svg viewBox="0 0 29 29"><path d="M4 4h${codigoQr.length}v1h-1z"/></svg>`
}

function etiqueta(codigoQr: string, dataValidade: string) {
  return {
    id: `unidade-${codigoQr}`,
    codigoQr,
    dataValidade,
    produto: {
      id: ID_PRODUTO,
      codigoInterno: PERFUME.codigoInterno,
      nome: PERFUME.nome,
      marca: PERFUME.marca,
    },
    svg: simbolo(codigoQr),
  }
}

const PRIMEIRA = etiqueta('PRF-8K2M4Q', '2027-03-01')
const SEGUNDA = etiqueta('PRF-JC95FJ', '2027-11-20')

function folha(etiquetas: (typeof PRIMEIRA)[], total = etiquetas.length, pagina = 1) {
  return respostaFalsa(200, { etiquetas, total, pagina, tamanhoPagina: 100 })
}

function catalogo(produtos = [PERFUME], total = produtos.length) {
  return respostaFalsa(200, { produtos, total, pagina: 1, tamanhoPagina: 20 })
}

const buscar = vi.fn<typeof fetch>()

/** O que a tela de recebimento manda ao navegar para cá. */
const VINDO_DO_RECEBIMENTO: ImpressaoPedida = {
  produtoId: ID_PRODUTO,
  produtoNome: PERFUME.nome,
  unidadeIds: [PRIMEIRA.id, SEGUNDA.id],
}

/** Renderiza na rota `/etiquetas`, com ou sem o estado vindo do recebimento. */
function renderizar(estado: ImpressaoPedida | null = null) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/etiquetas', state: estado }]}>
      <TelaEtiquetas />
    </MemoryRouter>,
  )
}

/** As URLs pedidas ao backend, na ordem. */
function urlsChamadas(): string[] {
  return buscar.mock.calls.map(([url]) => String(url))
}

describe('TelaEtiquetas (RF04)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
    // jsdom não implementa impressão; o que se verifica é que a tela pede.
    vi.stubGlobal('print', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('monta uma etiqueta por unidade, com código e validade formatada', async () => {
    buscar.mockResolvedValueOnce(folha([PRIMEIRA, SEGUNDA]))

    renderizar(VINDO_DO_RECEBIMENTO)

    const lista = await screen.findByRole('list', { name: 'Etiquetas para impressão' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('PRF-8K2M4Q')).toBeInTheDocument()
    // A data vai formatada por fatia de texto, sem passar por fuso (RNF01).
    expect(screen.getByText('Val 01/03/2027')).toBeInTheDocument()
    expect(screen.getByText('Val 20/11/2027')).toBeInTheDocument()
  })

  it('insere no documento o símbolo que o servidor mandou', async () => {
    buscar.mockResolvedValueOnce(folha([PRIMEIRA]))

    const { container } = renderizar(VINDO_DO_RECEBIMENTO)

    const etiquetaNaTela = (await screen.findByText('PRF-8K2M4Q')).closest('li') as HTMLElement
    const svg = etiquetaNaTela.querySelector('.simbolo svg')
    // A tela não gera QR: o que está no DOM é o SVG que veio pronto do
    // `simboloQr.ts`, dono único do símbolo (RNF03 aplicado à etiqueta).
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 29 29')
    expect(container.querySelectorAll('.simbolo svg')).toHaveLength(1)
  })

  it('vindo do recebimento, pede só as unidades daquele lote', async () => {
    buscar.mockResolvedValueOnce(folha([PRIMEIRA, SEGUNDA]))

    renderizar(VINDO_DO_RECEBIMENTO)

    await screen.findByText('PRF-8K2M4Q')
    // Uma chamada só: o catálogo não é carregado, porque o produto já veio.
    expect(buscar).toHaveBeenCalledTimes(1)
    expect(urlsChamadas()[0]).toBe(
      `http://localhost:3333/produtos/${ID_PRODUTO}/unidades/etiquetas` +
        `?unidadeIds=${PRIMEIRA.id}&unidadeIds=${SEGUNDA.id}`,
    )
    expect(buscar).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('na reimpressão, não busca etiqueta nenhuma antes de a gestora pedir', async () => {
    buscar.mockResolvedValueOnce(catalogo())

    renderizar()

    // Só o catálogo: reimprimir etiqueta de frasco que já tem uma é como se
    // duplicam identificadores no mundo físico.
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(1))
    expect(urlsChamadas()[0]).toContain('/produtos')
    expect(urlsChamadas()[0]).not.toContain('/etiquetas')
    expect(screen.queryByRole('list', { name: 'Etiquetas para impressão' })).toBeNull()

    buscar.mockResolvedValueOnce(folha([PRIMEIRA]))
    const seletor = await screen.findByLabelText('Produto')
    await waitFor(() => expect(within(seletor).getAllByRole('option')).toHaveLength(2))
    fireEvent.change(seletor, { target: { value: ID_PRODUTO } })
    fireEvent.click(screen.getByRole('button', { name: 'Carregar etiquetas' }))

    expect(await screen.findByText('PRF-8K2M4Q')).toBeInTheDocument()
    // Sem `unidadeIds`: a folha é o estoque em mãos daquele SKU.
    expect(urlsChamadas()[1]).toBe(
      `http://localhost:3333/produtos/${ID_PRODUTO}/unidades/etiquetas`,
    )
  })

  it('aplica à folha o tamanho de símbolo escolhido', async () => {
    buscar.mockResolvedValueOnce(folha([PRIMEIRA]))

    renderizar(VINDO_DO_RECEBIMENTO)

    const lista = await screen.findByRole('list', { name: 'Etiquetas para impressão' })
    // O padrão é 20 mm; as três medidas em si moram no CSS, que o jsdom não
    // resolve — o que se prova aqui é que a escolha chega ao DOM.
    expect(lista).toHaveAttribute('data-tamanho-mm', '20')
    expect(screen.getByText(/símbolo de 20 mm/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('15 mm'))

    expect(lista).toHaveAttribute('data-tamanho-mm', '15')
    // O tamanho vai impresso no rodapé: T16 precisa saber qual folha aprovou.
    expect(screen.getByText(/símbolo de 15 mm/)).toBeInTheDocument()
  })

  it('imprime pelo diálogo do navegador', async () => {
    buscar.mockResolvedValueOnce(folha([PRIMEIRA]))

    renderizar(VINDO_DO_RECEBIMENTO)

    await screen.findByText('PRF-8K2M4Q')
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))

    expect(window.print).toHaveBeenCalledTimes(1)
  })

  it('produto sem unidades em estoque é estado vazio, não falha', async () => {
    buscar.mockResolvedValueOnce(folha([]))

    renderizar(VINDO_DO_RECEBIMENTO)

    expect(
      await screen.findByText('Nenhuma unidade em estoque para etiquetar neste produto.'),
    ).toBeInTheDocument()
    // Sem etiqueta não há o que imprimir nem que dimensionar.
    expect(screen.queryByRole('button', { name: 'Imprimir' })).toBeNull()
  })

  it('exibe a mensagem que o servidor escreveu quando a busca falha', async () => {
    buscar.mockResolvedValueOnce(
      respostaFalsa(403, {
        erro: 'PAPEL_INSUFICIENTE',
        mensagem: 'Apenas o gestor pode gerar etiquetas.',
      }),
    )

    renderizar(VINDO_DO_RECEBIMENTO)

    // A tela não redige recusa própria (RNF04).
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Apenas o gestor pode gerar etiquetas.',
    )
  })

  it('a segunda página é uma nova busca, e imprime-se uma página por vez', async () => {
    buscar.mockResolvedValueOnce(folha([PRIMEIRA], 150))

    renderizar(VINDO_DO_RECEBIMENTO)

    await screen.findByText('PRF-8K2M4Q')
    expect(screen.getByText('Imprima uma página por vez.')).toBeInTheDocument()

    buscar.mockResolvedValueOnce(folha([SEGUNDA], 150, 2))
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))

    expect(await screen.findByText('PRF-JC95FJ')).toBeInTheDocument()
    expect(urlsChamadas()[1]).toContain('pagina=2')
  })
})
