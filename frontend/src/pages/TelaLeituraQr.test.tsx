import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaLeituraQr } from './TelaLeituraQr'
import { respostaFalsa } from '../services/testes/respostaFalsa'

/**
 * A câmera é substituída por um dublê. `html5-qrcode` depende de
 * `getUserMedia` e de decodificação de imagem, e nenhum dos dois existe em
 * jsdom — é por isso que `LeitorCamera.tsx` faz uma coisa só, e é por isso que
 * o caminho da câmera precisa de conferência em celular real (T10, Decisão 3).
 *
 * O dublê expõe dois botões: um simula um quadro decodificado, o outro simula
 * a câmera indisponível.
 */
const camera = vi.hoisted(() => ({ codigo: 'PRF-AAAAAA' }))

vi.mock('../components/LeitorCamera', () => ({
  LeitorCamera: ({
    aoLer,
    aoFalhar,
  }: {
    aoLer: (texto: string) => void
    aoFalhar: (mensagem: string) => void
  }) => (
    <div data-testid="camera-dublada">
      <button type="button" onClick={() => aoLer(camera.codigo)}>
        simular quadro
      </button>
      <button type="button" onClick={() => aoFalhar('Permissão de câmera negada.')}>
        simular falha de câmera
      </button>
    </div>
  ),
}))

const buscar = vi.fn<typeof fetch>()

function unidade(codigoQr: string, dataValidade: string) {
  return {
    id: `unidade-${codigoQr}`,
    codigoQr,
    dataValidade,
    produto: {
      id: 'produto-1',
      codigoInterno: 'PRF-001',
      nome: 'Eau de Parfum 50ml',
      marca: 'Marca Exemplo',
    },
  }
}

const CONFIRMADO = {
  veredito: 'CONFIRMAR',
  codigoQr: 'PRF-AAAAAA',
  unidade: unidade('PRF-AAAAAA', '2026-11-30'),
  mensagem: 'Saída registrada: Eau de Parfum 50ml (Marca Exemplo), validade 30/11/2026.',
}

const BLOQUEADO = {
  veredito: 'BLOQUEAR_FIFO',
  codigoQr: 'PRF-ZZZZZZ',
  unidadeLida: unidade('PRF-ZZZZZZ', '2027-05-10'),
  unidadeCorreta: unidade('PRF-AAAAAA', '2026-11-30'),
  tentativas: 1,
  mensagem:
    'Devolva esta unidade à prateleira (validade 10/05/2027). Saia primeiro com a de validade 30/11/2026 — código PRF-AAAAAA.',
}

const VENCIDO = {
  veredito: 'EXCECAO_VENCIDO',
  codigoQr: 'PRF-VVVVVV',
  unidade: unidade('PRF-VVVVVV', '2026-08-01'),
  mensagem:
    'Eau de Parfum 50ml (Marca Exemplo) venceu em 01/08/2026. Esta unidade não sai pelo fluxo normal.',
}

const NAO_ENCONTRADO = {
  veredito: 'ERRO',
  motivo: 'QR_NAO_ENCONTRADO',
  codigoQr: 'PRF-XXXXXX',
  mensagem: 'Código não cadastrado. Confira a etiqueta ou digite o código impresso abaixo do QR.',
}

const BACKEND_DE_PE = () => respostaFalsa(200, { status: 'ok', uptime: 1 })

/** Responde `/health` e devolve as leituras na ordem em que forem pedidas. */
function comLeituras(...vereditos: unknown[]) {
  let proxima = 0
  buscar.mockImplementation(async (entrada, init) => {
    const caminho = String(entrada).replace('http://localhost:3333', '')
    if (caminho === '/health') return BACKEND_DE_PE()
    if (caminho === '/saidas/ler' && init?.method === 'POST') {
      const veredito = vereditos[Math.min(proxima, vereditos.length - 1)]
      proxima += 1
      return respostaFalsa(200, veredito)
    }
    throw new Error(`rota não simulada no teste: ${init?.method ?? 'GET'} ${caminho}`)
  })
}

/** Corpos das leituras enviadas, na ordem. */
function leiturasEnviadas(): Array<{ codigoQr: string; sessaoVendaId?: string }> {
  return buscar.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

/** A n-ésima leitura enviada, falhando alto se ela não existir. */
function leituraEnviada(indice: number): { codigoQr: string; sessaoVendaId?: string } {
  const enviadas = leiturasEnviadas()
  const corpo = enviadas[indice]
  if (!corpo) {
    throw new Error(`esperava ao menos ${indice + 1} leitura(s); houve ${enviadas.length}`)
  }
  return corpo
}

function definirConexao(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online })
}

/** Digita um código no fallback manual e envia. */
async function digitarCodigo(codigo: string) {
  fireEvent.change(await screen.findByLabelText(/digite o código/i), {
    target: { value: codigo },
  })
  fireEvent.click(screen.getByRole('button', { name: /ler código/i }))
}

describe('TelaLeituraQr (RF05, RF06, RNF07)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
    definirConexao(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    definirConexao(true)
  })

  describe('os quatro vereditos, cada um com seu layout', () => {
    it('mostra a saída registrada quando o servidor confirma', async () => {
      comLeituras(CONFIRMADO)
      render(<TelaLeituraQr />)

      await digitarCodigo('PRF-AAAAAA')

      expect(await screen.findByRole('heading', { name: /saída registrada/i })).toBeInTheDocument()
      // A mensagem é a que o servidor escreveu, exibida como veio (RNF04).
      expect(screen.getByText(CONFIRMADO.mensagem)).toBeInTheDocument()
      expect(screen.getByText('30/11/2026')).toBeInTheDocument()
    })

    it('destaca o código da unidade correta e as duas validades no bloqueio FIFO', async () => {
      comLeituras(BLOQUEADO)
      render(<TelaLeituraQr />)

      await digitarCodigo('PRF-ZZZZZZ')

      expect(await screen.findByRole('heading', { name: /não é esta unidade/i })).toBeInTheDocument()
      expect(screen.getByText(BLOQUEADO.mensagem)).toBeInTheDocument()
      // Os dois lados do bloqueio: o frasco na mão e o que deve sair.
      expect(screen.getByRole('heading', { name: /na sua mão/i })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /saia com esta/i })).toBeInTheDocument()
      expect(screen.getByText('10/05/2027')).toBeInTheDocument()
      expect(screen.getByText('30/11/2026')).toBeInTheDocument()
      expect(screen.getByText(/tentativa 1 neste produto/i)).toBeInTheDocument()
    })

    it('informa a unidade vencida sem oferecer ação — os três caminhos são T11', async () => {
      comLeituras(VENCIDO)
      render(<TelaLeituraQr />)

      await digitarCodigo('PRF-VVVVVV')

      expect(await screen.findByRole('heading', { name: /unidade vencida/i })).toBeInTheDocument()
      expect(screen.getByText(VENCIDO.mensagem)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /descartar|corrigir|autorizar/i })).toBeNull()
    })

    it('mostra o código não encontrado sem tratá-lo como falha da tela', async () => {
      comLeituras(NAO_ENCONTRADO)
      render(<TelaLeituraQr />)

      await digitarCodigo('PRF-XXXXXX')

      expect(
        await screen.findByRole('heading', { name: /código não encontrado/i }),
      ).toBeInTheDocument()
      expect(screen.getByText(NAO_ENCONTRADO.mensagem)).toBeInTheDocument()
    })
  })

  describe('laço de revalidação (RF06)', () => {
    it('bloqueia, aceita a segunda leitura e confirma, na mesma montagem', async () => {
      comLeituras(BLOQUEADO, CONFIRMADO)
      render(<TelaLeituraQr />)

      await digitarCodigo('PRF-ZZZZZZ')
      await screen.findByRole('heading', { name: /não é esta unidade/i })

      // O laço é a ausência de estado: a tela não guarda nada entre uma
      // leitura e outra, só manda o próximo código.
      await digitarCodigo('PRF-AAAAAA')

      expect(await screen.findByRole('heading', { name: /saída registrada/i })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /não é esta unidade/i })).toBeNull()
      expect(leiturasEnviadas().map((corpo) => corpo.codigoQr)).toEqual([
        'PRF-ZZZZZZ',
        'PRF-AAAAAA',
      ])
    })

    it('manda o código como foi digitado, sem normalizar no cliente', async () => {
      comLeituras(NAO_ENCONTRADO)
      render(<TelaLeituraQr />)

      await digitarCodigo('prf-aaaaaa')

      // Quem normaliza (maiúsculas, Crockford) é `codigoQr.ts` no backend,
      // dono único do formato desde T08. Normalizar aqui também criaria um
      // segundo dono.
      await waitFor(() => expect(leituraEnviada(0).codigoQr).toBe('prf-aaaaaa'))
    })
  })

  describe('agrupador de atendimento (sessaoVendaId)', () => {
    it('repete o mesmo agrupador em todas as leituras do ciclo, inclusive na bloqueada', async () => {
      comLeituras(BLOQUEADO, CONFIRMADO)
      render(<TelaLeituraQr />)

      await digitarCodigo('PRF-ZZZZZZ')
      await screen.findByRole('heading', { name: /não é esta unidade/i })
      await digitarCodigo('PRF-AAAAAA')
      await screen.findByRole('heading', { name: /saída registrada/i })

      expect(leituraEnviada(0).sessaoVendaId).toBeTruthy()
      expect(leituraEnviada(1).sessaoVendaId).toBe(leituraEnviada(0).sessaoVendaId)
    })

    it('não troca de atendimento depois de uma confirmação — um cliente leva vários itens', async () => {
      comLeituras(CONFIRMADO, CONFIRMADO)
      render(<TelaLeituraQr />)

      await digitarCodigo('PRF-AAAAAA')
      await screen.findByRole('heading', { name: /saída registrada/i })
      await digitarCodigo('PRF-BBBBBB')
      await waitFor(() => expect(leiturasEnviadas()).toHaveLength(2))

      expect(leituraEnviada(1).sessaoVendaId).toBe(leituraEnviada(0).sessaoVendaId)
    })

    it('troca de agrupador ao encerrar o atendimento', async () => {
      comLeituras(CONFIRMADO, CONFIRMADO)
      render(<TelaLeituraQr />)

      await digitarCodigo('PRF-AAAAAA')
      await screen.findByRole('heading', { name: /saída registrada/i })

      fireEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }))
      await digitarCodigo('PRF-BBBBBB')
      await waitFor(() => expect(leiturasEnviadas()).toHaveLength(2))

      expect(leituraEnviada(1).sessaoVendaId).not.toBe(leituraEnviada(0).sessaoVendaId)
    })
  })

  describe('câmera', () => {
    it('não conta a rajada de quadros do mesmo frasco como leituras diferentes', async () => {
      comLeituras(CONFIRMADO)
      render(<TelaLeituraQr />)

      fireEvent.click(await screen.findByRole('button', { name: /ligar câmera/i }))
      const quadro = screen.getByRole('button', { name: /simular quadro/i })

      fireEvent.click(quadro)
      await screen.findByRole('heading', { name: /saída registrada/i })
      fireEvent.click(quadro)
      fireEvent.click(quadro)

      // Cada disparo viraria um `LEITURA_QR_SAIDA` e inflaria o denominador
      // da taxa de acerto na primeira leitura (RF12).
      await waitFor(() => expect(leiturasEnviadas()).toHaveLength(1))
    })

    it('aponta o fallback manual quando a câmera não abre', async () => {
      comLeituras(CONFIRMADO)
      render(<TelaLeituraQr />)

      fireEvent.click(await screen.findByRole('button', { name: /ligar câmera/i }))
      fireEvent.click(screen.getByRole('button', { name: /simular falha de câmera/i }))

      expect(await screen.findByRole('alert')).toHaveTextContent(/permissão de câmera negada/i)
      // O caminho digitado nunca esteve escondido — é o da etiqueta riscada.
      expect(screen.getByLabelText(/digite o código/i)).toBeInTheDocument()
    })
  })

  describe('offline (RNF07)', () => {
    it('bloqueia a leitura e explica por quê quando o navegador está sem rede', async () => {
      definirConexao(false)
      comLeituras(CONFIRMADO)

      render(<TelaLeituraQr />)

      expect(await screen.findByRole('alert')).toHaveTextContent(/sem conexão com o servidor/i)
      // Sem campo e sem câmera: não existe leitura offline, e oferecer o campo
      // sugeriria que existe.
      expect(screen.queryByLabelText(/digite o código/i)).toBeNull()
      expect(screen.queryByRole('button', { name: /ligar câmera/i })).toBeNull()
      // Nada foi enfileirado para enviar depois — quem decide o veredito é o
      // servidor, e um veredito guardado não valeria mais quando chegasse.
      expect(leiturasEnviadas()).toHaveLength(0)
    })

    it('bloqueia também quando há rede mas o backend não responde', async () => {
      buscar.mockImplementation(async () => {
        throw new TypeError('Failed to fetch')
      })

      render(<TelaLeituraQr />)

      // `navigator.onLine` só sabe que existe uma rede, não que ela chega ao
      // servidor: por isso o portão tem dois sinais.
      expect(await screen.findByRole('alert')).toHaveTextContent(/sem conexão com o servidor/i)
    })

    it('descarta o veredito anterior ao perder a conexão', async () => {
      comLeituras(BLOQUEADO)
      render(<TelaLeituraQr />)

      await digitarCodigo('PRF-ZZZZZZ')
      await screen.findByRole('heading', { name: /não é esta unidade/i })

      definirConexao(false)
      fireEvent(window, new Event('offline'))
      await screen.findByRole('heading', { name: /sem conexão com o servidor/i })

      definirConexao(true)
      fireEvent(window, new Event('online'))
      await screen.findByLabelText(/digite o código/i)

      // Enquanto a conexão esteve fora, outra atendente pode ter vendido
      // aquela unidade: o veredito antigo não é mais afirmável.
      expect(screen.queryByRole('heading', { name: /não é esta unidade/i })).toBeNull()
    })

    it('libera a leitura quando a conexão volta', async () => {
      definirConexao(false)
      comLeituras(CONFIRMADO)

      render(<TelaLeituraQr />)
      await screen.findByRole('alert')

      definirConexao(true)
      fireEvent(window, new Event('online'))

      expect(await screen.findByLabelText(/digite o código/i)).toBeInTheDocument()
    })

    it('cai no mesmo bloqueio quando a rede some no meio da leitura', async () => {
      let saudeOk = true
      buscar.mockImplementation(async (entrada, init) => {
        const caminho = String(entrada).replace('http://localhost:3333', '')
        if (caminho === '/health') {
          if (!saudeOk) throw new TypeError('Failed to fetch')
          return BACKEND_DE_PE()
        }
        if (caminho === '/saidas/ler' && init?.method === 'POST') {
          saudeOk = false
          throw new TypeError('Failed to fetch')
        }
        throw new Error(`rota não simulada: ${caminho}`)
      })

      render(<TelaLeituraQr />)
      await digitarCodigo('PRF-AAAAAA')

      // Nenhum veredito inventado pela tela: ela diz que não deu para falar
      // com o servidor e volta ao estado bloqueado.
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: /sem conexão com o servidor/i })).toBeInTheDocument(),
      )
    })
  })
})
