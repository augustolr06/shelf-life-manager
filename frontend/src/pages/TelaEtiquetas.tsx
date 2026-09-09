import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { ErroApi } from '../services/api'
import { formatarData } from '../services/datas'
import { listarEtiquetas, type FolhaDeEtiquetas } from '../services/etiquetas'
import { listarProdutos, type Produto } from '../services/produtos'

/**
 * A folha de etiquetas imprimíveis (RF04).
 *
 * É o elo físico do sistema: aqui o `codigoQr` que existe no banco desde T05, e
 * que virou símbolo em T14, finalmente vira papel colado no frasco. Sem esta
 * tela o fluxo inteiro de leitura de QR (T08, T10) não tem entrada — a câmera
 * não tem o que ler.
 *
 * A tela não decide nada sobre o dado: o símbolo vem pronto do servidor, a
 * ordem da folha é a do FIFO (validade crescente, a mesma da fila de T13) e a
 * validade chega como data de calendário. O que se decide aqui é **impressão**:
 * quantos milímetros o símbolo ocupa no papel, e o que ocupa espaço ao lado
 * dele.
 *
 * ## Por que o tamanho é escolhido na tela
 *
 * A RNF08 exige validar a leitura em superfície real — frasco curvo, plástico
 * brilhante, luz da loja — **antes** de congelar o formato da etiqueta, e essa
 * validação é T16. Um tamanho fixo no código obrigaria a editar e reimplantar o
 * frontend a cada tentativa; as três opções fazem a folha de teste sair pronta
 * da impressora. Depois que T16 apontar o vencedor, fixá-lo é uma linha — e aí
 * com dado físico por trás.
 */

/**
 * Lado do símbolo em milímetros. Com os 29 módulos do `viewBox` de T14 (21 do
 * símbolo mais 4+4 da zona de silêncio), dão módulos de ~0,52 mm, ~0,69 mm e
 * ~0,86 mm. A referência prática para câmera de celular com impressora comum
 * fica em torno de 0,5 mm por módulo: 15 mm é o limite inferior plausível, e
 * 25 mm é o tamanho confortável que talvez não caiba num frasco pequeno.
 */
const TAMANHOS_EM_MM = [15, 20, 25] as const
type TamanhoEmMm = (typeof TAMANHOS_EM_MM)[number]
const TAMANHO_PADRAO: TamanhoEmMm = 20

/**
 * O que a tela de recebimento entrega ao navegar para cá.
 *
 * Vai por estado de rota e não pela URL: 500 UUIDs são cerca de 18 KB de query
 * string.
 *
 * O que se perde em troca é menos do que parecia na conferência: o React Router
 * guarda o estado no History API, então **recarregar a página no mesmo
 * navegador mantém o lote**. O que não sobrevive é levar o endereço para outro
 * lugar — outra aba, outro aparelho, um link colado para alguém. Aí a tela cai
 * no seletor e **não** carrega nada sozinha, que é o comportamento desejado:
 * abrir sozinha o estoque inteiro do SKU faria imprimir uma segunda etiqueta
 * para frascos já etiquetados, e é assim que se duplicam identificadores no
 * mundo físico.
 */
export type ImpressaoPedida = {
  produtoId: string
  produtoNome: string
  /** Ausente na reimpressão: aí a folha é o estoque em mãos daquele SKU. */
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

export function TelaEtiquetas() {
  const { state } = useLocation()

  // Nulo é o modo reimpressão: a tela espera a gestora escolher o produto.
  const [pedido, setPedido] = useState<ImpressaoPedida | null>(() => lerPedido(state))
  const [tamanho, setTamanho] = useState<TamanhoEmMm>(TAMANHO_PADRAO)

  const [folha, setFolha] = useState<FolhaDeEtiquetas | null>(null)
  const [pagina, setPagina] = useState(1)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [produtos, setProdutos] = useState<Produto[]>([])
  const [totalProdutos, setTotalProdutos] = useState(0)
  const [termo, setTermo] = useState('')
  const [produtoId, setProdutoId] = useState('')
  const [carregandoCatalogo, setCarregandoCatalogo] = useState(false)

  const buscarCatalogo = useCallback(async (busca: string) => {
    setCarregandoCatalogo(true)
    setErro(null)
    try {
      const resultado = await listarProdutos({ busca })
      setProdutos(resultado.produtos)
      setTotalProdutos(resultado.total)
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível carregar o catálogo.')
    } finally {
      setCarregandoCatalogo(false)
    }
  }, [])

  useEffect(() => {
    // Chegando do recebimento não há catálogo a carregar: o produto já veio.
    if (pedido) return
    void buscarCatalogo('')
  }, [pedido, buscarCatalogo])

  const carregarFolha = useCallback(async () => {
    if (!pedido) return
    setCarregando(true)
    setErro(null)
    try {
      setFolha(await listarEtiquetas(pedido.produtoId, { unidadeIds: pedido.unidadeIds, pagina }))
    } catch (falha) {
      setFolha(null)
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível carregar as etiquetas.')
    } finally {
      setCarregando(false)
    }
  }, [pedido, pagina])

  useEffect(() => {
    void carregarFolha()
  }, [carregarFolha])

  function pedirReimpressao(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const escolhido = produtos.find((produto) => produto.id === produtoId)
    if (!escolhido) return
    setPagina(1)
    setPedido({ produtoId: escolhido.id, produtoNome: escolhido.nome })
  }

  function filtrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setProdutoId('')
    void buscarCatalogo(termo.trim())
  }

  function voltarAoSeletor() {
    setPedido(null)
    setFolha(null)
    setPagina(1)
    setProdutoId('')
  }

  const totalPaginas = folha ? Math.max(1, Math.ceil(folha.total / folha.tamanhoPagina)) : 1

  return (
    <section className="tela-etiquetas">
      {/* Tudo o que é controle sai da folha impressa: ver `@media print`. */}
      <div className="controles-etiquetas">
        <h2>Etiquetas para impressão</h2>
        <p className="subtitulo">
          Recorte e cole cada etiqueta na sua unidade. A folha sai na ordem de validade — a
          mesma ordem em que os frascos serão vendidos.
        </p>

        {erro && (
          <p className="erro" role="alert">
            {erro}
          </p>
        )}

        {pedido ? (
          <p className="resumo-folha">
            {pedido.produtoNome}
            {pedido.unidadeIds
              ? ` — ${pedido.unidadeIds.length} unidade(s) do recebimento`
              : ' — todas as unidades em estoque'}{' '}
            <button type="button" className="secundario" onClick={voltarAoSeletor}>
              Escolher outro produto
            </button>
          </p>
        ) : (
          <>
            <form className="filtros" onSubmit={filtrar}>
              <div className="campo">
                <label htmlFor="busca-produto-etiqueta">Buscar produto por nome ou código</label>
                <input
                  id="busca-produto-etiqueta"
                  name="busca-produto-etiqueta"
                  value={termo}
                  onChange={(evento) => setTermo(evento.target.value)}
                />
              </div>
              <button type="submit">Buscar</button>
            </form>

            <form className="filtros" onSubmit={pedirReimpressao}>
              <div className="campo">
                <label htmlFor="produto-etiqueta">Produto</label>
                <select
                  id="produto-etiqueta"
                  name="produto-etiqueta"
                  required
                  value={produtoId}
                  onChange={(evento) => setProdutoId(evento.target.value)}
                  disabled={carregandoCatalogo}
                >
                  <option value="">
                    {carregandoCatalogo ? 'Carregando catálogo…' : 'Selecione o produto'}
                  </option>
                  {produtos.map((produto) => (
                    <option key={produto.id} value={produto.id}>
                      {produto.codigoInterno} — {produto.nome} ({produto.marca})
                    </option>
                  ))}
                </select>
                {!carregandoCatalogo && totalProdutos > produtos.length && (
                  <small>
                    Mostrando {produtos.length} de {totalProdutos} produtos. Refine a busca para
                    achar os demais.
                  </small>
                )}
              </div>
              {/* Nada é carregado sozinho na reimpressão: reimprimir etiqueta de
                  frasco que já tem uma é como se duplicam identificadores. */}
              <button type="submit" disabled={produtoId === ''}>
                Carregar etiquetas
              </button>
            </form>
          </>
        )}

        {folha && folha.etiquetas.length > 0 && (
          <div className="opcoes-impressao">
            <fieldset className="tamanhos">
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
            {/* O diálogo do sistema é o que a loja já usa para imprimir; gerar
                PDF aqui só acrescentaria uma decisão de margem que o driver da
                impressora toma melhor. */}
            <button type="button" onClick={() => window.print()}>
              Imprimir
            </button>
          </div>
        )}
      </div>

      {carregando && <p role="status">Carregando etiquetas…</p>}

      {!carregando && folha && folha.etiquetas.length === 0 && (
        <p>Nenhuma unidade em estoque para etiquetar neste produto.</p>
      )}

      {!carregando && folha && folha.etiquetas.length > 0 && (
        <>
          <ul
            className="folha-etiquetas"
            aria-label="Etiquetas para impressão"
            // O milímetro chega ao CSS por atributo, e não por estilo em linha:
            // as três medidas ficam na folha de estilo, junto do resto da
            // impressão, em vez de espalhadas entre TSX e CSS.
            data-tamanho-mm={tamanho}
          >
            {folha.etiquetas.map((etiqueta) => (
              <li className="etiqueta" key={etiqueta.id}>
                {/* O SVG vem de `simboloQr.ts`, que o gera a partir de um código
                    já validado e o entrega sem script, evento, id, class ou
                    style (T14). Precisa ser elemento de verdade — e não imagem
                    por `data:` URI — para herdar o tamanho da folha. */}
                <div
                  className="simbolo"
                  // O símbolo não diz nada a um leitor de tela que o código
                  // logo abaixo, em texto, já não diga.
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: etiqueta.svg }}
                />
                {/* O código em texto é o que a atendente digita quando a câmera
                    falha (o fallback manual de T10), e por isso vai impresso. */}
                <p className="codigo-etiqueta">{etiqueta.codigoQr}</p>
                {/* A validade é o que um humano precisa ver na prateleira sem
                    escanear nada — é o dado em torno do qual o sistema gira. */}
                <p className="validade-etiqueta">Val {formatarData(etiqueta.dataValidade)}</p>
              </li>
            ))}
          </ul>

          {/* Sai impresso: T16 precisa saber qual tamanho aprovou ou reprovou. */}
          <p className="rodape-folha">
            {pedido?.produtoNome} · símbolo de {tamanho} mm · {folha.etiquetas.length} de{' '}
            {folha.total} etiqueta(s) · página {folha.pagina} de {totalPaginas}
          </p>
        </>
      )}

      {totalPaginas > 1 && (
        <div className="paginacao">
          <button type="button" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </button>
          <button
            type="button"
            disabled={pagina >= totalPaginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima
          </button>
          {/* Imprime-se a página carregada, e a tela diz isso: juntar páginas
              numa folha só exigiria acumular várias requisições para um botão
              de impressão, e imprimiria o que não está na tela. */}
          <p className="subtitulo">Imprima uma página por vez.</p>
        </div>
      )}
    </section>
  )
}
