import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaUsuarios } from './TelaUsuarios'
import { encontrarAviso, renderizarComAvisos } from '../services/testes/avisos'
import { respostaFalsa } from '../services/testes/respostaFalsa'
import type { Usuario } from '../services/auth'

const GESTOR: Usuario = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Gestora de Loja',
  email: 'gestor@estoque.local',
  papel: 'GESTOR',
}

const CONTA_GESTOR = { ...GESTOR, ativo: true }

const CONTA_ATENDENTE = {
  id: '22222222-2222-2222-2222-222222222222',
  nome: 'Atendente de Balcão',
  email: 'atendente@estoque.local',
  papel: 'ATENDENTE' as const,
  ativo: true,
}

const buscar = vi.fn<typeof fetch>()

function lista(usuarios: unknown[]) {
  return respostaFalsa(200, { usuarios })
}

function linhaDe(nome: string) {
  return within(screen.getByRole('row', { name: new RegExp(nome) }))
}

describe('TelaUsuarios (RF01, T22)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lista as contas sem pedir as desativadas por padrão', async () => {
    buscar.mockResolvedValueOnce(lista([CONTA_GESTOR, CONTA_ATENDENTE]))

    renderizarComAvisos(<TelaUsuarios usuario={GESTOR} />)

    expect(await screen.findByText('atendente@estoque.local')).toBeInTheDocument()
    expect(buscar.mock.calls[0]?.[0]).toBe('http://localhost:3333/usuarios')
  })

  it('pede as desativadas quando a caixa é marcada', async () => {
    buscar.mockResolvedValue(lista([CONTA_GESTOR]))

    renderizarComAvisos(<TelaUsuarios usuario={GESTOR} />)
    await screen.findByText('gestor@estoque.local')

    fireEvent.click(screen.getByLabelText('Mostrar contas desativadas'))

    await waitFor(() => {
      expect(buscar.mock.calls[1]?.[0]).toBe('http://localhost:3333/usuarios?incluirInativos=true')
    })
  })

  it('cria conta com o papel escolhido e recarrega a lista', async () => {
    buscar.mockResolvedValueOnce(lista([CONTA_GESTOR]))
    buscar.mockResolvedValueOnce(respostaFalsa(201, { usuario: CONTA_ATENDENTE }))
    buscar.mockResolvedValueOnce(lista([CONTA_GESTOR, CONTA_ATENDENTE]))

    renderizarComAvisos(<TelaUsuarios usuario={GESTOR} />)
    await screen.findByText('gestor@estoque.local')

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Nova Atendente' } })
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nova@loja.com' } })
    fireEvent.change(screen.getByLabelText('Papel'), { target: { value: 'ATENDENTE' } })
    fireEvent.change(screen.getByLabelText('Senha inicial'), {
      target: { value: 'senha-inicial-2026' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^criar conta$/i }))

    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(3))
    await encontrarAviso('Conta de Atendente de Balcão criada.')
    const chamada = buscar.mock.calls[1]
    expect(chamada?.[0]).toBe('http://localhost:3333/usuarios')
    expect(JSON.parse(String(chamada?.[1]?.body))).toMatchObject({
      nome: 'Nova Atendente',
      email: 'nova@loja.com',
      papel: 'ATENDENTE',
      senha: 'senha-inicial-2026',
    })
  })

  // RNF04: a mensagem exibida é a que o backend escreveu, não um texto local.
  it('mostra a recusa do backend ao criar conta com e-mail repetido', async () => {
    buscar.mockResolvedValueOnce(lista([CONTA_GESTOR]))
    buscar.mockResolvedValueOnce(
      respostaFalsa(409, {
        erro: 'EMAIL_EM_USO',
        mensagem: 'Já existe uma conta com esse e-mail.',
      }),
    )

    renderizarComAvisos(<TelaUsuarios usuario={GESTOR} />)
    await screen.findByText('gestor@estoque.local')

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Repetida' } })
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'gestor@estoque.local' } })
    fireEvent.change(screen.getByLabelText('Senha inicial'), {
      target: { value: 'senha-inicial-2026' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^criar conta$/i }))

    expect((await encontrarAviso('Já existe uma conta com esse e-mail.')).tipo).toBe('error')
    // O formulário fica preenchido para a correção.
    expect(screen.getByLabelText('Nome')).toHaveValue('Repetida')
  })

  it('desativa outra conta e some com ela da lista corrente', async () => {
    buscar.mockResolvedValueOnce(lista([CONTA_GESTOR, CONTA_ATENDENTE]))
    buscar.mockResolvedValueOnce(
      respostaFalsa(200, { usuario: { ...CONTA_ATENDENTE, ativo: false } }),
    )
    buscar.mockResolvedValueOnce(lista([CONTA_GESTOR]))

    renderizarComAvisos(<TelaUsuarios usuario={GESTOR} />)
    await screen.findByText('atendente@estoque.local')

    fireEvent.click(linhaDe('Atendente de Balcão').getByRole('button', { name: 'Desativar' }))

    await waitFor(() => expect(screen.queryByText('atendente@estoque.local')).toBeNull())
    await encontrarAviso('Conta de Atendente de Balcão desativada.')
    const chamada = buscar.mock.calls[1]
    expect(JSON.parse(String(chamada?.[1]?.body))).toEqual({ ativo: false })
  })

  it('troca o papel de outra conta pelo seletor da linha', async () => {
    buscar.mockResolvedValueOnce(lista([CONTA_GESTOR, CONTA_ATENDENTE]))
    buscar.mockResolvedValueOnce(
      respostaFalsa(200, { usuario: { ...CONTA_ATENDENTE, papel: 'GESTOR' } }),
    )

    renderizarComAvisos(<TelaUsuarios usuario={GESTOR} />)
    await screen.findByText('atendente@estoque.local')

    fireEvent.change(screen.getByLabelText('Papel de Atendente de Balcão'), {
      target: { value: 'GESTOR' },
    })

    await encontrarAviso('Atendente de Balcão agora é gestor.')
    const chamada = buscar.mock.calls[1]
    expect(chamada?.[0]).toBe(`http://localhost:3333/usuarios/${CONTA_ATENDENTE.id}`)
    expect(JSON.parse(String(chamada?.[1]?.body))).toEqual({ papel: 'GESTOR' })
  })

  it('avisa em toast a recusa do backend ao trocar o papel (T29)', async () => {
    buscar.mockResolvedValueOnce(lista([CONTA_GESTOR, CONTA_ATENDENTE]))
    buscar.mockResolvedValueOnce(
      respostaFalsa(409, {
        erro: 'ULTIMO_GESTOR',
        mensagem: 'A loja precisa de pelo menos um gestor ativo.',
      }),
    )

    renderizarComAvisos(<TelaUsuarios usuario={GESTOR} />)
    await screen.findByText('atendente@estoque.local')

    fireEvent.change(screen.getByLabelText('Papel de Atendente de Balcão'), {
      target: { value: 'GESTOR' },
    })

    expect((await encontrarAviso('A loja precisa de pelo menos um gestor ativo.')).tipo).toBe(
      'error',
    )
    // A lista continua na tela: a recusa é da ação, não do carregamento.
    expect(screen.getByText('atendente@estoque.local')).toBeInTheDocument()
  })

  // Conveniência de interface, não autorização: quem recusa é o 409 do
  // backend. A tela só evita oferecer o caminho que vai ser recusado.
  it('não oferece desativar nem trocar o papel da própria conta', async () => {
    buscar.mockResolvedValueOnce(lista([CONTA_GESTOR, CONTA_ATENDENTE]))

    renderizarComAvisos(<TelaUsuarios usuario={GESTOR} />)
    await screen.findByText('gestor@estoque.local')

    const minhaLinha = linhaDe('Gestora de Loja')
    expect(minhaLinha.queryByRole('button', { name: 'Desativar' })).toBeNull()
    expect(minhaLinha.queryByRole('button', { name: 'Redefinir senha' })).toBeNull()
    expect(minhaLinha.getByLabelText('Papel de Gestora de Loja')).toBeDisabled()
    expect(minhaLinha.getByText(/Minha senha/)).toBeInTheDocument()
  })

  it('redefine a senha de outra conta e confirma na tela', async () => {
    buscar.mockResolvedValueOnce(lista([CONTA_GESTOR, CONTA_ATENDENTE]))
    buscar.mockResolvedValueOnce(respostaFalsa(204))

    renderizarComAvisos(<TelaUsuarios usuario={GESTOR} />)
    await screen.findByText('atendente@estoque.local')

    fireEvent.click(linhaDe('Atendente de Balcão').getByRole('button', { name: 'Redefinir senha' }))
    fireEvent.change(screen.getByLabelText('Nova senha'), {
      target: { value: 'senha-redefinida-2026' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar senha' }))

    expect(
      (await encontrarAviso('Senha redefinida para Atendente de Balcão. Informe a pessoa.')).tipo,
    ).toBe('success')
    const chamada = buscar.mock.calls[1]
    expect(chamada?.[0]).toBe(`http://localhost:3333/usuarios/${CONTA_ATENDENTE.id}/senha`)
    expect(JSON.parse(String(chamada?.[1]?.body))).toEqual({ senha: 'senha-redefinida-2026' })
  })
})
