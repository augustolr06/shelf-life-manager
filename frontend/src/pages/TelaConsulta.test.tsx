import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaConsulta } from './TelaConsulta'
import { respostaFalsa } from '../services/testes/respostaFalsa'

/**
 * A câmera é substituída por um dublê, pelo mesmo motivo da tela de Venda:
 * `html5-qrcode` precisa de `getUserMedia`, que jsdom não tem. O dublê entrega
 * o código que o teste pedir, quantas vezes pedir — que é o que a câmera
 * contínua faz com o frasco parado na frente dela.
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
    modo?: 'unica' | 'continua'
    leitura?: string
  }) {
    camera.modo = modo
    camera.leitura = leitura
    return (
      <div data-testid="camera-dublada">
        <input aria-label="código na frente da câmera" id="codigo-camera" />
        <button
          type="button"
          onClick={() => {
            const campo = document.getElementById('codigo-camera') as HTMLInputElement
            aoLer(campo.value)
          }}
        >
          simular quadro
        </button>
        <button type="button" onClick={() => aoFalhar('Permissão de câmera negada.')}>
          simular falha de câmera
        </button>
      </div>
    )
  },
}))

const buscar = vi.fn<typeof fetch>()

function consulta(
  codigoQr: string,
  extras: {
    situacao?: 'VENCIDA' | 'NO_PRAZO'
    diasParaVencer?: number
    status?: 'EM_ESTOQUE' | 'VENDIDA' | 'DESCARTADA'
    ativo?: boolean
    nome?: string
  } = {},
) {
  return {
    unidade: {
      id: `unidade-${codigoQr}`,
      codigoQr,
      dataValidade: '2026-12-01',
      status: extras.status ?? 'EM_ESTOQUE',
      dataEntrada: '2026-09-20T13:02:11.000Z',
      produto: {
        id: 'produto-1',
        codigoInterno: 'COD-001',
        nome: extras.nome ?? 'Eau de Parfum 50ml',
        marca: 'Marca Exemplo',
        categoria: 'Perfumaria',
        ativo: extras.ativo ?? true,
      },
    },
    situacao: extras.situacao ?? 'NO_PRAZO',
    diasParaVencer: extras.diasParaVencer ?? 42,
  }
}

/** Um produto como a busca da Consulta o devolve (T49). */
function produto(
  id: string,
  extras: { nome?: string; codigoInterno?: string; ativo?: boolean; emEstoque?: number } = {},
) {
  return {
    id,
    codigoInterno: extras.codigoInterno ?? `COD-${id}`,
    nome: extras.nome ?? `Produto ${id}`,
    marca: 'Alfaparf',
    categoria: 'Coloração',
    ativo: extras.ativo ?? true,
    emEstoque: extras.emEstoque ?? 0,
  }
}

/** Uma unidade da lista de estoque, com o que o servidor decidiu sobre ela. */
function unidadeEmEstoque(
  codigoQr: string,
  diasParaVencer: number,
  faixa: string,
  dataValidade = '2026-12-01',
) {
  return {
    id: `unidade-${codigoQr}`,
    codigoQr,
    dataValidade,
    dataEntrada: '2026-09-20T13:02:11.000Z',
    diasParaVencer,
    situacao: diasParaVencer < 0 ? 'VENCIDA' : 'NO_PRAZO',
    faixa,
  }
}

function estoqueDe(base: ReturnType<typeof produto>, unidades: unknown[] = []) {
  const { emEstoque: _emEstoque, ...dados } = base
  return { produto: dados, unidades }
}

type BuscaDeProdutos = { produtos: ReturnType<typeof produto>[]; total: number }

/**
 * Responde `/health`, a busca e o estoque (T49). `unidades` é por termo, como
 * a consulta de etiqueta de T32 o devolveria; `buscas` são as listas de
 * produtos por termo; `estoques`, por id. Termo sem resposta é a lista vazia,
 * como no servidor; produto sem estoque cadastrado aqui é 404.
 */
function simular(
  unidades: Record<string, unknown>,
  {
    buscas = {},
    estoques = {},
  }: { buscas?: Record<string, BuscaDeProdutos>; estoques?: Record<string, unknown> } = {},
) {
  buscar.mockImplementation(async (entrada) => {
    const caminho = String(entrada).replace('http://localhost:3333', '')
    if (caminho === '/health') return respostaFalsa(200, { status: 'ok', uptime: 1 })

    if (caminho.startsWith('/consulta/busca?')) {
      const termo = new URLSearchParams(caminho.slice('/consulta/busca?'.length)).get('termo') ?? ''
      if (unidades[termo]) return respostaFalsa(200, { tipo: 'UNIDADE', consulta: unidades[termo] })
      return respostaFalsa(200, { tipo: 'PRODUTOS', ...(buscas[termo] ?? { produtos: [], total: 0 }) })
    }

    const prefixo = '/consulta/produtos/'
    if (caminho.startsWith(prefixo)) {
      const corpo = estoques[decodeURIComponent(caminho.slice(prefixo.length))]
      return corpo
        ? respostaFalsa(200, corpo)
        : respostaFalsa(404, { erro: 'PRODUTO_NAO_ENCONTRADO', mensagem: 'Produto não encontrado.' })
    }
    throw new Error(`requisição inesperada: ${caminho}`)
  })
}

/** Os termos enviados à busca, na ordem. */
function consultasEnviadas(): string[] {
  return buscar.mock.calls
    .map(([entrada]) => String(entrada).replace('http://localhost:3333', ''))
    .filter((caminho) => caminho.startsWith('/consulta/busca?'))
    .map((caminho) => new URLSearchParams(caminho.slice('/consulta/busca?'.length)).get('termo') ?? '')
}

function definirConexao(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online })
}

/**
 * Dentro de um roteador desde T42, quando a tela passou a ler `?codigo=` da
 * URL — é por ela que a busca e o "Ver unidade" do Início chegam aqui.
 */
function montar(rota = '/consulta') {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <TelaConsulta />
    </MemoryRouter>,
  )
}

async function digitar(codigo: string) {
  fireEvent.change(await screen.findByLabelText(/busque por nome/i), { target: { value: codigo } })
  fireEvent.click(screen.getByRole('button', { name: /^buscar$/i }))
}

async function ligarCamera() {
  fireEvent.click(await screen.findByRole('button', { name: /ligar câmera/i }))
}

function apontarCamera(codigo: string) {
  fireEvent.change(screen.getByLabelText(/código na frente da câmera/i), {
    target: { value: codigo },
  })
  fireEvent.click(screen.getByRole('button', { name: /simular quadro/i }))
}

describe('TelaConsulta (T32)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
    definirConexao(true)
    camera.modo = null
    camera.leitura = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    definirConexao(true)
  })

  it('deixa claro que consultar não dá baixa', async () => {
    simular({})
    montar()

    expect(await screen.findByText(/consultar não dá baixa/i)).toBeInTheDocument()
  })

  describe('o cartão da unidade', () => {
    it('mostra produto, validade, dias para vencer e situação no estoque', async () => {
      simular({ 'PRF-AAAAAA': consulta('PRF-AAAAAA') })
      montar()

      await digitar('PRF-AAAAAA')

      expect(await screen.findByRole('heading', { name: 'Eau de Parfum 50ml' })).toBeInTheDocument()
      expect(screen.getByText('Marca Exemplo')).toBeInTheDocument()
      expect(screen.getByText('Perfumaria')).toBeInTheDocument()
      expect(screen.getByText('COD-001')).toBeInTheDocument()
      expect(screen.getByText('01/12/2026')).toBeInTheDocument()
      expect(screen.getByText('42 dias')).toBeInTheDocument()
      expect(screen.getByText('Em estoque')).toBeInTheDocument()
      expect(screen.getByText('PRF-AAAAAA')).toBeInTheDocument()
    })

    it('consulta sozinha o código que chega pela URL, vindo do Início (T42)', async () => {
      simular({ 'PRF-AAAAAA': consulta('PRF-AAAAAA') })
      montar('/consulta?codigo=PRF-AAAAAA')

      expect(await screen.findByRole('heading', { name: 'Eau de Parfum 50ml' })).toBeInTheDocument()
      // Uma consulta só: o código da URL não é repetido a cada render.
      expect(consultasEnviadas()).toEqual(['PRF-AAAAAA'])
    })

    it('destaca a unidade vencida pelo campo situacao do servidor', async () => {
      simular({
        'PRF-VVVVVV': consulta('PRF-VVVVVV', { situacao: 'VENCIDA', diasParaVencer: -3 }),
      })
      montar()

      await digitar('PRF-VVVVVV')

      const cartao = (await screen.findByRole('heading', { name: 'Eau de Parfum 50ml' })).closest(
        'section',
      )
      expect(cartao).toHaveClass('resultado-vencido')
      expect(screen.getByText(/há 3 dias/i)).toBeInTheDocument()
    })

    it('não marca vencida sem o servidor dizer, mesmo com a validade no passado', async () => {
      // A data de validade fica no passado do calendário do teste, mas o
      // servidor disse `NO_PRAZO`: a tela não compara datas (RNF01, RNF04).
      simular({
        'PRF-AAAAAA': {
          ...consulta('PRF-AAAAAA', { diasParaVencer: 0 }),
          unidade: { ...consulta('PRF-AAAAAA').unidade, dataValidade: '2000-01-01' },
        },
      })
      montar()

      await digitar('PRF-AAAAAA')

      const cartao = (await screen.findByRole('heading', { name: 'Eau de Parfum 50ml' })).closest(
        'section',
      )
      expect(cartao).not.toHaveClass('resultado-vencido')
      expect(screen.getByText('hoje')).toBeInTheDocument()
    })

    it.each([
      ['VENDIDA', 'Vendida'],
      ['DESCARTADA', 'Descartada'],
    ] as const)('mostra a unidade %s, com o status real', async (status, rotulo) => {
      simular({ 'PRF-BBBBBB': consulta('PRF-BBBBBB', { status }) })
      montar()

      await digitar('PRF-BBBBBB')

      expect(await screen.findByText(rotulo)).toBeInTheDocument()
    })

    it('avisa quando o produto está inativo', async () => {
      simular({ 'PRF-AAAAAA': consulta('PRF-AAAAAA', { ativo: false }) })
      montar()

      await digitar('PRF-AAAAAA')

      expect(await screen.findByText(/produto inativo/i)).toBeInTheDocument()
    })

    it('código que nada acha diz isso no lugar do resultado anterior', async () => {
      simular({ 'PRF-AAAAAA': consulta('PRF-AAAAAA') })
      montar()

      await digitar('PRF-AAAAAA')
      await screen.findByRole('heading', { name: 'Eau de Parfum 50ml' })

      await digitar('PRF-XXXXXX')

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Nada encontrado para “PRF-XXXXXX”.',
      )
      expect(screen.queryByRole('heading', { name: 'Eau de Parfum 50ml' })).toBeNull()
    })

    it('envia o código como foi digitado, sem normalizar', async () => {
      simular({})
      montar()

      await digitar(' prf-aaaaaa ')

      await screen.findByRole('status')
      // Quem normaliza é o backend (T08); o espaço nas pontas é só aparado.
      expect(consultasEnviadas()).toEqual(['prf-aaaaaa'])
    })

    it('"Ver estoque do produto" abre o produto da unidade, e dá para voltar a ela', async () => {
      const base = produto('produto-1', { nome: 'Eau de Parfum 50ml' })
      simular(
        { 'PRF-AAAAAA': consulta('PRF-AAAAAA') },
        { estoques: { 'produto-1': estoqueDe(base, [unidadeEmEstoque('PRF-AAAAAA', 42, 'DE_31_A_90_DIAS')]) } },
      )
      montar()

      await digitar('PRF-AAAAAA')
      fireEvent.click(await screen.findByRole('button', { name: 'Ver estoque do produto' }))

      expect(await screen.findByRole('heading', { name: '1 unidade em estoque' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Voltar à unidade' }))
      expect(screen.getByRole('button', { name: 'Ver estoque do produto' })).toBeInTheDocument()
    })
  })

  describe('câmera contínua', () => {
    it('usa o leitor no modo contínuo', async () => {
      simular({})
      montar()

      await ligarCamera()

      expect(camera.modo).toBe('continua')
      // T49: a câmera lê a etiqueta e o código de barras da embalagem.
      expect(camera.leitura).toBe('qr-e-codigo-de-barras')
    })

    it('uma leitura nova substitui a anterior, sem desligar a câmera', async () => {
      simular({
        'PRF-AAAAAA': consulta('PRF-AAAAAA'),
        'PRF-BBBBBB': consulta('PRF-BBBBBB', { nome: 'Body Splash 200ml' }),
      })
      montar()
      await ligarCamera()

      apontarCamera('PRF-AAAAAA')
      await screen.findByRole('heading', { name: 'Eau de Parfum 50ml' })

      apontarCamera('PRF-BBBBBB')
      expect(await screen.findByRole('heading', { name: 'Body Splash 200ml' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Eau de Parfum 50ml' })).toBeNull()
      expect(screen.getByTestId('camera-dublada')).toBeInTheDocument()
    })

    it('ignora o mesmo código que já está na tela', async () => {
      simular({ 'PRF-AAAAAA': consulta('PRF-AAAAAA') })
      montar()
      await ligarCamera()

      apontarCamera('PRF-AAAAAA')
      await screen.findByRole('heading', { name: 'Eau de Parfum 50ml' })
      apontarCamera('PRF-AAAAAA')
      apontarCamera('PRF-AAAAAA')

      expect(consultasEnviadas()).toHaveLength(1)
    })

    it('também não repete a consulta do código que não foi encontrado', async () => {
      simular({})
      montar()
      await ligarCamera()

      apontarCamera('PRF-XXXXXX')
      await screen.findByRole('status')
      apontarCamera('PRF-XXXXXX')

      expect(consultasEnviadas()).toHaveLength(1)
    })

    it('ignora a rajada enquanto a consulta está no ar', async () => {
      let liberar: (resposta: Response) => void = () => {}
      buscar.mockImplementation(async (entrada) => {
        const caminho = String(entrada).replace('http://localhost:3333', '')
        if (caminho === '/health') return respostaFalsa(200, { status: 'ok', uptime: 1 })
        return new Promise<Response>((resolver) => {
          liberar = resolver
        })
      })
      montar()
      await ligarCamera()

      apontarCamera('PRF-AAAAAA')
      apontarCamera('PRF-BBBBBB')
      apontarCamera('PRF-AAAAAA')
      liberar(respostaFalsa(200, { tipo: 'UNIDADE', consulta: consulta('PRF-AAAAAA') }))

      await screen.findByRole('heading', { name: 'Eau de Parfum 50ml' })
      expect(consultasEnviadas()).toHaveLength(1)
    })

    it('mostra a falha da câmera e mantém a digitação', async () => {
      simular({})
      montar()
      await ligarCamera()

      fireEvent.click(screen.getByRole('button', { name: /simular falha de câmera/i }))

      expect(await screen.findByRole('alert')).toHaveTextContent(/permissão de câmera negada/i)
      expect(screen.queryByTestId('camera-dublada')).toBeNull()
      expect(screen.getByLabelText(/busque por nome/i)).toBeInTheDocument()
    })
  })

  describe('offline (RNF07)', () => {
    it('bloqueia a consulta sem rede, sem enviar nada', async () => {
      definirConexao(false)
      simular({})
      montar()

      expect(await screen.findByRole('alert')).toHaveTextContent(/sem conexão com o servidor/i)
      expect(screen.queryByLabelText(/busque por nome/i)).toBeNull()
      expect(screen.queryByRole('button', { name: /ligar câmera/i })).toBeNull()
      expect(consultasEnviadas()).toHaveLength(0)
    })

    it('apaga o resultado ao perder a conexão', async () => {
      simular({ 'PRF-AAAAAA': consulta('PRF-AAAAAA') })
      montar()

      await digitar('PRF-AAAAAA')
      await screen.findByRole('heading', { name: 'Eau de Parfum 50ml' })

      definirConexao(false)
      fireEvent(window, new Event('offline'))
      await screen.findByRole('heading', { name: /sem conexão com o servidor/i })

      definirConexao(true)
      fireEvent(window, new Event('online'))
      await screen.findByLabelText(/busque por nome/i)

      // A unidade pode ter sido vendida enquanto a conexão esteve fora.
      expect(screen.queryByRole('heading', { name: 'Eau de Parfum 50ml' })).toBeNull()
    })

    it('cai no portão se a rede some durante a consulta', async () => {
      let saudavel = true
      buscar.mockImplementation(async (entrada) => {
        const caminho = String(entrada).replace('http://localhost:3333', '')
        if (caminho === '/health' && saudavel) return respostaFalsa(200, { status: 'ok', uptime: 1 })
        throw new TypeError('Failed to fetch')
      })
      montar()
      await screen.findByLabelText(/busque por nome/i)
      saudavel = false

      await digitar('PRF-AAAAAA')

      await waitFor(() =>
        expect(screen.getByRole('heading', { name: /sem conexão com o servidor/i })).toBeInTheDocument(),
      )
    })
  })

  describe('busca por produto (T49)', () => {
    const TINTA = produto('tinta', {
      nome: 'Alta Moda 6.1',
      codigoInterno: '7891000325858',
      emEstoque: 3,
    })
    const ESTOQUE_DA_TINTA = estoqueDe(TINTA, [
      unidadeEmEstoque('PRF-VVVVVV', -2, 'VENCIDA', '2026-11-10'),
      unidadeEmEstoque('PRF-HHHHHH', 0, 'ATE_7_DIAS', '2026-11-12'),
      unidadeEmEstoque('PRF-LLLLLL', 1, 'ATE_7_DIAS', '2026-11-13'),
    ])

    it('código de barras de um produto só abre direto o produto com as unidades em estoque', async () => {
      simular(
        {},
        {
          buscas: { '7891000325858': { produtos: [TINTA], total: 1 } },
          estoques: { tinta: ESTOQUE_DA_TINTA },
        },
      )
      montar()

      await digitar('7891000325858')

      expect(await screen.findByRole('heading', { name: 'Alta Moda 6.1' })).toBeInTheDocument()
      expect(screen.getByText('Alfaparf')).toBeInTheDocument()
      expect(screen.getByText('Coloração')).toBeInTheDocument()
      expect(screen.getByText('7891000325858')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: '3 unidades em estoque' })).toBeInTheDocument()
      // Veio direto, sem lista: não há para onde voltar.
      expect(screen.queryByRole('button', { name: /voltar/i })).toBeNull()
    })

    it('cada unidade traz o código, a validade e o distintivo da faixa que o servidor deu', async () => {
      simular(
        {},
        {
          buscas: { '7891000325858': { produtos: [TINTA], total: 1 } },
          estoques: { tinta: ESTOQUE_DA_TINTA },
        },
      )
      montar()

      await digitar('7891000325858')
      const linhas = within(await screen.findByRole('list')).getAllByRole('listitem')

      expect(linhas.map((linha) => linha.textContent)).toEqual([
        'PRF-VVVVVVValidade 10/11/2026vencida há 2 dias',
        'PRF-HHHHHHValidade 12/11/2026vence hoje',
        'PRF-LLLLLLValidade 13/11/2026vence em 1 dia',
      ])
      expect(within(linhas[0]!).getByText('vencida há 2 dias')).toHaveClass('distintivo', 'faixa-vencida')
      expect(within(linhas[1]!).getByText('vence hoje')).toHaveClass('faixa-ate_7_dias')
      // Ordem de leitura, não veredito: nada marca a próxima a sair (RNF03).
      expect(screen.queryByText(/próxima/i)).toBeNull()
    })

    it('nome com vários produtos mostra a lista, e escolher um abre o estoque dele', async () => {
      const outra = produto('outra', { nome: 'Alta Moda 7.0', ativo: false, emEstoque: 1 })
      simular(
        {},
        {
          buscas: { 'alta moda': { produtos: [TINTA, outra], total: 2 } },
          estoques: { tinta: ESTOQUE_DA_TINTA },
        },
      )
      montar()

      await digitar('alta moda')

      expect(
        await screen.findByRole('heading', { name: '2 produtos para “alta moda”' }),
      ).toBeInTheDocument()
      const opcao = screen.getByRole('button', { name: /Alta Moda 7\.0/ })
      expect(opcao).toHaveTextContent('Inativo')
      expect(opcao).toHaveTextContent('1 em estoque')
      expect(screen.getByRole('button', { name: /Alta Moda 6\.1/ })).toHaveTextContent('3 em estoque')

      fireEvent.click(screen.getByRole('button', { name: /Alta Moda 6\.1/ }))

      expect(await screen.findByRole('heading', { name: '3 unidades em estoque' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Voltar à lista' }))
      expect(screen.getByRole('heading', { name: '2 produtos para “alta moda”' })).toBeInTheDocument()
    })

    it('avisa quando a lista não traz todos os produtos', async () => {
      const produtos = Array.from({ length: 20 }, (_, i) => produto(`p${i}`))
      simular({}, { buscas: { tom: { produtos, total: 25 } } })
      montar()

      await digitar('tom')

      expect(await screen.findByText(/Mostrando 20 de 25/)).toBeInTheDocument()
    })

    it('produto sem estoque e inativo diz as duas coisas', async () => {
      const parado = produto('parado', { nome: 'Henna Pó', ativo: false })
      simular(
        {},
        {
          buscas: { henna: { produtos: [parado], total: 1 } },
          estoques: { parado: estoqueDe(parado) },
        },
      )
      montar()

      await digitar('henna')

      expect(
        await screen.findByRole('heading', { name: 'Nenhuma unidade em estoque' }),
      ).toBeInTheDocument()
      expect(screen.getByText(/Produto inativo no catálogo/)).toBeInTheDocument()
    })

    it('a câmera lê o código de barras da embalagem e abre o produto', async () => {
      simular(
        {},
        {
          buscas: { '7891000325858': { produtos: [TINTA], total: 1 } },
          estoques: { tinta: ESTOQUE_DA_TINTA },
        },
      )
      montar()
      await ligarCamera()

      apontarCamera('7891000325858')

      expect(await screen.findByRole('heading', { name: 'Alta Moda 6.1' })).toBeInTheDocument()
      expect(screen.getByTestId('camera-dublada')).toBeInTheDocument()
    })

    it('falha ao carregar o estoque mostra a mensagem do servidor', async () => {
      simular({}, { buscas: { sumiu: { produtos: [produto('sumiu')], total: 1 } } })
      montar()

      await digitar('sumiu')

      expect(await screen.findByRole('alert')).toHaveTextContent('Produto não encontrado.')
    })
  })
})
