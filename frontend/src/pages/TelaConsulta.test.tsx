import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaConsulta } from './TelaConsulta'
import { respostaFalsa } from '../services/testes/respostaFalsa'

/**
 * A câmera é substituída por um dublê, pelo mesmo motivo da tela de Venda:
 * `html5-qrcode` precisa de `getUserMedia`, que jsdom não tem. O dublê entrega
 * o código que o teste pedir, quantas vezes pedir — que é o que a câmera
 * contínua faz com o frasco parado na frente dela.
 */
const camera = vi.hoisted(() => ({ modo: null as string | null }))

vi.mock('../components/LeitorCamera', () => ({
  LeitorCamera: function LeitorCameraDublado({
    aoLer,
    aoFalhar,
    modo = 'continua',
  }: {
    aoLer: (texto: string) => void
    aoFalhar: (mensagem: string) => void
    modo?: 'unica' | 'continua'
  }) {
    camera.modo = modo
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

const NAO_ENCONTRADO = {
  erro: 'QR_NAO_ENCONTRADO',
  mensagem: 'Código não cadastrado. Confira a etiqueta ou digite o código impresso abaixo do QR.',
}

/**
 * Responde `/health` e as consultas. `respostas` é por código, já decodificado
 * da URL; código sem resposta é 404.
 */
function simular(respostas: Record<string, unknown>) {
  buscar.mockImplementation(async (entrada) => {
    const caminho = String(entrada).replace('http://localhost:3333', '')
    if (caminho === '/health') return respostaFalsa(200, { status: 'ok', uptime: 1 })

    const prefixo = '/unidades/consulta/'
    if (caminho.startsWith(prefixo)) {
      const codigo = decodeURIComponent(caminho.slice(prefixo.length))
      const corpo = respostas[codigo]
      return corpo ? respostaFalsa(200, corpo) : respostaFalsa(404, NAO_ENCONTRADO)
    }
    throw new Error(`requisição inesperada: ${caminho}`)
  })
}

function consultasEnviadas(): string[] {
  return buscar.mock.calls
    .map(([entrada]) => String(entrada).replace('http://localhost:3333', ''))
    .filter((caminho) => caminho.startsWith('/unidades/consulta/'))
}

function definirConexao(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online })
}

async function digitar(codigo: string) {
  fireEvent.change(await screen.findByLabelText(/digite o código/i), { target: { value: codigo } })
  fireEvent.click(screen.getByRole('button', { name: /^consultar$/i }))
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
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    definirConexao(true)
  })

  it('deixa claro que consultar não dá baixa', async () => {
    simular({})
    render(<TelaConsulta />)

    expect(await screen.findByText(/consultar não dá baixa/i)).toBeInTheDocument()
  })

  describe('o cartão da unidade', () => {
    it('mostra produto, validade, dias para vencer e situação no estoque', async () => {
      simular({ 'PRF-AAAAAA': consulta('PRF-AAAAAA') })
      render(<TelaConsulta />)

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

    it('destaca a unidade vencida pelo campo situacao do servidor', async () => {
      simular({
        'PRF-VVVVVV': consulta('PRF-VVVVVV', { situacao: 'VENCIDA', diasParaVencer: -3 }),
      })
      render(<TelaConsulta />)

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
      render(<TelaConsulta />)

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
      render(<TelaConsulta />)

      await digitar('PRF-BBBBBB')

      expect(await screen.findByText(rotulo)).toBeInTheDocument()
    })

    it('avisa quando o produto está inativo', async () => {
      simular({ 'PRF-AAAAAA': consulta('PRF-AAAAAA', { ativo: false }) })
      render(<TelaConsulta />)

      await digitar('PRF-AAAAAA')

      expect(await screen.findByText(/produto inativo/i)).toBeInTheDocument()
    })

    it('mostra a mensagem do servidor para código inexistente, no lugar do resultado anterior', async () => {
      simular({ 'PRF-AAAAAA': consulta('PRF-AAAAAA') })
      render(<TelaConsulta />)

      await digitar('PRF-AAAAAA')
      await screen.findByRole('heading', { name: 'Eau de Parfum 50ml' })

      await digitar('PRF-XXXXXX')

      expect(await screen.findByRole('alert')).toHaveTextContent(/código não cadastrado/i)
      expect(screen.queryByRole('heading', { name: 'Eau de Parfum 50ml' })).toBeNull()
    })

    it('envia o código como foi digitado, sem normalizar', async () => {
      simular({})
      render(<TelaConsulta />)

      await digitar('prf-aaaaaa')

      await screen.findByRole('alert')
      // Quem normaliza é o backend (T08); o espaço nas pontas é só aparado.
      expect(consultasEnviadas()).toEqual(['/unidades/consulta/prf-aaaaaa'])
    })
  })

  describe('câmera contínua', () => {
    it('usa o leitor no modo contínuo', async () => {
      simular({})
      render(<TelaConsulta />)

      await ligarCamera()

      expect(camera.modo).toBe('continua')
    })

    it('uma leitura nova substitui a anterior, sem desligar a câmera', async () => {
      simular({
        'PRF-AAAAAA': consulta('PRF-AAAAAA'),
        'PRF-BBBBBB': consulta('PRF-BBBBBB', { nome: 'Body Splash 200ml' }),
      })
      render(<TelaConsulta />)
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
      render(<TelaConsulta />)
      await ligarCamera()

      apontarCamera('PRF-AAAAAA')
      await screen.findByRole('heading', { name: 'Eau de Parfum 50ml' })
      apontarCamera('PRF-AAAAAA')
      apontarCamera('PRF-AAAAAA')

      expect(consultasEnviadas()).toHaveLength(1)
    })

    it('também não repete a consulta do código que não foi encontrado', async () => {
      simular({})
      render(<TelaConsulta />)
      await ligarCamera()

      apontarCamera('PRF-XXXXXX')
      await screen.findByRole('alert')
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
      render(<TelaConsulta />)
      await ligarCamera()

      apontarCamera('PRF-AAAAAA')
      apontarCamera('PRF-BBBBBB')
      apontarCamera('PRF-AAAAAA')
      liberar(respostaFalsa(200, consulta('PRF-AAAAAA')))

      await screen.findByRole('heading', { name: 'Eau de Parfum 50ml' })
      expect(consultasEnviadas()).toHaveLength(1)
    })

    it('mostra a falha da câmera e mantém a digitação', async () => {
      simular({})
      render(<TelaConsulta />)
      await ligarCamera()

      fireEvent.click(screen.getByRole('button', { name: /simular falha de câmera/i }))

      expect(await screen.findByRole('alert')).toHaveTextContent(/permissão de câmera negada/i)
      expect(screen.queryByTestId('camera-dublada')).toBeNull()
      expect(screen.getByLabelText(/digite o código/i)).toBeInTheDocument()
    })
  })

  describe('offline (RNF07)', () => {
    it('bloqueia a consulta sem rede, sem enviar nada', async () => {
      definirConexao(false)
      simular({})
      render(<TelaConsulta />)

      expect(await screen.findByRole('alert')).toHaveTextContent(/sem conexão com o servidor/i)
      expect(screen.queryByLabelText(/digite o código/i)).toBeNull()
      expect(screen.queryByRole('button', { name: /ligar câmera/i })).toBeNull()
      expect(consultasEnviadas()).toHaveLength(0)
    })

    it('apaga o resultado ao perder a conexão', async () => {
      simular({ 'PRF-AAAAAA': consulta('PRF-AAAAAA') })
      render(<TelaConsulta />)

      await digitar('PRF-AAAAAA')
      await screen.findByRole('heading', { name: 'Eau de Parfum 50ml' })

      definirConexao(false)
      fireEvent(window, new Event('offline'))
      await screen.findByRole('heading', { name: /sem conexão com o servidor/i })

      definirConexao(true)
      fireEvent(window, new Event('online'))
      await screen.findByLabelText(/digite o código/i)

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
      render(<TelaConsulta />)
      await screen.findByLabelText(/digite o código/i)
      saudavel = false

      await digitar('PRF-AAAAAA')

      await waitFor(() =>
        expect(screen.getByRole('heading', { name: /sem conexão com o servidor/i })).toBeInTheDocument(),
      )
    })
  })
})
