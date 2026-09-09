import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaConfiguracaoAlerta } from './TelaConfiguracaoAlerta'
import { respostaFalsa } from '../services/testes/respostaFalsa'
import type { ConfiguracaoAlerta } from '../services/configuracaoAlerta'

/**
 * Configuração da janela de antecedência (RF08, T17).
 *
 * A tela não decide nada: o mínimo, o máximo e a recusa de duas janelas iguais
 * são do servidor, e o que estes testes verificam é que ela exibe o que
 * recebeu e envia o que o gestor digitou — inclusive no 409, que é o caso que
 * ele vai encontrar de verdade.
 */

const TRINTA: ConfiguracaoAlerta = {
  id: '11111111-1111-1111-1111-111111111111',
  diasAntecedencia: 30,
  canal: 'IN_APP',
  ativo: true,
}

const SETE: ConfiguracaoAlerta = {
  id: '22222222-2222-2222-2222-222222222222',
  diasAntecedencia: 7,
  canal: 'AMBOS',
  ativo: false,
}

function lista(configuracoes: ConfiguracaoAlerta[]) {
  return respostaFalsa(200, { configuracoes })
}

const buscar = vi.fn<typeof fetch>()

/** O corpo JSON enviado na chamada de índice `n`. */
function corpoDaChamada(n: number): unknown {
  const [, init] = buscar.mock.calls[n] as [string, RequestInit]
  return JSON.parse(String(init.body))
}

/** A linha da tabela cuja antecedência está na tela. */
function linhaDe(rotulo: string): HTMLElement {
  return screen.getByText(rotulo).closest('tr') as HTMLElement
}

describe('TelaConfiguracaoAlerta (RF08)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lista as janelas com antecedência, canal em português e situação', async () => {
    buscar.mockResolvedValueOnce(lista([TRINTA, SETE]))

    render(<TelaConfiguracaoAlerta />)

    expect(await screen.findByText('30 dias antes')).toBeInTheDocument()
    // Sempre dentro da linha: os mesmos rótulos existem como <option> do
    // seletor de canal do formulário.
    const ativa = within(linhaDe('30 dias antes'))
    expect(ativa.getByText('No aplicativo')).toBeInTheDocument()
    expect(ativa.getByText('Ativa')).toBeInTheDocument()

    // A inativa vem junto: sem ela na lista não haveria como reativá-la.
    expect(screen.getByText('7 dias antes')).toBeInTheDocument()
    const inativa = within(linhaDe('7 dias antes'))
    expect(inativa.getByText('No aplicativo e push')).toBeInTheDocument()
    expect(inativa.getByText('Inativa')).toBeInTheDocument()

    expect(buscar).toHaveBeenCalledWith(
      'http://localhost:3333/configuracao-alerta',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('aponta para a aba de alertas e condiciona o push à autorização do aparelho', async () => {
    buscar.mockResolvedValueOnce(lista([TRINTA]))

    render(<TelaConfiguracaoAlerta />)
    await screen.findByText('30 dias antes')

    // Quarta versão do aviso (T19b): o push existe, e o que resta por dizer é
    // que ele depende de cada aparelho ter autorizado. Sem esta linha, uma
    // janela configurada como push pareceria notificar todo mundo.
    expect(screen.getByText(/verificação periódica roda automaticamente/i)).toBeInTheDocument()
    expect(
      screen.getByText(/para os aparelhos que tiverem autorizado o recebimento/i),
    ).toBeInTheDocument()
  })

  it('mostra o bloco de notificações deste aparelho', async () => {
    buscar.mockResolvedValueOnce(lista([TRINTA]))

    render(<TelaConfiguracaoAlerta />)
    await screen.findByText('30 dias antes')

    // Em jsdom não há service worker nem PushManager, então o bloco cai no
    // estado "indisponível" — que é justamente o que a gestora vê num
    // navegador sem suporte, e o que garante que ele não pede nada ao
    // servidor nesse caso.
    expect(screen.getByRole('heading', { name: 'Notificações neste aparelho' })).toBeInTheDocument()
    expect(screen.getByText(/não oferece notificações/i)).toBeInTheDocument()
    expect(buscar).toHaveBeenCalledTimes(1)
  })

  it('lista vazia tem estado próprio, não erro', async () => {
    buscar.mockResolvedValueOnce(lista([]))

    render(<TelaConfiguracaoAlerta />)

    expect(await screen.findByText('Nenhuma janela de antecedência configurada.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('erro de carregamento exibe a mensagem do servidor', async () => {
    buscar.mockResolvedValueOnce(
      respostaFalsa(403, { erro: 'PAPEL_INSUFICIENTE', mensagem: 'Seu papel não permite esta ação.' }),
    )

    render(<TelaConfiguracaoAlerta />)

    expect(await screen.findByText('Seu papel não permite esta ação.')).toBeInTheDocument()
  })

  it('cadastrar envia dias e canal e recarrega a lista', async () => {
    buscar
      .mockResolvedValueOnce(lista([]))
      .mockResolvedValueOnce(respostaFalsa(201, { configuracao: SETE }))
      .mockResolvedValueOnce(lista([SETE]))

    render(<TelaConfiguracaoAlerta />)
    await screen.findByText('Nenhuma janela de antecedência configurada.')

    fireEvent.change(screen.getByLabelText('Dias de antecedência'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Como avisar'), { target: { value: 'AMBOS' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar janela' }))

    expect(await screen.findByText('7 dias antes')).toBeInTheDocument()

    const [url, init] = buscar.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('http://localhost:3333/configuracao-alerta')
    expect(init.method).toBe('POST')
    // Número, não string: o schema do backend exige inteiro.
    expect(corpoDaChamada(1)).toEqual({ diasAntecedencia: 7, canal: 'AMBOS' })
  })

  it('antecedência repetida exibe a mensagem do servidor e mantém o formulário preenchido', async () => {
    buscar.mockResolvedValueOnce(lista([TRINTA])).mockResolvedValueOnce(
      respostaFalsa(409, {
        erro: 'ANTECEDENCIA_JA_CONFIGURADA',
        mensagem:
          'Já existe uma configuração ativa com essa antecedência. Altere a existente em vez de criar uma segunda.',
      }),
    )

    render(<TelaConfiguracaoAlerta />)
    await screen.findByText('30 dias antes')

    fireEvent.change(screen.getByLabelText('Dias de antecedência'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar janela' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Já existe uma configuração ativa com essa antecedência/,
    )
    // O gestor vai querer só trocar o número, não redigitar tudo.
    expect(screen.getByLabelText('Dias de antecedência')).toHaveValue(30)
    // Recusa não recarrega: a lista continua sendo a de uma chamada só.
    expect(buscar).toHaveBeenCalledTimes(2)
  })

  it('alterar envia só o campo que mudou', async () => {
    buscar
      .mockResolvedValueOnce(lista([TRINTA]))
      .mockResolvedValueOnce(respostaFalsa(200, { configuracao: { ...TRINTA, canal: 'PUSH' } }))

    render(<TelaConfiguracaoAlerta />)
    await screen.findByText('30 dias antes')

    fireEvent.click(within(linhaDe('30 dias antes')).getByRole('button', { name: 'Alterar' }))
    fireEvent.change(screen.getByLabelText('Como avisar', { selector: '#canal-' + TRINTA.id }), {
      target: { value: 'PUSH' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(within(linhaDe('30 dias antes')).getByText('Notificação push')).toBeInTheDocument(),
    )

    const [url, init] = buscar.mock.calls[1] as [string, RequestInit]
    expect(url).toBe(`http://localhost:3333/configuracao-alerta/${TRINTA.id}`)
    expect(init.method).toBe('PATCH')
    // A antecedência não mudou e não vai no corpo — reenviá-la dispararia a
    // verificação de colisão contra a própria linha sem necessidade.
    expect(corpoDaChamada(1)).toEqual({ canal: 'PUSH' })
  })

  it('alterar sem mexer em nada não chama a API', async () => {
    buscar.mockResolvedValueOnce(lista([TRINTA]))

    render(<TelaConfiguracaoAlerta />)
    await screen.findByText('30 dias antes')

    fireEvent.click(within(linhaDe('30 dias antes')).getByRole('button', { name: 'Alterar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(screen.getByText('30 dias antes')).toBeInTheDocument())
    expect(buscar).toHaveBeenCalledTimes(1)
  })

  it('inativar chama DELETE e a linha passa a Inativa', async () => {
    buscar
      .mockResolvedValueOnce(lista([TRINTA]))
      .mockResolvedValueOnce(respostaFalsa(200, { configuracao: { ...TRINTA, ativo: false } }))

    render(<TelaConfiguracaoAlerta />)
    await screen.findByText('30 dias antes')

    fireEvent.click(within(linhaDe('30 dias antes')).getByRole('button', { name: 'Inativar' }))

    expect(await within(linhaDe('30 dias antes')).findByText('Inativa')).toBeInTheDocument()

    const [url, init] = buscar.mock.calls[1] as [string, RequestInit]
    expect(url).toBe(`http://localhost:3333/configuracao-alerta/${TRINTA.id}`)
    expect(init.method).toBe('DELETE')
  })

  it('reativar chama PATCH com ativo true', async () => {
    buscar
      .mockResolvedValueOnce(lista([SETE]))
      .mockResolvedValueOnce(respostaFalsa(200, { configuracao: { ...SETE, ativo: true } }))

    render(<TelaConfiguracaoAlerta />)
    await screen.findByText('7 dias antes')

    fireEvent.click(within(linhaDe('7 dias antes')).getByRole('button', { name: 'Reativar' }))

    expect(await within(linhaDe('7 dias antes')).findByText('Ativa')).toBeInTheDocument()

    const [, init] = buscar.mock.calls[1] as [string, RequestInit]
    expect(init.method).toBe('PATCH')
    expect(corpoDaChamada(1)).toEqual({ ativo: true })
  })

  it('reativação recusada exibe a mensagem do servidor e mantém a linha inativa', async () => {
    buscar.mockResolvedValueOnce(lista([SETE])).mockResolvedValueOnce(
      respostaFalsa(409, {
        erro: 'ANTECEDENCIA_JA_CONFIGURADA',
        mensagem: 'Já existe uma configuração ativa com essa antecedência.',
      }),
    )

    render(<TelaConfiguracaoAlerta />)
    await screen.findByText('7 dias antes')

    fireEvent.click(within(linhaDe('7 dias antes')).getByRole('button', { name: 'Reativar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Já existe uma configuração ativa com essa antecedência/,
    )
    expect(within(linhaDe('7 dias antes')).getByText('Inativa')).toBeInTheDocument()
  })
})
