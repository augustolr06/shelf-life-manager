import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaDescartesPendentes } from './TelaDescartesPendentes'
import { respostaFalsa } from '../services/testes/respostaFalsa'
import type { Usuario } from '../services/auth'

/**
 * Fila de descarte pendente (RF11, T13).
 *
 * A tela não decide nada: quem é vencido, em que ordem e há quantos dias vêm
 * prontos do servidor. O que estes testes verificam é isso — que a lista
 * reflete a resposta, que resolver reusa o painel de T12 sem o override, e que
 * o `sessaoVendaId` não é inventado onde não há atendimento.
 */

const GESTOR: Usuario = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Gestora de Loja',
  email: 'gestor@estoque.local',
  papel: 'GESTOR',
}

const VENCIDA = {
  id: '44444444-4444-4444-4444-444444444444',
  codigoQr: 'PRF-JC95FJ',
  dataValidade: '2026-07-01',
  diasVencida: 69,
  dataEntrada: '2026-01-10T12:00:00.000Z',
  produto: {
    id: '33333333-3333-3333-3333-333333333333',
    codigoInterno: 'PRF-001',
    nome: 'Eau de Parfum 50ml',
    marca: 'Marca Exemplo',
  },
}

const OUTRA_VENCIDA = {
  ...VENCIDA,
  id: '55555555-5555-5555-5555-555555555555',
  codigoQr: 'PRF-6KJXCQ',
  dataValidade: '2026-08-20',
  diasVencida: 19,
}

function fila(unidades: (typeof VENCIDA)[], total = unidades.length) {
  return respostaFalsa(200, { unidades, total, pagina: 1, tamanhoPagina: 20 })
}

const buscar = vi.fn<typeof fetch>()

/** Abre o painel de resolução da unidade cujo código está na tela. */
function resolver(codigoQr: string) {
  const linha = screen.getByText(codigoQr).closest('li') as HTMLElement
  fireEvent.click(within(linha).getByRole('button', { name: 'Resolver' }))
  return linha
}

describe('TelaDescartesPendentes (RF11)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lista as unidades vencidas com os dados que o servidor mandou', async () => {
    buscar.mockResolvedValueOnce(fila([VENCIDA]))

    render(<TelaDescartesPendentes usuario={GESTOR} />)

    expect(await screen.findByText('PRF-JC95FJ')).toBeInTheDocument()
    expect(screen.getByText('Eau de Parfum 50ml')).toBeInTheDocument()
    expect(screen.getByText('01/07/2026')).toBeInTheDocument()
    // A contagem vem pronta do servidor — a tela não subtrai datas (RNF01).
    expect(screen.getByText('69 dias')).toBeInTheDocument()
    expect(buscar).toHaveBeenCalledWith(
      'http://localhost:3333/descartes/pendentes',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('fila vazia é o estado desejado, não uma falha', async () => {
    buscar.mockResolvedValueOnce(fila([]))

    render(<TelaDescartesPendentes usuario={GESTOR} />)

    expect(await screen.findByText('Nenhuma unidade vencida em estoque.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('erro de carregamento exibe a mensagem do servidor', async () => {
    buscar.mockResolvedValueOnce(
      respostaFalsa(403, { erro: 'PAPEL_INSUFICIENTE', mensagem: 'Seu papel não permite esta ação.' }),
    )

    render(<TelaDescartesPendentes usuario={GESTOR} />)

    expect(await screen.findByText('Seu papel não permite esta ação.')).toBeInTheDocument()
  })

  it('“Resolver” abre o painel só da unidade escolhida', async () => {
    buscar.mockResolvedValueOnce(fila([VENCIDA, OUTRA_VENCIDA]))

    render(<TelaDescartesPendentes usuario={GESTOR} />)
    await screen.findByText('PRF-JC95FJ')

    const linha = resolver('PRF-JC95FJ')

    expect(within(linha).getByRole('button', { name: 'Registrar descarte' })).toBeInTheDocument()
    const outra = screen.getByText('PRF-6KJXCQ').closest('li') as HTMLElement
    expect(within(outra).getByRole('button', { name: 'Resolver' })).toBeInTheDocument()
    expect(within(outra).queryByRole('button', { name: 'Registrar descarte' })).toBeNull()
  })

  it('não oferece o override: na fila não há venda acontecendo', async () => {
    buscar.mockResolvedValueOnce(fila([VENCIDA]))

    render(<TelaDescartesPendentes usuario={GESTOR} />)
    await screen.findByText('PRF-JC95FJ')

    resolver('PRF-JC95FJ')

    // Nem para GESTOR: o override é escape do balcão, com cliente na frente
    // (T13, Decisão 1). Os outros dois caminhos continuam ali.
    expect(screen.queryByRole('button', { name: /autorizar a venda/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Registrar descarte' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Corrigir validade' })).toBeInTheDocument()
  })

  it('descarta pela fila sem sessaoVendaId e tira a linha da lista', async () => {
    buscar.mockResolvedValueOnce(fila([VENCIDA, OUTRA_VENCIDA]))
    buscar.mockResolvedValueOnce(
      respostaFalsa(201, {
        resultado: 'DESCARTE_REGISTRADO',
        unidade: VENCIDA,
        descarte: {
          id: '66666666-6666-6666-6666-666666666666',
          dataHora: '2026-09-08T18:00:00.000Z',
          motivo: 'Unidade vencida constatada na leitura de saída.',
        },
        mensagem: 'Descarte registrado. A unidade saiu do estoque.',
      }),
    )

    render(<TelaDescartesPendentes usuario={GESTOR} />)
    await screen.findByText('PRF-JC95FJ')

    resolver('PRF-JC95FJ')
    fireEvent.click(screen.getByRole('button', { name: 'Registrar descarte' }))

    expect(await screen.findByText('Descarte registrado. A unidade saiu do estoque.')).toBeInTheDocument()
    expect(screen.queryByText('PRF-JC95FJ')).toBeNull()
    expect(screen.getByText('PRF-6KJXCQ')).toBeInTheDocument()

    // Varredura de estoque não é atendimento: inventar um agrupador aqui
    // poluiria o relatório com atendimentos que nunca existiram (T09).
    const [, envio] = buscar.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(envio.body as string)).toEqual({ unidadeId: VENCIDA.id })
  })

  it('correção recarrega a fila em vez de a tela adivinhar o novo estado', async () => {
    buscar.mockResolvedValueOnce(fila([VENCIDA]))
    buscar.mockResolvedValueOnce(
      respostaFalsa(200, {
        correcao: { dataValidadeAnterior: '2026-07-01', dataValidadeNova: '2027-03-01' },
        revalidacao: {
          veredito: 'CONFIRMAR',
          codigoQr: VENCIDA.codigoQr,
          unidade: { ...VENCIDA, dataValidade: '2027-03-01' },
          mensagem: 'Saída registrada. Pode entregar esta unidade.',
        },
      }),
    )
    buscar.mockResolvedValueOnce(fila([]))

    render(<TelaDescartesPendentes usuario={GESTOR} />)
    await screen.findByText('PRF-JC95FJ')

    resolver('PRF-JC95FJ')
    fireEvent.change(screen.getByLabelText('Validade impressa na embalagem'), {
      target: { value: '2027-03-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir validade' }))

    // A revalidação pode terminar em venda, em bloqueio ou de novo em unidade
    // vencida — quem sabe é o servidor, e a fila é relida.
    expect(await screen.findByText('Saída registrada. Pode entregar esta unidade.')).toBeInTheDocument()
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(3))
    expect(await screen.findByText('Nenhuma unidade vencida em estoque.')).toBeInTheDocument()

    const [, envio] = buscar.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(envio.body as string)).toEqual({
      unidadeId: VENCIDA.id,
      dataValidade: '2027-03-01',
    })
  })

  it('409 UNIDADE_JA_BAIXADA mostra a mensagem do servidor e relê a fila', async () => {
    buscar.mockResolvedValueOnce(fila([VENCIDA]))
    buscar.mockResolvedValueOnce(
      respostaFalsa(409, {
        erro: 'UNIDADE_JA_BAIXADA',
        mensagem: 'Esta unidade já saiu do estoque — foi vendida ou descartada. Nada a resolver.',
      }),
    )
    buscar.mockResolvedValueOnce(fila([]))

    render(<TelaDescartesPendentes usuario={GESTOR} />)
    await screen.findByText('PRF-JC95FJ')

    resolver('PRF-JC95FJ')
    fireEvent.click(screen.getByRole('button', { name: 'Registrar descarte' }))

    // Lista velha: alguém resolveu esta unidade desde que a fila carregou.
    expect(
      await screen.findByText(
        'Esta unidade já saiu do estoque — foi vendida ou descartada. Nada a resolver.',
      ),
    ).toBeInTheDocument()
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(3))
    expect(screen.queryByText('PRF-JC95FJ')).toBeNull()
  })

  it('pagina pedindo a página seguinte ao servidor', async () => {
    const muitas = Array.from({ length: 20 }, (_, indice) => ({
      ...VENCIDA,
      id: `unidade-${indice}`,
      codigoQr: `PRF-00000${indice}`,
    }))
    buscar.mockResolvedValueOnce(fila(muitas, 25))
    buscar.mockResolvedValueOnce(fila([OUTRA_VENCIDA], 25))

    render(<TelaDescartesPendentes usuario={GESTOR} />)
    await screen.findByText('PRF-000000')

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))

    expect(await screen.findByText('PRF-6KJXCQ')).toBeInTheDocument()
    expect(buscar.mock.calls[1]?.[0]).toBe('http://localhost:3333/descartes/pendentes?pagina=2')
  })
})
