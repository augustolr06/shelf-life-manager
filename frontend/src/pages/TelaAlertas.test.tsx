import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaAlertas } from './TelaAlertas'
import { respostaFalsa } from '../services/testes/respostaFalsa'
import type { Alerta } from '../services/alertas'

/**
 * A entrega do alerta proativo (RF08, T19).
 *
 * A tela não decide nada: o que está na janela, a ordem, os dias que faltam e
 * se a unidade já venceu vêm prontos do servidor. O que estes testes verificam
 * é isso — que a lista reflete a resposta, que `situacao` (e não o sinal de
 * `diasParaVencer`) é o que muda o texto, e que marcar como lido não some com
 * o alerta a não ser quando o filtro pede.
 */

const NA_JANELA: Alerta = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  geradoEm: '2026-09-09T09:00:00.000Z',
  lidoEm: null,
  diasParaVencer: 12,
  situacao: 'NA_JANELA',
  janela: { configuracaoId: 'cfg-30', diasAntecedencia: 30, canal: 'IN_APP' },
  unidade: {
    id: 'unidade-1',
    codigoQr: 'PRF-JC95FJ',
    dataValidade: '2026-09-21',
    produto: {
      id: 'produto-1',
      codigoInterno: 'PRF-001',
      nome: 'Eau de Parfum 50ml',
      marca: 'Marca Exemplo',
    },
  },
}

const VENCIDO: Alerta = {
  ...NA_JANELA,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  diasParaVencer: -3,
  situacao: 'VENCIDA',
  unidade: { ...NA_JANELA.unidade, id: 'unidade-2', codigoQr: 'PRF-6KJXCQ' },
}

function pagina(
  alertas: Alerta[],
  extras: { total?: number; naoLidos?: number; tamanhoPagina?: number } = {},
) {
  return respostaFalsa(200, {
    alertas,
    total: extras.total ?? alertas.length,
    naoLidos: extras.naoLidos ?? alertas.filter((a) => a.lidoEm === null).length,
    pagina: 1,
    tamanhoPagina: extras.tamanhoPagina ?? 20,
  })
}

const buscar = vi.fn<typeof fetch>()

describe('TelaAlertas (RF08)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lista o alerta com produto, etiqueta, validade e a janela que o gerou', async () => {
    buscar.mockResolvedValueOnce(pagina([NA_JANELA]))

    render(<TelaAlertas />)

    expect(await screen.findByText('Eau de Parfum 50ml')).toBeInTheDocument()
    expect(screen.getByText('PRF-JC95FJ')).toBeInTheDocument()
    expect(screen.getByText('21/09/2026')).toBeInTheDocument()
    expect(screen.getByText('Vence em')).toBeInTheDocument()
    expect(screen.getByText('12 dias')).toBeInTheDocument()
    expect(screen.getByText('avisado 30 dias antes')).toBeInTheDocument()
  })

  it('marca o alerta cuja unidade venceu e aponta para a fila de descarte', async () => {
    buscar.mockResolvedValueOnce(pagina([VENCIDO]))

    render(<TelaAlertas />)

    // O rótulo vem de `situacao`, não de a tela comparar datas (RNF01/RNF04).
    expect(await screen.findByText('Vencida há')).toBeInTheDocument()
    expect(screen.getByText('3 dias')).toBeInTheDocument()
    expect(screen.getByText(/está na fila de descarte/i)).toBeInTheDocument()
  })

  it('não decide nada sobre validade: exibe o alerta lido do jeito que o servidor mandou', async () => {
    buscar.mockResolvedValueOnce(pagina([{ ...NA_JANELA, lidoEm: '2026-09-09T10:00:00.000Z' }]))

    render(<TelaAlertas />)

    expect(await screen.findByText('Lido')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar como lido' })).not.toBeInTheDocument()
  })

  it('estado vazio é o desejado, não erro', async () => {
    buscar.mockResolvedValueOnce(pagina([]))

    render(<TelaAlertas />)

    expect(
      await screen.findByText('Nenhuma unidade dentro da janela de alerta.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('mostra a mensagem do servidor quando o carregamento falha', async () => {
    buscar.mockResolvedValueOnce(
      respostaFalsa(403, { erro: 'PAPEL_INSUFICIENTE', mensagem: 'Seu papel não permite esta ação.' }),
    )

    render(<TelaAlertas />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Seu papel não permite esta ação.')
  })

  it('marcar como lido mantém o alerta na lista e derruba o contador', async () => {
    const naoLidos = vi.fn()
    buscar.mockResolvedValueOnce(pagina([NA_JANELA], { naoLidos: 1 }))
    buscar.mockResolvedValueOnce(
      respostaFalsa(200, { alerta: { ...NA_JANELA, lidoEm: '2026-09-09T10:00:00.000Z' } }),
    )

    render(<TelaAlertas aoAtualizarNaoLidos={naoLidos} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Marcar como lido' }))

    expect(await screen.findByText('Lido')).toBeInTheDocument()
    // Continua visível: marcar não esconde nada quando o filtro está desligado.
    expect(screen.getByText('PRF-JC95FJ')).toBeInTheDocument()
    await waitFor(() => expect(naoLidos).toHaveBeenLastCalledWith(0))

    const chamada = buscar.mock.calls[1]
    expect(String(chamada?.[0])).toContain(`/alertas/${NA_JANELA.id}/lido`)
    expect(chamada?.[1]).toMatchObject({ method: 'POST' })
  })

  it('com o filtro de não lidos, o alerta marcado sai da lista', async () => {
    buscar.mockResolvedValueOnce(pagina([NA_JANELA], { naoLidos: 1 }))
    buscar.mockResolvedValueOnce(pagina([NA_JANELA], { naoLidos: 1 }))
    buscar.mockResolvedValueOnce(
      respostaFalsa(200, { alerta: { ...NA_JANELA, lidoEm: '2026-09-09T10:00:00.000Z' } }),
    )

    render(<TelaAlertas />)
    await screen.findByText('PRF-JC95FJ')

    fireEvent.click(screen.getByLabelText('Mostrar só os não lidos'))

    await waitFor(() =>
      expect(String(buscar.mock.calls[1]?.[0])).toContain('apenasNaoLidos=true'),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Marcar como lido' }))

    expect(await screen.findByText('Nenhum alerta não lido.')).toBeInTheDocument()
  })

  it('pagina pedindo a página seguinte ao servidor', async () => {
    const muitos = Array.from({ length: 20 }, (_, indice) => ({
      ...NA_JANELA,
      id: `alerta-${indice}`,
      unidade: { ...NA_JANELA.unidade, id: `unidade-${indice}`, codigoQr: `PRF-00000${indice}` },
    }))
    buscar.mockResolvedValueOnce(pagina(muitos, { total: 25, naoLidos: 25 }))
    buscar.mockResolvedValueOnce(pagina([NA_JANELA], { total: 25, naoLidos: 25 }))

    render(<TelaAlertas />)
    await screen.findByText('PRF-000000')

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))

    await waitFor(() => expect(String(buscar.mock.calls[1]?.[0])).toContain('pagina=2'))
  })

  it('exibe o resumo com total e não lidos', async () => {
    buscar.mockResolvedValueOnce(pagina([NA_JANELA, VENCIDO], { total: 2, naoLidos: 2 }))

    render(<TelaAlertas />)

    const resumo = await screen.findByText(/2 alerta\(s\)/)
    expect(resumo).toHaveTextContent('2 não lido(s)')
  })
})
