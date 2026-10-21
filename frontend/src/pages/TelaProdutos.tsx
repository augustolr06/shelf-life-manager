import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { useConfirmacao } from '../components/DialogoConfirmacao'
import { Icone } from '../components/Icone'
import { ImportacaoProdutos } from '../components/ImportacaoProdutos'
import { MenuLinha } from '../components/MenuLinha'
import { Paginacao } from '../components/Paginacao'
import { useFormatoDaTela } from '../hooks/useFormatoDaTela'
import { useValorComAtraso } from '../hooks/useValorComAtraso'
import { camposRecusados, ErroApi } from '../services/api'
import { avisar } from '../services/avisos'
import type { Usuario } from '../services/auth'
import {
  criarProduto,
  inativarProduto,
  listarCategorias,
  listarProdutos,
  reativarProduto,
  TAMANHO_MAXIMO_CAMPO_PRODUTO,
  type DadosProduto,
  type Produto,
} from '../services/produtos'

const CAMPOS_VAZIOS: DadosProduto = {
  codigoInterno: '',
  nome: '',
  marca: '',
  categoria: '',
}

type CampoProduto = keyof DadosProduto

/**
 * Os campos do cadastro com o rótulo da tela — que é como a mensagem de recusa
 * do servidor nomeia o campo (T25) — e o início do aviso de colagem cortada,
 * com artigo e particípio no gênero do campo.
 */
const CAMPOS_DO_FORMULARIO: readonly {
  campo: CampoProduto
  rotulo: string
  foiCortado: string
}[] = [
  { campo: 'codigoInterno', rotulo: 'Código interno', foiCortado: 'O código interno foi cortado' },
  { campo: 'nome', rotulo: 'Nome', foiCortado: 'O nome foi cortado' },
  { campo: 'marca', rotulo: 'Marca', foiCortado: 'A marca foi cortada' },
  { campo: 'categoria', rotulo: 'Categoria', foiCortado: 'A categoria foi cortada' },
]

type MensagensPorCampo = Partial<Record<CampoProduto, string>>

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

  const [novo, setNovo] = useState<DadosProduto>(CAMPOS_VAZIOS)
  const [errosDeCampo, setErrosDeCampo] = useState<MensagensPorCampo>({})
  const [avisosDeColagem, setAvisosDeColagem] = useState<MensagensPorCampo>({})
  const [salvando, setSalvando] = useState(false)
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

  async function cadastrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErrosDeCampo({})
    setSalvando(true)

    try {
      const criado = await criarProduto(novo)
      avisar.sucesso(`Produto “${criado.nome}” cadastrado.`)
      setNovo(CAMPOS_VAZIOS)
      setAvisosDeColagem({})
      // O painel continua aberto, vazio, para o próximo cadastro.
      elementoPainel.current?.querySelector('input')?.focus()
      void carregarCategorias()
      await carregar()
    } catch (falha) {
      // Recusa de schema (T12b) traz os campos recusados: a mensagem vai para
      // junto do campo, com o rótulo da tela (T25). O texto genérico do
      // servidor só aparece quando nenhum campo daqui foi nomeado.
      const recusados = falha instanceof ErroApi && falha.codigo === 'CORPO_INVALIDO'
        ? errosPelosCampos(camposRecusados(falha.corpo))
        : {}
      if (Object.keys(recusados).length > 0) {
        setErrosDeCampo(recusados)
        return
      }

      // Código interno duplicado chega como 409 com mensagem própria do
      // backend — a tela só exibe o que recebeu. O formulário fica preenchido
      // para a correção.
      avisar.erro(falha, 'Não foi possível cadastrar o produto.')
    } finally {
      setSalvando(false)
    }
  }

  function editarCampo(campo: CampoProduto, evento: ChangeEvent<HTMLInputElement>) {
    const valor = evento.target.value
    setNovo((atual) => ({ ...atual, [campo]: valor }))
    setErrosDeCampo((atuais) => semCampo(atuais, campo))
    // A própria colagem também dispara esta edição, logo depois de
    // `avisarColagemCortada`; só ela não pode apagar o aviso que acabou de criar.
    if ((evento.nativeEvent as InputEvent).inputType !== 'insertFromPaste') {
      setAvisosDeColagem((atuais) => semCampo(atuais, campo))
    }
  }

  /**
   * `maxLength` faz o navegador cortar em silêncio o texto colado que não cabe
   * — e o nome cadastrado sairia truncado sem ninguém perceber (T25, Decisão
   * 2). O corte em si continua sendo do navegador; aqui só se calcula se ele
   * vai acontecer.
   */
  function avisarColagemCortada(
    campo: CampoProduto,
    foiCortado: string,
    evento: ClipboardEvent<HTMLInputElement>,
  ) {
    const alvo = evento.currentTarget
    // Campo de uma linha descarta as quebras de linha do texto colado antes de
    // aplicar o limite.
    const colado = evento.clipboardData.getData('text').replace(/[\r\n]/g, '')
    const selecionado = (alvo.selectionEnd ?? 0) - (alvo.selectionStart ?? 0)
    const tamanhoFinal = alvo.value.length - selecionado + colado.length

    if (tamanhoFinal > TAMANHO_MAXIMO_CAMPO_PRODUTO) {
      setAvisosDeColagem((atuais) => ({
        ...atuais,
        [campo]: `${foiCortado} em ${TAMANHO_MAXIMO_CAMPO_PRODUTO} caracteres.`,
      }))
    }
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
                <form className="formulario-coluna cadastro-produto" onSubmit={cadastrar}>
                  {CAMPOS_DO_FORMULARIO.map(({ campo, rotulo, foiCortado }) => {
                    const erroDoCampo = errosDeCampo[campo]
                    const avisoDeColagem = avisosDeColagem[campo]
                    const descricoes = [
                      `contador-${campo}`,
                      erroDoCampo ? `erro-${campo}` : null,
                      avisoDeColagem ? `aviso-colagem-${campo}` : null,
                    ]
                      .filter(Boolean)
                      .join(' ')

                    return (
                      <div className="campo" key={campo}>
                        <div className="rotulo-com-contador">
                          <label htmlFor={campo}>{rotulo}</label>
                          <span className="contador-caracteres" id={`contador-${campo}`}>
                            {novo[campo].length}/{TAMANHO_MAXIMO_CAMPO_PRODUTO}
                          </span>
                        </div>
                        <input
                          id={campo}
                          name={campo}
                          required
                          className={campo === 'codigoInterno' ? 'codigo' : undefined}
                          placeholder={campo === 'codigoInterno' ? 'Ex.: PRF-021' : undefined}
                          // A categoria sugere as que já existem e aceita uma
                          // nova (T45): escolher da lista evita "Perfumaria" e
                          // "perfumaria" como duas pílulas.
                          list={campo === 'categoria' ? 'categorias-existentes' : undefined}
                          autoComplete={campo === 'categoria' ? 'off' : undefined}
                          maxLength={TAMANHO_MAXIMO_CAMPO_PRODUTO}
                          aria-invalid={erroDoCampo ? true : undefined}
                          aria-describedby={descricoes}
                          value={novo[campo]}
                          onChange={(evento) => editarCampo(campo, evento)}
                          onPaste={(evento) => avisarColagemCortada(campo, foiCortado, evento)}
                        />
                        {avisoDeColagem && (
                          <p
                            className="nota-informativa"
                            id={`aviso-colagem-${campo}`}
                            role="status"
                          >
                            {avisoDeColagem}
                          </p>
                        )}
                        {erroDoCampo && (
                          <p className="erro" id={`erro-${campo}`} role="alert">
                            {erroDoCampo}
                          </p>
                        )}
                      </div>
                    )
                  })}
                  <datalist id="categorias-existentes">
                    {categorias.map((existente) => (
                      <option key={existente} value={existente} />
                    ))}
                  </datalist>

                  <button type="submit" aria-busy={salvando} disabled={salvando}>
                    {salvando ? 'Cadastrando…' : 'Cadastrar produto'}
                  </button>
                </form>
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

/**
 * A mensagem de cada campo recusado que este formulário tem, pelo rótulo da
 * tela. O servidor diz o campo, não a regra (T12b); o tamanho máximo é a única
 * regra que estes campos podem violar com o formulário preenchido, já que os
 * quatro vão sempre como texto e o `required` impede o vazio.
 */
function errosPelosCampos(campos: string[]): MensagensPorCampo {
  const erros: MensagensPorCampo = {}
  for (const { campo, rotulo } of CAMPOS_DO_FORMULARIO) {
    if (campos.includes(campo)) {
      erros[campo] = `O campo ${rotulo} aceita no máximo ${TAMANHO_MAXIMO_CAMPO_PRODUTO} caracteres.`
    }
  }
  return erros
}

function semCampo(mensagens: MensagensPorCampo, campo: CampoProduto): MensagensPorCampo {
  if (!(campo in mensagens)) return mensagens
  const { [campo]: _removida, ...restantes } = mensagens
  return restantes
}
