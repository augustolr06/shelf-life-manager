import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
} from 'react'
import { ImportacaoProdutos } from '../components/ImportacaoProdutos'
import { camposRecusados, ErroApi } from '../services/api'
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

type Props = {
  usuario: Usuario
}

export function TelaProdutos({ usuario }: Props) {
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [total, setTotal] = useState(0)
  const [tamanhoPagina, setTamanhoPagina] = useState(20)
  const [pagina, setPagina] = useState(1)
  const [busca, setBusca] = useState('')
  const [termoDigitado, setTermoDigitado] = useState('')
  const [incluirInativos, setIncluirInativos] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [novo, setNovo] = useState<DadosProduto>(CAMPOS_VAZIOS)
  const [erroFormulario, setErroFormulario] = useState<string | null>(null)
  const [errosDeCampo, setErrosDeCampo] = useState<MensagensPorCampo>({})
  const [avisosDeColagem, setAvisosDeColagem] = useState<MensagensPorCampo>({})
  const [salvando, setSalvando] = useState(false)

  // A escrita é restrita a GESTOR (RF02). Esconder o formulário é conveniência
  // de interface, não autorização: quem decide continua sendo o 403 do
  // backend (RNF04), inclusive se esta condição estiver errada.
  const podeEditar = usuario.papel === 'GESTOR'

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const resultado = await listarProdutos({ busca, incluirInativos, pagina })
      setProdutos(resultado.produtos)
      setTotal(resultado.total)
      setTamanhoPagina(resultado.tamanhoPagina)
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível carregar o catálogo.')
    } finally {
      setCarregando(false)
    }
  }, [busca, incluirInativos, pagina])

  useEffect(() => {
    void carregar()
  }, [carregar])

  function buscarProdutos(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    // Volta à primeira página: a página atual pode nem existir no novo filtro.
    setPagina(1)
    setBusca(termoDigitado.trim())
  }

  async function cadastrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErroFormulario(null)
    setErrosDeCampo({})
    setSalvando(true)

    try {
      await criarProduto(novo)
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
      // backend — a tela só exibe o que recebeu.
      setErroFormulario(
        falha instanceof ErroApi ? falha.message : 'Não foi possível cadastrar o produto.',
      )
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
    setErro(null)
    try {
      const atualizado = produto.ativo
        ? await inativarProduto(produto.id)
        : await reativarProduto(produto.id)

      // Se o produto inativado sai do filtro corrente, recarrega; senão basta
      // trocar a linha no lugar.
      if (!atualizado.ativo && !incluirInativos) {
        await carregar()
        return
      }
      setProdutos((atuais) => atuais.map((p) => (p.id === atualizado.id ? atualizado : p)))
    } catch (falha) {
      setErro(
        falha instanceof ErroApi ? falha.message : 'Não foi possível alterar a situação do produto.',
      )
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

          {erroFormulario && (
            <p className="erro" role="alert">
              {erroFormulario}
            </p>
          )}

          <button type="submit" disabled={salvando}>
            {salvando ? 'Cadastrando…' : 'Cadastrar'}
          </button>
        </form>
      )}

      {podeEditar && <ImportacaoProdutos aoImportar={() => void carregar()} />}

      <form className="filtros" onSubmit={buscarProdutos}>
        <div className="campo">
          <label htmlFor="busca">Buscar por nome ou código</label>
          <input
            id="busca"
            name="busca"
            value={termoDigitado}
            onChange={(evento) => setTermoDigitado(evento.target.value)}
          />
        </div>
        <button type="submit">Buscar</button>
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

      {carregando ? (
        <p role="status">Carregando produtos…</p>
      ) : produtos.length === 0 ? (
        <p>Nenhum produto encontrado.</p>
      ) : (
        <table>
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
        </div>
      )}
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
