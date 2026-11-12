import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react'
import { Icone } from './Icone'
import { LeitorCamera } from './LeitorCamera'
import { useFormatoDaTela } from '../hooks/useFormatoDaTela'
import { camposRecusados, ErroApi } from '../services/api'
import { avisar } from '../services/avisos'
import {
  consultarCodigoDeBarras,
  criarProduto,
  TAMANHO_MAXIMO_CAMPO_PRODUTO,
  TAMANHO_MAXIMO_CODIGO_DE_BARRAS,
  type DadosProduto,
  type MotivoConsultaIndisponivel,
  type Produto,
  type SugestaoProduto,
} from '../services/produtos'

type CampoProduto = keyof DadosProduto

type MensagensPorCampo = Partial<Record<CampoProduto, string>>

const CAMPOS_VAZIOS: DadosProduto = {
  codigoInterno: '',
  nome: '',
  marca: '',
  categoria: '',
}

type DescricaoCampo = {
  campo: CampoProduto
  rotulo: string
  foiCortado: string
}

/**
 * Os campos do cadastro com o rótulo da tela — que é como a mensagem de recusa
 * do servidor nomeia o campo (T25) — e o início do aviso de texto cortado,
 * com artigo e particípio no gênero do campo.
 */
const CAMPOS_DO_FORMULARIO: readonly DescricaoCampo[] = [
  { campo: 'codigoInterno', rotulo: 'Código interno', foiCortado: 'O código interno foi cortado' },
  { campo: 'nome', rotulo: 'Nome', foiCortado: 'O nome foi cortado' },
  { campo: 'marca', rotulo: 'Marca', foiCortado: 'A marca foi cortada' },
  { campo: 'categoria', rotulo: 'Categoria', foiCortado: 'A categoria foi cortada' },
]

const CAMPO_CATEGORIA = CAMPOS_DO_FORMULARIO[3]!

/**
 * Por que o formulário está aberto, que é o que decide a nota acima dele: a
 * consulta não achou o código, não respondeu (os três motivos do servidor), a
 * gestora quis editar ou completar o que a consulta achou, ou chegou ao
 * formulário sem consulta (produto sem código de barras, ou "não é este").
 */
export type OrigemFormulario =
  | 'MANUAL'
  | 'NAO_ENCONTRADO'
  | MotivoConsultaIndisponivel
  | 'EDITAR'
  | 'COMPLETAR'

/**
 * O cadastro em andamento (T47). Mora na `TelaProdutos`, e não aqui, para
 * sobreviver a fechar e reabrir o painel, como o formulário de T45 sobrevivia.
 */
export type RascunhoCadastro = {
  etapa: 'codigo' | 'encontrado' | 'formulario'
  codigoDeBarras: string
  /** O que a consulta achou: o card mostra, e "Editar" e "Completar" partem daí. */
  encontrado: { fonte: string; sugestao: SugestaoProduto } | null
  origem: OrigemFormulario
  /** O que vai no `POST /produtos`, venha do card ou do formulário. */
  campos: DadosProduto
}

export const RASCUNHO_INICIAL: RascunhoCadastro = {
  etapa: 'codigo',
  codigoDeBarras: '',
  encontrado: null,
  origem: 'MANUAL',
  campos: CAMPOS_VAZIOS,
}

type Props = {
  /** As categorias que já existem, para as sugestões do campo (T45). */
  categorias: string[]
  rascunho: RascunhoCadastro
  aoMudarRascunho: Dispatch<SetStateAction<RascunhoCadastro>>
  /** Depois de um cadastro aceito, para a lista e as categorias recarregarem. */
  aoCadastrar: () => void
  /** O código consultado já está no catálogo: a tela mostra o produto na lista. */
  aoMostrarNaLista: (produto: Produto) => void
}

/**
 * Cadastro de um produto pelo código de barras (T47), no painel do Catálogo.
 * Três etapas:
 *
 * 1. **Código de barras**, digitado, lido por um leitor USB (que "digita" e
 *    tecla Enter) ou, no celular, pela câmera.
 * 2. **Card do produto encontrado** no catálogo externo, cadastrado dali mesmo
 *    com um toque, ou levado ao formulário para editar.
 * 3. **Formulário** com os quatro campos (T04, T25), quando a consulta não
 *    achou, não respondeu, ou o produto não tem código de barras.
 *
 * Quem decide se o código existe, se é válido e o que a fonte sabe dele é o
 * servidor; a tela só mostra cada resposta.
 */
export function CadastroProduto({
  categorias,
  rascunho,
  aoMudarRascunho,
  aoCadastrar,
  aoMostrarNaLista,
}: Props) {
  const elemento = useRef<HTMLDivElement>(null)
  const [consultando, setConsultando] = useState(false)
  const [erroCodigo, setErroCodigo] = useState<string | null>(null)
  const [jaCadastrado, setJaCadastrado] = useState<Produto | null>(null)
  const [errosDeCampo, setErrosDeCampo] = useState<MensagensPorCampo>({})
  const [avisosDeCorte, setAvisosDeCorte] = useState<MensagensPorCampo>({})
  const [salvando, setSalvando] = useState(false)
  const [imagemQueFalhou, setImagemQueFalhou] = useState<string | null>(null)

  // A câmera é do celular (decisão do orientando, T47): é nele que a gestora
  // está com o frasco na mão e sem leitor de código de barras.
  const cameraDisponivel = useFormatoDaTela() === 'celular'
  const [cameraLigada, setCameraLigada] = useState(false)
  const [avisoCamera, setAvisoCamera] = useState<string | null>(null)

  // A cada troca de etapa, o foco vai para onde a gestora continua: o título
  // do card (que o leitor de tela anuncia), o primeiro campo vazio do
  // formulário — o Nome, quando o código já veio da consulta — ou o código de
  // barras. A abertura do painel não passa por aqui: quem foca nela é a tela.
  const etapaAnterior = useRef(rascunho.etapa)
  useEffect(() => {
    if (etapaAnterior.current === rascunho.etapa) return
    etapaAnterior.current = rascunho.etapa

    const raiz = elemento.current
    if (!raiz) return
    if (rascunho.etapa === 'encontrado') {
      raiz.querySelector<HTMLElement>('#titulo-produto-encontrado')?.focus()
      return
    }
    const campos = Array.from(raiz.querySelectorAll('input'))
    ;(campos.find((campo) => campo.value === '') ?? campos[0])?.focus()
  }, [rascunho.etapa])

  function irPara(mudanca: Partial<RascunhoCadastro>) {
    setErrosDeCampo({})
    setAvisosDeCorte({})
    aoMudarRascunho((atual) => ({ ...atual, ...mudanca }))
  }

  function abrirFormulario(origem: OrigemFormulario, codigoInterno = '') {
    irPara({ etapa: 'formulario', origem, campos: { ...CAMPOS_VAZIOS, codigoInterno } })
  }

  function recomecar() {
    setErroCodigo(null)
    setJaCadastrado(null)
    irPara(RASCUNHO_INICIAL)
  }

  async function buscar(codigo: string) {
    const termo = codigo.trim()
    if (!termo) return

    setErroCodigo(null)
    setJaCadastrado(null)
    setConsultando(true)
    try {
      const resposta = await consultarCodigoDeBarras(termo)
      switch (resposta.situacao) {
        case 'JA_CADASTRADO':
          setJaCadastrado(resposta.produto)
          break
        case 'ENCONTRADO':
          irPara({
            etapa: 'encontrado',
            encontrado: { fonte: resposta.fonte, sugestao: resposta.sugestao },
            origem: 'EDITAR',
            campos: camposDaSugestao(resposta.sugestao).campos,
          })
          break
        case 'NAO_ENCONTRADO':
          abrirFormulario('NAO_ENCONTRADO', semEspacos(termo))
          break
        case 'INDISPONIVEL':
          // Fonte fora do ar, cota esgotada ou servidor sem token: o cadastro
          // não espera pela consulta, segue à mão.
          abrirFormulario(resposta.motivo, semEspacos(termo))
          break
      }
    } catch (falha) {
      // Código que não pode ser código de barras (formato ou dígito
      // verificador): a mensagem do servidor fica junto do campo, que é onde
      // está o que corrigir. Outra falha é da ação, e vira toast (T29).
      if (falha instanceof ErroApi && falha.codigo === 'CODIGO_DE_BARRAS_INVALIDO') {
        setErroCodigo(falha.message)
      } else {
        avisar.erro(falha, 'Não foi possível consultar o código de barras.')
      }
    } finally {
      setConsultando(false)
    }
  }

  function consultarDigitado(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    void buscar(rascunho.codigoDeBarras)
  }

  function editarCodigoDeBarras(evento: ChangeEvent<HTMLInputElement>) {
    const valor = evento.target.value
    setErroCodigo(null)
    setJaCadastrado(null)
    aoMudarRascunho((atual) => ({ ...atual, codigoDeBarras: valor }))
  }

  function lerPelaCamera(texto: string) {
    // Leitura única (T31): a câmera desliga ao identificar o código, e a
    // consulta sai sem esperar o toque em "Buscar produto".
    setCameraLigada(false)
    aoMudarRascunho((atual) => ({ ...atual, codigoDeBarras: texto }))
    void buscar(texto)
  }

  function ligarCamera() {
    setAvisoCamera(null)
    setCameraLigada(true)
  }

  function falhaDaCamera(mensagem: string) {
    setCameraLigada(false)
    setAvisoCamera(mensagem)
  }

  /**
   * O que a consulta trouxe e não cabe no cadastro direto do card — marca
   * ausente ou texto acima do limite — vai para o formulário. O corte já
   * aconteceu em `camposDaSugestao`; aqui ele é avisado, como na colagem (T25),
   * porque cortar em silêncio é o que T25 proibiu.
   */
  function completar() {
    const sugestao = rascunho.encontrado?.sugestao
    const cortados = sugestao ? camposDaSugestao(sugestao).cortados : []
    irPara({ etapa: 'formulario', origem: 'COMPLETAR' })
    setAvisosDeCorte(
      Object.fromEntries(
        CAMPOS_DO_FORMULARIO.filter(({ campo }) => cortados.includes(campo)).map(
          ({ campo, foiCortado }) => [campo, `${foiCortado} em ${TAMANHO_MAXIMO_CAMPO_PRODUTO} caracteres.`],
        ),
      ),
    )
  }

  async function cadastrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErrosDeCampo({})
    setSalvando(true)

    try {
      const criado = await criarProduto(rascunho.campos)
      avisar.sucesso(`Produto “${criado.nome}” cadastrado.`)
      setAvisosDeCorte({})
      // O painel continua aberto, na primeira etapa, para o próximo cadastro.
      aoMudarRascunho(RASCUNHO_INICIAL)
      aoCadastrar()
    } catch (falha) {
      // Recusa de schema (T12b) traz os campos recusados: a mensagem vai para
      // junto do campo, com o rótulo da tela (T25). O texto genérico do
      // servidor só aparece quando nenhum campo daqui foi nomeado.
      const recusados =
        falha instanceof ErroApi && falha.codigo === 'CORPO_INVALIDO'
          ? errosPelosCampos(camposRecusados(falha.corpo))
          : {}
      if (Object.keys(recusados).length > 0) {
        // No card só a categoria tem campo. Recusa de outro campo leva ao
        // formulário, onde o campo recusado aparece com a mensagem.
        if (
          rascunho.etapa === 'encontrado' &&
          Object.keys(recusados).some((campo) => campo !== 'categoria')
        ) {
          aoMudarRascunho((atual) => ({ ...atual, etapa: 'formulario', origem: 'EDITAR' }))
        }
        setErrosDeCampo(recusados)
        return
      }

      // Código interno duplicado chega como 409 com mensagem própria do
      // backend — a tela só exibe o que recebeu. Os dados ficam na tela.
      avisar.erro(falha, 'Não foi possível cadastrar o produto.')
    } finally {
      setSalvando(false)
    }
  }

  function editarCampo(campo: CampoProduto, evento: ChangeEvent<HTMLInputElement>) {
    const valor = evento.target.value
    aoMudarRascunho((atual) => ({ ...atual, campos: { ...atual.campos, [campo]: valor } }))
    setErrosDeCampo((atuais) => semCampo(atuais, campo))
    // A própria colagem também dispara esta edição, logo depois de
    // `avisarColagemCortada`; só ela não pode apagar o aviso que acabou de criar.
    if ((evento.nativeEvent as InputEvent).inputType !== 'insertFromPaste') {
      setAvisosDeCorte((atuais) => semCampo(atuais, campo))
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
      setAvisosDeCorte((atuais) => ({
        ...atuais,
        [campo]: `${foiCortado} em ${TAMANHO_MAXIMO_CAMPO_PRODUTO} caracteres.`,
      }))
    }
  }

  function campoDeTexto({ campo, rotulo, foiCortado }: DescricaoCampo) {
    const erroDoCampo = errosDeCampo[campo]
    const avisoDeCorte = avisosDeCorte[campo]
    const descricoes = [
      `contador-${campo}`,
      erroDoCampo ? `erro-${campo}` : null,
      avisoDeCorte ? `aviso-colagem-${campo}` : null,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div className="campo" key={campo}>
        <div className="rotulo-com-contador">
          <label htmlFor={campo}>{rotulo}</label>
          <span className="contador-caracteres" id={`contador-${campo}`}>
            {rascunho.campos[campo].length}/{TAMANHO_MAXIMO_CAMPO_PRODUTO}
          </span>
        </div>
        <input
          id={campo}
          name={campo}
          required
          className={campo === 'codigoInterno' ? 'codigo' : undefined}
          placeholder={campo === 'codigoInterno' ? 'Ex.: PRF-021' : undefined}
          // A categoria sugere as que já existem e aceita uma nova (T45):
          // escolher da lista evita "Perfumaria" e "perfumaria" como duas
          // pílulas.
          list={campo === 'categoria' ? 'categorias-existentes' : undefined}
          autoComplete={campo === 'categoria' ? 'off' : undefined}
          maxLength={TAMANHO_MAXIMO_CAMPO_PRODUTO}
          aria-invalid={erroDoCampo ? true : undefined}
          aria-describedby={descricoes}
          value={rascunho.campos[campo]}
          onChange={(evento) => editarCampo(campo, evento)}
          onPaste={(evento) => avisarColagemCortada(campo, foiCortado, evento)}
        />
        {avisoDeCorte && (
          <p className="nota-informativa" id={`aviso-colagem-${campo}`} role="status">
            {avisoDeCorte}
          </p>
        )}
        {erroDoCampo && (
          <p className="erro" id={`erro-${campo}`} role="alert">
            {erroDoCampo}
          </p>
        )}
      </div>
    )
  }

  const sugestoesDeCategoria = (
    <datalist id="categorias-existentes">
      {categorias.map((existente) => (
        <option key={existente} value={existente} />
      ))}
    </datalist>
  )

  if (rascunho.etapa === 'encontrado' && rascunho.encontrado) {
    const { fonte, sugestao } = rascunho.encontrado
    // Cadastro direto só com o que o `POST` aceita como veio: marca presente e
    // nada acima do limite. O resto passa pelo formulário.
    const completo = sugestao.marca !== null && camposDaSugestao(sugestao).cortados.length === 0
    const mostrarImagem = sugestao.imagemUrl !== null && sugestao.imagemUrl !== imagemQueFalhou

    return (
      <div ref={elemento} className="cadastro-produto etapa-encontrado">
        <h3 id="titulo-produto-encontrado" tabIndex={-1}>
          Encontramos este produto
        </h3>
        <div className="produto-encontrado">
          {mostrarImagem && (
            // A imagem é ilustração: nome, marca e código estão ao lado, em
            // texto. Vem do servidor da fonte, sem o endereço do app junto.
            <img
              src={sugestao.imagemUrl ?? undefined}
              alt=""
              width={64}
              height={64}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImagemQueFalhou(sugestao.imagemUrl)}
            />
          )}
          <div className="dados-produto-encontrado">
            <span className="nome-produto">{sugestao.nome}</span>
            <span className="marca-produto">{sugestao.marca ?? 'Marca não informada'}</span>
            <span className="codigo">{sugestao.codigoInterno}</span>
          </div>
        </div>
        <p className="fonte-consulta">
          Fonte: {fonte}. Confira se é o produto que você tem em mãos.
        </p>

        {completo ? (
          <form className="formulario-coluna" onSubmit={cadastrar}>
            {campoDeTexto(CAMPO_CATEGORIA)}
            {sugestoesDeCategoria}
            <button type="submit" aria-busy={salvando} disabled={salvando}>
              {salvando ? 'Cadastrando…' : 'Cadastrar este produto'}
            </button>
          </form>
        ) : (
          <div className="acoes-cadastro">
            <button type="button" onClick={completar}>
              Completar e cadastrar
            </button>
          </div>
        )}

        <div className="links-cadastro">
          {completo && (
            <button
              type="button"
              className="botao-link"
              onClick={() => irPara({ etapa: 'formulario', origem: 'EDITAR' })}
            >
              Editar antes de cadastrar
            </button>
          )}
          <button
            type="button"
            className="botao-link"
            onClick={() => abrirFormulario('MANUAL', sugestao.codigoInterno)}
          >
            Não é este produto
          </button>
          <button type="button" className="botao-link" onClick={recomecar}>
            Buscar outro código
          </button>
        </div>
      </div>
    )
  }

  if (rascunho.etapa === 'formulario') {
    const nota = notaDoFormulario(rascunho, rascunho.encontrado?.fonte)

    return (
      <div ref={elemento} className="cadastro-produto etapa-formulario">
        {nota && (
          <p className="nota-informativa nota-cadastro" role="status">
            {nota}
          </p>
        )}
        <form className="formulario-coluna" onSubmit={cadastrar}>
          {CAMPOS_DO_FORMULARIO.map(campoDeTexto)}
          {sugestoesDeCategoria}
          <button type="submit" aria-busy={salvando} disabled={salvando}>
            {salvando ? 'Cadastrando…' : 'Cadastrar produto'}
          </button>
        </form>
        <div className="links-cadastro">
          <button type="button" className="botao-link" onClick={recomecar}>
            {rascunho.codigoDeBarras ? 'Buscar outro código' : 'Buscar pelo código de barras'}
          </button>
        </div>
      </div>
    )
  }

  const descricoesCodigo = [erroCodigo ? 'erro-codigoDeBarras' : null, jaCadastrado ? 'ja-cadastrado' : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div ref={elemento} className="cadastro-produto etapa-codigo">
      <form className="formulario-coluna" onSubmit={consultarDigitado}>
        <div className="campo">
          <label htmlFor="codigoDeBarras">Código de barras</label>
          <input
            id="codigoDeBarras"
            name="codigoDeBarras"
            required
            className="codigo"
            placeholder="Ex.: 7891234567895"
            inputMode="numeric"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={TAMANHO_MAXIMO_CODIGO_DE_BARRAS}
            // Só leitura, e não desabilitado, durante a consulta: o foco fica
            // no campo, e o leitor USB não perde o próximo código.
            readOnly={consultando}
            aria-invalid={erroCodigo ? true : undefined}
            aria-describedby={descricoesCodigo || undefined}
            value={rascunho.codigoDeBarras}
            onChange={editarCodigoDeBarras}
          />
          {erroCodigo && (
            <p className="erro" id="erro-codigoDeBarras" role="alert">
              {erroCodigo}
            </p>
          )}
          {jaCadastrado && (
            <div className="nota-informativa" id="ja-cadastrado" role="status">
              O código {jaCadastrado.codigoInterno} já está no catálogo: “{jaCadastrado.nome}” (
              {jaCadastrado.marca}){jaCadastrado.ativo ? '' : ', inativo'}.{' '}
              <button
                type="button"
                className="botao-link"
                onClick={() => aoMostrarNaLista(jaCadastrado)}
              >
                Mostrar na lista
              </button>
            </div>
          )}
        </div>

        {cameraDisponivel && cameraLigada && (
          <div className="camera">
            <LeitorCamera
              modo="unica"
              leitura="codigo-de-barras"
              aoLer={lerPelaCamera}
              aoFalhar={falhaDaCamera}
            />
            <button type="button" className="secundario" onClick={() => setCameraLigada(false)}>
              Desligar câmera
            </button>
          </div>
        )}

        <div className="acoes-cadastro">
          <button type="submit" aria-busy={consultando} disabled={consultando}>
            {consultando ? 'Buscando…' : 'Buscar produto'}
          </button>
          {cameraDisponivel && !cameraLigada && (
            <button type="button" className="secundario" onClick={ligarCamera} disabled={consultando}>
              <Icone nome="camera" />
              Ler com a câmera
            </button>
          )}
        </div>

        {cameraDisponivel && avisoCamera && (
          <p className="erro" role="alert">
            {avisoCamera}
          </p>
        )}
      </form>

      <p className="troca-painel">
        Produto sem código de barras?{' '}
        <button
          type="button"
          className="botao-link"
          onClick={() => {
            setErroCodigo(null)
            setJaCadastrado(null)
            setCameraLigada(false)
            irPara({ ...RASCUNHO_INICIAL, etapa: 'formulario' })
          }}
        >
          Preencha manualmente
        </button>
        .
      </p>
    </div>
  )
}

/**
 * A sugestão da consulta nos campos do cadastro, cortada no limite de 120
 * caracteres de cada um. Quais foram cortados volta junto: o card só cadastra
 * direto o que não precisou de corte, e o formulário avisa do corte.
 */
function camposDaSugestao(sugestao: SugestaoProduto): {
  campos: DadosProduto
  cortados: CampoProduto[]
} {
  const brutos: DadosProduto = {
    codigoInterno: sugestao.codigoInterno,
    nome: sugestao.nome,
    marca: sugestao.marca ?? '',
    categoria: sugestao.categoria ?? '',
  }
  const cortados = CAMPOS_DO_FORMULARIO.map(({ campo }) => campo).filter(
    (campo) => brutos[campo].length > TAMANHO_MAXIMO_CAMPO_PRODUTO,
  )
  return {
    campos: {
      codigoInterno: brutos.codigoInterno.slice(0, TAMANHO_MAXIMO_CAMPO_PRODUTO),
      nome: brutos.nome.slice(0, TAMANHO_MAXIMO_CAMPO_PRODUTO),
      marca: brutos.marca.slice(0, TAMANHO_MAXIMO_CAMPO_PRODUTO),
      categoria: brutos.categoria.slice(0, TAMANHO_MAXIMO_CAMPO_PRODUTO),
    },
    cortados,
  }
}

/** A nota acima do formulário, que diz por que ele está aberto. */
function notaDoFormulario(rascunho: RascunhoCadastro, fonte = 'consultada'): string | null {
  switch (rascunho.origem) {
    case 'NAO_ENCONTRADO':
      return `Não encontramos o código ${semEspacos(rascunho.codigoDeBarras)} na base consultada. Preencha os dados do produto.`
    case 'FALHA':
      return 'A consulta automática não respondeu agora. Preencha os dados do produto.'
    case 'LIMITE_DIARIO':
      return 'As consultas automáticas de hoje acabaram. Preencha os dados do produto.'
    case 'NAO_CONFIGURADA':
      return 'A consulta automática não está ligada. Preencha os dados do produto.'
    case 'EDITAR':
      return `Dados da base ${fonte}. Confira antes de cadastrar.`
    case 'COMPLETAR':
      return `A base ${fonte} não trouxe tudo o que o cadastro pede. Complete e confira antes de cadastrar.`
    case 'MANUAL':
      return null
  }
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

/** Código de barras copiado de nota fiscal costuma vir em grupos ("7 891234 567895"). */
function semEspacos(codigo: string): string {
  return codigo.replace(/\s+/g, '')
}
