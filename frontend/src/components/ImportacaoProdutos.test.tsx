import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportacaoProdutos } from './ImportacaoProdutos'
import { lerTextoDaPlanilha } from '../services/produtos'
import { respostaFalsa } from '../services/testes/respostaFalsa'

const buscar = vi.fn<typeof fetch>()
const PLANILHA = 'código interno;nome;marca;categoria\nPRF-001;Perfume;Marca;Perfumaria\n'

function escolherArquivo(conteudo: BlobPart = PLANILHA) {
  const arquivo = new File([conteudo], 'catalogo.csv', { type: 'text/csv' })
  fireEvent.change(screen.getByLabelText('Arquivo CSV'), { target: { files: [arquivo] } })
}

describe('ImportacaoProdutos (T24)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('só habilita o envio depois de escolher um arquivo', () => {
    render(<ImportacaoProdutos aoImportar={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled()
    escolherArquivo()
    expect(screen.getByRole('button', { name: 'Importar' })).toBeEnabled()
  })

  it('envia o texto do arquivo como está, e mostra o que o servidor cadastrou e pulou', async () => {
    const aoImportar = vi.fn()
    buscar.mockResolvedValueOnce(
      respostaFalsa(200, { criados: 3, ignorados: [{ linha: 4, codigoInterno: 'PRF-009' }] }),
    )
    render(<ImportacaoProdutos aoImportar={aoImportar} />)

    escolherArquivo()
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    const resultado = await screen.findByRole('status')
    expect(resultado).toHaveTextContent('3 produto(s) importado(s).')
    expect(resultado).toHaveTextContent('1 código(s) já estavam cadastrados e foram pulados')
    expect(within(resultado).getByText('Linha 4: PRF-009')).toBeInTheDocument()
    // Quem interpreta o CSV é o servidor: a tela manda o texto sem mexer nele.
    expect(buscar).toHaveBeenCalledWith(
      'http://localhost:3333/produtos/importar',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ conteudo: PLANILHA }) }),
    )
    expect(aoImportar).toHaveBeenCalledOnce()
    // Pronto para a próxima planilha.
    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled()
  })

  it('mostra a recusa do servidor com cada linha a corrigir, sem recarregar o catálogo', async () => {
    const aoImportar = vi.fn()
    buscar.mockResolvedValueOnce(
      respostaFalsa(400, {
        erro: 'PLANILHA_INVALIDA',
        mensagem: 'A planilha tem problemas e nada foi importado.',
        erros: ['Linha 3: nome em branco.', 'Linha 7: código PRF-001 repetido (já aparece na linha 2).'],
      }),
    )
    render(<ImportacaoProdutos aoImportar={aoImportar} />)

    escolherArquivo()
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('A planilha tem problemas e nada foi importado.')
    expect(within(alerta).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Linha 3: nome em branco.',
      'Linha 7: código PRF-001 repetido (já aparece na linha 2).',
    ])
    expect(aoImportar).not.toHaveBeenCalled()
  })

  it('mostra o botão ocupado enquanto envia', async () => {
    let responder: (resposta: Response) => void = () => {}
    buscar.mockReturnValueOnce(new Promise((resolver) => (responder = resolver)))
    render(<ImportacaoProdutos aoImportar={vi.fn()} />)

    escolherArquivo()
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    expect(await screen.findByRole('button', { name: 'Importando…' })).toBeDisabled()
    responder(respostaFalsa(200, { criados: 1, ignorados: [] }))
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
  })
})

describe('lerTextoDaPlanilha', () => {
  it('lê UTF-8', async () => {
    const texto = await lerTextoDaPlanilha(new Blob([new TextEncoder().encode('Perfumaria Clássica')]))

    expect(texto).toBe('Perfumaria Clássica')
  })

  it('lê o CSV do Excel em Windows-1252 sem estragar os acentos', async () => {
    // "Clássica, Loção" em Windows-1252: á = 0xE1, ç = 0xE7, ã = 0xE3.
    const bytes = new Uint8Array([0x43, 0x6c, 0xe1, 0x73, 0x73, 0x69, 0x63, 0x61, 0x2c, 0x20, 0x4c, 0x6f, 0xe7, 0xe3, 0x6f])

    expect(await lerTextoDaPlanilha(new Blob([bytes]))).toBe('Clássica, Loção')
  })
})
