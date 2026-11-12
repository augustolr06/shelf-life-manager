import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CadastroProduto, RASCUNHO_INICIAL, type RascunhoCadastro } from './CadastroProduto'
import { encontrarAviso, renderizarComAvisos } from '../services/testes/avisos'
import { respostaFalsa } from '../services/testes/respostaFalsa'
import type { Produto, SugestaoProduto } from '../services/produtos'

/**
 * A câmera real depende de `getUserMedia` e de decodificar imagem, que o
 * jsdom não tem (ver `LeitorCamera.tsx`). O dublê guarda com que modo e tipo
 * de leitura foi montado e deixa o teste "pôr um código na frente dela".
 */
const camera = vi.hoisted(() => ({ modo: null as string | null, leitura: null as string | null }))

vi.mock('./LeitorCamera', () => ({
  LeitorCamera: function LeitorCameraDublado({
    aoLer,
    aoFalhar,
    modo = 'continua',
    leitura = 'qr',
  }: {
    aoLer: (texto: string) => void
    aoFalhar: (mensagem: string) => void
    modo?: string
    leitura?: string
  }) {
    camera.modo = modo
    camera.leitura = leitura
    return (
      <div data-testid="camera-dublada">
        <button type="button" onClick={() => aoLer('7891000325858')}>
          simular leitura
        </button>
        <button type="button" onClick={() => aoFalhar('Permissão de câmera negada.')}>
          simular falha de câmera
        </button>
      </div>
    )
  },
}))

const EAN = '7891000325858'

const SUGESTAO: SugestaoProduto = {
  codigoInterno: EAN,
  nome: 'COLORACAO CREME 6.1 LOURO ESCURO',
  marca: 'Marca X',
  categoria: 'Coloração',
  imagemUrl: 'https://global.si5.com.br/imagens/7891000325858.webp',
}

const TINTA: Produto = {
  id: '33333333-3333-3333-3333-333333333333',
  codigoInterno: EAN,
  nome: 'Alta Moda 6.1',
  marca: 'Alfaparf',
  categoria: 'Coloração',
  ativo: true,
}

const buscar = vi.fn<typeof fetch>()
const aoCadastrar = vi.fn()
const aoMostrarNaLista = vi.fn()

/** O rascunho mora em quem usa o componente (a `TelaProdutos`); aqui, num estado simples. */
function Hospedeiro() {
  const [rascunho, setRascunho] = useState<RascunhoCadastro>(RASCUNHO_INICIAL)
  return (
    <CadastroProduto
      categorias={['Coloração', 'Henna']}
      rascunho={rascunho}
      aoMudarRascunho={setRascunho}
      aoCadastrar={aoCadastrar}
      aoMostrarNaLista={aoMostrarNaLista}
    />
  )
}

function montar() {
  return renderizarComAvisos(<Hospedeiro />)
}

function digitarEBuscar(codigo = EAN) {
  fireEvent.change(screen.getByLabelText('Código de barras'), { target: { value: codigo } })
  fireEvent.click(screen.getByRole('button', { name: 'Buscar produto' }))
}

function encontrado(sugestao: Partial<SugestaoProduto> = {}) {
  return respostaFalsa(200, {
    situacao: 'ENCONTRADO',
    fonte: 'SI5 Global',
    sugestao: { ...SUGESTAO, ...sugestao },
  })
}

/** Simula a largura do celular para `useFormatoDaTela`, como em `App.test.tsx`. */
function simularLargura(largura: number) {
  vi.stubGlobal('matchMedia', (consulta: string) => ({
    matches: largura <= Number(/max-width:\s*([\d.]+)px/.exec(consulta)?.[1]),
    media: consulta,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

describe('CadastroProduto — cadastro pelo código de barras (T47)', () => {
  beforeEach(() => {
    buscar.mockReset()
    aoCadastrar.mockReset()
    aoMostrarNaLista.mockReset()
    camera.modo = null
    camera.leitura = null
    vi.stubGlobal('fetch', buscar)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('etapa 1: código de barras', () => {
    it('consulta o código pelo servidor, uma vez, e só lê o campo enquanto espera', async () => {
      let entregar!: (resposta: Response) => void
      buscar.mockReturnValueOnce(new Promise((resolver) => (entregar = resolver)))
      montar()

      digitarEBuscar(` ${EAN} `)

      expect(buscar).toHaveBeenCalledTimes(1)
      expect(buscar).toHaveBeenCalledWith(
        `http://localhost:3333/produtos/codigo-de-barras/${EAN}`,
        expect.objectContaining({ credentials: 'include' }),
      )
      expect(screen.getByLabelText('Código de barras')).toHaveAttribute('readonly')
      expect(screen.getByRole('button', { name: 'Buscando…' })).toBeDisabled()

      entregar(respostaFalsa(200, { situacao: 'NAO_ENCONTRADO' }))
      expect(await screen.findByLabelText('Nome')).toBeInTheDocument()
    })

    it('o Enter no campo também busca, como faz o leitor de código de barras USB', async () => {
      buscar.mockResolvedValueOnce(respostaFalsa(200, { situacao: 'NAO_ENCONTRADO' }))
      montar()

      const campo = screen.getByLabelText('Código de barras')
      fireEvent.change(campo, { target: { value: EAN } })
      fireEvent.submit(campo)

      await screen.findByLabelText('Nome')
      expect(buscar).toHaveBeenCalledTimes(1)
    })

    it('mostra junto do campo a recusa do servidor para código inválido', async () => {
      const mensagem =
        'O último dígito não confere com os anteriores: o código de barras foi digitado errado. Confira e digite de novo.'
      buscar.mockResolvedValueOnce(
        respostaFalsa(400, { erro: 'CODIGO_DE_BARRAS_INVALIDO', mensagem }),
      )
      montar()

      digitarEBuscar('7891000325859')

      const campo = screen.getByLabelText('Código de barras')
      expect(await screen.findByRole('alert')).toHaveTextContent(mensagem)
      expect(campo).toHaveAttribute('aria-invalid', 'true')
      expect(campo).toHaveAccessibleDescription(mensagem)

      // Corrigir o código tira a recusa, que era sobre o valor anterior.
      fireEvent.change(campo, { target: { value: '789100032585' } })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('avisa que o código já está no catálogo e oferece mostrar o produto na lista', async () => {
      buscar.mockResolvedValueOnce(respostaFalsa(200, { situacao: 'JA_CADASTRADO', produto: TINTA }))
      montar()

      digitarEBuscar()

      expect(await screen.findByRole('status')).toHaveTextContent(
        `O código ${EAN} já está no catálogo: “Alta Moda 6.1” (Alfaparf).`,
      )
      expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Mostrar na lista' }))
      expect(aoMostrarNaLista).toHaveBeenCalledWith(TINTA)
    })

    it('falha ao falar com o servidor vira toast, e o código continua no campo', async () => {
      buscar.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      montar()

      digitarEBuscar()

      expect((await encontrarAviso(/Não foi possível falar com o servidor/)).tipo).toBe('error')
      expect(screen.getByLabelText('Código de barras')).toHaveValue(EAN)
    })

    it('"Preencha manualmente" abre o formulário vazio, para o produto sem código de barras', async () => {
      montar()

      fireEvent.click(screen.getByRole('button', { name: 'Preencha manualmente' }))

      for (const rotulo of ['Código interno', 'Nome', 'Marca', 'Categoria']) {
        expect(screen.getByLabelText(rotulo)).toHaveValue('')
      }
      expect(screen.getByLabelText('Código interno')).toHaveFocus()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(buscar).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Buscar pelo código de barras' }))
      expect(screen.getByLabelText('Código de barras')).toHaveFocus()
    })
  })

  describe('etapa 2: card do produto encontrado', () => {
    it('mostra o que a fonte achou e a categoria preenchida, para conferir', async () => {
      buscar.mockResolvedValueOnce(encontrado())
      montar()

      digitarEBuscar()

      expect(await screen.findByRole('heading', { name: 'Encontramos este produto' })).toHaveFocus()
      expect(screen.getByText(SUGESTAO.nome)).toBeInTheDocument()
      expect(screen.getByText('Marca X')).toBeInTheDocument()
      expect(screen.getByText(EAN)).toBeInTheDocument()
      expect(screen.getByText(/Fonte: SI5 Global/)).toBeInTheDocument()
      expect(screen.getByLabelText('Categoria')).toHaveValue('Coloração')
    })

    it('mostra a imagem da fonte sem mandar o endereço do app, e a esconde se ela falhar', async () => {
      buscar.mockResolvedValueOnce(encontrado())
      const { container } = montar()

      digitarEBuscar()
      await screen.findByText(SUGESTAO.nome)

      const imagem = container.querySelector('.produto-encontrado img')
      expect(imagem).toHaveAttribute('src', SUGESTAO.imagemUrl)
      expect(imagem).toHaveAttribute('referrerpolicy', 'no-referrer')

      fireEvent.error(imagem!)
      expect(container.querySelector('.produto-encontrado img')).toBeNull()
    })

    it('"Cadastrar este produto" cadastra com a categoria escolhida e volta à primeira etapa', async () => {
      buscar
        .mockResolvedValueOnce(encontrado())
        .mockResolvedValueOnce(respostaFalsa(201, { produto: { ...TINTA, nome: SUGESTAO.nome } }))
      montar()

      digitarEBuscar()
      await screen.findByText(SUGESTAO.nome)
      fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'Henna' } })
      fireEvent.click(screen.getByRole('button', { name: 'Cadastrar este produto' }))

      expect((await encontrarAviso(`Produto “${SUGESTAO.nome}” cadastrado.`)).tipo).toBe('success')
      expect(buscar).toHaveBeenLastCalledWith(
        'http://localhost:3333/produtos',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            codigoInterno: EAN,
            nome: SUGESTAO.nome,
            marca: 'Marca X',
            categoria: 'Henna',
          }),
        }),
      )
      expect(aoCadastrar).toHaveBeenCalledTimes(1)
      expect(screen.getByLabelText('Código de barras')).toHaveValue('')
      expect(screen.getByLabelText('Código de barras')).toHaveFocus()
    })

    it('categoria que a fonte não trouxe fica vazia e é obrigatória', async () => {
      buscar.mockResolvedValueOnce(encontrado({ categoria: null }))
      montar()

      digitarEBuscar()

      const categoria = await screen.findByLabelText('Categoria')
      expect(categoria).toHaveValue('')
      expect(categoria).toBeRequired()
    })

    it('"Editar antes de cadastrar" leva os dados ao formulário', async () => {
      buscar.mockResolvedValueOnce(encontrado())
      montar()

      digitarEBuscar()
      await screen.findByText(SUGESTAO.nome)
      fireEvent.click(screen.getByRole('button', { name: 'Editar antes de cadastrar' }))

      expect(screen.getByRole('status')).toHaveTextContent(
        'Dados da base SI5 Global. Confira antes de cadastrar.',
      )
      expect(screen.getByLabelText('Código interno')).toHaveValue(EAN)
      expect(screen.getByLabelText('Nome')).toHaveValue(SUGESTAO.nome)
      expect(screen.getByLabelText('Marca')).toHaveValue('Marca X')
      expect(screen.getByLabelText('Categoria')).toHaveValue('Coloração')
      expect(screen.getByRole('button', { name: 'Cadastrar produto' })).toBeInTheDocument()
    })

    it('"Não é este produto" abre o formulário só com o código', async () => {
      buscar.mockResolvedValueOnce(encontrado())
      montar()

      digitarEBuscar()
      await screen.findByText(SUGESTAO.nome)
      fireEvent.click(screen.getByRole('button', { name: 'Não é este produto' }))

      expect(screen.getByLabelText('Código interno')).toHaveValue(EAN)
      expect(screen.getByLabelText('Nome')).toHaveValue('')
      expect(screen.getByLabelText('Nome')).toHaveFocus()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('"Buscar outro código" volta à primeira etapa vazia', async () => {
      buscar.mockResolvedValueOnce(encontrado())
      montar()

      digitarEBuscar()
      await screen.findByText(SUGESTAO.nome)
      fireEvent.click(screen.getByRole('button', { name: 'Buscar outro código' }))

      expect(screen.getByLabelText('Código de barras')).toHaveValue('')
      expect(screen.getByLabelText('Código de barras')).toHaveFocus()
    })

    it('sem marca, não cadastra direto: "Completar e cadastrar" leva ao formulário', async () => {
      buscar.mockResolvedValueOnce(encontrado({ marca: null }))
      montar()

      digitarEBuscar()
      expect(await screen.findByText('Marca não informada')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cadastrar este produto' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Completar e cadastrar' }))

      expect(screen.getByRole('status')).toHaveTextContent(
        'A base SI5 Global não trouxe tudo o que o cadastro pede.',
      )
      expect(screen.getByLabelText('Nome')).toHaveValue(SUGESTAO.nome)
      expect(screen.getByLabelText('Marca')).toHaveValue('')
      expect(screen.getByLabelText('Marca')).toHaveFocus()
    })

    it('nome acima de 120 caracteres vai cortado ao formulário, com o aviso do corte', async () => {
      const longo = 'N'.repeat(130)
      buscar.mockResolvedValueOnce(encontrado({ nome: longo }))
      montar()

      digitarEBuscar()
      await screen.findByText(longo)
      fireEvent.click(screen.getByRole('button', { name: 'Completar e cadastrar' }))

      const nome = screen.getByLabelText('Nome')
      expect(nome).toHaveValue('N'.repeat(120))
      expect(nome).toHaveAccessibleDescription(/O nome foi cortado em 120 caracteres/)
    })

    it('recusa da categoria pelo servidor aparece no próprio card', async () => {
      buscar.mockResolvedValueOnce(encontrado()).mockResolvedValueOnce(
        respostaFalsa(400, {
          erro: 'CORPO_INVALIDO',
          mensagem: 'Alguns campos do formulário não foram aceitos. Confira os dados e tente de novo.',
          campos: ['categoria'],
        }),
      )
      montar()

      digitarEBuscar()
      await screen.findByText(SUGESTAO.nome)
      fireEvent.click(screen.getByRole('button', { name: 'Cadastrar este produto' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'O campo Categoria aceita no máximo 120 caracteres.',
      )
      expect(screen.getByRole('heading', { name: 'Encontramos este produto' })).toBeInTheDocument()
    })
  })

  describe('etapa 3: formulário quando a consulta não ajuda', () => {
    it.each([
      ['NAO_ENCONTRADO', { situacao: 'NAO_ENCONTRADO' }, `Não encontramos o código ${EAN} na base consultada.`],
      ['FALHA', { situacao: 'INDISPONIVEL', motivo: 'FALHA' }, 'A consulta automática não respondeu agora.'],
      [
        'LIMITE_DIARIO',
        { situacao: 'INDISPONIVEL', motivo: 'LIMITE_DIARIO' },
        'As consultas automáticas de hoje acabaram.',
      ],
      [
        'NAO_CONFIGURADA',
        { situacao: 'INDISPONIVEL', motivo: 'NAO_CONFIGURADA' },
        'A consulta automática não está ligada.',
      ],
    ])('%s: avisa em uma linha e abre o formulário com o código', async (_caso, corpo, aviso) => {
      buscar.mockResolvedValueOnce(respostaFalsa(200, corpo))
      montar()

      digitarEBuscar()

      expect(await screen.findByRole('status')).toHaveTextContent(aviso)
      expect(screen.getByRole('status')).toHaveTextContent('Preencha os dados do produto.')
      expect(screen.getByLabelText('Código interno')).toHaveValue(EAN)
      expect(screen.getByLabelText('Nome')).toHaveFocus()
    })

    it('cadastra pelo formulário e volta à primeira etapa', async () => {
      buscar
        .mockResolvedValueOnce(respostaFalsa(200, { situacao: 'NAO_ENCONTRADO' }))
        .mockResolvedValueOnce(respostaFalsa(201, { produto: TINTA }))
      montar()

      digitarEBuscar()
      await screen.findByLabelText('Nome')
      fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Alta Moda 6.1' } })
      fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Alfaparf' } })
      fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'Coloração' } })
      fireEvent.click(screen.getByRole('button', { name: 'Cadastrar produto' }))

      expect((await encontrarAviso('Produto “Alta Moda 6.1” cadastrado.')).tipo).toBe('success')
      expect(buscar).toHaveBeenLastCalledWith(
        'http://localhost:3333/produtos',
        expect.objectContaining({
          body: JSON.stringify({
            codigoInterno: EAN,
            nome: 'Alta Moda 6.1',
            marca: 'Alfaparf',
            categoria: 'Coloração',
          }),
        }),
      )
      await waitFor(() => expect(screen.getByLabelText('Código de barras')).toHaveFocus())
    })
  })

  describe('câmera no celular', () => {
    it('no computador, não oferece a câmera', () => {
      simularLargura(1280)
      montar()

      expect(screen.queryByRole('button', { name: /ler com a câmera/i })).not.toBeInTheDocument()
    })

    it('lê o código de barras uma vez, preenche o campo e já consulta', async () => {
      simularLargura(360)
      buscar.mockResolvedValueOnce(encontrado())
      montar()

      fireEvent.click(screen.getByRole('button', { name: /ler com a câmera/i }))
      expect(camera.modo).toBe('unica')
      expect(camera.leitura).toBe('codigo-de-barras')

      fireEvent.click(screen.getByRole('button', { name: 'simular leitura' }))

      expect(await screen.findByRole('heading', { name: 'Encontramos este produto' })).toBeInTheDocument()
      expect(screen.queryByTestId('camera-dublada')).not.toBeInTheDocument()
      expect(buscar).toHaveBeenCalledWith(
        `http://localhost:3333/produtos/codigo-de-barras/${EAN}`,
        expect.anything(),
      )
    })

    it('"Desligar câmera" volta ao botão de ligar', () => {
      simularLargura(360)
      montar()

      fireEvent.click(screen.getByRole('button', { name: /ler com a câmera/i }))
      fireEvent.click(screen.getByRole('button', { name: 'Desligar câmera' }))

      expect(screen.queryByTestId('camera-dublada')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /ler com a câmera/i })).toBeInTheDocument()
    })

    it('câmera que não abre vira aviso, e o campo continua servindo', () => {
      simularLargura(360)
      montar()

      fireEvent.click(screen.getByRole('button', { name: /ler com a câmera/i }))
      fireEvent.click(screen.getByRole('button', { name: 'simular falha de câmera' }))

      expect(screen.getByRole('alert')).toHaveTextContent('Permissão de câmera negada.')
      expect(screen.queryByTestId('camera-dublada')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Código de barras')).toBeInTheDocument()
    })
  })
})
