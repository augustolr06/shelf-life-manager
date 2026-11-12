import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaProdutos } from './TelaProdutos'
import { encontrarAviso, renderizarComAvisos, semAvisos } from '../services/testes/avisos'
import { encontrarConfirmacao, responderConfirmacao } from '../services/testes/confirmacao'
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

const COLONIA = {
  ...PERFUME,
  id: '44444444-4444-4444-4444-444444444444',
  codigoInterno: 'COL-002',
  nome: 'Colônia 100ml',
}

/**
 * As consultas da lista, do cadastro e da situação, na ordem em que saem. As
 * categorias (T45) são pedidas em paralelo, ao abrir e depois de cadastrar, e
 * respondem por fora dela — em `buscarCategorias` —, para não desalinhar a
 * fila de respostas de cada teste.
 */
const buscar = vi.fn<typeof fetch>()
const buscarCategorias = vi.fn<() => Promise<Response>>()
const CATEGORIAS = ['Corpo e banho', 'Perfumaria']

const fetchFalso: typeof fetch = (entrada, init) =>
  String(entrada).endsWith('/produtos/categorias') ? buscarCategorias() : buscar(entrada, init)

/** Uma resposta que só chega quando o teste mandar, para controlar a ordem. */
function respostaAdiada() {
  let entregar!: (resposta: Response) => void
  const promessa = new Promise<Response>((resolver) => {
    entregar = resolver
  })
  return { promessa, entregar }
}

/** O painel de cadastro começa fechado (T45). */
function abrirNovoProduto() {
  fireEvent.click(screen.getByRole('button', { name: 'Novo produto' }))
}

/**
 * Desde T47 o painel começa pelo código de barras; o formulário de quatro
 * campos é a etapa do produto sem código (ou que a consulta não achou).
 */
function abrirFormularioManual() {
  if (!screen.queryByRole('complementary', { name: 'Novo produto' })) abrirNovoProduto()
  if (!screen.queryByLabelText('Código interno')) {
    fireEvent.click(screen.getByRole('button', { name: 'Preencha manualmente' }))
  }
}

/** Preenche o formulário de cadastro e submete, abrindo o painel se preciso. */
function cadastrar(codigo: string) {
  abrirFormularioManual()
  fireEvent.change(screen.getByLabelText('Código interno'), { target: { value: codigo } })
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Eau de Parfum 50ml' } })
  fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Marca Exemplo' } })
  fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'Perfumaria' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cadastrar produto' }))
}

/** Escolhe uma ação no menu "…" da linha do produto (T45). */
function escolherAcao(nomeProduto: string, acao: string) {
  fireEvent.click(screen.getByRole('button', { name: `Ações de “${nomeProduto}”` }))
  fireEvent.click(screen.getByRole('menuitem', { name: acao }))
}

async function esperarAcao(nomeProduto: string, acao: string) {
  await screen.findByRole('button', { name: `Ações de “${nomeProduto}”` })
  escolherAcao(nomeProduto, acao)
}

/**
 * Dentro de um roteador desde T42, quando a tela passou a ler `?busca=` da
 * URL — é por ela que a busca do Início chega aqui.
 */
function montar(usuario: Usuario = GESTOR, rota = '/produtos') {
  return renderizarComAvisos(
    <MemoryRouter initialEntries={[rota]}>
      <TelaProdutos usuario={usuario} />
    </MemoryRouter>,
  )
}

describe('TelaProdutos (RF02)', () => {
  beforeEach(() => {
    buscar.mockReset()
    buscarCategorias.mockReset()
    buscarCategorias.mockImplementation(async () => respostaFalsa(200, { categorias: CATEGORIAS }))
    vi.stubGlobal('fetch', fetchFalso)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lista o catálogo sem pedir inativos por padrão', async () => {
    buscar.mockResolvedValueOnce(pagina([PERFUME]))

    montar()

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

    montar()
    await screen.findByText(/nenhum produto encontrado/i)

    cadastrar('PRF-001')

    expect(await screen.findByText('PRF-001')).toBeInTheDocument()
    expect((await encontrarAviso('Produto “Eau de Parfum 50ml” cadastrado.')).tipo).toBe(
      'success',
    )
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
    // Painel de volta à primeira etapa, vazio, para o próximo cadastro (T47).
    expect(screen.getByLabelText('Código de barras')).toHaveValue('')
    expect(screen.queryByLabelText('Código interno')).not.toBeInTheDocument()
  })

  it('exibe a mensagem do backend quando o código interno já existe', async () => {
    buscar.mockResolvedValueOnce(pagina([])).mockResolvedValueOnce(
      respostaFalsa(409, {
        erro: 'CODIGO_INTERNO_EM_USO',
        mensagem: 'Já existe um produto com esse código interno.',
      }),
    )

    montar()
    await screen.findByText(/nenhum produto encontrado/i)

    cadastrar('PRF-001')

    // O veredito é do backend; a tela apenas o reflete (RNF04).
    const aviso = await encontrarAviso('Já existe um produto com esse código interno.')
    expect(aviso.tipo).toBe('error')
    // Os dados digitados continuam na tela para correção.
    expect(screen.getByLabelText('Código interno')).toHaveValue('PRF-001')
  })

  it('pede os inativos ao backend quando o filtro é marcado', async () => {
    buscar.mockResolvedValue(pagina([PERFUME]))

    montar()
    await screen.findByText('PRF-001')

    fireEvent.click(screen.getByLabelText('Mostrar inativos'))

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

    montar()
    await screen.findByText('PRF-001')

    // Com o filtro de inativos ligado, a linha permanece visível após a baixa.
    fireEvent.click(screen.getByLabelText('Mostrar inativos'))
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(2))

    escolherAcao(PERFUME.nome, 'Inativar')
    await responderConfirmacao('Inativar produto?', 'Inativar')

    await encontrarAviso('Produto “Eau de Parfum 50ml” inativado.')
    const linha = screen.getByText('PRF-001').closest('tr')
    expect(within(linha as HTMLElement).getByText('Inativo')).toBeInTheDocument()
    // O menu da linha agora oferece o desfazer.
    fireEvent.click(screen.getByRole('button', { name: `Ações de “${PERFUME.nome}”` }))
    expect(screen.getByRole('menuitem', { name: 'Reativar' })).toBeInTheDocument()
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

    montar()
    await esperarAcao(PERFUME.nome, 'Reativar')

    // Reativar desfaz uma inativação, sem perda: não pergunta (T39).
    expect(await screen.findByText('Ativo')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(buscar).toHaveBeenLastCalledWith(
      `http://localhost:3333/produtos/${PERFUME.id}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ ativo: true }) }),
    )
  })

  it('não oferece cadastro nem ações de escrita ao ATENDENTE', async () => {
    buscar.mockResolvedValueOnce(pagina([PERFUME]))

    montar(ATENDENTE)
    await screen.findByText('PRF-001')

    // Esconder é conveniência de interface; a recusa real continua sendo o
    // 403 do backend (RNF04).
    expect(screen.queryByRole('button', { name: 'Novo produto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Importar planilha' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ações de/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Ações' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Código interno')).not.toBeInTheDocument()
    // A busca e o filtro por categoria são de todos.
    expect(screen.getByLabelText(/buscar por nome ou código/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Perfumaria' })).toBeInTheDocument()
  })

  it('avisa quando o catálogo não pôde ser carregado', async () => {
    buscar.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    montar()

    // Falha ao carregar é estado da tela, e fica nela — não é toast (T29).
    expect(await screen.findByRole('alert')).toHaveTextContent(/conexão/i)
    expect(await semAvisos()).toBe(true)
  })

  it('avisa em toast quando a inativação falha, sem trocar a lista por erro (T29)', async () => {
    buscar
      .mockResolvedValueOnce(pagina([PERFUME]))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))

    montar()
    await esperarAcao(PERFUME.nome, 'Inativar')
    await responderConfirmacao('Inativar produto?', 'Inativar')

    expect((await encontrarAviso(/conexão/i)).tipo).toBe('error')
    expect(screen.getByText('PRF-001')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  describe('filtro por categoria (T45)', () => {
    it('mostra "Todas" e as categorias do servidor, com "Todas" escolhida', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()

      const grupo = await screen.findByRole('group', { name: 'Filtrar por categoria' })
      const pilulas = within(grupo).getAllByRole('button')
      expect(pilulas.map((pilula) => pilula.textContent)).toEqual([
        'Todas',
        'Corpo e banho',
        'Perfumaria',
      ])
      expect(within(grupo).getByRole('button', { name: 'Todas' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    it('pede a categoria ao servidor, combinada com a busca, e volta à primeira página', async () => {
      buscar.mockResolvedValue(pagina([PERFUME], 45))
      montar(GESTOR, '/produtos?busca=eau')
      await screen.findByText('PRF-001')

      fireEvent.click(screen.getByRole('button', { name: /próxima/i }))
      await waitFor(() =>
        expect(buscar).toHaveBeenLastCalledWith(
          'http://localhost:3333/produtos?busca=eau&pagina=2',
          expect.anything(),
        ),
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Corpo e banho' }))

      await waitFor(() =>
        expect(buscar).toHaveBeenLastCalledWith(
          'http://localhost:3333/produtos?busca=eau&categoria=Corpo+e+banho',
          expect.anything(),
        ),
      )
      expect(screen.getByRole('button', { name: 'Corpo e banho' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'false')
    })

    it('"Todas" tira o filtro', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()

      fireEvent.click(await screen.findByRole('button', { name: 'Perfumaria' }))
      await waitFor(() =>
        expect(buscar).toHaveBeenLastCalledWith(
          'http://localhost:3333/produtos?categoria=Perfumaria',
          expect.anything(),
        ),
      )

      fireEvent.click(screen.getByRole('button', { name: 'Todas' }))

      await waitFor(() =>
        expect(buscar).toHaveBeenLastCalledWith('http://localhost:3333/produtos', expect.anything()),
      )
    })

    it('sem as categorias, a lista continua, só sem as pílulas', async () => {
      buscarCategorias.mockRejectedValue(new TypeError('Failed to fetch'))
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()

      expect(await screen.findByText('PRF-001')).toBeInTheDocument()
      await waitFor(() => expect(buscarCategorias).toHaveBeenCalled())
      expect(screen.queryByRole('group', { name: 'Filtrar por categoria' })).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('cabeçalho com a contagem (T45)', () => {
    it('conta os produtos ativos da lista, pelo total do servidor', async () => {
      buscar.mockResolvedValue(pagina([PERFUME], 26))
      montar()

      expect(await screen.findByText('26 produtos ativos')).toBeInTheDocument()
      expect(screen.getByText('1–20 de 26')).toBeInTheDocument()
    })

    it('diz quando conta os inativos junto', async () => {
      buscar.mockResolvedValue(pagina([PERFUME], 30))
      montar()
      await screen.findByText('30 produtos ativos')

      fireEvent.click(screen.getByLabelText('Mostrar inativos'))

      expect(await screen.findByText('30 produtos')).toBeInTheDocument()
    })
  })

  describe('painel de cadastro e importação (T45)', () => {
    it('começa fechado; "Novo produto" abre o painel com o foco no código de barras', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()
      await screen.findByText('PRF-001')

      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Código interno')).not.toBeInTheDocument()

      abrirNovoProduto()

      const painel = screen.getByRole('complementary', { name: 'Novo produto' })
      // T47: o painel começa pelo código de barras, e não pelos quatro campos.
      expect(within(painel).getByLabelText('Código de barras')).toHaveFocus()
      expect(screen.getByRole('button', { name: 'Novo produto' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      // A lista continua na tela ao lado do painel.
      expect(screen.getByText('PRF-001')).toBeInTheDocument()
    })

    it('fechar devolve o foco ao botão que abriu o painel, e o Esc fecha também', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()
      await screen.findByText('PRF-001')

      abrirNovoProduto()
      fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))

      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Novo produto' })).toHaveFocus()

      fireEvent.click(screen.getByRole('button', { name: 'Importar planilha' }))
      fireEvent.keyDown(screen.getByLabelText('Arquivo CSV'), { key: 'Escape' })

      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Importar planilha' })).toHaveFocus()
    })

    it('o que foi digitado continua lá quando o painel reabre', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()
      await screen.findByText('PRF-001')

      abrirFormularioManual()
      fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Colônia' } })
      fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
      abrirNovoProduto()

      // Volta na mesma etapa, com o que foi digitado (T47 manteve o T45).
      expect(screen.getByLabelText('Nome')).toHaveValue('Colônia')
    })

    it('o código de barras digitado também continua lá quando o painel reabre', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()
      await screen.findByText('PRF-001')

      abrirNovoProduto()
      fireEvent.change(screen.getByLabelText('Código de barras'), {
        target: { value: '7891000325858' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
      abrirNovoProduto()

      expect(screen.getByLabelText('Código de barras')).toHaveValue('7891000325858')
    })

    it('"Importar planilha" abre a importação no mesmo painel, e dá para trocar entre os dois', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()
      await screen.findByText('PRF-001')

      fireEvent.click(screen.getByRole('button', { name: 'Importar planilha' }))

      const importacao = screen.getByRole('complementary', { name: 'Importar planilha' })
      expect(within(importacao).getByLabelText('Arquivo CSV')).toHaveFocus()

      fireEvent.click(within(importacao).getByRole('button', { name: 'Cadastre pelo formulário' }))
      const cadastro = screen.getByRole('complementary', { name: 'Novo produto' })
      expect(within(cadastro).getByLabelText('Código de barras')).toHaveFocus()

      fireEvent.click(within(cadastro).getByRole('button', { name: 'Importe uma planilha CSV' }))
      expect(screen.getByRole('complementary', { name: 'Importar planilha' })).toBeInTheDocument()
    })

    it('o campo Categoria sugere as categorias que já existem e aceita uma nova', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()
      await screen.findByRole('button', { name: 'Perfumaria' })

      abrirFormularioManual()

      const campo = screen.getByLabelText('Categoria')
      const sugestoes = document.getElementById(campo.getAttribute('list') ?? '')
      expect(sugestoes?.tagName).toBe('DATALIST')
      expect(
        Array.from(sugestoes?.querySelectorAll('option') ?? []).map((opcao) => opcao.value),
      ).toEqual(CATEGORIAS)
      // Continua um campo de texto: categoria nova é digitada.
      fireEvent.change(campo, { target: { value: 'Óleos' } })
      expect(campo).toHaveValue('Óleos')
    })

    it('cadastro com sucesso mantém o painel aberto e pede as categorias de novo', async () => {
      buscar
        .mockResolvedValueOnce(pagina([]))
        .mockResolvedValueOnce(respostaFalsa(201, { produto: PERFUME }))
        .mockResolvedValueOnce(pagina([PERFUME]))
      montar()
      await screen.findByText(/nenhum produto encontrado/i)
      await waitFor(() => expect(buscarCategorias).toHaveBeenCalledTimes(1))

      cadastrar('PRF-001')

      expect(await screen.findByText('PRF-001')).toBeInTheDocument()
      expect(buscarCategorias).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('complementary', { name: 'Novo produto' })).toBeInTheDocument()
      expect(screen.getByLabelText('Código de barras')).toHaveFocus()
    })
  })

  describe('código de barras já cadastrado (T47)', () => {
    const INATIVO = { ...COLONIA, ativo: false }

    it('"Mostrar na lista" busca o código, tira o filtro de categoria e liga os inativos', async () => {
      buscar.mockResolvedValueOnce(pagina([PERFUME]))
      montar()
      await screen.findByRole('button', { name: 'Perfumaria' })

      buscar.mockResolvedValueOnce(pagina([PERFUME]))
      fireEvent.click(screen.getByRole('button', { name: 'Perfumaria' }))
      await waitFor(() =>
        expect(buscar).toHaveBeenLastCalledWith(
          'http://localhost:3333/produtos?categoria=Perfumaria',
          expect.anything(),
        ),
      )

      abrirNovoProduto()
      buscar.mockResolvedValueOnce(respostaFalsa(200, { situacao: 'JA_CADASTRADO', produto: INATIVO }))
      fireEvent.change(screen.getByLabelText('Código de barras'), { target: { value: 'col-002' } })
      fireEvent.click(screen.getByRole('button', { name: 'Buscar produto' }))

      expect(await screen.findByText(/já está no catálogo/)).toHaveTextContent(
        'O código COL-002 já está no catálogo: “Colônia 100ml” (Marca Exemplo), inativo.',
      )

      buscar.mockResolvedValue(pagina([INATIVO]))
      fireEvent.click(screen.getByRole('button', { name: 'Mostrar na lista' }))

      expect(screen.getByLabelText(/buscar por nome ou código/i)).toHaveValue('COL-002')
      expect(screen.getByRole('checkbox', { name: 'Mostrar inativos' })).toBeChecked()
      expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true')
      await waitFor(() =>
        expect(buscar).toHaveBeenLastCalledWith(
          'http://localhost:3333/produtos?busca=COL-002&incluirInativos=true',
          expect.anything(),
        ),
      )
    })
  })

  describe('confirmação antes de inativar (T39)', () => {
    it('cita o produto e diz o que acontece com o estoque, com o foco em Cancelar', async () => {
      buscar.mockResolvedValueOnce(pagina([PERFUME]))

      montar()
      await esperarAcao(PERFUME.nome, 'Inativar')

      const dialogo = await encontrarConfirmacao('Inativar produto?')
      expect(dialogo).toHaveAccessibleDescription(
        /“Eau de Parfum 50ml” deixa de receber unidades novas.*As unidades que já estão em estoque continuam podendo ser vendidas/,
      )
      expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })

    it('o item Inativar do menu é o de perigo; Reativar não', async () => {
      buscar.mockResolvedValueOnce(pagina([PERFUME, { ...COLONIA, ativo: false }]))

      montar()
      await screen.findByText('PRF-001')

      fireEvent.click(screen.getByRole('button', { name: `Ações de “${PERFUME.nome}”` }))
      expect(screen.getByRole('menuitem', { name: 'Inativar' })).toHaveClass('perigo')
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

      fireEvent.click(screen.getByRole('button', { name: `Ações de “${COLONIA.nome}”` }))
      expect(screen.getByRole('menuitem', { name: 'Reativar' })).not.toHaveClass('perigo')
    })

    it('cancelar não chama a API e deixa o produto ativo', async () => {
      buscar.mockResolvedValueOnce(pagina([PERFUME]))

      montar()
      await esperarAcao(PERFUME.nome, 'Inativar')
      await responderConfirmacao('Inativar produto?', 'Cancelar')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(buscar).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Ativo')).toBeInTheDocument()
    })

    it('Esc cancela, como o botão', async () => {
      buscar.mockResolvedValueOnce(pagina([PERFUME]))

      montar()
      await esperarAcao(PERFUME.nome, 'Inativar')
      fireEvent.keyDown(await encontrarConfirmacao('Inativar produto?'), { key: 'Escape' })

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(buscar).toHaveBeenCalledTimes(1)
    })

    it('confirmar chama a API uma vez', async () => {
      buscar
        .mockResolvedValueOnce(pagina([PERFUME]))
        .mockResolvedValueOnce(respostaFalsa(200, { produto: { ...PERFUME, ativo: false } }))
        .mockResolvedValueOnce(pagina([]))

      montar()
      await esperarAcao(PERFUME.nome, 'Inativar')
      await responderConfirmacao('Inativar produto?', 'Inativar')

      await encontrarAviso('Produto “Eau de Parfum 50ml” inativado.')
      const inativacoes = buscar.mock.calls.filter(([, init]) => init?.method === 'DELETE')
      expect(inativacoes).toHaveLength(1)
    })
  })

  describe('busca em tempo real (T26)', () => {
    const ATRASO = 300

    function campoBusca() {
      return screen.getByLabelText(/buscar por nome ou código/i)
    }

    function digitar(valor: string) {
      fireEvent.change(campoBusca(), { target: { value: valor } })
    }

    function avancar(ms: number) {
      act(() => vi.advanceTimersByTime(ms))
    }

    /**
     * Relógio falso só no trecho que digita e espera o atraso. O `findBy` do
     * Testing Library precisa do `setTimeout` real para terminar, então o
     * relógio volta ao normal antes de qualquer espera pela tela.
     */
    function comRelogioFalso(passos: () => void) {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        passos()
      } finally {
        vi.useRealTimers()
      }
    }

    function digitarEEsperar(valor: string) {
      comRelogioFalso(() => {
        digitar(valor)
        avancar(ATRASO)
      })
    }

    /** Espera a resposta da consulta chegar à tela antes do próximo passo. */
    async function esperarFimDoCarregamento() {
      await waitFor(() => expect(screen.queryByText('Carregando…')).not.toBeInTheDocument())
    }

    it('começa com a busca que chega pela URL, vinda do Início (T42)', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar(GESTOR, '/produtos?busca=perfume')

      await screen.findByText('PRF-001')
      expect(campoBusca()).toHaveValue('perfume')
      // Já a primeira consulta vai com o termo, sem esperar a pausa da digitação.
      expect(buscar).toHaveBeenCalledTimes(1)
      expect(buscar).toHaveBeenCalledWith(
        'http://localhost:3333/produtos?busca=perfume',
        expect.objectContaining({ credentials: 'include' }),
      )
    })

    it('busca depois da pausa na digitação, uma vez só, sem botão Buscar', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()
      await screen.findByText('PRF-001')
      expect(screen.queryByRole('button', { name: /^buscar$/i })).not.toBeInTheDocument()

      comRelogioFalso(() => {
        digitar('p')
        avancar(ATRASO - 100)
        digitar('  parfum ')
        avancar(ATRASO - 1)

        // Nenhuma pausa completa ainda: só a carga inicial saiu.
        expect(buscar).toHaveBeenCalledTimes(1)

        avancar(1)
      })
      await esperarFimDoCarregamento()

      expect(buscar).toHaveBeenCalledTimes(2)
      expect(buscar).toHaveBeenLastCalledWith(
        'http://localhost:3333/produtos?busca=parfum',
        expect.anything(),
      )
    })

    it('campo apagado volta à lista completa, respeitando o filtro de inativos', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()
      await screen.findByText('PRF-001')

      fireEvent.click(screen.getByLabelText('Mostrar inativos'))
      await esperarFimDoCarregamento()
      digitarEEsperar('parfum')
      await esperarFimDoCarregamento()
      expect(buscar).toHaveBeenLastCalledWith(
        'http://localhost:3333/produtos?busca=parfum&incluirInativos=true',
        expect.anything(),
      )

      digitarEEsperar('')
      await esperarFimDoCarregamento()

      expect(buscar).toHaveBeenLastCalledWith(
        'http://localhost:3333/produtos?incluirInativos=true',
        expect.anything(),
      )
    })

    it('o botão de limpar só aparece com texto, esvazia o campo e volta à lista completa', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()
      await screen.findByText('PRF-001')
      expect(screen.queryByRole('button', { name: 'Limpar busca' })).not.toBeInTheDocument()

      digitarEEsperar('parfum')
      await esperarFimDoCarregamento()
      comRelogioFalso(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Limpar busca' }))

        expect(campoBusca()).toHaveValue('')
        expect(campoBusca()).toHaveFocus()
        expect(screen.queryByRole('button', { name: 'Limpar busca' })).not.toBeInTheDocument()

        avancar(ATRASO)
      })
      await esperarFimDoCarregamento()

      expect(buscar).toHaveBeenLastCalledWith('http://localhost:3333/produtos', expect.anything())
    })

    it('Enter no campo não recarrega a página nem busca de novo', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()
      await screen.findByText('PRF-001')

      digitarEEsperar('parfum')
      await esperarFimDoCarregamento()
      expect(buscar).toHaveBeenCalledTimes(2)

      comRelogioFalso(() => {
        // `fireEvent` devolve `false` quando o evento teve o padrão cancelado.
        expect(fireEvent.submit(campoBusca().closest('form') as HTMLFormElement)).toBe(false)
        avancar(ATRASO)
      })

      expect(buscar).toHaveBeenCalledTimes(2)
    })

    it('mantém a lista anterior na tela enquanto a busca carrega', async () => {
      const busca = respostaAdiada()
      buscar.mockResolvedValueOnce(pagina([PERFUME])).mockReturnValueOnce(busca.promessa)
      montar()
      await screen.findByText('PRF-001')

      digitarEEsperar('colônia')

      expect(screen.getByRole('status')).toHaveTextContent('Carregando…')
      expect(screen.getByText('PRF-001')).toBeInTheDocument()

      busca.entregar(pagina([COLONIA]))

      expect(await screen.findByText('COL-002')).toBeInTheDocument()
      expect(screen.queryByText('PRF-001')).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('ignora a resposta de um termo antigo que chega depois da do termo atual', async () => {
      const antiga = respostaAdiada()
      const atual = respostaAdiada()
      buscar
        .mockResolvedValueOnce(pagina([]))
        .mockReturnValueOnce(antiga.promessa)
        .mockReturnValueOnce(atual.promessa)
      montar()
      await screen.findByText(/nenhum produto encontrado/i)

      digitarEEsperar('col')
      digitarEEsperar('colônia')

      atual.entregar(pagina([COLONIA]))
      expect(await screen.findByText('COL-002')).toBeInTheDocument()

      await act(async () => antiga.entregar(pagina([PERFUME])))

      expect(screen.getByText('COL-002')).toBeInTheDocument()
      expect(screen.queryByText('PRF-001')).not.toBeInTheDocument()
      expect(screen.getByText('1 produto ativo encontrado')).toBeInTheDocument()
    })

    it('termo novo volta para a primeira página', async () => {
      buscar.mockResolvedValue(pagina([PERFUME], 45))
      montar()
      await screen.findByText('PRF-001')

      fireEvent.click(screen.getByRole('button', { name: /próxima/i }))
      await esperarFimDoCarregamento()
      expect(buscar).toHaveBeenLastCalledWith(
        'http://localhost:3333/produtos?pagina=2',
        expect.anything(),
      )

      digitarEEsperar('parfum')
      await esperarFimDoCarregamento()

      expect(buscar).toHaveBeenLastCalledWith(
        'http://localhost:3333/produtos?busca=parfum',
        expect.anything(),
      )
      // Nenhuma consulta com o termo novo na página antiga.
      expect(buscar).not.toHaveBeenCalledWith(
        'http://localhost:3333/produtos?busca=parfum&pagina=2',
        expect.anything(),
      )
    })

    it('limita o termo aos 120 caracteres que o servidor aceita', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      montar()
      await screen.findByText('PRF-001')

      expect(campoBusca()).toHaveAttribute('maxLength', '120')
    })
  })

  describe('limite de 120 caracteres (T25)', () => {
    const LONGO = 'x'.repeat(130)

    async function abrirFormulario() {
      buscar.mockResolvedValueOnce(pagina([]))
      montar()
      await screen.findByText(/nenhum produto encontrado/i)
      abrirFormularioManual()
    }

    it('limita os quatro campos e mostra o contador de caracteres', async () => {
      await abrirFormulario()

      for (const rotulo of ['Código interno', 'Nome', 'Marca', 'Categoria']) {
        const campo = screen.getByLabelText(rotulo)
        expect(campo).toHaveAttribute('maxLength', '120')
        expect(campo).toHaveAccessibleDescription('0/120')
      }

      fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'n'.repeat(87) } })

      expect(screen.getByLabelText('Nome')).toHaveAccessibleDescription('87/120')
    })

    it('avisa que o texto colado foi cortado, e o aviso some na próxima edição', async () => {
      await abrirFormulario()
      const nome = screen.getByLabelText('Nome')

      // O corte em si é do navegador (`maxLength`), que o jsdom não aplica:
      // a colagem e a edição que ela gera são simuladas em separado.
      fireEvent.paste(nome, { clipboardData: { getData: () => LONGO } })
      fireEvent.input(nome, {
        target: { value: LONGO.slice(0, 120) },
        inputType: 'insertFromPaste',
      })

      expect(screen.getByRole('status')).toHaveTextContent('O nome foi cortado em 120 caracteres.')
      expect(nome).toHaveAccessibleDescription(/O nome foi cortado em 120 caracteres/)

      fireEvent.change(nome, { target: { value: LONGO.slice(0, 119) } })

      expect(screen.queryByText(/foi cortado/)).not.toBeInTheDocument()
    })

    it('escreve o aviso de colagem no gênero do campo', async () => {
      await abrirFormulario()

      fireEvent.paste(screen.getByLabelText('Categoria'), {
        clipboardData: { getData: () => LONGO },
      })

      expect(screen.getByRole('status')).toHaveTextContent(
        'A categoria foi cortada em 120 caracteres.',
      )
    })

    it('não avisa quando o texto colado cabe, contando o trecho selecionado que ele substitui', async () => {
      await abrirFormulario()
      const marca = screen.getByLabelText('Marca') as HTMLInputElement

      fireEvent.change(marca, { target: { value: 'm'.repeat(120) } })
      marca.setSelectionRange(0, 120)
      fireEvent.paste(marca, { clipboardData: { getData: () => 'Marca Exemplo' } })

      expect(screen.queryByText(/foi cortad/)).not.toBeInTheDocument()
    })

    it('nomeia junto ao campo, pelo rótulo, o campo que o servidor recusou', async () => {
      await abrirFormulario()
      buscar.mockResolvedValueOnce(
        respostaFalsa(400, {
          erro: 'CORPO_INVALIDO',
          mensagem: 'Alguns campos do formulário não foram aceitos. Confira os dados e tente de novo.',
          campos: ['nome'],
        }),
      )

      cadastrar('PRF-001')

      const nome = screen.getByLabelText('Nome')
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'O campo Nome aceita no máximo 120 caracteres.',
      )
      expect(nome).toHaveAccessibleDescription(/O campo Nome aceita no máximo 120 caracteres/)
      expect(nome).toHaveAttribute('aria-invalid', 'true')
      expect(screen.queryByText(/confira os dados/i)).not.toBeInTheDocument()
      // Erro de campo fica junto ao campo, e não vira toast (T29).
      expect(await semAvisos()).toBe(true)

      // Corrigir o campo tira a recusa, que era sobre o valor anterior.
      fireEvent.change(nome, { target: { value: 'Eau de Parfum' } })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('mostra a mensagem genérica do servidor quando a recusa não nomeia campo', async () => {
      await abrirFormulario()
      buscar.mockResolvedValueOnce(
        respostaFalsa(400, {
          erro: 'CORPO_INVALIDO',
          mensagem: 'Alguns campos do formulário não foram aceitos. Confira os dados e tente de novo.',
          campos: [],
        }),
      )

      cadastrar('PRF-001')

      expect((await encontrarAviso(/confira os dados/i)).tipo).toBe('error')
    })
  })
})
