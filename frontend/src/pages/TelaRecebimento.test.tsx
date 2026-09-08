import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaRecebimento } from './TelaRecebimento'
import { respostaFalsa } from '../services/testes/respostaFalsa'

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

async function selecionarProduto() {
  const seletor = await screen.findByLabelText('Produto')
  await waitFor(() => expect(within(seletor).getAllByRole('option')).toHaveLength(2))
  fireEvent.change(seletor, { target: { value: ID_PRODUTO } })
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

    render(<TelaRecebimento />)

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

    render(<TelaRecebimento />)
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

    render(<TelaRecebimento />)
    await selecionarProduto()
    preencherLinha(0, '2027-03-01')
    fireEvent.click(screen.getByRole('button', { name: /^registrar recebimento$/i }))

    // O código vem do backend; a tela nunca o inventa.
    expect(await screen.findByText('PRF-AB12CD')).toBeInTheDocument()
    expect(screen.getByText('01/03/2027')).toBeInTheDocument()
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

    render(<TelaRecebimento />)
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

    render(<TelaRecebimento />)
    await selecionarProduto()
    preencherLinha(0, '2027-03-01')
    fireEvent.click(screen.getByRole('button', { name: /^registrar recebimento$/i }))

    // RNF04: a tela reflete o veredito do backend, não inventa o seu.
    expect(await screen.findByRole('alert')).toHaveTextContent(/está inativo/i)
    expect(screen.queryByText(/unidade\(s\) cadastrada\(s\)/i)).not.toBeInTheDocument()
  })

  it('só habilita o envio com produto escolhido e todas as validades preenchidas', async () => {
    buscar.mockResolvedValueOnce(catalogo())

    render(<TelaRecebimento />)
    await screen.findByRole('option', { name: /PRF-001/ })

    const enviar = screen.getByRole('button', { name: /^registrar recebimento$/i })
    expect(enviar).toBeDisabled()

    await selecionarProduto()
    expect(enviar).toBeDisabled()

    preencherLinha(0, '2027-03-01')
    expect(enviar).toBeEnabled()
  })

  it('limpa as linhas depois do envio para não duplicar etiquetas', async () => {
    buscar
      .mockResolvedValueOnce(catalogo())
      .mockResolvedValueOnce(
        respostaFalsa(201, { unidades: [unidade('PRF-AB12CD', '2027-03-01')], avisos: [] }),
      )

    render(<TelaRecebimento />)
    await selecionarProduto()
    preencherLinha(0, '2027-03-01')
    fireEvent.click(screen.getByRole('button', { name: /^registrar recebimento$/i }))

    await screen.findByText('PRF-AB12CD')
    // Reenviar o mesmo lote por engano geraria unidades físicas inexistentes.
    expect(screen.getByLabelText('Validade', { selector: '#validade-0' })).toHaveValue('')
    expect(screen.getByRole('button', { name: /^registrar recebimento$/i })).toBeDisabled()
  })

  it('remove uma linha de validade, mantendo ao menos uma', async () => {
    buscar.mockResolvedValueOnce(catalogo())

    render(<TelaRecebimento />)
    await screen.findByRole('option', { name: /PRF-001/ })

    expect(screen.getByRole('button', { name: /remover validade 1/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /adicionar outra validade/i }))
    fireEvent.click(screen.getByRole('button', { name: /remover validade 2/i }))

    expect(screen.queryByLabelText('Validade', { selector: '#validade-1' })).not.toBeInTheDocument()
  })
})
