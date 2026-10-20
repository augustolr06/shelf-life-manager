import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SeletorProduto } from './SeletorProduto'
import type { Produto } from '../services/produtos'
import { respostaFalsa } from '../services/testes/respostaFalsa'

/**
 * Seletor de produto com filtro (T28). O que importa provar é que o valor do
 * componente é sempre um produto escolhido da lista, e nunca o texto digitado.
 */

const PERFUME: Produto = {
  id: '33333333-3333-3333-3333-333333333333',
  codigoInterno: 'PRF-001',
  nome: 'Eau de Parfum 50ml',
  marca: 'Marca Exemplo',
  categoria: 'Perfumaria',
  ativo: true,
}

/** Mesmo nome, outra marca: é o caso que obriga a lista a mostrar mais que o nome. */
const PERFUME_OUTRA_MARCA: Produto = {
  ...PERFUME,
  id: '44444444-4444-4444-4444-444444444444',
  codigoInterno: 'PRF-002',
  marca: 'Outra Marca',
}

const COLONIA: Produto = {
  ...PERFUME,
  id: '55555555-5555-5555-5555-555555555555',
  codigoInterno: 'COL-003',
  nome: 'Colônia 100ml',
}

const ATRASO = 300

function pagina(produtos: Produto[], total = produtos.length) {
  return respostaFalsa(200, { produtos, total, pagina: 1, tamanhoPagina: 20 })
}

const buscar = vi.fn<typeof fetch>()
const aoEscolher = vi.fn<(produto: Produto | null) => void>()

/** O seletor controlado, como as telas o usam. */
function ComEstado({ inicial = null }: { inicial?: Produto | null }) {
  const [valor, setValor] = useState<Produto | null>(inicial)
  return (
    <>
      <SeletorProduto
        valor={valor}
        aoEscolher={(produto) => {
          aoEscolher(produto)
          setValor(produto)
        }}
      />
      <output data-testid="escolhido">{valor?.id ?? ''}</output>
    </>
  )
}

function campo() {
  return screen.getByRole('combobox', { name: 'Produto' })
}

function lista() {
  return screen.getByRole('listbox', { name: 'Produtos encontrados', hidden: true })
}

function escolhido() {
  return screen.getByTestId('escolhido').textContent
}

function focar() {
  act(() => campo().focus())
}

function sair() {
  act(() => campo().blur())
}

function digitar(valor: string) {
  fireEvent.change(campo(), { target: { value: valor } })
}

/**
 * Digita e espera o atraso de T26 com relógio falso. O relógio volta ao
 * normal antes de qualquer espera pela tela: o `findBy` precisa do real.
 */
function digitarEEsperar(valor: string) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    digitar(valor)
    act(() => vi.advanceTimersByTime(ATRASO))
  } finally {
    vi.useRealTimers()
  }
}

/** Monta, espera a primeira página do catálogo e abre a lista pelo foco. */
async function abrirComCatalogo(produtos: Produto[], total?: number) {
  buscar.mockResolvedValueOnce(pagina(produtos, total))
  render(<ComEstado />)
  focar()
  if (produtos.length > 0) await screen.findAllByRole('option')
  else await screen.findByText('Nenhum produto ativo encontrado.')
}

function urlsChamadas(): string[] {
  return buscar.mock.calls.map(([url]) => String(url))
}

describe('SeletorProduto (T28)', () => {
  beforeEach(() => {
    buscar.mockReset()
    aoEscolher.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ao focar, abre com a primeira página do catálogo ativo', async () => {
    await abrirComCatalogo([PERFUME, COLONIA])

    expect(campo()).toHaveAttribute('aria-expanded', 'true')
    expect(within(lista()).getAllByRole('option')).toHaveLength(2)
    // Sem `incluirInativos`: o backend recusa receber unidade de produto
    // inativo (T28, Decisão 2).
    expect(urlsChamadas()).toEqual(['http://localhost:3333/produtos'])
  })

  it('cada opção mostra nome, marca e código interno', async () => {
    await abrirComCatalogo([PERFUME, PERFUME_OUTRA_MARCA])

    const [primeira, segunda] = within(lista()).getAllByRole('option')
    expect(primeira).toHaveTextContent('Eau de Parfum 50ml')
    expect(primeira).toHaveTextContent('Marca Exemplo · PRF-001')
    expect(segunda).toHaveTextContent('Outra Marca · PRF-002')
  })

  it('digitar filtra a lista no servidor, depois da pausa na digitação', async () => {
    await abrirComCatalogo([PERFUME, COLONIA])

    buscar.mockResolvedValueOnce(pagina([COLONIA]))
    digitarEEsperar(' colônia ')

    await waitFor(() => expect(within(lista()).getAllByRole('option')).toHaveLength(1))
    expect(within(lista()).getByRole('option')).toHaveTextContent('Colônia 100ml')
    expect(urlsChamadas()[1]).toBe(
      `http://localhost:3333/produtos?busca=${encodeURIComponent('colônia')}`,
    )
    // Digitar não escolhe: só a lista muda.
    expect(aoEscolher).not.toHaveBeenCalled()
  })

  it('escolher por clique preenche o campo com o nome e fecha a lista', async () => {
    await abrirComCatalogo([PERFUME, COLONIA])

    fireEvent.click(within(lista()).getByRole('option', { name: /Colônia/ }))

    expect(aoEscolher).toHaveBeenLastCalledWith(COLONIA)
    expect(escolhido()).toBe(COLONIA.id)
    expect(campo()).toHaveValue('Colônia 100ml')
    expect(campo()).toHaveAttribute('aria-expanded', 'false')
  })

  it('escolher pelo teclado: setas navegam e Enter escolhe', async () => {
    await abrirComCatalogo([PERFUME, COLONIA])

    fireEvent.keyDown(campo(), { key: 'ArrowDown' })
    fireEvent.keyDown(campo(), { key: 'ArrowDown' })

    // O leitor de tela acompanha o destaque por `aria-activedescendant`.
    const [, segunda] = within(lista()).getAllByRole('option') as [HTMLElement, HTMLElement]
    expect(campo()).toHaveAttribute('aria-activedescendant', segunda.id)

    fireEvent.keyDown(campo(), { key: 'Enter' })

    expect(aoEscolher).toHaveBeenLastCalledWith(COLONIA)
    expect(campo()).toHaveValue('Colônia 100ml')
    expect(campo()).toHaveAttribute('aria-expanded', 'false')
  })

  it('Esc fecha a lista sem escolher', async () => {
    await abrirComCatalogo([PERFUME, COLONIA])

    fireEvent.keyDown(campo(), { key: 'ArrowDown' })
    fireEvent.keyDown(campo(), { key: 'Escape' })

    expect(campo()).toHaveAttribute('aria-expanded', 'false')
    expect(aoEscolher).not.toHaveBeenCalled()
  })

  it('editar o texto depois de escolher desfaz a escolha', async () => {
    await abrirComCatalogo([PERFUME, COLONIA])
    fireEvent.click(within(lista()).getByRole('option', { name: /Colônia/ }))
    expect(escolhido()).toBe(COLONIA.id)

    buscar.mockResolvedValueOnce(pagina([COLONIA]))
    digitarEEsperar('Colônia 100')

    expect(aoEscolher).toHaveBeenLastCalledWith(null)
    expect(escolhido()).toBe('')
    // O texto editado continua na caixa: a escolha é que deixou de valer.
    expect(campo()).toHaveValue('Colônia 100')
    await waitFor(() => expect(urlsChamadas()[1]).toContain('busca=Col%C3%B4nia+100'))
  })

  it('escolher não dispara busca pelo nome escolhido', async () => {
    await abrirComCatalogo([PERFUME, COLONIA])

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      fireEvent.click(within(lista()).getByRole('option', { name: /Colônia/ }))
      act(() => vi.advanceTimersByTime(ATRASO))
    } finally {
      vi.useRealTimers()
    }

    expect(buscar).toHaveBeenCalledTimes(1)
  })

  it('sair do campo sem escolher apaga o texto e não escolhe nada', async () => {
    await abrirComCatalogo([PERFUME, COLONIA])
    buscar.mockResolvedValue(pagina([PERFUME, COLONIA]))
    digitarEEsperar('eau')
    await waitFor(() => expect(screen.queryByText('Carregando…')).not.toBeInTheDocument())

    // Item destacado (mouse ou seta) não é escolha: sair não o seleciona.
    fireEvent.keyDown(campo(), { key: 'ArrowDown' })
    sair()

    expect(campo()).toHaveValue('')
    expect(aoEscolher).not.toHaveBeenCalled()
    expect(escolhido()).toBe('')
  })

  it('sair do campo com produto escolhido mantém a escolha', async () => {
    await abrirComCatalogo([PERFUME, COLONIA])
    fireEvent.click(within(lista()).getByRole('option', { name: /Colônia/ }))

    sair()

    expect(campo()).toHaveValue('Colônia 100ml')
    expect(escolhido()).toBe(COLONIA.id)
  })

  it('sem resultado, diz que nenhum produto ativo foi encontrado', async () => {
    await abrirComCatalogo([])

    expect(screen.getByText('Nenhum produto ativo encontrado.')).toBeInTheDocument()
    expect(within(lista()).queryAllByRole('option')).toHaveLength(0)
  })

  it('mais resultados que a página: pede para continuar digitando', async () => {
    await abrirComCatalogo([PERFUME, COLONIA], 140)

    expect(
      screen.getByText('Mostrando 2 de 140 — continue digitando para refinar.'),
    ).toBeInTheDocument()
  })

  it('falha de rede: mostra o erro e tenta de novo com o mesmo termo', async () => {
    buscar.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<ComEstado />)
    focar()

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/conexão/i)

    buscar.mockResolvedValueOnce(pagina([PERFUME]))
    fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByRole('option', { name: /Eau de Parfum/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(urlsChamadas()).toEqual([
      'http://localhost:3333/produtos',
      'http://localhost:3333/produtos',
    ])
  })

  it('falha de rede depois de uma lista carregada não deixa a lista antiga à vista', async () => {
    await abrirComCatalogo([PERFUME, COLONIA])

    buscar.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    digitarEEsperar('body')

    expect(await screen.findByRole('alert')).toHaveTextContent(/conexão/i)
    // A lista de antes é do termo vazio: embaixo de "body", passaria por
    // resultado dele.
    expect(within(lista()).queryAllByRole('option')).toHaveLength(0)

    buscar.mockResolvedValueOnce(pagina([COLONIA]))
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByRole('option', { name: /Colônia/ })).toBeInTheDocument()
    expect(urlsChamadas()[2]).toBe('http://localhost:3333/produtos?busca=body')
  })

  it('aceita um produto já escolhido como valor inicial', async () => {
    buscar.mockResolvedValueOnce(pagina([PERFUME]))
    render(<ComEstado inicial={PERFUME} />)

    expect(campo()).toHaveValue('Eau de Parfum 50ml')
    expect(escolhido()).toBe(PERFUME.id)
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(1))
  })
})
