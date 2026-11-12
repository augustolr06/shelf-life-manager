import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaEtiquetas, type ImpressaoPedida } from './TelaEtiquetas'
import { respostaFalsa } from '../services/testes/respostaFalsa'
import type { GrupoDeEtiquetas } from '../services/pdfEtiquetas'

/**
 * Etiquetas de vários produtos num PDF (RF04, T15 e T50).
 *
 * O desenho do PDF é substituído por um dublê: jsdom não desenha PDF, e o
 * layout tem suíte própria (`services/pdfEtiquetas.test.ts`). O que se prova
 * aqui é o caminho até ele — que nada é buscado antes do pedido, que o
 * servidor recebe exatamente os produtos (ou as unidades) escolhidos, que as
 * páginas são juntadas e que o gerador recebe os grupos e o tamanho certos.
 */

const gerarPdf = vi.hoisted(() => vi.fn<(grupos: GrupoDeEtiquetas[], lado: number) => Promise<void>>())

vi.mock('../services/pdfEtiquetas', async (original) => ({
  ...(await original<typeof import('../services/pdfEtiquetas')>()),
  gerarPdfEtiquetas: gerarPdf,
}))

const API = 'http://localhost:3333'

function produtoDoCatalogo(id: string, nome: string, marca: string) {
  return { id, codigoInterno: `PRF-${id.slice(0, 3)}`, nome, marca, categoria: 'Perfumaria', ativo: true }
}

const KAIAK = produtoDoCatalogo('11111111-1111-4111-8111-111111111111', 'Kaiak', 'Natura')
const MALBEC = produtoDoCatalogo('22222222-2222-4222-8222-222222222222', 'Malbec', 'Boticário')

function etiqueta(de: typeof KAIAK, codigoQr: string) {
  return {
    id: `unidade-${codigoQr}`,
    codigoQr,
    dataValidade: '2027-03-01',
    produto: { id: de.id, codigoInterno: de.codigoInterno, nome: de.nome, marca: de.marca },
    svg: '<svg viewBox="0 0 29 29"></svg>',
  }
}

const MALBEC_1 = etiqueta(MALBEC, 'PRF-AAAAAA')
const KAIAK_1 = etiqueta(KAIAK, 'PRF-BBBBBB')
const KAIAK_2 = etiqueta(KAIAK, 'PRF-CCCCCC')

function folha(etiquetas: unknown[], total = etiquetas.length, pagina = 1) {
  return respostaFalsa(200, { etiquetas, total, pagina, tamanhoPagina: 500 })
}

const buscar = vi.fn<typeof fetch>()

/**
 * O catálogo responde sempre (o seletor o recarrega a cada escolha); as
 * etiquetas respondem o que cada teste enfileirar.
 */
function servidor(...folhas: Response[]) {
  buscar.mockImplementation(async (url) => {
    if (String(url).includes('etiquetas')) {
      const proxima = folhas.shift()
      if (!proxima) throw new Error(`pedido de etiquetas não esperado: ${String(url)}`)
      return proxima
    }
    return respostaFalsa(200, { produtos: [KAIAK, MALBEC], total: 2, pagina: 1, tamanhoPagina: 20 })
  })
}

function pedidosDeEtiquetas() {
  return buscar.mock.calls
    .filter(([url]) => String(url).includes('etiquetas'))
    .map(([url, init]) => ({
      url: String(url),
      metodo: init?.method ?? 'GET',
      corpo: init?.body ? JSON.parse(String(init.body)) : undefined,
    }))
}

const VINDO_DO_RECEBIMENTO: ImpressaoPedida = {
  produtoId: KAIAK.id,
  produtoNome: KAIAK.nome,
  unidadeIds: [KAIAK_1.id, KAIAK_2.id],
}

function renderizar(estado: ImpressaoPedida | null = null) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/etiquetas', state: estado }]}>
      <TelaEtiquetas />
    </MemoryRouter>,
  )
}

async function escolherNoSeletor(nome: string) {
  act(() => screen.getByRole('combobox', { name: 'Produto' }).focus())
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(nome) }))
  // A escolha remonta o seletor vazio, que recarrega o catálogo: espera-se
  // essa resposta aqui, e não depois do fim do teste.
  await act(async () => {})
}

function gerar() {
  fireEvent.click(screen.getByRole('button', { name: 'Gerar PDF' }))
}

describe('TelaEtiquetas (RF04, T50)', () => {
  beforeEach(() => {
    buscar.mockReset()
    gerarPdf.mockReset()
    gerarPdf.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('escolha de produtos', () => {
    it('não busca etiqueta nenhuma antes de a gestora pedir', async () => {
      servidor()

      renderizar()

      await screen.findByRole('combobox', { name: 'Produto' })
      await act(async () => {})
      // Reimprimir etiqueta de frasco que já tem uma é como se duplicam
      // identificadores no mundo físico (Decisão 1 de T15).
      expect(pedidosDeEtiquetas()).toEqual([])
      expect(screen.getByRole('button', { name: 'Gerar PDF' })).toBeDisabled()
    })

    it('cada produto escolhido vira um item removível, sem repetir', async () => {
      servidor()
      renderizar()

      await escolherNoSeletor('Kaiak')
      await escolherNoSeletor('Malbec')
      await escolherNoSeletor('Kaiak')

      const lista = screen.getByRole('list', { name: 'Produtos escolhidos' })
      expect(within(lista).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'Natura — Kaiak',
        'Boticário — Malbec',
      ])
      // O seletor volta vazio, pronto para o próximo.
      expect(screen.getByRole('combobox', { name: 'Produto' })).toHaveValue('')

      fireEvent.click(screen.getByRole('button', { name: 'Remover Kaiak' }))
      expect(within(lista).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'Boticário — Malbec',
      ])
    })

    it('gera com os produtos escolhidos, e o PDF recebe um grupo por produto', async () => {
      servidor(folha([MALBEC_1, KAIAK_1, KAIAK_2]))
      renderizar()
      await escolherNoSeletor('Kaiak')
      await escolherNoSeletor('Malbec')

      gerar()

      await screen.findByRole('table', { name: 'Etiquetas por produto' })
      expect(pedidosDeEtiquetas()).toEqual([
        {
          url: `${API}/unidades/etiquetas`,
          metodo: 'POST',
          corpo: { produtoIds: [KAIAK.id, MALBEC.id], pagina: 1, tamanhoPagina: 500 },
        },
      ])
      expect(gerarPdf).toHaveBeenCalledTimes(1)
      const [grupos, lado] = gerarPdf.mock.calls[0] ?? []
      // A ordem é a do servidor (Boticário antes de Natura), não a da escolha.
      expect(grupos?.map((g) => [g.produto.nome, g.etiquetas.map((e) => e.codigoQr)])).toEqual([
        ['Malbec', ['PRF-AAAAAA']],
        ['Kaiak', ['PRF-BBBBBB', 'PRF-CCCCCC']],
      ])
      expect(lado).toBe(20)
      expect(screen.getByText(/PDF gerado com 3 etiqueta\(s\) de 2 produto\(s\)/)).toBeInTheDocument()
    })

    it('"Todos os produtos com estoque" pede tudo, sem lista', async () => {
      servidor(folha([KAIAK_1]))
      renderizar()

      fireEvent.click(screen.getByRole('checkbox', { name: 'Todos os produtos com estoque' }))
      expect(screen.queryByRole('combobox', { name: 'Produto' })).toBeNull()
      gerar()

      await waitFor(() => expect(gerarPdf).toHaveBeenCalledTimes(1))
      expect(pedidosDeEtiquetas()[0]?.corpo).toEqual({ todos: true, pagina: 1, tamanhoPagina: 500 })
    })

    it('busca as páginas em sequência até o total, e o PDF sai com todas', async () => {
      servidor(folha([MALBEC_1, KAIAK_1], 3, 1), folha([KAIAK_2], 3, 2))
      renderizar()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Todos os produtos com estoque' }))

      gerar()

      await waitFor(() => expect(gerarPdf).toHaveBeenCalledTimes(1))
      expect(pedidosDeEtiquetas().map((p) => p.corpo.pagina)).toEqual([1, 2])
      const [grupos] = gerarPdf.mock.calls[0] ?? []
      // A página 2 continua o grupo de Kaiak, em vez de abrir outro.
      expect(grupos?.map((g) => g.etiquetas.length)).toEqual([1, 2])
    })

    it('leva ao PDF o tamanho de símbolo escolhido', async () => {
      servidor(folha([KAIAK_1]))
      renderizar()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Todos os produtos com estoque' }))

      fireEvent.click(screen.getByRole('radio', { name: '15 mm' }))
      gerar()

      await waitFor(() => expect(gerarPdf).toHaveBeenCalledTimes(1))
      expect(gerarPdf.mock.calls[0]?.[1]).toBe(15)
    })

    it('avisa quais produtos escolhidos não tinham estoque', async () => {
      servidor(folha([KAIAK_1]))
      renderizar()
      await escolherNoSeletor('Kaiak')
      await escolherNoSeletor('Malbec')

      gerar()

      expect(await screen.findByText(/Sem unidades em estoque, ficaram de fora: Malbec\./)).toBeInTheDocument()
      expect(gerarPdf).toHaveBeenCalledTimes(1)
    })

    it('sem nenhuma unidade, diz isso e não gera PDF', async () => {
      servidor(folha([]))
      renderizar()
      await escolherNoSeletor('Malbec')

      gerar()

      expect(await screen.findByText('Nenhuma unidade em estoque nos produtos escolhidos.')).toBeInTheDocument()
      expect(gerarPdf).not.toHaveBeenCalled()
    })

    it('exibe a mensagem que o servidor escreveu quando a busca falha', async () => {
      servidor(respostaFalsa(403, { erro: 'SEM_PERMISSAO', mensagem: 'Acesso restrito à gestão.' }))
      renderizar()
      await escolherNoSeletor('Kaiak')

      gerar()

      expect(await screen.findByRole('alert')).toHaveTextContent('Acesso restrito à gestão.')
      expect(gerarPdf).not.toHaveBeenCalled()
      // O botão volta a funcionar para tentar de novo.
      expect(screen.getByRole('button', { name: 'Gerar PDF' })).toBeEnabled()
    })
  })

  describe('vindo do recebimento', () => {
    it('mostra o lote e não busca nada antes do pedido', async () => {
      servidor()

      renderizar(VINDO_DO_RECEBIMENTO)

      expect(screen.getByText(/Kaiak — 2 unidade\(s\) do recebimento/)).toBeInTheDocument()
      await act(async () => {})
      expect(buscar).not.toHaveBeenCalled()
    })

    it('gera só as unidades daquele lote, pela folha do produto', async () => {
      servidor(folha([KAIAK_1, KAIAK_2]))
      renderizar(VINDO_DO_RECEBIMENTO)

      gerar()

      await waitFor(() => expect(gerarPdf).toHaveBeenCalledTimes(1))
      expect(pedidosDeEtiquetas()).toEqual([
        {
          url:
            `${API}/produtos/${KAIAK.id}/unidades/etiquetas` +
            `?tamanhoPagina=500&unidadeIds=${KAIAK_1.id}&unidadeIds=${KAIAK_2.id}`,
          metodo: 'GET',
          corpo: undefined,
        },
      ])
      expect(gerarPdf.mock.calls[0]?.[0]).toHaveLength(1)
    })

    it('"Escolher produtos" troca o lote pela escolha livre', async () => {
      servidor()
      renderizar(VINDO_DO_RECEBIMENTO)

      fireEvent.click(screen.getByRole('button', { name: 'Escolher produtos' }))

      expect(await screen.findByRole('combobox', { name: 'Produto' })).toHaveValue('')
      expect(screen.getByRole('button', { name: 'Gerar PDF' })).toBeDisabled()
    })
  })
})
