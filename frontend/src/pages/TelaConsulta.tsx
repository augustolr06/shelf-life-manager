import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LeitorCamera } from '../components/LeitorCamera'
import { PortaoOffline } from '../components/PortaoOffline'
import { useConexao } from '../hooks/useConexao'
import { ErroApi } from '../services/api'
import { formatarData, formatarInstante } from '../services/datas'
import { consultarUnidade, type ConsultaUnidade } from '../services/unidades'

/**
 * Consultar produto (T32): o que é este frasco, sem vender. Para a atendente
 * que quer conferir a validade e responder a um cliente — na tela de Venda,
 * ler põe no carrinho.
 *
 * Mostra dados, não ordem. Se a unidade é a próxima a sair é veredito FIFO, e
 * a RNF03 o prende a `validarSaidaFifo`; a consulta não passa por ela. Também
 * não compara datas: `situacao` e `diasParaVencer` vêm prontos do servidor
 * (RNF01, RNF04).
 *
 * A câmera fica ligada esperando o próximo frasco (modo `'continua'` de T31):
 * aqui nada é gravado, e ler o seguinte sem tocar na tela é o que se quer.
 */

const ROTULO_DO_STATUS: Record<ConsultaUnidade['unidade']['status'], string> = {
  EM_ESTOQUE: 'Em estoque',
  VENDIDA: 'Vendida',
  DESCARTADA: 'Descartada',
}

export function TelaConsulta() {
  const { conexao, verificar } = useConexao()

  const [codigoDigitado, setCodigoDigitado] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [consulta, setConsulta] = useState<ConsultaUnidade | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [cameraLigada, setCameraLigada] = useState(false)
  const [avisoCamera, setAvisoCamera] = useState<string | null>(null)

  // A câmera contínua entrega o mesmo frasco dez vezes por segundo. Uma
  // consulta por vez, e o código que já está na tela (ou a caminho dela) não
  // é consultado de novo — inclusive o que voltou "não encontrado", que senão
  // viraria uma rajada de 404.
  const emVoo = useRef(false)
  const ultimoCodigo = useRef<string | null>(null)

  // O resultado é do estoque de um instante: depois de uma queda, a unidade
  // pode ter sido vendida por outra pessoa. Mesmo motivo da tela de Venda.
  useEffect(() => {
    if (conexao === 'offline') {
      setConsulta(null)
      setErro(null)
      ultimoCodigo.current = null
    }
  }, [conexao])

  async function consultar(texto: string) {
    const codigoQr = texto.trim()
    if (codigoQr === '' || emVoo.current) return

    emVoo.current = true
    ultimoCodigo.current = codigoQr
    setConsultando(true)

    try {
      // O código vai como foi lido ou digitado: quem normaliza é o backend
      // (T08), dono único do formato.
      const resposta = await consultarUnidade(codigoQr)
      setConsulta(resposta)
      setErro(null)
      setCodigoDigitado('')
    } catch (falha) {
      // Um código diferente substitui o resultado anterior, inclusive quando
      // não acha nada: deixar o frasco anterior na tela faria parecer que é
      // dele que se está falando.
      setConsulta(null)
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível consultar este código.')
      // Rede caída leva ao portão de offline, como na Venda (RNF07).
      if (falha instanceof ErroApi && falha.status === 0) void verificar()
    } finally {
      emVoo.current = false
      setConsultando(false)
    }
  }

  function lerPelaCamera(texto: string) {
    if (texto.trim() === ultimoCodigo.current) return
    void consultar(texto)
  }

  function lerDigitado(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    // Digitar é ato deliberado: consulta de novo mesmo o código que está na
    // tela, para quem quer o dado atualizado.
    void consultar(codigoDigitado)
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
      <h2>Consultar produto</h2>
      <p className="subtitulo">
        Leia o código de um frasco para ver o produto e a validade dele.{' '}
        <strong>Consultar não dá baixa:</strong> nada sai do estoque e nada é registrado. Para
        vender, use a tela de Venda.
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
                <LeitorCamera modo="continua" aoLer={lerPelaCamera} aoFalhar={falhaDaCamera} />
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
              <label htmlFor="codigo-consulta">Ou digite o código impresso na etiqueta</label>
              <input
                id="codigo-consulta"
                name="codigo-consulta"
                autoComplete="off"
                value={codigoDigitado}
                onChange={(evento) => setCodigoDigitado(evento.target.value)}
                placeholder="PRF-XXXXXX"
              />
            </div>
            <button
              type="submit"
              aria-busy={consultando}
              disabled={consultando || codigoDigitado.trim() === ''}
            >
              {consultando ? 'Consultando…' : 'Consultar'}
            </button>
          </form>

          <div className="area-resultado" aria-live="polite">
            {erro && (
              <p className="erro" role="alert">
                {erro}
              </p>
            )}
            {consulta && <ResultadoDaConsulta consulta={consulta} />}
          </div>
        </>
      )}
    </section>
  )
}

/**
 * O cartão do frasco. Tudo o que diz se a unidade venceu vem de `situacao`;
 * `diasParaVencer` só dá o número, como na lista de alertas (T19).
 */
function ResultadoDaConsulta({ consulta }: { consulta: ConsultaUnidade }) {
  const { unidade, situacao, diasParaVencer } = consulta
  const vencida = situacao === 'VENCIDA'
  const dias = Math.abs(diasParaVencer)
  const textoDosDias = `${dias} dia${dias === 1 ? '' : 's'}`

  return (
    // A cor de perigo que já existe para unidade vencida; o destaque
    // definitivo de estado é de T38.
    <section className={vencida ? 'cartao resultado resultado-vencido' : 'cartao resultado'}>
      <h3>{unidade.produto.nome}</h3>

      {vencida && (
        <p className="erro">
          <strong>Vencida</strong> há {textoDosDias}.
        </p>
      )}
      {!unidade.produto.ativo && (
        <p className="subtitulo">Produto inativo no catálogo.</p>
      )}

      <dl className="dados-unidade">
        <dt>Marca</dt>
        <dd>{unidade.produto.marca}</dd>
        <dt>Categoria</dt>
        <dd>{unidade.produto.categoria}</dd>
        <dt>Código interno</dt>
        <dd>{unidade.produto.codigoInterno}</dd>
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
        <dd>{unidade.codigoQr}</dd>
      </dl>
    </section>
  )
}
