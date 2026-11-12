import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Icone } from '../components/Icone'
import { SeletorProduto } from '../components/SeletorProduto'
import { ErroApi } from '../services/api'
import {
  carregarFolhaCompleta,
  listarEtiquetas,
  listarEtiquetasDeVariosProdutos,
  TAMANHO_PAGINA_MAXIMO,
  type FolhaDeEtiquetas,
} from '../services/etiquetas'
import {
  agruparPorProduto,
  gerarPdfEtiquetas,
  TAMANHO_PADRAO,
  TAMANHOS_EM_MM,
  type GrupoDeEtiquetas,
  type TamanhoEmMm,
} from '../services/pdfEtiquetas'
import type { Produto } from '../services/produtos'

/**
 * As etiquetas imprimíveis (RF04), agora de vários produtos num PDF só (T50).
 *
 * É o elo físico do sistema: aqui o `codigoQr` que existe no banco vira papel
 * colado no frasco. A tela não decide nada sobre o dado — o símbolo vem pronto
 * do servidor, e a ordem (marca → nome → validade) também. O que se decide
 * aqui é **impressão**: quais produtos entram, e quantos milímetros o símbolo
 * ocupa no papel.
 *
 * Dois caminhos de entrada:
 * - **do Recebimento**, com os ids do lote que acabou de chegar (T15). A folha
 *   é só daquele lote, e não do estoque inteiro do SKU;
 * - **pela aba**, escolhendo um ou vários produtos, ou "todos com estoque": a
 *   entrega mista, a etiquetagem do estoque existente e a reimpressão.
 *
 * Nos dois, **nada é buscado antes do clique em "Gerar PDF"** (Decisão 1 de
 * T15): abrir sozinha a folha faria imprimir segunda etiqueta para frascos já
 * etiquetados, e é assim que se duplicam identificadores no mundo físico.
 *
 * ## Por que o tamanho ainda é escolhido na tela
 *
 * A RNF08 exige validar a leitura em superfície real antes de congelar o
 * formato, e essa validação é T16. As três opções fazem a folha de teste sair
 * pronta; depois de T16, fixar o vencedor é uma linha.
 */

/**
 * O que a tela de recebimento entrega ao navegar para cá.
 *
 * Vai por estado de rota e não pela URL: 500 UUIDs são cerca de 18 KB de query
 * string. O React Router guarda o estado no History API, então recarregar a
 * página no mesmo navegador mantém o lote; levar o endereço para outra aba ou
 * outro aparelho cai na escolha de produtos, sem nada carregado.
 */
export type ImpressaoPedida = {
  produtoId: string
  produtoNome: string
  /** Ausente: o produto já vem escolhido, mas a folha é o estoque em mãos dele. */
  unidadeIds?: string[]
}

/** Estado de rota é dado de fora: só vira pedido se tiver a forma esperada. */
function lerPedido(estado: unknown): ImpressaoPedida | null {
  if (!estado || typeof estado !== 'object') return null
  const candidato = estado as Partial<ImpressaoPedida>
  if (typeof candidato.produtoId !== 'string' || typeof candidato.produtoNome !== 'string') {
    return null
  }
  return {
    produtoId: candidato.produtoId,
    produtoNome: candidato.produtoNome,
    unidadeIds: Array.isArray(candidato.unidadeIds) ? candidato.unidadeIds : undefined,
  }
}

/** O que a lista de escolhidos precisa de um produto: o id e como mostrá-lo. */
type ProdutoEscolhido = Pick<Produto, 'id' | 'nome'> & { marca?: string }

type Lote = { produtoId: string; produtoNome: string; unidadeIds: string[] }

type Progresso =
  | { fase: 'carregando'; feitas: number; total: number | null }
  | { fase: 'desenhando'; feitas: number; total: number }

type Resultado = {
  grupos: GrupoDeEtiquetas[]
  /** Produtos escolhidos que não tinham nenhuma unidade em estoque. */
  semEstoque: ProdutoEscolhido[]
}

/**
 * De quantas em quantas etiquetas o progresso do desenho é atualizado na tela.
 * A cada uma seriam três mil re-renderizações para um número que ninguém lê.
 */
const PASSO_DO_PROGRESSO = 25

export function TelaEtiquetas() {
  const { state } = useLocation()

  const [lote, setLote] = useState<Lote | null>(() => {
    const pedido = lerPedido(state)
    return pedido?.unidadeIds ? { ...pedido, unidadeIds: pedido.unidadeIds } : null
  })
  const [escolhidos, setEscolhidos] = useState<ProdutoEscolhido[]>(() => {
    const pedido = lerPedido(state)
    return pedido && !pedido.unidadeIds ? [{ id: pedido.produtoId, nome: pedido.produtoNome }] : []
  })
  const [todos, setTodos] = useState(false)
  // O seletor volta vazio depois de cada escolha: a chave nova o remonta.
  const [chaveDoSeletor, setChaveDoSeletor] = useState(0)

  const [tamanho, setTamanho] = useState<TamanhoEmMm>(TAMANHO_PADRAO)
  const [progresso, setProgresso] = useState<Progresso | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const gerando = progresso !== null
  const podeGerar = !gerando && (lote !== null || todos || escolhidos.length > 0)

  function escolher(produto: Produto | null) {
    if (!produto) return
    // O mesmo produto duas vezes não duplica a folha: o servidor recebe ids.
    setEscolhidos((atuais) =>
      atuais.some((atual) => atual.id === produto.id)
        ? atuais
        : [...atuais, { id: produto.id, nome: produto.nome, marca: produto.marca }],
    )
    setChaveDoSeletor((chave) => chave + 1)
    setResultado(null)
  }

  function remover(id: string) {
    setEscolhidos((atuais) => atuais.filter((atual) => atual.id !== id))
    setResultado(null)
  }

  function voltarAEscolha() {
    setLote(null)
    setResultado(null)
    setErro(null)
  }

  async function gerar() {
    if (!podeGerar) return
    setErro(null)
    setResultado(null)
    setProgresso({ fase: 'carregando', feitas: 0, total: null })

    // Capturados agora: mudar a escolha durante a geração não muda este PDF.
    const escolhidosAgora = escolhidos
    const buscarPagina: (pagina: number) => Promise<FolhaDeEtiquetas> = lote
      ? (pagina) =>
          listarEtiquetas(lote.produtoId, {
            unidadeIds: lote.unidadeIds,
            pagina,
            tamanhoPagina: TAMANHO_PAGINA_MAXIMO,
          })
      : (pagina) =>
          listarEtiquetasDeVariosProdutos(
            todos ? { todos: true } : { produtoIds: escolhidosAgora.map((produto) => produto.id) },
            pagina,
          )

    try {
      const etiquetas = await carregarFolhaCompleta(buscarPagina, (feitas, total) =>
        setProgresso({ fase: 'carregando', feitas, total }),
      )
      const grupos = agruparPorProduto(etiquetas)
      const semEstoque =
        lote || todos
          ? []
          : escolhidosAgora.filter((produto) => !grupos.some((grupo) => grupo.produto.id === produto.id))

      if (etiquetas.length > 0) {
        setProgresso({ fase: 'desenhando', feitas: 0, total: etiquetas.length })
        await gerarPdfEtiquetas(grupos, tamanho, (feitas, total) => {
          if (feitas % PASSO_DO_PROGRESSO === 0 || feitas === total) {
            setProgresso({ fase: 'desenhando', feitas, total })
          }
        })
      }
      setResultado({ grupos, semEstoque })
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível gerar o PDF das etiquetas.')
    } finally {
      setProgresso(null)
    }
  }

  const totalDeEtiquetas = resultado?.grupos.reduce((soma, grupo) => soma + grupo.etiquetas.length, 0) ?? 0

  return (
    <section className="tela tela-etiquetas">
      <h1>Etiquetas</h1>
      <p className="subtitulo">
        Escolha os produtos e gere um PDF para imprimir, recortar e colar cada etiqueta na sua
        unidade. Cada produto ganha um cabeçalho, e as etiquetas saem na ordem de validade — a
        mesma ordem em que os frascos serão vendidos.
      </p>

      {lote ? (
        <p className="resumo-folha">
          {lote.produtoNome} — {lote.unidadeIds.length} unidade(s) do recebimento{' '}
          <button type="button" className="secundario" onClick={voltarAEscolha} disabled={gerando}>
            Escolher produtos
          </button>
        </p>
      ) : (
        <div className="cartao escolha-etiquetas">
          <label className="opcao-todos">
            <input
              type="checkbox"
              checked={todos}
              disabled={gerando}
              onChange={(evento) => {
                setTodos(evento.target.checked)
                setResultado(null)
              }}
            />
            Todos os produtos com estoque
          </label>

          {!todos && (
            <>
              <SeletorProduto key={chaveDoSeletor} valor={null} aoEscolher={escolher} />
              {escolhidos.length > 0 ? (
                <ul className="produtos-escolhidos" aria-label="Produtos escolhidos">
                  {escolhidos.map((produto) => (
                    <li key={produto.id} className="chip-produto">
                      <span>{produto.marca ? `${produto.marca} — ${produto.nome}` : produto.nome}</span>
                      <button
                        type="button"
                        className="fantasma botao-icone"
                        aria-label={`Remover ${produto.nome}`}
                        disabled={gerando}
                        onClick={() => remover(produto.id)}
                      >
                        <Icone nome="fechar" tamanho={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="subtitulo">
                  Nenhum produto escolhido. Procure acima e escolha um ou mais.
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="opcoes-impressao">
        <fieldset className="tamanhos" disabled={gerando}>
          <legend>Tamanho do símbolo</legend>
          {TAMANHOS_EM_MM.map((opcao) => (
            <label key={opcao} htmlFor={`tamanho-${opcao}`}>
              <input
                type="radio"
                id={`tamanho-${opcao}`}
                name="tamanho"
                value={opcao}
                checked={tamanho === opcao}
                onChange={() => setTamanho(opcao)}
              />
              {opcao} mm
            </label>
          ))}
        </fieldset>
        <button type="button" onClick={() => void gerar()} disabled={!podeGerar}>
          Gerar PDF
        </button>
      </div>

      {progresso && (
        <p role="status">
          {progresso.fase === 'carregando'
            ? progresso.total === null
              ? 'Carregando etiquetas…'
              : `Carregando ${progresso.feitas} de ${progresso.total} etiquetas…`
            : `Montando o PDF: ${progresso.feitas} de ${progresso.total} etiquetas…`}
        </p>
      )}

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      {resultado && resultado.semEstoque.length > 0 && (
        <p className="nota-atencao" role="alert">
          Sem unidades em estoque, ficaram de fora:{' '}
          {resultado.semEstoque.map((produto) => produto.nome).join(', ')}.
        </p>
      )}

      {resultado && resultado.grupos.length === 0 && (
        <p>Nenhuma unidade em estoque nos produtos escolhidos.</p>
      )}

      {resultado && resultado.grupos.length > 0 && (
        <div className="resultado-etiquetas">
          <p className="nota-sucesso" role="status">
            PDF gerado com {totalDeEtiquetas} etiqueta(s) de {resultado.grupos.length} produto(s).
            Imprima em <strong>tamanho real (100%)</strong>, sem “ajustar à página”: o tamanho do
            símbolo só vale se a impressão não reescalar.
          </p>
          <table aria-label="Etiquetas por produto">
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col">Etiquetas</th>
              </tr>
            </thead>
            <tbody>
              {resultado.grupos.map((grupo) => (
                <tr key={grupo.produto.id}>
                  <td>
                    {grupo.produto.marca} — {grupo.produto.nome}
                  </td>
                  <td>{grupo.etiquetas.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
