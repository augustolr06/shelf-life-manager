import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
} from 'react'
import { ImportacaoProdutos } from '../components/ImportacaoProdutos'
import { Paginacao } from '../components/Paginacao'
import { useValorComAtraso } from '../hooks/useValorComAtraso'
import { camposRecusados, ErroApi } from '../services/api'
import { avisar } from '../services/avisos'
import type { Usuario } from '../services/auth'
import {
  criarProduto,
  inativarProduto,
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
  const [termoDigitado, setTermoDigitado] = useState('')
  const [incluirInativos, setIncluirInativos] = useState(false)
  const [carregando, setCarregando] = useState(true)
  // Só a falha ao carregar a lista: é estado da tela. Falha de ação vira
  // toast (T29).
  const [erro, setErro] = useState<string | null>(null)
  const campoBusca = useRef<HTMLInputElement>(null)
  const ultimaConsulta = useRef(0)
  const inicioDaLista = useRef<HTMLTableElement>(null)

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

  // A escrita é restrita a GESTOR (RF02). Esconder o formulário é conveniência
  // de interface, não autorização: quem decide continua sendo o 403 do
  // backend (RNF04), inclusive se esta condição estiver errada.
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
      const resultado = await listarProdutos({ busca, incluirInativos, pagina })
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
  }, [busca, incluirInativos, pagina])

  useEffect(() => {
    void carregar()
  }, [carregar])

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

  return (
    <section className="tela-produtos">
      <h2>Catálogo de produtos</h2>

      {podeEditar && (
        <form className="formulario-produto cadastro-produto" onSubmit={cadastrar}>
          <h3>Cadastrar produto</h3>

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
                  maxLength={TAMANHO_MAXIMO_CAMPO_PRODUTO}
                  aria-invalid={erroDoCampo ? true : undefined}
                  aria-describedby={descricoes}
                  value={novo[campo]}
                  onChange={(evento) => editarCampo(campo, evento)}
                  onPaste={(evento) => avisarColagemCortada(campo, foiCortado, evento)}
                />
                {avisoDeColagem && (
                  <p className="nota-informativa" id={`aviso-colagem-${campo}`} role="status">
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

          <button type="submit" disabled={salvando}>
            {salvando ? 'Cadastrando…' : 'Cadastrar'}
          </button>
        </form>
      )}

      {podeEditar && <ImportacaoProdutos aoImportar={() => void carregar()} />}

      {/* A busca reage à digitação (T26). O formulário continua existindo só
          para o Enter no campo não recarregar a página. */}
      <form className="filtros" onSubmit={(evento) => evento.preventDefault()}>
        <div className="campo">
          {/* O indicador fica na linha do rótulo: ao lado da caixa, aparecer e
              sumir a cada busca mudaria a largura dela. */}
          <div className="rotulo-com-contador">
            <label htmlFor="busca">Buscar por nome ou código</label>
            {carregando && produtos !== null && (
              <span className="indicador-carregando" role="status">
                Carregando…
              </span>
            )}
          </div>
          <div className="campo-com-limpar">
            <input
              id="busca"
              name="busca"
              ref={campoBusca}
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
        </div>
        <label className="caixa-selecao">
          <input
            type="checkbox"
            checked={incluirInativos}
            onChange={(evento) => {
              setPagina(1)
              setIncluirInativos(evento.target.checked)
            }}
          />
          Mostrar produtos inativos
        </label>
      </form>

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      {produtos === null ? (
        carregando && <p role="status">Carregando produtos…</p>
      ) : produtos.length === 0 ? (
        <p>Nenhum produto encontrado.</p>
      ) : (
        <table ref={inicioDaLista}>
          <caption>
            {total} produto(s) — página {pagina} de {totalPaginas}
          </caption>
          <thead>
            <tr>
              <th scope="col">Código</th>
              <th scope="col">Nome</th>
              <th scope="col">Marca</th>
              <th scope="col">Categoria</th>
              <th scope="col">Situação</th>
              {podeEditar && <th scope="col">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {produtos.map((produto) => (
              <tr key={produto.id} className={produto.ativo ? undefined : 'linha-inativa'}>
                <td>{produto.codigoInterno}</td>
                <td>{produto.nome}</td>
                <td>{produto.marca}</td>
                <td>{produto.categoria}</td>
                <td>{produto.ativo ? 'Ativo' : 'Inativo'}</td>
                {podeEditar && (
                  <td>
                    <button type="button" onClick={() => void alternarSituacao(produto)}>
                      {produto.ativo ? 'Inativar' : 'Reativar'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Paginacao
        pagina={pagina}
        totalPaginas={totalPaginas}
        aoMudar={setPagina}
        alvoRolagem={inicioDaLista}
      />
    </section>
  )
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
