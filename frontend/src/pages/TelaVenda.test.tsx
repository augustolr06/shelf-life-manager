import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaVenda } from './TelaVenda'
import { ProvedorConfirmacao } from '../components/DialogoConfirmacao'
import type { Usuario } from '../services/auth'
import { encontrarConfirmacao, responderConfirmacao } from '../services/testes/confirmacao'
import { respostaFalsa } from '../services/testes/respostaFalsa'

/**
 * A câmera é substituída por um dublê. `html5-qrcode` depende de
 * `getUserMedia` e de decodificação de imagem, e nenhum dos dois existe em
 * jsdom — é por isso que `LeitorCamera.tsx` faz uma coisa só, e é por isso que
 * o caminho da câmera precisa de conferência em celular real (T10, Decisão 3).
 *
 * O dublê expõe três botões: um simula um quadro decodificado, respeitando o
 * modo como o leitor real (no `'unica'`, só o primeiro quadro da montagem
 * chega à tela); outro simula um leitor que falhou em parar e entrega a rajada
 * inteira; o último simula a câmera indisponível.
 */
const camera = vi.hoisted(() => ({ codigo: 'PRF-AAAAAA', modo: null as string | null }))

vi.mock('../components/LeitorCamera', async () => {
  const { useRef } = await import('react')

  return {
    LeitorCamera: function LeitorCameraDublado({
      aoLer,
      aoFalhar,
      modo = 'continua',
    }: {
      aoLer: (texto: string) => void
      aoFalhar: (mensagem: string) => void
      modo?: 'unica' | 'continua'
    }) {
      const jaLeu = useRef(false)
      camera.modo = modo

      function quadro() {
        if (modo === 'unica' && jaLeu.current) return
        jaLeu.current = true
        aoLer(camera.codigo)
      }

      return (
        <div data-testid="camera-dublada">
          <button type="button" onClick={quadro}>
            simular quadro
          </button>
          <button
            type="button"
            onClick={() => {
              aoLer(camera.codigo)
              aoLer(camera.codigo)
              aoLer(camera.codigo)
            }}
          >
            simular leitor que não parou
          </button>
          <button type="button" onClick={() => aoFalhar('Permissão de câmera negada.')}>
            simular falha de câmera
          </button>
        </div>
      )
    },
  }
})

const buscar = vi.fn<typeof fetch>()

/**
 * O papel só muda uma coisa nesta tela: quais dos três caminhos da unidade
 * vencida aparecem (T12). Todo o resto — vereditos, laço, agrupador, offline —
 * é igual para os dois, e por isso a montagem padrão é a da atendente, que é
 * quem opera o balcão.
 */
const ATENDENTE: Usuario = {
  id: 'usuario-atendente',
  nome: 'Ana Atendente',
  email: 'ana@estoque.local',
  papel: 'ATENDENTE',
}

const GESTOR: Usuario = {
  id: 'usuario-gestor',
  nome: 'Gabriela Gestora',
  email: 'gabriela@estoque.local',
  papel: 'GESTOR',
}

/**
 * Com o provedor que o `App` monta: descarte, override, confirmação da venda e
 * esvaziamento do carrinho pedem confirmação (T39, T34).
 */
function montarTela(usuario: Usuario = ATENDENTE) {
  return render(
    <ProvedorConfirmacao>
      <TelaVenda usuario={usuario} />
    </ProvedorConfirmacao>,
  )
}

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

/**
 * `CONFIRMAR` da leitura: desde T33b, "pode ser vendida", e nada saiu do
 * estoque. O código entra na mensagem para que cada unidade tenha um texto
 * próprio na tela.
 */
function liberada(codigoQr: string, dataValidade = '2026-11-30') {
  return {
    veredito: 'CONFIRMAR',
    codigoQr,
    unidade: unidade(codigoQr, dataValidade),
    mensagem: `Pode ser vendida: Eau de Parfum 50ml (Marca Exemplo), código ${codigoQr}.`,
  }
}

/** `CONFIRMAR` da confirmação do carrinho: aqui, sim, a unidade foi vendida. */
function vendida(codigoQr: string) {
  return {
    unidadeId: `unidade-${codigoQr}`,
    veredito: 'CONFIRMAR',
    codigoQr,
    unidade: unidade(codigoQr, '2026-11-30'),
    mensagem: `Venda registrada: Eau de Parfum 50ml (Marca Exemplo), código ${codigoQr}.`,
  }
}

const CONFIRMADO = liberada('PRF-AAAAAA')

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

/** A mesma unidade vencida, corrigida para outra data também no passado. */
const VENCIDO_DE_NOVO = {
  veredito: 'EXCECAO_VENCIDO',
  codigoQr: 'PRF-VVVVVV',
  unidade: unidade('PRF-VVVVVV', '2026-09-01'),
  mensagem:
    'Eau de Parfum 50ml (Marca Exemplo) venceu em 01/09/2026. Esta unidade não sai pelo fluxo normal.',
}

/** Respostas dos três caminhos da exceção, como T11 as devolve. */
const DESCARTE_FEITO = {
  resultado: 'DESCARTE_REGISTRADO',
  unidade: unidade('PRF-VVVVVV', '2026-08-01'),
  descarte: {
    id: 'descarte-1',
    dataHora: '2026-09-08T13:00:00.000Z',
    motivo: 'Unidade vencida constatada na leitura de saída.',
  },
  mensagem:
    'Descarte registrado: Eau de Parfum 50ml (Marca Exemplo), validade 01/08/2026. ' +
    'A unidade saiu do estoque e entra no relatório de perdas.',
}

const OVERRIDE_FEITO = {
  resultado: 'VENDA_VENCIDA_AUTORIZADA',
  unidade: unidade('PRF-VVVVVV', '2026-08-01'),
  saida: {
    id: 'saida-1',
    dataHora: '2026-09-08T13:05:00.000Z',
    justificativa: 'Cliente ciente, peça de mostruário.',
    autorizadoPor: { id: GESTOR.id, nome: GESTOR.nome },
  },
  mensagem:
    'Venda de unidade vencida autorizada por Gabriela Gestora: Eau de Parfum 50ml ' +
    '(Marca Exemplo), validade 01/08/2026. O registro desta autorização é permanente.',
}

/** A correção devolve `{ correcao, revalidacao }` — o veredito novo vem dentro. */
function correcaoCom(revalidacao: unknown) {
  return {
    correcao: { dataValidadeAnterior: '2026-08-01', dataValidadeNova: '2027-08-01' },
    revalidacao,
  }
}

/** Os dois 4xx de T11 que a tela precisa distinguir. */
const JA_BAIXADA = {
  erro: 'UNIDADE_JA_BAIXADA',
  mensagem: 'Esta unidade já saiu do estoque — foi vendida ou descartada. Nada a resolver.',
}

const VALIDADE_INALTERADA = {
  erro: 'VALIDADE_INALTERADA',
  mensagem: 'A validade informada é igual à que já está cadastrada. Não há o que corrigir.',
}

const BACKEND_DE_PE = () => respostaFalsa(200, { status: 'ok', uptime: 1 })

type Caminho = 'corrigir' | 'descartar' | 'override'
type Resposta = { status: number; corpo: unknown }

/**
 * Responde `/health`, as leituras, a confirmação do carrinho (T33b) e os três
 * caminhos da exceção (T11).
 *
 * As leituras vêm de `vereditos`, na ordem em que forem pedidas; sem lista, cada
 * código lido é liberado com a unidade de mesmo código, que é o caso comum de
 * quem monta um carrinho. Cada caminho da exceção recebe status e corpo
 * próprios, porque o que se quer provar muda: sucesso no descarte, recusa de
 * pré-condição no 409, recusa de dado inalterado no 400.
 */
function simular({
  vereditos,
  finalizar,
  excecao = {},
}: {
  vereditos?: unknown[]
  finalizar?: Resposta
  excecao?: Partial<Record<Caminho, Resposta>>
}) {
  let proxima = 0
  buscar.mockImplementation(async (entrada, init) => {
    const caminho = String(entrada).replace('http://localhost:3333', '')
    if (caminho === '/health') return BACKEND_DE_PE()

    if (caminho === '/saidas/ler' && init?.method === 'POST') {
      if (!vereditos) {
        const { codigoQr } = JSON.parse(String(init.body)) as { codigoQr: string }
        return respostaFalsa(200, liberada(codigoQr))
      }
      const veredito = vereditos[Math.min(proxima, vereditos.length - 1)]
      proxima += 1
      return respostaFalsa(200, veredito)
    }

    if (caminho === '/saidas/finalizar' && init?.method === 'POST' && finalizar) {
      return respostaFalsa(finalizar.status, finalizar.corpo)
    }

    const acao = caminho.replace('/excecao-vencido/', '') as Caminho
    const resposta = excecao[acao]
    if (caminho.startsWith('/excecao-vencido/') && resposta) {
      return respostaFalsa(resposta.status, resposta.corpo)
    }

    throw new Error(`rota não simulada no teste: ${init?.method ?? 'GET'} ${caminho}`)
  })
}

/** Só leituras, na ordem dada. */
function comLeituras(...vereditos: unknown[]) {
  simular({ vereditos })
}

/** Corpos enviados a um caminho da API, na ordem. */
function enviosPara<T = Record<string, unknown>>(sufixo: string): T[] {
  return buscar.mock.calls
    .filter(([entrada]) => String(entrada).endsWith(sufixo))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as T)
}

type CorpoLeitura = { codigoQr: string; sessaoVendaId?: string; noCarrinho?: string[] }

/** Corpos das leituras enviadas, na ordem. */
function leiturasEnviadas(): CorpoLeitura[] {
  return enviosPara<CorpoLeitura>('/saidas/ler')
}

/** A n-ésima leitura enviada, falhando alto se ela não existir. */
function leituraEnviada(indice: number): CorpoLeitura {
  const enviadas = leiturasEnviadas()
  const corpo = enviadas[indice]
  if (!corpo) {
    throw new Error(`esperava ao menos ${indice + 1} leitura(s); houve ${enviadas.length}`)
  }
  return corpo
}

function confirmacoesEnviadas() {
  return enviosPara<{ unidadeIds: string[]; sessaoVendaId?: string }>('/saidas/finalizar')
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

/** Lê um código que o servidor libera e espera ele entrar no carrinho. */
async function adicionar(codigo: string) {
  await digitarCodigo(codigo)
  await waitFor(() => expect(codigosNoCarrinho()).toContain(codigo))
}

function regiaoCarrinho(): HTMLElement {
  return screen.getByRole('region', { name: /^carrinho/i })
}

/** Os códigos no carrinho, na ordem em que aparecem. */
function codigosNoCarrinho(): string[] {
  const regiao = screen.queryByRole('region', { name: /^carrinho/i })
  if (!regiao) return []
  return within(regiao)
    .queryAllByRole('listitem')
    .map((item) => within(item).getByText(/^PRF-/, { selector: 'dd' }).textContent ?? '')
}

function itemDoCarrinho(codigo: string): HTMLElement {
  const item = within(regiaoCarrinho())
    .getAllByRole('listitem')
    .find((li) => within(li).queryByText(codigo) !== null)
  if (!item) throw new Error(`${codigo} não está no carrinho`)
  return item
}

describe('TelaVenda (RF05, RF06, RNF07, T34)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
    definirConexao(true)
    camera.codigo = 'PRF-AAAAAA'
    camera.modo = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    definirConexao(true)
  })

  describe('os quatro vereditos na leitura, cada um com seu layout', () => {
    it('põe no carrinho a unidade que o servidor libera, sem vender', async () => {
      comLeituras(CONFIRMADO)
      montarTela()

      await digitarCodigo('PRF-AAAAAA')

      expect(await screen.findByRole('heading', { name: /no carrinho/i })).toBeInTheDocument()
      // A mensagem é a que o servidor escreveu, exibida como veio (RNF04).
      expect(screen.getByText(CONFIRMADO.mensagem)).toBeInTheDocument()
      expect(codigosNoCarrinho()).toEqual(['PRF-AAAAAA'])
      // Ler não vende (T33b): a venda é o botão do carrinho.
      expect(confirmacoesEnviadas()).toHaveLength(0)
      expect(screen.queryByText(/venda registrada/i)).toBeNull()
    })

    it('destaca o código da unidade correta e não põe a barrada no carrinho', async () => {
      comLeituras(BLOQUEADO)
      montarTela()

      await digitarCodigo('PRF-ZZZZZZ')

      expect(await screen.findByRole('heading', { name: /não é esta unidade/i })).toBeInTheDocument()
      expect(screen.getByText(BLOQUEADO.mensagem)).toBeInTheDocument()
      // Os dois lados do bloqueio: o frasco na mão e o que deve sair.
      expect(screen.getByRole('heading', { name: /na sua mão/i })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /saia com esta/i })).toBeInTheDocument()
      expect(screen.getByText('10/05/2027')).toBeInTheDocument()
      expect(screen.getByText('30/11/2026')).toBeInTheDocument()
      expect(screen.getByText(/tentativa 1 neste produto/i)).toBeInTheDocument()
      expect(codigosNoCarrinho()).toEqual([])
    })

    it('informa a unidade vencida, oferece os caminhos e não a põe no carrinho', async () => {
      comLeituras(VENCIDO)
      montarTela()

      await digitarCodigo('PRF-VVVVVV')

      expect(await screen.findByRole('heading', { name: /unidade vencida/i })).toBeInTheDocument()
      expect(screen.getByText(VENCIDO.mensagem)).toBeInTheDocument()
      // O destino do frasco é escolha da pessoa: a tela oferece, não decide.
      expect(screen.getByRole('button', { name: /registrar descarte/i })).toBeInTheDocument()
      expect(codigosNoCarrinho()).toEqual([])
    })

    it('mostra o código não encontrado sem tratá-lo como falha da tela', async () => {
      comLeituras(NAO_ENCONTRADO)
      montarTela()

      await digitarCodigo('PRF-XXXXXX')

      expect(
        await screen.findByRole('heading', { name: /código não encontrado/i }),
      ).toBeInTheDocument()
      expect(screen.getByText(NAO_ENCONTRADO.mensagem)).toBeInTheDocument()
      expect(codigosNoCarrinho()).toEqual([])
    })
  })

  describe('laço de revalidação (RF06)', () => {
    it('bloqueia, aceita a segunda leitura e libera, na mesma montagem', async () => {
      comLeituras(BLOQUEADO, CONFIRMADO)
      montarTela()

      await digitarCodigo('PRF-ZZZZZZ')
      await screen.findByRole('heading', { name: /não é esta unidade/i })

      // O laço é a ausência de estado: a tela não guarda nada entre uma
      // leitura e outra, só manda o próximo código.
      await digitarCodigo('PRF-AAAAAA')

      expect(await screen.findByRole('heading', { name: /no carrinho/i })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /não é esta unidade/i })).toBeNull()
      expect(leiturasEnviadas().map((corpo) => corpo.codigoQr)).toEqual([
        'PRF-ZZZZZZ',
        'PRF-AAAAAA',
      ])
    })

    it('manda o código como foi digitado, sem normalizar no cliente', async () => {
      comLeituras(NAO_ENCONTRADO)
      montarTela()

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
      montarTela()

      await digitarCodigo('PRF-ZZZZZZ')
      await screen.findByRole('heading', { name: /não é esta unidade/i })
      await digitarCodigo('PRF-AAAAAA')
      await screen.findByRole('heading', { name: /no carrinho/i })

      expect(leituraEnviada(0).sessaoVendaId).toBeTruthy()
      expect(leituraEnviada(1).sessaoVendaId).toBe(leituraEnviada(0).sessaoVendaId)
    })

    it('não troca de atendimento entre os itens do carrinho — um cliente leva vários', async () => {
      simular({})
      montarTela()

      await adicionar('PRF-AAAAAA')
      await adicionar('PRF-BBBBBB')

      expect(leituraEnviada(1).sessaoVendaId).toBe(leituraEnviada(0).sessaoVendaId)
    })

    it('troca de agrupador ao encerrar o atendimento com o carrinho vazio', async () => {
      comLeituras(BLOQUEADO, BLOQUEADO)
      montarTela()

      await digitarCodigo('PRF-ZZZZZZ')
      await screen.findByRole('heading', { name: /não é esta unidade/i })

      fireEvent.click(screen.getByRole('button', { name: /encerrar atendimento/i }))
      await digitarCodigo('PRF-ZZZZZZ')
      await waitFor(() => expect(leiturasEnviadas()).toHaveLength(2))

      expect(leituraEnviada(1).sessaoVendaId).not.toBe(leituraEnviada(0).sessaoVendaId)
    })

    it('não oferece encerrar o atendimento com itens no carrinho', async () => {
      simular({})
      montarTela()

      await adicionar('PRF-AAAAAA')

      // Encerrar deixaria o carrinho deste cliente no atendimento do próximo:
      // a saída é confirmar ou esvaziar.
      expect(screen.queryByRole('button', { name: /encerrar atendimento/i })).toBeNull()
    })
  })

  describe('câmera', () => {
    /** Liga a câmera e entrega um quadro com o código de `camera.codigo`. */
    async function lerPelaCamera() {
      fireEvent.click(await screen.findByRole('button', { name: /ligar câmera/i }))
      fireEvent.click(screen.getByRole('button', { name: /simular quadro/i }))
    }

    it('liga o leitor em modo de leitura única', async () => {
      comLeituras(CONFIRMADO)
      montarTela()

      fireEvent.click(await screen.findByRole('button', { name: /ligar câmera/i }))

      expect(camera.modo).toBe('unica')
    })

    it('desliga a câmera ao ler um código e mostra o resultado no lugar (T31)', async () => {
      comLeituras(CONFIRMADO)
      montarTela()

      await lerPelaCamera()

      expect(await screen.findByRole('heading', { name: /no carrinho/i })).toBeInTheDocument()
      // Sem câmera ligada, nenhum frasco que passe na frente vira leitura nova
      // enquanto a atendente ainda olha o resultado.
      expect(screen.queryByTestId('camera-dublada')).toBeNull()
      expect(screen.getByRole('button', { name: /ler próximo/i })).toBeInTheDocument()
      expect(leiturasEnviadas()).toHaveLength(1)
    })

    it('religa a câmera e limpa o resultado em "Ler próximo"', async () => {
      camera.codigo = 'PRF-ZZZZZZ'
      comLeituras(BLOQUEADO, BLOQUEADO)
      montarTela()

      await lerPelaCamera()
      await screen.findByRole('heading', { name: /não é esta unidade/i })
      fireEvent.click(screen.getByRole('button', { name: /ler próximo/i }))

      expect(screen.getByTestId('camera-dublada')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /não é esta unidade/i })).toBeNull()

      // A câmera religada é uma montagem nova do leitor: lê de novo, e
      // inclusive o mesmo frasco, se for ele que estiver em quadro.
      fireEvent.click(screen.getByRole('button', { name: /simular quadro/i }))
      expect(await screen.findByRole('heading', { name: /não é esta unidade/i })).toBeInTheDocument()
      expect(leiturasEnviadas()).toHaveLength(2)
    })

    it('não liga a câmera sozinha na leitura digitada, nem em "Ler próximo" depois dela', async () => {
      comLeituras(CONFIRMADO)
      montarTela()

      await digitarCodigo('PRF-AAAAAA')
      await screen.findByRole('heading', { name: /no carrinho/i })
      expect(screen.queryByTestId('camera-dublada')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: /ler próximo/i }))

      // Quem digitou pode não ter câmera: o próximo código volta para o campo.
      expect(screen.queryByTestId('camera-dublada')).toBeNull()
      expect(screen.getByLabelText(/digite o código/i)).toHaveFocus()
    })

    it('desliga a câmera ligada quando o código é digitado, e "Ler próximo" a religa', async () => {
      comLeituras(CONFIRMADO)
      montarTela()

      fireEvent.click(await screen.findByRole('button', { name: /ligar câmera/i }))
      await digitarCodigo('PRF-AAAAAA')

      await screen.findByRole('heading', { name: /no carrinho/i })
      expect(screen.queryByTestId('camera-dublada')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: /ler próximo/i }))
      expect(screen.getByTestId('camera-dublada')).toBeInTheDocument()
    })

    it('mantém o bloqueio FIFO na tela até a atendente pedir o próximo', async () => {
      camera.codigo = 'PRF-ZZZZZZ'
      comLeituras(BLOQUEADO)
      montarTela()

      await lerPelaCamera()

      expect(await screen.findByRole('heading', { name: /não é esta unidade/i })).toBeInTheDocument()
      expect(screen.getByText('PRF-AAAAAA', { selector: '.codigo-correto' })).toBeInTheDocument()
      expect(screen.queryByTestId('camera-dublada')).toBeNull()
    })

    it('mantém o painel da unidade vencida na tela até a atendente pedir o próximo', async () => {
      camera.codigo = 'PRF-VVVVVV'
      comLeituras(VENCIDO)
      montarTela()

      await lerPelaCamera()

      expect(await screen.findByRole('heading', { name: /unidade vencida/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /registrar descarte/i })).toBeInTheDocument()
      expect(screen.queryByTestId('camera-dublada')).toBeNull()
    })

    it('oferece "Ler próximo" também depois de uma leitura que falhou', async () => {
      buscar.mockImplementation(async (entrada) => {
        const caminho = String(entrada).replace('http://localhost:3333', '')
        if (caminho === '/health') return BACKEND_DE_PE()
        return respostaFalsa(500, { erro: 'ERRO_INTERNO', mensagem: 'Falha no servidor.' })
      })
      montarTela()

      await lerPelaCamera()

      expect(await screen.findByText('Falha no servidor.')).toBeInTheDocument()
      // A câmera desligou na leitura que falhou; este é o caminho de volta.
      fireEvent.click(screen.getByRole('button', { name: /ler próximo/i }))
      expect(screen.getByTestId('camera-dublada')).toBeInTheDocument()
      expect(screen.queryByText('Falha no servidor.')).toBeNull()
    })

    it('não conta como leituras diferentes a rajada de um leitor que não parou', async () => {
      comLeituras(CONFIRMADO)
      montarTela()

      fireEvent.click(await screen.findByRole('button', { name: /ligar câmera/i }))
      fireEvent.click(screen.getByRole('button', { name: /simular leitor que não parou/i }))

      // Defesa em profundidade (T31, Decisão 2): cada disparo viraria um
      // `LEITURA_QR_SAIDA` e inflaria o denominador da taxa de acerto na
      // primeira leitura (RF12).
      await screen.findByRole('heading', { name: /no carrinho/i })
      expect(leiturasEnviadas()).toHaveLength(1)
      expect(codigosNoCarrinho()).toEqual(['PRF-AAAAAA'])
    })

    it('aponta o fallback manual quando a câmera não abre', async () => {
      comLeituras(CONFIRMADO)
      montarTela()

      fireEvent.click(await screen.findByRole('button', { name: /ligar câmera/i }))
      fireEvent.click(screen.getByRole('button', { name: /simular falha de câmera/i }))

      expect(await screen.findByRole('alert')).toHaveTextContent(/permissão de câmera negada/i)
      // O caminho digitado nunca esteve escondido — é o da etiqueta riscada.
      expect(screen.getByLabelText(/digite o código/i)).toBeInTheDocument()
    })
  })

  /**
   * O carrinho (T34). Ler libera; vender é confirmar. Entre um e outro, a tela
   * só guarda o que o servidor liberou e manda os ids de volta — em cada
   * leitura, para a segunda unidade do mesmo produto não ser barrada pela
   * primeira, e na confirmação, para o servidor revalidar e baixar.
   */
  describe('carrinho (T34)', () => {
    it('manda os ids do carrinho em toda leitura, vazio inclusive', async () => {
      simular({})
      montarTela()

      await adicionar('PRF-AAAAAA')
      await adicionar('PRF-BBBBBB')

      expect(leituraEnviada(0).noCarrinho).toEqual([])
      // A de janeiro já está no carrinho: sem este campo, o servidor a veria
      // na prateleira e barraria a de fevereiro do mesmo produto (T33).
      expect(leituraEnviada(1).noCarrinho).toEqual(['unidade-PRF-AAAAAA'])
      expect(codigosNoCarrinho()).toEqual(['PRF-AAAAAA', 'PRF-BBBBBB'])
    })

    it('remove um item do carrinho, e ele sai também das leituras seguintes', async () => {
      simular({})
      montarTela()

      await adicionar('PRF-AAAAAA')
      await adicionar('PRF-BBBBBB')

      fireEvent.click(
        within(regiaoCarrinho()).getByRole('button', { name: 'Remover PRF-AAAAAA do carrinho' }),
      )
      expect(codigosNoCarrinho()).toEqual(['PRF-BBBBBB'])

      // Remover não pede confirmação nem vai ao servidor: basta ler de novo.
      expect(screen.queryByRole('dialog')).toBeNull()
      await adicionar('PRF-CCCCCC')
      expect(leituraEnviada(2).noCarrinho).toEqual(['unidade-PRF-BBBBBB'])
    })

    it('remove pelo cartão da leitura, para o frasco errado que acabou de ser lido', async () => {
      comLeituras(CONFIRMADO)
      montarTela()

      await digitarCodigo('PRF-AAAAAA')
      await screen.findByRole('heading', { name: /no carrinho/i })

      fireEvent.click(screen.getByRole('button', { name: 'Remover do carrinho' }))

      expect(codigosNoCarrinho()).toEqual([])
      expect(screen.queryByRole('heading', { name: /no carrinho/i })).toBeNull()
    })

    it('ignora o código que já está no carrinho, sem chamar o servidor', async () => {
      simular({})
      montarTela()

      await adicionar('PRF-AAAAAA')
      await digitarCodigo('PRF-AAAAAA')

      expect(await screen.findByRole('status')).toHaveTextContent(
        'A unidade PRF-AAAAAA já está no carrinho.',
      )
      expect(leiturasEnviadas()).toHaveLength(1)
      expect(codigosNoCarrinho()).toEqual(['PRF-AAAAAA'])
    })

    it('reconhece pelo id a mesma unidade digitada de outro jeito', async () => {
      comLeituras(CONFIRMADO, CONFIRMADO)
      montarTela()

      await adicionar('PRF-AAAAAA')
      // O texto difere, e quem sabe que é o mesmo código é o servidor (T08).
      await digitarCodigo('prf-aaaaaa')

      expect(await screen.findByRole('status')).toHaveTextContent(/já está no carrinho/i)
      expect(leiturasEnviadas()).toHaveLength(2)
      expect(codigosNoCarrinho()).toEqual(['PRF-AAAAAA'])
    })

    it('esvazia o carrinho só depois de confirmar, e sem vender nada', async () => {
      simular({})
      montarTela()

      await adicionar('PRF-AAAAAA')
      await adicionar('PRF-BBBBBB')

      fireEvent.click(screen.getByRole('button', { name: /esvaziar carrinho/i }))
      expect(await encontrarConfirmacao('Esvaziar carrinho?')).toHaveAccessibleDescription(
        'As 2 unidades saem do carrinho e continuam no estoque. Nada é vendido.',
      )
      await responderConfirmacao('Esvaziar carrinho?', 'Cancelar')
      expect(codigosNoCarrinho()).toEqual(['PRF-AAAAAA', 'PRF-BBBBBB'])

      fireEvent.click(screen.getByRole('button', { name: /esvaziar carrinho/i }))
      await responderConfirmacao('Esvaziar carrinho?', 'Esvaziar')

      await waitFor(() => expect(codigosNoCarrinho()).toEqual([]))
      expect(confirmacoesEnviadas()).toHaveLength(0)
    })

    it('não lê mais quando o carrinho chega ao teto da confirmação', async () => {
      simular({})
      montarTela()

      for (let i = 0; i < 50; i += 1) {
        await adicionar(`PRF-${String(i).padStart(6, '0')}`)
      }
      await digitarCodigo('PRF-EXTRA0')

      // O servidor recusaria confirmar um carrinho maior (T33): a tela não
      // deixa montá-lo.
      expect(await screen.findByRole('status')).toHaveTextContent(/chegou a 50 unidades/i)
      expect(leiturasEnviadas()).toHaveLength(50)
    }, 30_000)

    describe('confirmar a venda', () => {
      it('pergunta antes, com a lista e a quantidade, e cancelar não vende', async () => {
        simular({})
        montarTela()

        await adicionar('PRF-AAAAAA')
        await adicionar('PRF-BBBBBB')
        fireEvent.click(screen.getByRole('button', { name: /^confirmar venda$/i }))

        expect(await encontrarConfirmacao('Confirmar venda?')).toHaveAccessibleDescription(
          /^2 unidades serão vendidas: PRF-AAAAAA \(Eau de Parfum 50ml\), PRF-BBBBBB \(Eau de Parfum 50ml\)\./,
        )
        await responderConfirmacao('Confirmar venda?', 'Cancelar')

        expect(confirmacoesEnviadas()).toHaveLength(0)
        expect(codigosNoCarrinho()).toEqual(['PRF-AAAAAA', 'PRF-BBBBBB'])
      })

      it('vende o carrinho inteiro, esvazia e começa outro atendimento', async () => {
        simular({
          finalizar: { status: 200, corpo: { itens: [vendida('PRF-AAAAAA'), vendida('PRF-BBBBBB')] } },
        })
        montarTela()

        await adicionar('PRF-AAAAAA')
        await adicionar('PRF-BBBBBB')
        fireEvent.click(screen.getByRole('button', { name: /^confirmar venda$/i }))
        await responderConfirmacao('Confirmar venda?', 'Confirmar venda')

        expect(await screen.findByRole('heading', { name: 'Venda registrada' })).toBeInTheDocument()
        // Cada item com a mensagem do servidor, como veio (RNF04).
        expect(screen.getByText(vendida('PRF-AAAAAA').mensagem)).toBeInTheDocument()
        expect(screen.getByText(vendida('PRF-BBBBBB').mensagem)).toBeInTheDocument()
        expect(codigosNoCarrinho()).toEqual([])

        // Ids, na ordem do carrinho: quem decide a ordem de baixa é o
        // servidor (T33b), e o agrupador é o das leituras.
        expect(confirmacoesEnviadas()).toEqual([
          {
            unidadeIds: ['unidade-PRF-AAAAAA', 'unidade-PRF-BBBBBB'],
            sessaoVendaId: leituraEnviada(0).sessaoVendaId,
          },
        ])

        await adicionar('PRF-CCCCCC')
        expect(leituraEnviada(2).sessaoVendaId).toBeTruthy()
        expect(leituraEnviada(2).sessaoVendaId).not.toBe(leituraEnviada(0).sessaoVendaId)
      })

      it('mostra item a item o resultado parcial, e o barrado fica no carrinho', async () => {
        const barrado = {
          ...BLOQUEADO,
          unidadeId: 'unidade-PRF-BBBBBB',
          codigoQr: 'PRF-BBBBBB',
          unidadeLida: unidade('PRF-BBBBBB', '2027-05-10'),
          unidadeCorreta: unidade('PRF-NOVA00', '2026-10-30'),
          mensagem: 'Devolva esta unidade à prateleira. Saia primeiro com a de código PRF-NOVA00.',
        }
        simular({
          finalizar: { status: 200, corpo: { itens: [vendida('PRF-AAAAAA'), barrado] } },
        })
        montarTela()

        await adicionar('PRF-AAAAAA')
        await adicionar('PRF-BBBBBB')
        fireEvent.click(screen.getByRole('button', { name: /^confirmar venda$/i }))
        await responderConfirmacao('Confirmar venda?', 'Confirmar venda')

        expect(
          await screen.findByRole('heading', { name: 'Venda registrada em parte' }),
        ).toBeInTheDocument()
        expect(screen.getByText(vendida('PRF-AAAAAA').mensagem)).toBeInTheDocument()
        expect(screen.getByText(/1 unidade continua no carrinho/i)).toBeInTheDocument()

        // A vendida saiu; a barrada ficou, com o motivo do servidor e a
        // unidade que deve sair no lugar dela.
        expect(codigosNoCarrinho()).toEqual(['PRF-BBBBBB'])
        const item = itemDoCarrinho('PRF-BBBBBB')
        expect(within(item).getByText(barrado.mensagem)).toBeInTheDocument()
        expect(within(item).getByText('PRF-NOVA00')).toBeInTheDocument()

        // O cliente ainda está no balcão: o atendimento continua.
        await adicionar('PRF-NOVA00')
        expect(leituraEnviada(2).sessaoVendaId).toBe(leituraEnviada(0).sessaoVendaId)
      })

      it('abre os caminhos da unidade que venceu entre a leitura e a confirmação', async () => {
        const vencida = { ...VENCIDO, unidadeId: 'unidade-PRF-VVVVVV' }
        simular({
          finalizar: { status: 200, corpo: { itens: [vendida('PRF-AAAAAA'), vencida] } },
          excecao: { descartar: { status: 201, corpo: DESCARTE_FEITO } },
        })
        montarTela()

        await adicionar('PRF-AAAAAA')
        await adicionar('PRF-VVVVVV')
        fireEvent.click(screen.getByRole('button', { name: /^confirmar venda$/i }))
        await responderConfirmacao('Confirmar venda?', 'Confirmar venda')

        expect(await screen.findByRole('heading', { name: /unidade vencida/i })).toBeInTheDocument()
        expect(codigosNoCarrinho()).toEqual(['PRF-VVVVVV'])

        fireEvent.click(screen.getByRole('button', { name: /registrar descarte/i }))
        await responderConfirmacao('Descartar unidade?', 'Descartar')

        // Descartada, a unidade saiu do estoque e não pode continuar à venda.
        expect(await screen.findByRole('heading', { name: /descarte registrado/i })).toBeInTheDocument()
        expect(codigosNoCarrinho()).toEqual([])
      })

      it('mantém o carrinho quando a confirmação é recusada inteira', async () => {
        simular({
          finalizar: {
            status: 404,
            corpo: {
              erro: 'UNIDADE_NAO_ENCONTRADA',
              mensagem: 'Uma unidade do carrinho não foi encontrada. Leia os itens novamente.',
            },
          },
        })
        montarTela()

        await adicionar('PRF-AAAAAA')
        fireEvent.click(screen.getByRole('button', { name: /^confirmar venda$/i }))
        await responderConfirmacao('Confirmar venda?', 'Confirmar venda')

        expect(
          await screen.findByText('Uma unidade do carrinho não foi encontrada. Leia os itens novamente.'),
        ).toBeInTheDocument()
        expect(codigosNoCarrinho()).toEqual(['PRF-AAAAAA'])
      })
    })
  })

  /**
   * Os três caminhos da seção 6.1 do PRD (T12). A tela não escolhe nenhum e não
   * julga nenhum: ela oferece os que o papel alcança, manda o que a pessoa
   * pediu, e exibe o que o servidor respondeu.
   */
  describe('os três caminhos da unidade vencida (PRD 6.1)', () => {
    const CORRIGIDA = liberada('PRF-VVVVVV', '2027-08-01')

    const TODOS = {
      corrigir: { status: 200, corpo: correcaoCom(CORRIGIDA) },
      descartar: { status: 201, corpo: DESCARTE_FEITO },
      override: { status: 201, corpo: OVERRIDE_FEITO },
    }

    const JUSTIFICATIVA = 'Cliente ciente, peça de mostruário.'

    function comExcecao(vereditos: unknown[], excecao: Partial<Record<Caminho, Resposta>>) {
      simular({ vereditos, excecao })
    }

    function enviosDoCaminho(caminho: Caminho) {
      return enviosPara(`/excecao-vencido/${caminho}`)
    }

    /** Chega à exceção pelo caminho real: uma leitura de QR. */
    async function lerUnidadeVencida(usuario: Usuario = GESTOR) {
      const tela = montarTela(usuario)
      await digitarCodigo('PRF-VVVVVV')
      await screen.findByRole('heading', { name: /unidade vencida/i })
      return tela
    }

    async function acionar(caminho: Caminho) {
      if (caminho === 'corrigir') {
        fireEvent.change(screen.getByLabelText(/validade impressa/i), {
          target: { value: '2027-08-01' },
        })
        fireEvent.click(screen.getByRole('button', { name: /corrigir validade/i }))
        return
      }

      // Descarte e override passam pela confirmação (T39); a correção, não.
      if (caminho === 'descartar') {
        fireEvent.click(screen.getByRole('button', { name: /registrar descarte/i }))
        await responderConfirmacao('Descartar unidade?', 'Descartar')
        return
      }

      // O override exige três atos: revelar o formulário, justificar e
      // confirmar no diálogo.
      fireEvent.click(screen.getByRole('button', { name: /autorizar a venda mesmo assim/i }))
      fireEvent.change(await screen.findByLabelText(/justificativa/i), {
        target: { value: JUSTIFICATIVA },
      })
      fireEvent.click(screen.getByRole('button', { name: /^autorizar venda$/i }))
      await responderConfirmacao('Autorizar venda de unidade vencida?', 'Autorizar venda')
    }

    it('oferece os três caminhos ao GESTOR', async () => {
      comExcecao([VENCIDO], TODOS)
      await lerUnidadeVencida(GESTOR)

      expect(screen.getByLabelText(/validade impressa/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /registrar descarte/i })).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /autorizar a venda mesmo assim/i }),
      ).toBeInTheDocument()
    })

    it('oferece só o descarte à ATENDENTE, e diz onde estão os outros dois', async () => {
      comExcecao([VENCIDO], TODOS)
      await lerUnidadeVencida(ATENDENTE)

      expect(screen.getByRole('button', { name: /registrar descarte/i })).toBeInTheDocument()
      // Esconder é conveniência de interface — quem recusa é o 403 do backend
      // (RNF04). Botão inerte no balcão é pior que ausência.
      expect(screen.queryByLabelText(/validade impressa/i)).toBeNull()
      expect(screen.queryByRole('button', { name: /autorizar a venda mesmo assim/i })).toBeNull()
      expect(screen.getByText(/são ações do gestor/i)).toBeInTheDocument()
    })

    it('registra o descarte sem motivo quando o campo fica vazio', async () => {
      comExcecao([VENCIDO], TODOS)
      await lerUnidadeVencida(ATENDENTE)

      await acionar('descartar')

      expect(await screen.findByRole('heading', { name: /descarte registrado/i })).toBeInTheDocument()
      expect(screen.getByText(DESCARTE_FEITO.mensagem)).toBeInTheDocument()
      // Campo vazio é campo omitido: quem escreve o motivo padrão é o servidor,
      // e enviar texto em branco faria o backend recusar a requisição inteira.
      expect(enviosDoCaminho('descartar')[0]).toEqual({
        unidadeId: VENCIDO.unidade.id,
        sessaoVendaId: leituraEnviada(0).sessaoVendaId,
      })
    })

    it('manda o motivo quando a atendente escreve um', async () => {
      comExcecao([VENCIDO], TODOS)
      await lerUnidadeVencida(ATENDENTE)

      fireEvent.change(screen.getByLabelText(/motivo/i), {
        target: { value: 'Frasco no fundo da gaveta.' },
      })
      await acionar('descartar')

      await waitFor(() => expect(enviosDoCaminho('descartar')).toHaveLength(1))
      expect(enviosDoCaminho('descartar')[0]?.motivo).toBe('Frasco no fundo da gaveta.')
    })

    it('corrige a validade e põe no carrinho a unidade que o servidor liberou', async () => {
      comExcecao([VENCIDO], TODOS)
      await lerUnidadeVencida(GESTOR)

      await acionar('corrigir')

      // A revalidação é do servidor, na mesma transação da correção (T11).
      // Desde T33b, `CONFIRMAR` ali é "pode ser vendida": a unidade vai para o
      // carrinho, como numa leitura, e nada é vendido.
      expect(await screen.findByRole('heading', { name: /no carrinho/i })).toBeInTheDocument()
      expect(screen.getByText(CORRIGIDA.mensagem)).toBeInTheDocument()
      expect(codigosNoCarrinho()).toEqual(['PRF-VVVVVV'])
      expect(confirmacoesEnviadas()).toHaveLength(0)
      expect(enviosDoCaminho('corrigir')[0]).toEqual({
        unidadeId: VENCIDO.unidade.id,
        dataValidade: '2027-08-01',
        noCarrinho: [],
        sessaoVendaId: leituraEnviada(0).sessaoVendaId,
      })
    })

    it('manda os ids do carrinho na correção, como na leitura', async () => {
      comExcecao([CONFIRMADO, VENCIDO], TODOS)
      montarTela(GESTOR)

      await adicionar('PRF-AAAAAA')
      await digitarCodigo('PRF-VVVVVV')
      await screen.findByRole('heading', { name: /unidade vencida/i })
      await acionar('corrigir')

      // A unidade corrigida para fevereiro não pode ser barrada pela de janeiro
      // que já está no carrinho (T33, item 7).
      await waitFor(() => expect(enviosDoCaminho('corrigir')).toHaveLength(1))
      expect(enviosDoCaminho('corrigir')[0]?.noCarrinho).toEqual(['unidade-PRF-AAAAAA'])
      await waitFor(() => expect(codigosNoCarrinho()).toEqual(['PRF-AAAAAA', 'PRF-VVVVVV']))
    })

    it('volta a oferecer os caminhos quando a data corrigida também está no passado', async () => {
      comExcecao([VENCIDO], {
        ...TODOS,
        corrigir: { status: 200, corpo: correcaoCom(VENCIDO_DE_NOVO) },
      })
      await lerUnidadeVencida(GESTOR)

      await acionar('corrigir')

      // O erro de digitação pode ter sido de dia ou de mês: a resposta honesta
      // é a exceção de novo, com os caminhos ainda disponíveis.
      expect(await screen.findByText(VENCIDO_DE_NOVO.mensagem)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /registrar descarte/i })).toBeInTheDocument()
      expect(codigosNoCarrinho()).toEqual([])
    })

    it('autoriza a venda depois de revelar o formulário e justificar, fora do carrinho', async () => {
      comExcecao([VENCIDO], TODOS)
      await lerUnidadeVencida(GESTOR)

      // Antes do passo de revelar não existe campo de justificativa: o override
      // não é o botão primário da tela (restrição de design do PRD 6.1).
      expect(screen.queryByLabelText(/justificativa/i)).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: /autorizar a venda mesmo assim/i }))
      // Antes de autorizar, a pessoa sabe que não haverá outra confirmação.
      expect(screen.getByText(/registrada na hora, fora do carrinho/i)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))

      await acionar('override')

      expect(await screen.findByRole('heading', { name: /venda autorizada/i })).toBeInTheDocument()
      expect(screen.getByText(OVERRIDE_FEITO.mensagem)).toBeInTheDocument()
      // O override vende na hora (T33b, Decisão 3).
      expect(screen.getByText(/não faz parte do carrinho/i)).toBeInTheDocument()
      expect(codigosNoCarrinho()).toEqual([])
      expect(enviosDoCaminho('override')[0]?.justificativa).toBe(JUSTIFICATIVA)
    })

    it('mantém o botão de autorizar desabilitado enquanto a justificativa é curta', async () => {
      comExcecao([VENCIDO], TODOS)
      await lerUnidadeVencida(GESTOR)

      fireEvent.click(screen.getByRole('button', { name: /autorizar a venda mesmo assim/i }))
      fireEvent.change(await screen.findByLabelText(/justificativa/i), { target: { value: 'ok' } })

      // Espelho do mínimo do servidor (T12, Decisão 3): é o texto que a pessoa
      // acabou de digitar, e a tela o tem por inteiro. Nada vai à rede.
      expect(screen.getByRole('button', { name: /^autorizar venda$/i })).toBeDisabled()
      expect(screen.getByText(/faltam 8 caracteres/i)).toBeInTheDocument()
      expect(enviosDoCaminho('override')).toHaveLength(0)
    })

    it('não compara datas: a recusa de validade inalterada vem do servidor', async () => {
      comExcecao([VENCIDO], {
        ...TODOS,
        corrigir: { status: 400, corpo: VALIDADE_INALTERADA },
      })
      await lerUnidadeVencida(GESTOR)

      // A validade que a tela tem é cópia de estado do servidor, e pode estar
      // velha: comparar aqui bloquearia correção legítima (T12, Decisão 3).
      fireEvent.click(screen.getByRole('button', { name: /corrigir validade/i }))

      await waitFor(() => expect(enviosDoCaminho('corrigir')).toHaveLength(1))
      expect(enviosDoCaminho('corrigir')[0]?.dataValidade).toBe(VENCIDO.unidade.dataValidade)
      expect(await screen.findByText(VALIDADE_INALTERADA.mensagem)).toBeInTheDocument()
      // A unidade não foi resolvida: os caminhos continuam à mão.
      expect(screen.getByRole('button', { name: /registrar descarte/i })).toBeInTheDocument()
    })

    it('volta ao estado de nova leitura quando outra pessoa já resolveu a unidade', async () => {
      comExcecao([VENCIDO], { ...TODOS, descartar: { status: 409, corpo: JA_BAIXADA } })
      await lerUnidadeVencida(ATENDENTE)

      await acionar('descartar')

      // O veredito valia para o estoque de um instante que passou — mesmo
      // motivo pelo qual ele não sobrevive à queda de conexão (T10).
      expect(await screen.findByText(JA_BAIXADA.mensagem)).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /unidade vencida/i })).toBeNull()
      expect(screen.getByLabelText(/digite o código/i)).toBeInTheDocument()
    })

    it('manda o agrupador do atendimento nos três caminhos', async () => {
      for (const caminho of ['corrigir', 'descartar', 'override'] as const) {
        buscar.mockReset()
        comExcecao([VENCIDO], TODOS)

        const tela = await lerUnidadeVencida(GESTOR)
        await acionar(caminho)
        await waitFor(() => expect(enviosDoCaminho(caminho)).toHaveLength(1))

        // Resolver um frasco vencido faz parte do atendimento em que
        // aconteceu, e é isso que permite reconstruí-lo no relatório (RF13).
        expect(enviosDoCaminho(caminho)[0]?.sessaoVendaId).toBe(leituraEnviada(0).sessaoVendaId)
        tela.unmount()
      }
    })

    describe('confirmação antes de descartar e de autorizar (T39)', () => {
      it('pergunta antes de descartar, citando a unidade, e cancelar não chama a API', async () => {
        comExcecao([VENCIDO], TODOS)
        await lerUnidadeVencida(ATENDENTE)

        fireEvent.click(screen.getByRole('button', { name: /registrar descarte/i }))

        expect(await encontrarConfirmacao('Descartar unidade?')).toHaveAccessibleDescription(
          'A unidade PRF-VVVVVV de Eau de Parfum 50ml sai do estoque e entra no relatório de perdas. O descarte não pode ser desfeito.',
        )
        await responderConfirmacao('Descartar unidade?', 'Cancelar')

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(enviosDoCaminho('descartar')).toHaveLength(0)
        // A unidade continua à espera de um dos caminhos.
        expect(screen.getByRole('heading', { name: /unidade vencida/i })).toBeInTheDocument()
      })

      it('pergunta de novo depois da justificativa, e cancelar não autoriza', async () => {
        comExcecao([VENCIDO], TODOS)
        await lerUnidadeVencida(GESTOR)

        fireEvent.click(screen.getByRole('button', { name: /autorizar a venda mesmo assim/i }))
        fireEvent.change(await screen.findByLabelText(/justificativa/i), {
          target: { value: JUSTIFICATIVA },
        })
        fireEvent.click(screen.getByRole('button', { name: /^autorizar venda$/i }))

        expect(
          await encontrarConfirmacao('Autorizar venda de unidade vencida?'),
        ).toHaveAccessibleDescription(
          /A unidade PRF-VVVVVV de Eau de Parfum 50ml, vencida em 01\/08\/2026, será registrada como vendida\. A autorização fica registrada com seu nome/,
        )
        await responderConfirmacao('Autorizar venda de unidade vencida?', 'Cancelar')

        expect(enviosDoCaminho('override')).toHaveLength(0)
        // O que foi escrito fica: cancelar a pergunta não é desistir do texto.
        expect(screen.getByLabelText(/justificativa/i)).toHaveValue(JUSTIFICATIVA)
      })

      it('confirmar o descarte chama a API uma vez', async () => {
        comExcecao([VENCIDO], TODOS)
        await lerUnidadeVencida(ATENDENTE)

        await acionar('descartar')

        await screen.findByRole('heading', { name: /descarte registrado/i })
        expect(enviosDoCaminho('descartar')).toHaveLength(1)
      })
    })

    it('cai no portão de offline se a rede some durante a resolução', async () => {
      let saudeOk = true
      buscar.mockImplementation(async (entrada, init) => {
        const caminho = String(entrada).replace('http://localhost:3333', '')
        if (caminho === '/health') {
          if (!saudeOk) throw new TypeError('Failed to fetch')
          return BACKEND_DE_PE()
        }
        if (caminho === '/saidas/ler') return respostaFalsa(200, VENCIDO)
        if (caminho === '/excecao-vencido/descartar') {
          saudeOk = false
          throw new TypeError('Failed to fetch')
        }
        throw new Error(`rota não simulada: ${init?.method ?? 'GET'} ${caminho}`)
      })

      await lerUnidadeVencida(ATENDENTE)
      await acionar('descartar')

      // Nada de erro genérico: a queda no meio da resolução leva ao mesmo
      // bloqueio explícito da leitura (RNF07).
      expect(
        await screen.findByRole('heading', { name: /sem conexão com o servidor/i }),
      ).toBeInTheDocument()
    })
  })

  describe('offline (RNF07)', () => {
    it('bloqueia a leitura e explica por quê quando o navegador está sem rede', async () => {
      definirConexao(false)
      comLeituras(CONFIRMADO)

      montarTela()

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

      montarTela()

      // `navigator.onLine` só sabe que existe uma rede, não que ela chega ao
      // servidor: por isso o portão tem dois sinais.
      expect(await screen.findByRole('alert')).toHaveTextContent(/sem conexão com o servidor/i)
    })

    it('descarta o veredito anterior ao perder a conexão', async () => {
      comLeituras(BLOQUEADO)
      montarTela()

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

    it('guarda o carrinho na queda de conexão, mas não deixa confirmar até ela voltar', async () => {
      simular({})
      montarTela()

      await adicionar('PRF-AAAAAA')
      await adicionar('PRF-BBBBBB')

      definirConexao(false)
      fireEvent(window, new Event('offline'))
      await screen.findByRole('heading', { name: /sem conexão com o servidor/i })

      // O carrinho não afirma nada sobre o estoque de agora: a confirmação
      // revalida cada item (T34, Decisão 2). Por isso ele fica, e é ela que
      // espera a conexão.
      expect(codigosNoCarrinho()).toEqual(['PRF-AAAAAA', 'PRF-BBBBBB'])
      expect(screen.getByRole('button', { name: /^confirmar venda$/i })).toBeDisabled()
      expect(screen.queryByLabelText(/digite o código/i)).toBeNull()

      definirConexao(true)
      fireEvent(window, new Event('online'))
      await screen.findByLabelText(/digite o código/i)

      expect(codigosNoCarrinho()).toEqual(['PRF-AAAAAA', 'PRF-BBBBBB'])
      expect(screen.getByRole('button', { name: /^confirmar venda$/i })).toBeEnabled()
    })

    it('libera a leitura quando a conexão volta', async () => {
      definirConexao(false)
      comLeituras(CONFIRMADO)

      montarTela()
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

      montarTela()
      await digitarCodigo('PRF-AAAAAA')

      // Nenhum veredito inventado pela tela: ela diz que não deu para falar
      // com o servidor e volta ao estado bloqueado.
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: /sem conexão com o servidor/i })).toBeInTheDocument(),
      )
    })
  })
})
