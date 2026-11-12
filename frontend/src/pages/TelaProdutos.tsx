import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CadastroProduto,
  RASCUNHO_INICIAL,
  type RascunhoCadastro,
} from '../components/CadastroProduto'
import { useConfirmacao } from '../components/DialogoConfirmacao'
import { Icone } from '../components/Icone'
import { ImportacaoProdutos } from '../components/ImportacaoProdutos'
import { MenuLinha } from '../components/MenuLinha'
import { Paginacao } from '../components/Paginacao'
import { useFormatoDaTela } from '../hooks/useFormatoDaTela'
import { useValorComAtraso } from '../hooks/useValorComAtraso'
import { ErroApi } from '../services/api'
import { avisar } from '../services/avisos'
import type { Usuario } from '../services/auth'
import {
  inativarProduto,
  listarCategorias,
  listarProdutos,
  reativarProduto,
  type Produto,
} from '../services/produtos'

/**
 * Espelho do `maxLength` de `busca` no schema da listagem em
 * `backend/src/modules/produto/produto.routes.ts`. Com a busca disparando a
 * cada pausa na digitação (T26), o 121º caractere viraria a recusa genérica
 * de campo inválido; o campo para antes.
 */
const TAMANHO_MAXIMO_BUSCA = 120

/**
 * O que o painel ao lado da lista mostra (T45). Fechado por padrão: o uso
 * mais comum do catálogo é procurar, não cadastrar.
 */
type Painel = 'novo' | 'importar' | null

type Props = {
  usuario: Usuario
}

export function TelaProdutos({ usuario }: Props) {
  // `null` até a primeira resposta: depois dela, a lista anterior fica na tela
  // enquanto a próxima carrega, para a tabela não piscar a cada tecla (T26).
  const [produtos, setProdutos] = useState<Produto[] | null>(null)
  const [total, setTotal] = useState(0)
  const [tamanhoPagina, setTamanhoPagina] = useState(20)
  const [pagina, setPagina] = useState(1)
  // `?busca=` chega da busca do Início (T42) e só preenche o campo: o resto
  // segue como se o termo tivesse sido digitado aqui.
  const [parametros] = useSearchParams()
  const [termoDigitado, setTermoDigitado] = useState(() => parametros.get('busca') ?? '')
  const [incluirInativos, setIncluirInativos] = useState(false)
  // `null` é "Todas". As categorias vêm do servidor, como estão gravadas, e o
  // filtro é por igualdade (T45).
  const [categoria, setCategoria] = useState<string | null>(null)
  const [categorias, setCategorias] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)
  // Só a falha ao carregar a lista: é estado da tela. Falha de ação vira
  // toast (T29).
  const [erro, setErro] = useState<string | null>(null)
  const campoBusca = useRef<HTMLInputElement>(null)
  const ultimaConsulta = useRef(0)
  const inicioDaLista = useRef<HTMLElement>(null)

  // A busca vai ao servidor só depois de uma pausa na digitação (T26). Campo
  // vazio, ou só com espaços, vira busca vazia: a lista completa.
  const busca = useValorComAtraso(termoDigitado.trim())

  // Volta à primeira página quando o termo muda: a página atual pode nem
  // existir no novo filtro. Ajustada durante a renderização, e não num efeito,
  // para não sair uma consulta com o termo novo e a página antiga.
  const [buscaDaPagina, setBuscaDaPagina] = useState(busca)
  if (buscaDaPagina !== busca) {
    setBuscaDaPagina(busca)
    setPagina(1)
  }

  // O cadastro em andamento (T47) mora aqui, e não no painel, para que fechar
  // e reabrir o painel não perca o que foi digitado ou consultado (T45).
  const [rascunho, setRascunho] = useState<RascunhoCadastro>(RASCUNHO_INICIAL)
  const confirmar = useConfirmacao()

  const [painel, setPainel] = useState<Painel>(null)
  const elementoPainel = useRef<HTMLElement>(null)
  const botaoNovo = useRef<HTMLButtonElement>(null)
  const botaoImportar = useRef<HTMLButtonElement>(null)
  // Quem abriu o painel recebe o foco quando ele fecha. Guardado pelo nome, e
  // não pelo elemento: no celular o cabeçalho sai da tela com o painel aberto,
  // e o botão que volta é outro nó.
  const abertoPor = useRef<Exclude<Painel, null> | null>(null)
  const devolverFoco = useRef(false)
  // No celular o painel ocupa a tela, no lugar da lista; nos outros tamanhos,
  // fica ao lado dela (computador) ou acima (tablet).
  const painelEmTelaCheia = useFormatoDaTela() === 'celular' && painel !== null

  // A escrita é restrita a GESTOR (RF02). Esconder os botões, o painel e o
  // menu da linha é conveniência de interface, não autorização: quem decide
  // continua sendo o 403 do backend (RNF04), inclusive se esta condição
  // estiver errada.
  const podeEditar = usuario.papel === 'GESTOR'

  const carregar = useCallback(async () => {
    // Só a consulta mais recente pode mexer na tela. Se a resposta de "per"
    // chegar depois da de "perfume", a lista seria a de um termo que já não
    // está no campo (T26, Decisão 3).
    const consulta = ++ultimaConsulta.current
    const ehAtual = () => consulta === ultimaConsulta.current

    setCarregando(true)
    setErro(null)
    try {
      const resultado = await listarProdutos({
        busca,
        categoria: categoria ?? undefined,
        incluirInativos,
        pagina,
      })
      if (!ehAtual()) return
      setProdutos(resultado.produtos)
      setTotal(resultado.total)
      setTamanhoPagina(resultado.tamanhoPagina)
    } catch (falha) {
      if (!ehAtual()) return
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível carregar o catálogo.')
    } finally {
      if (ehAtual()) setCarregando(false)
    }
  }, [busca, categoria, incluirInativos, pagina])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // Falha aqui não vira aviso: sem as categorias, a tela perde só as pílulas
  // e as sugestões do campo, e a lista — que é o que importa — tem o próprio
  // aviso de falha. Cadastro e importação podem criar categoria nova, e por
  // isso pedem a lista de novo.
  const carregarCategorias = useCallback(async () => {
    try {
      setCategorias(await listarCategorias())
    } catch {
      // Fica a lista anterior.
    }
  }, [])

  useEffect(() => {
    void carregarCategorias()
  }, [carregarCategorias])

  // Painel aberto ou trocado: o foco vai para o primeiro campo dele. Painel
  // fechado: volta para o botão que o abriu.
  useEffect(() => {
    if (painel) {
      elementoPainel.current?.querySelector('input')?.focus()
      return
    }
    if (!devolverFoco.current) return
    devolverFoco.current = false
    ;(abertoPor.current === 'importar' ? botaoImportar : botaoNovo).current?.focus()
  }, [painel])

  function abrirPainel(qual: Exclude<Painel, null>) {
    abertoPor.current = qual
    setPainel(qual)
  }

  function fecharPainel() {
    devolverFoco.current = true
    setPainel(null)
  }

  function escolherCategoria(escolhida: string | null) {
    setPagina(1)
    setCategoria(escolhida)
  }

  function limparBusca() {
    setTermoDigitado('')
    campoBusca.current?.focus()
  }

  /**
   * O código consultado no cadastro já está no catálogo (T47): a lista passa a
   * mostrar o produto, pelo código na busca e sem o filtro de categoria, que
   * poderia escondê-lo — e com os inativos, se ele for um. No celular o painel
   * ocupa o lugar da lista, e fecha para ela aparecer.
   */
  function mostrarNaLista(produto: Produto) {
    setTermoDigitado(produto.codigoInterno)
    setCategoria(null)
    setPagina(1)
    if (!produto.ativo) setIncluirInativos(true)
    if (painelEmTelaCheia) fecharPainel()
  }

  async function alternarSituacao(produto: Produto) {
    // Só inativar pergunta: reativar desfaz uma inativação, sem perda (T39). O
    // texto diz o que o servidor faz com produto inativo — recusa recebimento
    // e sai do seletor de produto — e o que ele não faz: a venda e o descarte
    // das unidades já em estoque continuam.
    if (
      produto.ativo &&
      !(await confirmar({
        titulo: 'Inativar produto?',
        consequencia: `“${produto.nome}” deixa de receber unidades novas e sai da escolha de produto no recebimento e nas etiquetas. As unidades que já estão em estoque continuam podendo ser vendidas e descartadas. Você pode reativá-lo depois.`,
        rotuloConfirmar: 'Inativar',
      }))
    ) {
      return
    }

    try {
      const atualizado = produto.ativo
        ? await inativarProduto(produto.id)
        : await reativarProduto(produto.id)
      avisar.sucesso(
        `Produto “${atualizado.nome}” ${atualizado.ativo ? 'reativado' : 'inativado'}.`,
      )

      // Se o produto inativado sai do filtro corrente, recarrega; senão basta
      // trocar a linha no lugar.
      if (!atualizado.ativo && !incluirInativos) {
        await carregar()
        return
      }
      setProdutos((atuais) =>
        atuais?.map((p) => (p.id === atualizado.id ? atualizado : p)) ?? null,
      )
    } catch (falha) {
      avisar.erro(falha, 'Não foi possível alterar a situação do produto.')
    }
  }

  const totalPaginas = Math.max(1, Math.ceil(total / tamanhoPagina))
  const filtrada = busca !== '' || categoria !== null

  return (
    <section className="tela tela-produtos">
      {!painelEmTelaCheia && (
        <header className="cabecalho-catalogo">
          <div>
            <h1>Catálogo</h1>
            <p className="subtitulo">
              {produtos !== null && contagemDaLista(total, incluirInativos, filtrada)}
              {/* Ao lado da contagem, e não da caixa de busca: lá, aparecer
                  e sumir a cada busca mudaria a largura dela (T26). */}
              {carregando && produtos !== null && (
                <span className="indicador-carregando" role="status">
                  Carregando…
                </span>
              )}
            </p>
          </div>

          {podeEditar && (
            <div className="acoes-catalogo">
              <button
                ref={botaoImportar}
                type="button"
                className="secundario"
                aria-expanded={painel === 'importar'}
                onClick={() => abrirPainel('importar')}
              >
                <Icone nome="importar" />
                Importar planilha
              </button>
              <button
                ref={botaoNovo}
                type="button"
                aria-expanded={painel === 'novo'}
                onClick={() => abrirPainel('novo')}
              >
                <Icone nome="novo" />
                Novo produto
              </button>
            </div>
          )}
        </header>
      )}

      <div className={painel ? 'corpo-catalogo com-painel' : 'corpo-catalogo'}>
        {!painelEmTelaCheia && (
          <section ref={inicioDaLista} className="cartao lista-catalogo" aria-label="Lista de produtos">
            {/* A busca reage à digitação (T26). O formulário continua
                existindo só para o Enter no campo não recarregar a página. */}
            <form
              role="search"
              className="busca-catalogo"
              onSubmit={(evento) => evento.preventDefault()}
            >
              <label htmlFor="busca" className="visualmente-oculto">
                Buscar por nome ou código
              </label>
              <div className="campo-com-limpar">
                <Icone nome="consultar" />
                <input
                  id="busca"
                  name="busca"
                  ref={campoBusca}
                  placeholder="Buscar por nome ou código"
                  maxLength={TAMANHO_MAXIMO_BUSCA}
                  value={termoDigitado}
                  onChange={(evento) => setTermoDigitado(evento.target.value)}
                />
                {termoDigitado && (
                  <button
                    type="button"
                    className="botao-limpar-busca"
                    aria-label="Limpar busca"
                    onClick={limparBusca}
                  >
                    ×
                  </button>
                )}
              </div>
            </form>

            {categorias.length > 0 && (
              <div className="pilulas-categoria" role="group" aria-label="Filtrar por categoria">
                {[null, ...categorias].map((opcao) => (
                  <button
                    key={opcao ?? ''}
                    type="button"
                    className="pilula"
                    aria-pressed={categoria === opcao}
                    onClick={() => escolherCategoria(opcao)}
                  >
                    {opcao ?? 'Todas'}
                  </button>
                ))}
              </div>
            )}

            {erro && (
              <p className="erro" role="alert">
                {erro}
              </p>
            )}

            {produtos === null ? (
              carregando && <p role="status">Carregando produtos…</p>
            ) : produtos.length === 0 ? (
              <p className="lista-vazia">Nenhum produto encontrado.</p>
            ) : (
              // A tabela rola dentro do cartão; a página não rola na
              // horizontal (T45).
              <div className="rolagem-tabela">
                <table className="tabela-catalogo">
                  <thead>
                    <tr>
                      <th scope="col">Código</th>
                      <th scope="col">Produto</th>
                      <th scope="col">Categoria</th>
                      <th scope="col">Situação</th>
                      {podeEditar && (
                        <th scope="col">
                          <span className="visualmente-oculto">Ações</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {produtos.map((produto) => (
                      <tr key={produto.id} className={produto.ativo ? undefined : 'linha-inativa'}>
                        <td className="codigo">{produto.codigoInterno}</td>
                        <td>
                          <span className="nome-produto">{produto.nome}</span>
                          <span className="marca-produto">{produto.marca}</span>
                        </td>
                        <td>{produto.categoria}</td>
                        <td>
                          <span
                            className={
                              produto.ativo
                                ? 'distintivo distintivo-sucesso'
                                : 'distintivo distintivo-inativo'
                            }
                          >
                            {produto.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        {podeEditar && (
                          <td className="acoes-linha">
                            <MenuLinha
                              rotulo={`Ações de “${produto.nome}”`}
                              acoes={[
                                produto.ativo
                                  ? {
                                      rotulo: 'Inativar',
                                      perigo: true,
                                      aoEscolher: () => void alternarSituacao(produto),
                                    }
                                  : {
                                      rotulo: 'Reativar',
                                      aoEscolher: () => void alternarSituacao(produto),
                                    },
                              ]}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="rodape-lista">
              <label className="caixa-selecao">
                <input
                  type="checkbox"
                  checked={incluirInativos}
                  onChange={(evento) => {
                    setPagina(1)
                    setIncluirInativos(evento.target.checked)
                  }}
                />
                Mostrar inativos
              </label>
              {produtos !== null && total > 0 && (
                <span className="intervalo-lista">
                  {(pagina - 1) * tamanhoPagina + 1}–{Math.min(pagina * tamanhoPagina, total)} de{' '}
                  {total}
                </span>
              )}
              <Paginacao
                pagina={pagina}
                totalPaginas={totalPaginas}
                aoMudar={setPagina}
                alvoRolagem={inicioDaLista}
              />
            </div>
          </section>
        )}

        {podeEditar && painel && (
          <aside
            ref={elementoPainel}
            className="cartao painel-catalogo"
            aria-labelledby="titulo-painel-catalogo"
            onKeyDown={(evento) => {
              if (evento.key === 'Escape') fecharPainel()
            }}
          >
            <div className="cabecalho-painel-catalogo">
              <h2 id="titulo-painel-catalogo">
                {painel === 'novo' ? 'Novo produto' : 'Importar planilha'}
              </h2>
              <button
                type="button"
                className="fantasma botao-icone"
                aria-label="Fechar"
                onClick={fecharPainel}
              >
                <Icone nome="fechar" />
              </button>
            </div>

            {painel === 'novo' ? (
              <>
                <CadastroProduto
                  categorias={categorias}
                  rascunho={rascunho}
                  aoMudarRascunho={setRascunho}
                  aoCadastrar={() => {
                    void carregarCategorias()
                    void carregar()
                  }}
                  aoMostrarNaLista={mostrarNaLista}
                />
                <p className="troca-painel">
                  Tem muitos produtos?{' '}
                  <button type="button" className="botao-link" onClick={() => setPainel('importar')}>
                    Importe uma planilha CSV
                  </button>
                  .
                </p>
              </>
            ) : (
              <>
                <ImportacaoProdutos
                  aoImportar={() => {
                    void carregarCategorias()
                    void carregar()
                  }}
                />
                <p className="troca-painel">
                  É um produto só?{' '}
                  <button type="button" className="botao-link" onClick={() => setPainel('novo')}>
                    Cadastre pelo formulário
                  </button>
                  .
                </p>
              </>
            )}
          </aside>
        )}
      </div>
    </section>
  )
}

/**
 * A contagem do cabeçalho, sobre a lista que está na tela: com filtro, é o
 * que ele encontrou; com os inativos, conta os dois. O número é o `total` do
 * servidor.
 */
function contagemDaLista(total: number, incluirInativos: boolean, filtrada: boolean): string {
  const um = total === 1
  return [
    `${total} ${um ? 'produto' : 'produtos'}`,
    incluirInativos ? null : um ? 'ativo' : 'ativos',
    filtrada ? (um ? 'encontrado' : 'encontrados') : null,
  ]
    .filter(Boolean)
    .join(' ')
}
