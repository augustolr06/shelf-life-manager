import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaProdutos } from './TelaProdutos'
import { respostaFalsa } from '../services/testes/respostaFalsa'
import type { Usuario } from '../services/auth'

const GESTOR: Usuario = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Gestora de Loja',
  email: 'gestor@estoque.local',
  papel: 'GESTOR',
}

const ATENDENTE: Usuario = {
  id: '22222222-2222-2222-2222-222222222222',
  nome: 'Atendente de Balcão',
  email: 'atendente@estoque.local',
  papel: 'ATENDENTE',
}

const PERFUME = {
  id: '33333333-3333-3333-3333-333333333333',
  codigoInterno: 'PRF-001',
  nome: 'Eau de Parfum 50ml',
  marca: 'Marca Exemplo',
  categoria: 'Perfumaria',
  ativo: true,
}

function pagina(produtos: typeof PERFUME[], total = produtos.length) {
  return respostaFalsa(200, { produtos, total, pagina: 1, tamanhoPagina: 20 })
}

const buscar = vi.fn<typeof fetch>()

/** Preenche o formulário de cadastro e submete. */
function cadastrar(codigo: string) {
  fireEvent.change(screen.getByLabelText('Código interno'), { target: { value: codigo } })
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Eau de Parfum 50ml' } })
  fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Marca Exemplo' } })
  fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'Perfumaria' } })
  fireEvent.click(screen.getByRole('button', { name: /^cadastrar$/i }))
}

describe('TelaProdutos (RF02)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lista o catálogo sem pedir inativos por padrão', async () => {
    buscar.mockResolvedValueOnce(pagina([PERFUME]))

    render(<TelaProdutos usuario={GESTOR} />)

    expect(await screen.findByText('PRF-001')).toBeInTheDocument()
    // Sem `incluirInativos` na consulta, o backend oculta os inativos.
    expect(buscar).toHaveBeenCalledWith(
      'http://localhost:3333/produtos',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('cadastra um produto e recarrega a lista', async () => {
    buscar
      .mockResolvedValueOnce(pagina([]))
      .mockResolvedValueOnce(respostaFalsa(201, { produto: PERFUME }))
      .mockResolvedValueOnce(pagina([PERFUME]))

    render(<TelaProdutos usuario={GESTOR} />)
    await screen.findByText(/nenhum produto encontrado/i)

    cadastrar('PRF-001')

    expect(await screen.findByText('PRF-001')).toBeInTheDocument()
    expect(buscar).toHaveBeenCalledWith(
      'http://localhost:3333/produtos',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          codigoInterno: 'PRF-001',
          nome: 'Eau de Parfum 50ml',
          marca: 'Marca Exemplo',
          categoria: 'Perfumaria',
        }),
      }),
    )
    // Formulário limpo para o próximo cadastro.
    expect(screen.getByLabelText('Código interno')).toHaveValue('')
  })

  it('exibe a mensagem do backend quando o código interno já existe', async () => {
    buscar.mockResolvedValueOnce(pagina([])).mockResolvedValueOnce(
      respostaFalsa(409, {
        erro: 'CODIGO_INTERNO_EM_USO',
        mensagem: 'Já existe um produto com esse código interno.',
      }),
    )

    render(<TelaProdutos usuario={GESTOR} />)
    await screen.findByText(/nenhum produto encontrado/i)

    cadastrar('PRF-001')

    // O veredito é do backend; a tela apenas o reflete (RNF04).
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe um produto com esse código interno.',
    )
    // Os dados digitados continuam na tela para correção.
    expect(screen.getByLabelText('Código interno')).toHaveValue('PRF-001')
  })

  it('busca por nome ou código e volta para a primeira página', async () => {
    buscar.mockResolvedValue(pagina([PERFUME]))

    render(<TelaProdutos usuario={GESTOR} />)
    await screen.findByText('PRF-001')

    fireEvent.change(screen.getByLabelText(/buscar por nome ou código/i), {
      target: { value: '  parfum ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }))

    await waitFor(() =>
      expect(buscar).toHaveBeenLastCalledWith(
        'http://localhost:3333/produtos?busca=parfum',
        expect.anything(),
      ),
    )
  })

  it('pede os inativos ao backend quando o filtro é marcado', async () => {
    buscar.mockResolvedValue(pagina([PERFUME]))

    render(<TelaProdutos usuario={GESTOR} />)
    await screen.findByText('PRF-001')

    fireEvent.click(screen.getByLabelText(/mostrar produtos inativos/i))

    await waitFor(() =>
      expect(buscar).toHaveBeenLastCalledWith(
        'http://localhost:3333/produtos?incluirInativos=true',
        expect.anything(),
      ),
    )
  })

  it('inativa pelo DELETE e mostra a nova situação sem sumir com a linha', async () => {
    buscar
      .mockResolvedValueOnce(pagina([PERFUME]))
      .mockResolvedValueOnce(pagina([PERFUME]))
      .mockResolvedValueOnce(respostaFalsa(200, { produto: { ...PERFUME, ativo: false } }))

    render(<TelaProdutos usuario={GESTOR} />)
    await screen.findByText('PRF-001')

    // Com o filtro de inativos ligado, a linha permanece visível após a baixa.
    fireEvent.click(screen.getByLabelText(/mostrar produtos inativos/i))
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: /inativar/i }))

    expect(await screen.findByRole('button', { name: /reativar/i })).toBeInTheDocument()
    const linha = screen.getByText('PRF-001').closest('tr')
    expect(within(linha as HTMLElement).getByText('Inativo')).toBeInTheDocument()
    expect(buscar).toHaveBeenLastCalledWith(
      `http://localhost:3333/produtos/${PERFUME.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('reativa por PATCH um produto inativado', async () => {
    const inativo = { ...PERFUME, ativo: false }
    buscar
      .mockResolvedValueOnce(pagina([inativo]))
      .mockResolvedValueOnce(respostaFalsa(200, { produto: PERFUME }))

    render(<TelaProdutos usuario={GESTOR} />)
    fireEvent.click(await screen.findByRole('button', { name: /reativar/i }))

    expect(await screen.findByRole('button', { name: /inativar/i })).toBeInTheDocument()
    expect(buscar).toHaveBeenLastCalledWith(
      `http://localhost:3333/produtos/${PERFUME.id}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ ativo: true }) }),
    )
  })

  it('não oferece cadastro nem ações de escrita ao ATENDENTE', async () => {
    buscar.mockResolvedValueOnce(pagina([PERFUME]))

    render(<TelaProdutos usuario={ATENDENTE} />)
    await screen.findByText('PRF-001')

    // Esconder é conveniência de interface; a recusa real continua sendo o
    // 403 do backend (RNF04).
    expect(screen.queryByLabelText('Código interno')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /inativar/i })).not.toBeInTheDocument()
  })

  it('avisa quando o catálogo não pôde ser carregado', async () => {
    buscar.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    render(<TelaProdutos usuario={GESTOR} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/conexão/i)
  })
})
