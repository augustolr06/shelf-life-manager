import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LeitorCamera } from '../components/LeitorCamera'
import { PortaoOffline } from '../components/PortaoOffline'
import { useConexao } from '../hooks/useConexao'
import { ErroApi } from '../services/api'
import {
  buscarEstoqueDoProduto,
  buscarNaConsulta,
  type EstoqueDoProduto,
  type ProdutoNaConsulta,
  type UnidadeEmEstoque,
} from '../services/consulta'
import { formatarData, formatarInstante } from '../services/datas'
import type { ConsultaUnidade } from '../services/unidades'

/**
 * Consultar produto (T32, T49): o que é este frasco, ou o que existe deste
 * produto na loja, sem vender. Um campo só aceita o código da etiqueta, o
 * código de barras, o nome e a marca; quem decide o que o texto é, é o
 * servidor, dono do formato da etiqueta (T08).
 *
 * Mostra dados, não ordem. Se uma unidade é a próxima a sair é veredito FIFO,
 * e a RNF03 o prende a `validarSaidaFifo`; a consulta não passa por ela, e a
 * lista de unidades do produto vem em ordem de validade sem marcar nenhuma.
 * Também não compara datas: dias, situação e faixa vêm prontos do servidor
 * (RNF01, RNF04).
 *
 * A câmera fica ligada esperando o próximo frasco (modo `'continua'` de T31)
 * e lê tanto a etiqueta quanto o código de barras da embalagem: aqui nada é
 * gravado, e ler o seguinte sem tocar na tela é o que se quer.
 */

const ROTULO_DO_STATUS: Record<ConsultaUnidade['unidade']['status'], string> = {
  EM_ESTOQUE: 'Em estoque',
  VENDIDA: 'Vendida',
  DESCARTADA: 'Descartada',
}

/** O que está na área de resultado. O produto lembra de onde veio, para o "Voltar". */
type Visao =
  | { tipo: 'UNIDADE'; consulta: ConsultaUnidade }
  | { tipo: 'LISTA'; termo: string; produtos: ProdutoNaConsulta[]; total: number }
  | { tipo: 'NADA'; termo: string }
  | { tipo: 'PRODUTO'; estoque: EstoqueDoProduto; voltar: Visao | null }

export function TelaConsulta() {
  const { conexao, verificar } = useConexao()

  const [termoDigitado, setTermoDigitado] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [visao, setVisao] = useState<Visao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [cameraLigada, setCameraLigada] = useState(false)
  const [avisoCamera, setAvisoCamera] = useState<string | null>(null)

  // A câmera contínua entrega o mesmo frasco dez vezes por segundo. Uma
  // consulta por vez, e o código que já está na tela (ou a caminho dela) não
  // é consultado de novo — inclusive o que não achou nada, que senão viraria
  // uma rajada de consultas.
  const emVoo = useRef(false)
  const ultimoCodigo = useRef<string | null>(null)

  // O resultado é do estoque de um instante: depois de uma queda, a unidade
  // pode ter sido vendida por outra pessoa. Mesmo motivo da tela de Venda.
  useEffect(() => {
    if (conexao === 'offline') {
      setVisao(null)
      setErro(null)
      ultimoCodigo.current = null
    }
  }, [conexao])

  function tratarFalha(falha: unknown, padrao: string) {
    // Um termo diferente substitui o resultado anterior, inclusive quando
    // falha: deixar o frasco anterior na tela faria parecer que é dele que se
    // está falando.
    setVisao(null)
    setErro(falha instanceof ErroApi ? falha.message : padrao)
    // Rede caída leva ao portão de offline, como na Venda (RNF07).
    if (falha instanceof ErroApi && falha.status === 0) void verificar()
  }

  async function consultar(texto: string) {
    const termo = texto.trim()
    if (termo === '' || emVoo.current) return

    emVoo.current = true
    ultimoCodigo.current = termo
    setConsultando(true)

    try {
      // O termo vai como foi lido ou digitado: quem normaliza é o backend.
      const resposta = await buscarNaConsulta(termo)
      setErro(null)
      if (resposta.tipo === 'UNIDADE') {
        setVisao({ tipo: 'UNIDADE', consulta: resposta.consulta })
        setTermoDigitado('')
      } else if (resposta.total === 0) {
        setVisao({ tipo: 'NADA', termo })
      } else if (resposta.total === 1 && resposta.produtos[0]) {
        // Um produto só — o código de barras, quase sempre: abre direto.
        const estoque = await buscarEstoqueDoProduto(resposta.produtos[0].id)
        setVisao({ tipo: 'PRODUTO', estoque, voltar: null })
      } else {
        setVisao({ tipo: 'LISTA', termo, produtos: resposta.produtos, total: resposta.total })
      }
    } catch (falha) {
      tratarFalha(falha, 'Não foi possível fazer a consulta.')
    } finally {
      emVoo.current = false
      setConsultando(false)
    }
  }

  async function abrirProduto(id: string, voltar: Visao) {
    if (emVoo.current) return
    emVoo.current = true
    setConsultando(true)
    try {
      const estoque = await buscarEstoqueDoProduto(id)
      setErro(null)
      setVisao({ tipo: 'PRODUTO', estoque, voltar })
    } catch (falha) {
      tratarFalha(falha, 'Não foi possível carregar o estoque do produto.')
    } finally {
      emVoo.current = false
      setConsultando(false)
    }
  }

  // `?codigo=` chega da busca e do "Ver unidade" do Início (T42): a consulta
  // sai sozinha, como se o código tivesse sido digitado. Uma vez por código —
  // o `emVoo` segura a segunda chamada do modo estrito do React.
  const [parametros] = useSearchParams()
  const codigoDaUrl = parametros.get('codigo')
  useEffect(() => {
    if (codigoDaUrl) void consultar(codigoDaUrl)
    // `consultar` fica fora das dependências: ela muda a cada render, e o que
    // dispara a consulta é o código.
  }, [codigoDaUrl])

  function lerPelaCamera(texto: string) {
    if (texto.trim() === ultimoCodigo.current) return
    void consultar(texto)
  }

  function lerDigitado(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    // Digitar é ato deliberado: consulta de novo mesmo o termo que está na
    // tela, para quem quer o dado atualizado.
    void consultar(termoDigitado)
  }

  function ligarCamera() {
    // Também deliberado: o frasco que está na frente da câmera pode ser o
    // mesmo da tela, e religar é pedir o dado de novo.
    ultimoCodigo.current = null
    setAvisoCamera(null)
    setCameraLigada(true)
  }

  function falhaDaCamera(mensagem: string) {
    setCameraLigada(false)
    setAvisoCamera(mensagem)
  }

  return (
    <section className="tela tela-leitura">
      <h1>Consultar produto</h1>
      <p className="subtitulo">
        Leia a etiqueta de um frasco ou o código de barras da embalagem, ou busque o produto pelo
        nome ou pela marca. <strong>Consultar não dá baixa:</strong> nada sai do estoque e nada é
        registrado. Para vender, use a tela de Venda.
      </p>

      {conexao !== 'online' ? (
        <PortaoOffline estado={conexao} aoTentarDeNovo={verificar}>
          A consulta não funciona offline: os dados de cada frasco estão no servidor, e um resultado
          antigo poderia falar de uma unidade que já foi vendida.
        </PortaoOffline>
      ) : (
        <>
          <div className="cartao camera">
            {cameraLigada ? (
              <>
                <LeitorCamera
                  modo="continua"
                  leitura="qr-e-codigo-de-barras"
                  aoLer={lerPelaCamera}
                  aoFalhar={falhaDaCamera}
                />
                <button type="button" className="secundario" onClick={() => setCameraLigada(false)}>
                  Desligar câmera
                </button>
              </>
            ) : (
              <button type="button" onClick={ligarCamera}>
                Ligar câmera
              </button>
            )}

            {avisoCamera && (
              <p className="erro" role="alert">
                {avisoCamera}
              </p>
            )}
          </div>

          <form className="cartao entrada-manual" onSubmit={lerDigitado}>
            <div className="campo">
              <label htmlFor="termo-consulta">
                Ou busque por nome, marca, código de barras ou código da etiqueta
              </label>
              <input
                id="termo-consulta"
                name="termo-consulta"
                autoComplete="off"
                enterKeyHint="search"
                // O teto da busca no servidor, como no Catálogo (T26).
                maxLength={120}
                value={termoDigitado}
                onChange={(evento) => setTermoDigitado(evento.target.value)}
                placeholder="Ex.: Alta Moda, 7891234567895 ou PRF-XXXXXX"
              />
            </div>
            <button
              type="submit"
              aria-busy={consultando}
              disabled={consultando || termoDigitado.trim() === ''}
            >
              {consultando ? 'Buscando…' : 'Buscar'}
            </button>
          </form>

          <div className="area-resultado" aria-live="polite">
            {erro && (
              <p className="erro" role="alert">
                {erro}
              </p>
            )}
            {visao?.tipo === 'UNIDADE' && (
              <ResultadoDaUnidade
                consulta={visao.consulta}
                aoVerEstoque={() => void abrirProduto(visao.consulta.unidade.produto.id, visao)}
              />
            )}
            {visao?.tipo === 'NADA' && (
              <p className="nota-informativa nota-consulta" role="status">
                Nada encontrado para “{visao.termo}”. Confira o código ou busque pelo nome ou pela
                marca.
              </p>
            )}
            {visao?.tipo === 'LISTA' && (
              <ListaDeProdutos
                visao={visao}
                aoEscolher={(produto) => void abrirProduto(produto.id, visao)}
              />
            )}
            {visao?.tipo === 'PRODUTO' && (
              <EstoqueDoProdutoCartao
                estoque={visao.estoque}
                voltar={visao.voltar}
                aoVoltar={(anterior) => setVisao(anterior)}
              />
            )}
          </div>
        </>
      )}
    </section>
  )
}

function plural(quantidade: number, singular: string, plural: string): string {
  return `${quantidade} ${quantidade === 1 ? singular : plural}`
}

/**
 * O cartão do frasco (T32). Tudo o que diz se a unidade venceu vem de
 * `situacao`; `diasParaVencer` só dá o número, como na lista de alertas (T19).
 */
function ResultadoDaUnidade({
  consulta,
  aoVerEstoque,
}: {
  consulta: ConsultaUnidade
  aoVerEstoque: () => void
}) {
  const { unidade, situacao, diasParaVencer } = consulta
  const vencida = situacao === 'VENCIDA'
  const textoDosDias = plural(Math.abs(diasParaVencer), 'dia', 'dias')

  return (
    <section className={vencida ? 'cartao resultado resultado-vencido' : 'cartao resultado'}>
      <h3>{unidade.produto.nome}</h3>

      {vencida && (
        <p className="erro">
          <strong>Vencida</strong> há {textoDosDias}.
        </p>
      )}
      {!unidade.produto.ativo && <p className="subtitulo">Produto inativo no catálogo.</p>}

      <dl className="dados-unidade">
        <dt>Marca</dt>
        <dd>{unidade.produto.marca}</dd>
        <dt>Categoria</dt>
        <dd>{unidade.produto.categoria}</dd>
        <dt>Código interno</dt>
        <dd className="codigo">{unidade.produto.codigoInterno}</dd>
        <dt>Validade</dt>
        <dd>{formatarData(unidade.dataValidade)}</dd>
        {!vencida && (
          <>
            <dt>Vence em</dt>
            <dd>{diasParaVencer === 0 ? 'hoje' : textoDosDias}</dd>
          </>
        )}
        <dt>Situação</dt>
        <dd>{ROTULO_DO_STATUS[unidade.status]}</dd>
        <dt>Entrada</dt>
        <dd>{formatarInstante(unidade.dataEntrada)}</dd>
        <dt>Código</dt>
        <dd className="codigo">{unidade.codigoQr}</dd>
      </dl>

      <button type="button" className="secundario" onClick={aoVerEstoque}>
        Ver estoque do produto
      </button>
    </section>
  )
}

/** Mais de um produto para o termo (T49): escolher abre o estoque dele. */
function ListaDeProdutos({
  visao,
  aoEscolher,
}: {
  visao: Extract<Visao, { tipo: 'LISTA' }>
  aoEscolher: (produto: ProdutoNaConsulta) => void
}) {
  return (
    <section className="cartao lista-consulta" aria-labelledby="titulo-lista-consulta">
      <h3 id="titulo-lista-consulta">
        {plural(visao.total, 'produto', 'produtos')} para “{visao.termo}”
      </h3>
      <ul className="produtos-consulta">
        {visao.produtos.map((produto) => (
          <li key={produto.id}>
            <button
              type="button"
              className="item-produto-consulta"
              onClick={() => aoEscolher(produto)}
            >
              <span className="dados-item-consulta">
                <span className="nome-produto">{produto.nome}</span>
                <span className="marca-produto">
                  {produto.marca} · <span className="codigo">{produto.codigoInterno}</span>
                </span>
              </span>
              <span className="estoque-item-consulta">
                {!produto.ativo && <span className="distintivo distintivo-inativo">Inativo</span>}
                {plural(produto.emEstoque, 'em estoque', 'em estoque')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {visao.total > visao.produtos.length && (
        <p className="subtitulo">
          Mostrando {visao.produtos.length} de {visao.total}. Refine a busca para achar os outros.
        </p>
      )}
    </section>
  )
}

/** O distintivo da faixa (T40) com o texto do estado, nunca só a cor. */
function textoDaValidade(unidade: UnidadeEmEstoque): string {
  if (unidade.situacao === 'VENCIDA') {
    return `vencida há ${plural(Math.abs(unidade.diasParaVencer), 'dia', 'dias')}`
  }
  if (unidade.diasParaVencer === 0) return 'vence hoje'
  return `vence em ${plural(unidade.diasParaVencer, 'dia', 'dias')}`
}

/** O produto e o que existe dele na loja agora (T49). */
function EstoqueDoProdutoCartao({
  estoque: { produto, unidades },
  voltar,
  aoVoltar,
}: {
  estoque: EstoqueDoProduto
  voltar: Visao | null
  aoVoltar: (anterior: Visao) => void
}) {
  return (
    <section className="cartao resultado-produto" aria-labelledby="titulo-produto-consulta">
      {voltar && (
        <button type="button" className="botao-link voltar-consulta" onClick={() => aoVoltar(voltar)}>
          {voltar.tipo === 'UNIDADE' ? 'Voltar à unidade' : 'Voltar à lista'}
        </button>
      )}
      <h3 id="titulo-produto-consulta">{produto.nome}</h3>
      {!produto.ativo && (
        <p className="subtitulo">
          Produto inativo no catálogo: não recebe unidades novas, mas as que estão em estoque ainda
          podem ser vendidas.
        </p>
      )}

      <dl className="dados-unidade">
        <dt>Marca</dt>
        <dd>{produto.marca}</dd>
        <dt>Categoria</dt>
        <dd>{produto.categoria}</dd>
        <dt>Código interno</dt>
        <dd className="codigo">{produto.codigoInterno}</dd>
      </dl>

      <h4 className="titulo-unidades-consulta">
        {unidades.length === 0
          ? 'Nenhuma unidade em estoque'
          : `${plural(unidades.length, 'unidade', 'unidades')} em estoque`}
      </h4>
      {unidades.length > 0 && (
        <>
          <ul className="unidades-consulta">
            {unidades.map((unidade) => (
              <li key={unidade.id}>
                <span className="codigo">{unidade.codigoQr}</span>
                <span className="validade-unidade-consulta">
                  Validade {formatarData(unidade.dataValidade)}
                </span>
                <span className={`distintivo faixa-${unidade.faixa.toLowerCase()}`}>
                  {textoDaValidade(unidade)}
                </span>
              </li>
            ))}
          </ul>
          <p className="legenda-consulta">
            Em ordem de validade. Qual frasco sai primeiro, a tela de Venda confere na leitura.
          </p>
        </>
      )}
    </section>
  )
}
