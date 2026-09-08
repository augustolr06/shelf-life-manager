import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaLeituraQr } from './TelaLeituraQr'
import type { Usuario } from '../services/auth'
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

function montarTela(usuario: Usuario = ATENDENTE) {
  return render(<TelaLeituraQr usuario={usuario} />)
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

type Caminho = 'corrigir' | 'descartar' | 'override'

/**
 * Responde `/health`, as leituras e os três caminhos da exceção (T11).
 *
 * Cada caminho recebe status e corpo próprios, porque o que se quer provar
 * muda: sucesso no descarte, recusa de pré-condição no 409, recusa de dado
 * inalterado no 400.
 */
function comExcecao(
  vereditos: unknown[],
  respostas: Partial<Record<Caminho, { status: number; corpo: unknown }>>,
) {
  let proxima = 0
  buscar.mockImplementation(async (entrada, init) => {
    const caminho = String(entrada).replace('http://localhost:3333', '')
    if (caminho === '/health') return BACKEND_DE_PE()

    if (caminho === '/saidas/ler' && init?.method === 'POST') {
      const veredito = vereditos[Math.min(proxima, vereditos.length - 1)]
      proxima += 1
      return respostaFalsa(200, veredito)
    }

    const acao = caminho.replace('/excecao-vencido/', '') as Caminho
    const resposta = respostas[acao]
    if (caminho.startsWith('/excecao-vencido/') && resposta) {
      return respostaFalsa(resposta.status, resposta.corpo)
    }

    throw new Error(`rota não simulada no teste: ${init?.method ?? 'GET'} ${caminho}`)
  })
}

/** Corpos enviados a um dos três caminhos da exceção, na ordem. */
function enviosPara(caminho: Caminho): Array<Record<string, string>> {
  return buscar.mock.calls
    .filter(([entrada]) => String(entrada).endsWith(`/excecao-vencido/${caminho}`))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
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
      montarTela()

      await digitarCodigo('PRF-AAAAAA')

      expect(await screen.findByRole('heading', { name: /saída registrada/i })).toBeInTheDocument()
      // A mensagem é a que o servidor escreveu, exibida como veio (RNF04).
      expect(screen.getByText(CONFIRMADO.mensagem)).toBeInTheDocument()
      expect(screen.getByText('30/11/2026')).toBeInTheDocument()
    })

    it('destaca o código da unidade correta e as duas validades no bloqueio FIFO', async () => {
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
    })

    it('informa a unidade vencida e oferece os caminhos de resolução (PRD 6.1)', async () => {
      comLeituras(VENCIDO)
      montarTela()

      await digitarCodigo('PRF-VVVVVV')

      expect(await screen.findByRole('heading', { name: /unidade vencida/i })).toBeInTheDocument()
      expect(screen.getByText(VENCIDO.mensagem)).toBeInTheDocument()
      // O destino do frasco é escolha da pessoa: a tela oferece, não decide.
      expect(screen.getByRole('button', { name: /registrar descarte/i })).toBeInTheDocument()
    })

    it('mostra o código não encontrado sem tratá-lo como falha da tela', async () => {
      comLeituras(NAO_ENCONTRADO)
      montarTela()

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
      montarTela()

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
      await screen.findByRole('heading', { name: /saída registrada/i })

      expect(leituraEnviada(0).sessaoVendaId).toBeTruthy()
      expect(leituraEnviada(1).sessaoVendaId).toBe(leituraEnviada(0).sessaoVendaId)
    })

    it('não troca de atendimento depois de uma confirmação — um cliente leva vários itens', async () => {
      comLeituras(CONFIRMADO, CONFIRMADO)
      montarTela()

      await digitarCodigo('PRF-AAAAAA')
      await screen.findByRole('heading', { name: /saída registrada/i })
      await digitarCodigo('PRF-BBBBBB')
      await waitFor(() => expect(leiturasEnviadas()).toHaveLength(2))

      expect(leituraEnviada(1).sessaoVendaId).toBe(leituraEnviada(0).sessaoVendaId)
    })

    it('troca de agrupador ao encerrar o atendimento', async () => {
      comLeituras(CONFIRMADO, CONFIRMADO)
      montarTela()

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
      montarTela()

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
      montarTela()

      fireEvent.click(await screen.findByRole('button', { name: /ligar câmera/i }))
      fireEvent.click(screen.getByRole('button', { name: /simular falha de câmera/i }))

      expect(await screen.findByRole('alert')).toHaveTextContent(/permissão de câmera negada/i)
      // O caminho digitado nunca esteve escondido — é o da etiqueta riscada.
      expect(screen.getByLabelText(/digite o código/i)).toBeInTheDocument()
    })
  })

  /**
   * Os três caminhos da seção 6.1 do PRD (T12). A tela não escolhe nenhum e não
   * julga nenhum: ela oferece os que o papel alcança, manda o que a pessoa
   * pediu, e exibe o que o servidor respondeu.
   */
  describe('os três caminhos da unidade vencida (PRD 6.1)', () => {
    const TODOS = {
      corrigir: { status: 200, corpo: correcaoCom(CONFIRMADO) },
      descartar: { status: 201, corpo: DESCARTE_FEITO },
      override: { status: 201, corpo: OVERRIDE_FEITO },
    }

    const JUSTIFICATIVA = 'Cliente ciente, peça de mostruário.'

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

      if (caminho === 'descartar') {
        fireEvent.click(screen.getByRole('button', { name: /registrar descarte/i }))
        return
      }

      // O override exige dois atos: revelar o formulário e então justificar.
      fireEvent.click(screen.getByRole('button', { name: /autorizar a venda mesmo assim/i }))
      fireEvent.change(await screen.findByLabelText(/justificativa/i), {
        target: { value: JUSTIFICATIVA },
      })
      fireEvent.click(screen.getByRole('button', { name: /^autorizar venda$/i }))
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
      expect(enviosPara('descartar')[0]).toEqual({
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

      await waitFor(() => expect(enviosPara('descartar')).toHaveLength(1))
      expect(enviosPara('descartar')[0]?.motivo).toBe('Frasco no fundo da gaveta.')
    })

    it('corrige a validade e mostra o veredito que o servidor revalidou', async () => {
      comExcecao([VENCIDO], TODOS)
      await lerUnidadeVencida(GESTOR)

      await acionar('corrigir')

      // A revalidação é do servidor, na mesma transação da correção (T11). Se
      // ela devolve CONFIRMAR, a venda já aconteceu — não há o que confirmar
      // depois, e a tela diz isso como fato consumado.
      expect(await screen.findByRole('heading', { name: /saída registrada/i })).toBeInTheDocument()
      expect(screen.getByText(CONFIRMADO.mensagem)).toBeInTheDocument()
      expect(enviosPara('corrigir')[0]).toEqual({
        unidadeId: VENCIDO.unidade.id,
        dataValidade: '2027-08-01',
        sessaoVendaId: leituraEnviada(0).sessaoVendaId,
      })
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
    })

    it('autoriza a venda depois de revelar o formulário e justificar', async () => {
      comExcecao([VENCIDO], TODOS)
      await lerUnidadeVencida(GESTOR)

      // Antes do passo de revelar não existe campo de justificativa: o override
      // não é o botão primário da tela (restrição de design do PRD 6.1).
      expect(screen.queryByLabelText(/justificativa/i)).toBeNull()

      await acionar('override')

      expect(await screen.findByRole('heading', { name: /venda autorizada/i })).toBeInTheDocument()
      expect(screen.getByText(OVERRIDE_FEITO.mensagem)).toBeInTheDocument()
      expect(enviosPara('override')[0]?.justificativa).toBe(JUSTIFICATIVA)
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
      expect(enviosPara('override')).toHaveLength(0)
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

      await waitFor(() => expect(enviosPara('corrigir')).toHaveLength(1))
      expect(enviosPara('corrigir')[0]?.dataValidade).toBe(VENCIDO.unidade.dataValidade)
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
        await waitFor(() => expect(enviosPara(caminho)).toHaveLength(1))

        // Resolver um frasco vencido faz parte do atendimento em que
        // aconteceu, e é isso que permite reconstruí-lo no relatório (RF13).
        expect(enviosPara(caminho)[0]?.sessaoVendaId).toBe(leituraEnviada(0).sessaoVendaId)
        tela.unmount()
      }
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
