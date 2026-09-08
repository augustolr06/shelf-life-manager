import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { LeitorCamera } from '../components/LeitorCamera'
import { ErroApi } from '../services/api'
import { formatarData } from '../services/datas'
import {
  criarSessaoVenda,
  lerCodigoQr,
  type RespostaLeitura,
  type UnidadeLida,
} from '../services/saidas'
import { verificarBackend } from '../services/saude'

/**
 * Leitura de QR no balcão (RF05, RF06, RF07). É a tela onde o sistema encosta
 * no problema que o TCC ataca: a atendente pega um frasco, e o sistema diz se
 * é aquele que sai primeiro.
 *
 * Ela não decide nada. Escolhe *layout* pelo campo `veredito` da resposta e
 * exibe `mensagem` como o servidor escreveu (RNF03, RNF04). Não há aqui
 * comparação de validade, de status nem de ordem entre unidades — se um dia
 * aparecer, é sinal de que a regra vazou do servidor.
 */

type EstadoConexao = 'verificando' | 'online' | 'offline'

export function TelaLeituraQr() {
  const { conexao, verificar } = useConexao()

  // Um atendimento é um cliente no balcão, com um ou vários itens. O
  // agrupador só muda por ação explícita: trocá-lo a cada confirmação
  // separaria em atendimentos diferentes as duas peças que saíram juntas.
  const [sessaoVendaId, setSessaoVendaId] = useState(criarSessaoVenda)

  const [codigoDigitado, setCodigoDigitado] = useState('')
  const [lendo, setLendo] = useState(false)
  const [resultado, setResultado] = useState<RespostaLeitura | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [cameraLigada, setCameraLigada] = useState(false)
  const [avisoCamera, setAvisoCamera] = useState<string | null>(null)

  // Enquanto uma leitura está no ar, outra não parte. A câmera decodifica em
  // rajada — dez quadros por segundo do mesmo frasco —, e cada disparo viraria
  // um `LEITURA_QR_SAIDA` no log, inflando o denominador da taxa de acerto na
  // primeira leitura (RF12).
  const emVoo = useRef(false)
  const codigoJaProcessado = useRef<string | null>(null)

  // Um veredito vale para o estoque de um instante só: enquanto a conexão
  // esteve fora, outra atendente pode ter vendido a unidade que esta tela
  // ainda está apontando. Reexibi-lo ao reconectar seria mostrar como atual um
  // dado que ninguém revalidou.
  useEffect(() => {
    if (conexao === 'offline') {
      setResultado(null)
      setErro(null)
      codigoJaProcessado.current = null
    }
  }, [conexao])

  async function enviarLeitura(texto: string) {
    const codigoQr = texto.trim()
    if (codigoQr === '' || emVoo.current) return

    emVoo.current = true
    codigoJaProcessado.current = codigoQr
    setLendo(true)
    setErro(null)

    try {
      // O código vai como foi lido ou digitado. Quem normaliza é o backend
      // (T08), dono único do formato.
      const resposta = await lerCodigoQr(codigoQr, sessaoVendaId)
      setResultado(resposta)
      setCodigoDigitado('')
    } catch (falha) {
      setResultado(null)
      setErro(
        falha instanceof ErroApi ? falha.message : 'Não foi possível registrar esta leitura.',
      )
      // Rede caída no meio do atendimento leva ao mesmo portão de offline, em
      // vez de virar um erro genérico que não diz o que fazer (RNF07).
      if (falha instanceof ErroApi && falha.status === 0) void verificar()
    } finally {
      emVoo.current = false
      setLendo(false)
    }
  }

  function lerDigitado(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    // Digitação é ato deliberado: relê o mesmo código se a atendente insistir.
    codigoJaProcessado.current = null
    void enviarLeitura(codigoDigitado)
  }

  function lerPelaCamera(texto: string) {
    // Mesmo frasco ainda em quadro, veredito já na tela: é a rajada, não uma
    // leitura nova. Um código diferente passa na hora — é o que faz o laço do
    // RF06 funcionar sem a atendente tocar na tela entre um frasco e outro.
    if (codigoJaProcessado.current === texto.trim() && resultado !== null) return
    void enviarLeitura(texto)
  }

  function lerOutraUnidade() {
    setResultado(null)
    setErro(null)
    codigoJaProcessado.current = null
  }

  function encerrarAtendimento() {
    setSessaoVendaId(criarSessaoVenda())
    lerOutraUnidade()
    setCodigoDigitado('')
  }

  function falhaDaCamera(mensagem: string) {
    setCameraLigada(false)
    setAvisoCamera(mensagem)
  }

  return (
    <section className="tela-leitura">
      <h2>Leitura de QR</h2>
      <p className="subtitulo">
        Leia o código do frasco. O sistema responde se é esta a unidade que sai primeiro — quem
        decide é o servidor, com o estoque inteiro do produto à vista.
      </p>

      {conexao !== 'online' ? (
        <PortaoOffline estado={conexao} aoTentarDeNovo={verificar} />
      ) : (
        <>
          <div className="atendimento">
            <p>
              {sessaoVendaId ? (
                <>
                  Atendimento em andamento. As saídas desta sequência ficam agrupadas no relatório.
                </>
              ) : (
                <>
                  Sem agrupamento de atendimento neste navegador (exige HTTPS ou localhost). A
                  leitura funciona normalmente; só o relatório por atendimento fica sem dado.
                </>
              )}
            </p>
            <button type="button" className="secundario" onClick={encerrarAtendimento}>
              Encerrar atendimento
            </button>
          </div>

          <div className="camera">
            {cameraLigada ? (
              <>
                <LeitorCamera aoLer={lerPelaCamera} aoFalhar={falhaDaCamera} />
                <button type="button" className="secundario" onClick={() => setCameraLigada(false)}>
                  Desligar câmera
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAvisoCamera(null)
                  setCameraLigada(true)
                }}
              >
                Ligar câmera
              </button>
            )}

            {avisoCamera && (
              <p className="erro" role="alert">
                {avisoCamera}
              </p>
            )}
          </div>

          {/* Sempre visível, não escondido atrás da falha da câmera: é o
              caminho da etiqueta riscada, molhada ou apagada, e essa leitura é
              dado da pesquisa (RF12). */}
          <form className="entrada-manual" onSubmit={lerDigitado}>
            <div className="campo">
              <label htmlFor="codigo-qr">Ou digite o código impresso na etiqueta</label>
              <input
                id="codigo-qr"
                name="codigo-qr"
                autoComplete="off"
                value={codigoDigitado}
                onChange={(evento) => setCodigoDigitado(evento.target.value)}
                placeholder="PRF-XXXXXX"
              />
            </div>
            <button type="submit" disabled={lendo || codigoDigitado.trim() === ''}>
              {lendo ? 'Lendo…' : 'Ler código'}
            </button>
          </form>

          <div className="area-resultado" aria-live="polite">
            {erro && (
              <p className="erro" role="alert">
                {erro}
              </p>
            )}

            {resultado && (
              <>
                <Resultado resposta={resultado} />
                <button type="button" className="secundario" onClick={lerOutraUnidade}>
                  Ler outra unidade
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Os quatro layouts. O título é rótulo de layout; o texto que explica o que
 * aconteceu é sempre `resposta.mensagem`, escrita no servidor (RNF04).
 */
function Resultado({ resposta }: { resposta: RespostaLeitura }) {
  switch (resposta.veredito) {
    case 'CONFIRMAR':
      return (
        <section className="resultado resultado-confirmar">
          <h3>Saída registrada</h3>
          <p>{resposta.mensagem}</p>
          <DadosDaUnidade unidade={resposta.unidade} />
        </section>
      )

    case 'BLOQUEAR_FIFO':
      return (
        <section className="resultado resultado-bloqueio">
          <h3>Não é esta unidade</h3>
          <p>{resposta.mensagem}</p>

          {/* O código da unidade correta é o que a atendente vai procurar na
              prateleira, então é o maior elemento da tela. */}
          <p className="codigo-correto">{resposta.unidadeCorreta.codigoQr}</p>

          <div className="comparacao">
            <div>
              <h4>Na sua mão</h4>
              <DadosDaUnidade unidade={resposta.unidadeLida} />
            </div>
            <div>
              <h4>Saia com esta</h4>
              <DadosDaUnidade unidade={resposta.unidadeCorreta} />
            </div>
          </div>

          <p className="tentativas">
            Tentativa {resposta.tentativas} neste produto. O contador é do servidor.
          </p>
        </section>
      )

    case 'EXCECAO_VENCIDO':
      return (
        <section className="resultado resultado-vencido">
          <h3>Unidade vencida</h3>
          <p>{resposta.mensagem}</p>
          <DadosDaUnidade unidade={resposta.unidade} />
          <p className="subtitulo">
            Separe esta unidade e avise o gestor. Os caminhos de correção, descarte e autorização
            entram em uma etapa seguinte do projeto.
          </p>
        </section>
      )

    case 'ERRO':
      return (
        <section className="resultado resultado-erro">
          <h3>
            {resposta.motivo === 'QR_NAO_ENCONTRADO'
              ? 'Código não encontrado'
              : 'Unidade já baixada'}
          </h3>
          <p>{resposta.mensagem}</p>
          <p className="subtitulo">Código lido: {resposta.codigoQr}</p>
        </section>
      )
  }
}

function DadosDaUnidade({ unidade }: { unidade: UnidadeLida }) {
  return (
    <dl className="dados-unidade">
      <dt>Produto</dt>
      <dd>
        {unidade.produto.nome} ({unidade.produto.marca})
      </dd>
      <dt>Validade</dt>
      <dd>{formatarData(unidade.dataValidade)}</dd>
      <dt>Código</dt>
      <dd>{unidade.codigoQr}</dd>
    </dl>
  )
}

/**
 * Portão de offline (RNF07, `docs/arquitetura.md` seção 6). Não existe leitura
 * offline: o veredito depende do estoque inteiro do produto naquele instante, e
 * isso mora no servidor. Enfileirar a leitura para enviar depois só teria valor
 * se alguém desse o veredito na hora — e ninguém no navegador pode dar.
 */
function PortaoOffline({
  estado,
  aoTentarDeNovo,
}: {
  estado: EstadoConexao
  aoTentarDeNovo: () => void
}) {
  if (estado === 'verificando') {
    return <p role="status">Verificando conexão com o servidor…</p>
  }

  return (
    <div className="bloqueio-offline" role="alert">
      <h3>Sem conexão com o servidor</h3>
      <p>
        A leitura de QR não funciona offline: o sistema precisa consultar o estoque para saber qual
        frasco sai primeiro. Restabeleça a conexão para voltar a dar saída.
      </p>
      <button type="button" onClick={aoTentarDeNovo}>
        Tentar de novo
      </button>
    </div>
  )
}

/**
 * Dois sinais, o barato primeiro: `navigator.onLine` descarta o caso óbvio sem
 * ida à rede, e `/health` confirma que existe caminho até o backend — porque
 * `onLine` só sabe que há uma rede, não que ela chega ao servidor.
 */
function useConexao() {
  const [conexao, setConexao] = useState<EstadoConexao>('verificando')

  const verificar = useCallback(async () => {
    setConexao('verificando')
    if (!navigator.onLine) {
      setConexao('offline')
      return
    }
    setConexao((await verificarBackend()) ? 'online' : 'offline')
  }, [])

  useEffect(() => {
    void verificar()

    // Eventos do navegador, sem varredura periódica: sondar de tempos em
    // tempos gastaria bateria e rede do celular do balcão sem informar mais.
    const aoVoltar = () => void verificar()
    const aoCair = () => setConexao('offline')
    window.addEventListener('online', aoVoltar)
    window.addEventListener('offline', aoCair)

    return () => {
      window.removeEventListener('online', aoVoltar)
      window.removeEventListener('offline', aoCair)
    }
  }, [verificar])

  return { conexao, verificar: () => void verificar() }
}
