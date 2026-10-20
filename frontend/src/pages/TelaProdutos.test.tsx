import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
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

const buscar = vi.fn<typeof fetch>()

/** Uma resposta que só chega quando o teste mandar, para controlar a ordem. */
function respostaAdiada() {
  let entregar!: (resposta: Response) => void
  const promessa = new Promise<Response>((resolver) => {
    entregar = resolver
  })
  return { promessa, entregar }
}

/** Preenche o formulário de cadastro e submete. */
function cadastrar(codigo: string) {
  fireEvent.change(screen.getByLabelText('Código interno'), { target: { value: codigo } })
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Eau de Parfum 50ml' } })
  fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Marca Exemplo' } })
  fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'Perfumaria' } })
  fireEvent.click(screen.getByRole('button', { name: /^cadastrar$/i }))
}

describe('TelaProdutos (RF02)', () => {
  beforeEach(() => {
    buscar.mockReset()
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lista o catálogo sem pedir inativos por padrão', async () => {
    buscar.mockResolvedValueOnce(pagina([PERFUME]))

    renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)

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

    renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
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
    // Formulário limpo para o próximo cadastro.
    expect(screen.getByLabelText('Código interno')).toHaveValue('')
  })

  it('exibe a mensagem do backend quando o código interno já existe', async () => {
    buscar.mockResolvedValueOnce(pagina([])).mockResolvedValueOnce(
      respostaFalsa(409, {
        erro: 'CODIGO_INTERNO_EM_USO',
        mensagem: 'Já existe um produto com esse código interno.',
      }),
    )

    renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
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

    renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
    await screen.findByText('PRF-001')

    fireEvent.click(screen.getByLabelText(/mostrar produtos inativos/i))

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

    renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
    await screen.findByText('PRF-001')

    // Com o filtro de inativos ligado, a linha permanece visível após a baixa.
    fireEvent.click(screen.getByLabelText(/mostrar produtos inativos/i))
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: /inativar/i }))
    await responderConfirmacao('Inativar produto?', 'Inativar')

    expect(await screen.findByRole('button', { name: /reativar/i })).toBeInTheDocument()
    await encontrarAviso('Produto “Eau de Parfum 50ml” inativado.')
    const linha = screen.getByText('PRF-001').closest('tr')
    expect(within(linha as HTMLElement).getByText('Inativo')).toBeInTheDocument()
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

    renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
    fireEvent.click(await screen.findByRole('button', { name: /reativar/i }))

    // Reativar desfaz uma inativação, sem perda: não pergunta (T39).
    expect(await screen.findByRole('button', { name: /inativar/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(buscar).toHaveBeenLastCalledWith(
      `http://localhost:3333/produtos/${PERFUME.id}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ ativo: true }) }),
    )
  })

  it('não oferece cadastro nem ações de escrita ao ATENDENTE', async () => {
    buscar.mockResolvedValueOnce(pagina([PERFUME]))

    renderizarComAvisos(<TelaProdutos usuario={ATENDENTE} />)
    await screen.findByText('PRF-001')

    // Esconder é conveniência de interface; a recusa real continua sendo o
    // 403 do backend (RNF04).
    expect(screen.queryByLabelText('Código interno')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /inativar/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Arquivo CSV')).not.toBeInTheDocument()
  })

  it('avisa quando o catálogo não pôde ser carregado', async () => {
    buscar.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)

    // Falha ao carregar é estado da tela, e fica nela — não é toast (T29).
    expect(await screen.findByRole('alert')).toHaveTextContent(/conexão/i)
    expect(await semAvisos()).toBe(true)
  })

  it('avisa em toast quando a inativação falha, sem trocar a lista por erro (T29)', async () => {
    buscar
      .mockResolvedValueOnce(pagina([PERFUME]))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))

    renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
    fireEvent.click(await screen.findByRole('button', { name: /inativar/i }))
    await responderConfirmacao('Inativar produto?', 'Inativar')

    expect((await encontrarAviso(/conexão/i)).tipo).toBe('error')
    expect(screen.getByText('PRF-001')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  describe('confirmação antes de inativar (T39)', () => {
    it('cita o produto e diz o que acontece com o estoque, com o foco em Cancelar', async () => {
      buscar.mockResolvedValueOnce(pagina([PERFUME]))

      renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
      fireEvent.click(await screen.findByRole('button', { name: /inativar/i }))

      const dialogo = await encontrarConfirmacao('Inativar produto?')
      expect(dialogo).toHaveAccessibleDescription(
        /“Eau de Parfum 50ml” deixa de receber unidades novas.*As unidades que já estão em estoque continuam podendo ser vendidas/,
      )
      expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })

    it('cancelar não chama a API e deixa o produto ativo', async () => {
      buscar.mockResolvedValueOnce(pagina([PERFUME]))

      renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
      fireEvent.click(await screen.findByRole('button', { name: /inativar/i }))
      await responderConfirmacao('Inativar produto?', 'Cancelar')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(buscar).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Ativo')).toBeInTheDocument()
    })

    it('Esc cancela, como o botão', async () => {
      buscar.mockResolvedValueOnce(pagina([PERFUME]))

      renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
      fireEvent.click(await screen.findByRole('button', { name: /inativar/i }))
      fireEvent.keyDown(await encontrarConfirmacao('Inativar produto?'), { key: 'Escape' })

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(buscar).toHaveBeenCalledTimes(1)
    })

    it('confirmar chama a API uma vez', async () => {
      buscar
        .mockResolvedValueOnce(pagina([PERFUME]))
        .mockResolvedValueOnce(respostaFalsa(200, { produto: { ...PERFUME, ativo: false } }))
        .mockResolvedValueOnce(pagina([]))

      renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
      fireEvent.click(await screen.findByRole('button', { name: /inativar/i }))
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

    it('busca depois da pausa na digitação, uma vez só, sem botão Buscar', async () => {
      buscar.mockResolvedValue(pagina([PERFUME]))
      renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
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
      renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
      await screen.findByText('PRF-001')

      fireEvent.click(screen.getByLabelText(/mostrar produtos inativos/i))
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
      renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
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
      renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
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
      renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
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
      renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
      await screen.findByText(/nenhum produto encontrado/i)

      digitarEEsperar('col')
      digitarEEsperar('colônia')

      atual.entregar(pagina([COLONIA]))
      expect(await screen.findByText('COL-002')).toBeInTheDocument()

      await act(async () => antiga.entregar(pagina([PERFUME])))

      expect(screen.getByText('COL-002')).toBeInTheDocument()
      expect(screen.queryByText('PRF-001')).not.toBeInTheDocument()
      expect(screen.getByText(/1 produto\(s\)/)).toBeInTheDocument()
    })

    it('termo novo volta para a primeira página', async () => {
      buscar.mockResolvedValue(pagina([PERFUME], 45))
      renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
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
      renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
      await screen.findByText('PRF-001')

      expect(campoBusca()).toHaveAttribute('maxLength', '120')
    })
  })

  describe('limite de 120 caracteres (T25)', () => {
    const LONGO = 'x'.repeat(130)

    async function abrirFormulario() {
      buscar.mockResolvedValueOnce(pagina([]))
      renderizarComAvisos(<TelaProdutos usuario={GESTOR} />)
      await screen.findByText(/nenhum produto encontrado/i)
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
