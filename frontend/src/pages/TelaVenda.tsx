import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useConfirmacao } from '../components/DialogoConfirmacao'
import { LeitorCamera } from '../components/LeitorCamera'
import { PainelExcecaoVencido } from '../components/PainelExcecaoVencido'
import { PortaoOffline } from '../components/PortaoOffline'
import { useConexao } from '../hooks/useConexao'
import { ErroApi } from '../services/api'
import type { Usuario } from '../services/auth'
import { formatarData } from '../services/datas'
import type { Resolucao } from '../services/excecaoVencido'
import {
  criarSessaoVenda,
  finalizarVenda,
  lerCodigoQr,
  MAXIMO_ITENS_DO_CARRINHO,
  type ItemFinalizado,
  type RespostaLeitura,
  type UnidadeLida,
} from '../services/saidas'

/**
 * Venda no balcão (RF05, RF06, RF07), com carrinho desde T34. É a tela onde o
 * sistema encosta no problema que o TCC ataca: a atendente pega um frasco, e o
 * sistema diz se é aquele que sai primeiro.
 *
 * Ler **não vende** (T33b). A leitura valida e, se o servidor libera, a
 * unidade entra no carrinho; a venda só acontece em "Confirmar venda", quando o
 * servidor revalida cada item sob lock. Antes, a câmera aberta vendia o que
 * lesse, e um segundo QR lido sem querer não tinha volta.
 *
 * Ela não decide nada. Escolhe *layout* pelo campo `veredito` da resposta e
 * exibe `mensagem` como o servidor escreveu (RNF03, RNF04). Não há aqui
 * comparação de validade, de status nem de ordem entre unidades — se um dia
 * aparecer, é sinal de que a regra vazou do servidor. O carrinho só compara
 * identidade (o mesmo código, o mesmo id), para não ter o mesmo frasco duas
 * vezes.
 */

/**
 * Uma unidade liberada pela leitura. `pendencia` é o veredito que a
 * confirmação devolveu quando a unidade **não** saiu: o estoque mudou entre a
 * leitura e a confirmação, e o item fica no carrinho com o motivo.
 */
type ItemCarrinho = {
  unidade: UnidadeLida
  pendencia: RespostaLeitura | null
}

/** O desfecho da última confirmação, até a próxima leitura. */
type DesfechoVenda = {
  vendidas: ItemFinalizado[]
  restantes: number
}

export function TelaVenda({ usuario }: { usuario: Usuario }) {
  const { conexao, verificar } = useConexao()
  const confirmar = useConfirmacao()

  // Um atendimento é um cliente no balcão, com um ou vários itens. Ele termina
  // quando o carrinho esvazia pela confirmação, ou por "Encerrar atendimento"
  // com o carrinho vazio.
  const [sessaoVendaId, setSessaoVendaId] = useState(criarSessaoVenda)

  // Vive só na memória da tela (T34, Decisão 1): recarregar a página o perde,
  // e nada fica pendente no servidor, porque o carrinho não existe lá (T33b).
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([])
  const [confirmandoVenda, setConfirmandoVenda] = useState(false)
  const [desfecho, setDesfecho] = useState<DesfechoVenda | null>(null)

  const [codigoDigitado, setCodigoDigitado] = useState('')
  const [lendo, setLendo] = useState(false)
  const [resultado, setResultado] = useState<RespostaLeitura | null>(null)
  // Descarte e override tiram a unidade do estoque: não há mais veredito a
  // exibir, e sim o desfecho. Nunca coexiste com `resultado`.
  const [resolucao, setResolucao] = useState<Resolucao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // O que a própria tela tem a dizer sobre o carrinho (item repetido, limite).
  // Não é veredito, e por isso não ocupa o lugar de `resultado`.
  const [aviso, setAviso] = useState<string | null>(null)
  const [cameraLigada, setCameraLigada] = useState(false)
  const [avisoCamera, setAvisoCamera] = useState<string | null>(null)

  // Enquanto uma leitura está no ar, outra não parte. A câmera decodifica em
  // rajada — dez quadros por segundo do mesmo frasco —, e cada disparo viraria
  // um `LEITURA_QR_SAIDA` no log, inflando o denominador da taxa de acerto na
  // primeira leitura (RF12).
  // A câmera lê um código e para (T31), então essa proteção não deveria
  // disparar. Ela fica como defesa em profundidade, para o caso de o leitor
  // falhar em parar.
  const emVoo = useRef(false)
  const codigoJaProcessado = useRef<string | null>(null)

  // Se a câmera estava ligada quando a última leitura partiu. "Ler próximo"
  // religa a câmera só nesse caso: quem digitou o código talvez nem tenha
  // câmera.
  const religarCamera = useRef(false)
  const campoCodigo = useRef<HTMLInputElement>(null)

  // Um veredito vale para o estoque de um instante só: enquanto a conexão
  // esteve fora, outra atendente pode ter vendido a unidade que esta tela
  // ainda está apontando. Reexibi-lo ao reconectar seria mostrar como atual um
  // dado que ninguém revalidou.
  // O carrinho fica (T34, Decisão 2): ele não afirma nada sobre o estoque de
  // agora, porque a confirmação revalida cada item antes de baixar.
  useEffect(() => {
    if (conexao === 'offline') {
      setResultado(null)
      setResolucao(null)
      setErro(null)
      setAviso(null)
      setDesfecho(null)
      codigoJaProcessado.current = null
    }
  }, [conexao])

  const idsNoCarrinho = carrinho.map((item) => item.unidade.id)

  /** Entra no carrinho, ou, se já estava, deixa de ter pendência. */
  function colocarNoCarrinho(unidade: UnidadeLida) {
    setCarrinho((atual) =>
      atual.some((item) => item.unidade.id === unidade.id)
        ? atual.map((item) =>
            item.unidade.id === unidade.id ? { unidade, pendencia: null } : item,
          )
        : [...atual, { unidade, pendencia: null }],
    )
  }

  function tirarDoCarrinho(unidadeId: string) {
    setCarrinho((atual) => atual.filter((item) => item.unidade.id !== unidadeId))
  }

  function marcarPendencia(unidadeId: string, pendencia: RespostaLeitura) {
    setCarrinho((atual) =>
      atual.map((item) => (item.unidade.id === unidadeId ? { ...item, pendencia } : item)),
    )
  }

  async function enviarLeitura(texto: string) {
    const codigoQr = texto.trim()
    // Durante a confirmação, o carrinho que foi ao servidor é o que a tela
    // vai conciliar com a resposta: um item lido nesse meio tempo sumiria.
    if (codigoQr === '' || emVoo.current || confirmandoVenda) return

    setErro(null)
    setResolucao(null)
    setResultado(null)
    setAviso(null)
    setDesfecho(null)

    // O mesmo frasco não entra duas vezes, e a tela sabe disso sem perguntar:
    // é identidade, não veredito. A comparação é do texto como veio — quem
    // normaliza o código é o servidor —, e a variação de digitação que passar
    // por aqui é pega pelo id na volta.
    if (carrinho.some((item) => item.unidade.codigoQr === codigoQr)) {
      setAviso(`A unidade ${codigoQr} já está no carrinho.`)
      setCodigoDigitado('')
      return
    }
    if (carrinho.length >= MAXIMO_ITENS_DO_CARRINHO) {
      setAviso(
        `O carrinho chegou a ${MAXIMO_ITENS_DO_CARRINHO} unidades. Confirme a venda antes de ler mais.`,
      )
      return
    }

    emVoo.current = true
    codigoJaProcessado.current = codigoQr
    setLendo(true)

    try {
      // O código vai como foi lido ou digitado. Quem normaliza é o backend
      // (T08), dono único do formato.
      const resposta = await lerCodigoQr(codigoQr, sessaoVendaId, idsNoCarrinho)
      setCodigoDigitado('')

      if (
        resposta.veredito === 'CONFIRMAR' &&
        carrinho.some((item) => item.unidade.id === resposta.unidade.id)
      ) {
        setAviso(`A unidade ${resposta.unidade.codigoQr} já está no carrinho.`)
        return
      }

      setResultado(resposta)
      if (resposta.veredito === 'CONFIRMAR') colocarNoCarrinho(resposta.unidade)
    } catch (falha) {
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
    // Uma câmera ligada leria o próximo frasco que passasse na frente dela
    // enquanto a atendente ainda olha o resultado digitado.
    religarCamera.current = cameraLigada
    setCameraLigada(false)
    void enviarLeitura(codigoDigitado)
  }

  function lerPelaCamera(texto: string) {
    // O leitor já parou sozinho ao emitir o código (modo `'unica'`); a tela só
    // tira o vídeo de cena e põe o resultado no lugar.
    religarCamera.current = true
    setCameraLigada(false)
    // Mesmo frasco, veredito já na tela: é rajada de um leitor que não parou,
    // não uma leitura nova.
    if (codigoJaProcessado.current === texto.trim() && resultado !== null) return
    void enviarLeitura(texto)
  }

  function ligarCamera() {
    // Ligar a câmera é ato deliberado, como digitar: o mesmo frasco pode ser
    // lido de novo.
    codigoJaProcessado.current = null
    setAvisoCamera(null)
    setCameraLigada(true)
  }

  function limparResultado() {
    setResultado(null)
    setResolucao(null)
    setErro(null)
    setAviso(null)
    setDesfecho(null)
    codigoJaProcessado.current = null
  }

  function lerProximo() {
    limparResultado()
    if (religarCamera.current) {
      ligarCamera()
    } else {
      campoCodigo.current?.focus()
    }
  }

  /** Frasco errado ou cliente desistiu dele: basta ler de novo para voltar. */
  function remover(unidadeId: string) {
    tirarDoCarrinho(unidadeId)
    // O cartão da leitura falava de uma unidade que agora não está mais no
    // carrinho, e o botão de remover dele não teria mais o que fazer.
    if (resultado?.veredito === 'CONFIRMAR' && resultado.unidade.id === unidadeId) {
      setResultado(null)
    }
  }

  async function esvaziar() {
    const quantas = carrinho.length
    const confirmado = await confirmar({
      titulo: 'Esvaziar carrinho?',
      consequencia: `${quantas === 1 ? 'A unidade sai' : `As ${quantas} unidades saem`} do carrinho e ${quantas === 1 ? 'continua' : 'continuam'} no estoque. Nada é vendido.`,
      rotuloConfirmar: 'Esvaziar',
    })
    if (!confirmado) return
    setCarrinho([])
    limparResultado()
  }

  async function confirmarVenda() {
    if (carrinho.length === 0 || confirmandoVenda) return

    const enviados = carrinho.map((item) => item.unidade)
    const lista = enviados
      .map((unidade) => `${unidade.codigoQr} (${unidade.produto.nome})`)
      .join(', ')
    // A lista inteira no diálogo: é a última chance de perceber o frasco que
    // não devia estar ali, e a venda não tem estorno.
    const confirmado = await confirmar({
      titulo: 'Confirmar venda?',
      consequencia:
        enviados.length === 1
          ? `1 unidade será vendida: ${lista}. O sistema confere a ordem de saída de novo antes de baixar. A venda não pode ser desfeita.`
          : `${enviados.length} unidades serão vendidas: ${lista}. O sistema confere a ordem de saída de cada uma de novo antes de baixar. A venda não pode ser desfeita.`,
      rotuloConfirmar: 'Confirmar venda',
    })
    if (!confirmado) return

    setConfirmandoVenda(true)
    setCameraLigada(false)
    limparResultado()

    try {
      const itens = await finalizarVenda(
        enviados.map((unidade) => unidade.id),
        sessaoVendaId,
      )

      // O veredito de cada item é o do servidor: `CONFIRMAR` saiu do estoque, e
      // qualquer outro fica no carrinho com o motivo. Nenhum item é julgado
      // aqui.
      const vendidas = itens.filter((item) => item.veredito === 'CONFIRMAR')
      const barrados = new Map(
        itens.filter((item) => item.veredito !== 'CONFIRMAR').map((item) => [item.unidadeId, item]),
      )
      const idsVendidos = new Set(vendidas.map((item) => item.unidadeId))
      const restantes = carrinho
        .filter((item) => !idsVendidos.has(item.unidade.id))
        .map((item) => ({ ...item, pendencia: barrados.get(item.unidade.id) ?? item.pendencia }))

      setCarrinho(restantes)
      setDesfecho({ vendidas, restantes: restantes.length })

      // O cliente levou tudo: o próximo item é de outro atendimento.
      if (restantes.length === 0) setSessaoVendaId(criarSessaoVenda())

      // A unidade que venceu entre a leitura e a confirmação precisa de um dos
      // três caminhos (PRD 6.1), e o painel deles é a área de resultado.
      const vencida = itens.find((item) => item.veredito === 'EXCECAO_VENCIDO')
      if (vencida) setResultado(vencida)
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível confirmar a venda.')
      if (falha instanceof ErroApi && falha.status === 0) void verificar()
    } finally {
      setConfirmandoVenda(false)
    }
  }

  /**
   * Os três caminhos da unidade vencida (PRD 6.1), montados aqui porque é esta
   * tela que sabe o que é um veredito, o que fazer com o veredito **novo** que
   * a correção devolve, e o que cada desfecho faz com o carrinho.
   */
  function painelDaExcecao(unidade: UnidadeLida): ReactNode {
    return (
      <PainelExcecaoVencido
        unidade={unidade}
        papel={usuario.papel}
        sessaoVendaId={sessaoVendaId}
        noCarrinho={idsNoCarrinho}
        // A correção revalidou o FIFO no servidor: o que volta é um veredito
        // comum, e os quatro layouts abaixo já sabem exibi-lo. `CONFIRMAR` põe
        // a unidade no carrinho, como numa leitura (T33b).
        aoRevalidar={(revalidacao) => {
          setResultado(revalidacao)
          setErro(null)
          codigoJaProcessado.current = null
          if (revalidacao.veredito === 'CONFIRMAR') {
            colocarNoCarrinho(revalidacao.unidade)
          } else {
            // Unidade que já estava no carrinho (venceu entre a leitura e a
            // confirmação) continua lá com o motivo novo.
            marcarPendencia(unidade.id, revalidacao)
          }
        }}
        // Descarte e override são terminais: a unidade saiu do estoque, e não
        // pode continuar no carrinho.
        aoResolver={(resolvida) => {
          tirarDoCarrinho(resolvida.unidade.id)
          setResultado(null)
          setResolucao(resolvida)
          codigoJaProcessado.current = null
        }}
        // Outra pessoa resolveu esta unidade enquanto o frasco estava na mão: o
        // veredito em tela não vale mais, pelo mesmo motivo que ele não
        // sobrevive à queda de conexão, e a unidade não está mais à venda.
        aoPerderUnidade={(mensagem) => {
          tirarDoCarrinho(unidade.id)
          setResultado(null)
          setResolucao(null)
          setErro(mensagem)
          codigoJaProcessado.current = null
        }}
        aoCairConexao={verificar}
      />
    )
  }

  function botaoRemover(unidade: UnidadeLida): ReactNode {
    if (!idsNoCarrinho.includes(unidade.id)) return null
    return (
      <button type="button" className="secundario" onClick={() => remover(unidade.id)}>
        Remover do carrinho
      </button>
    )
  }

  function encerrarAtendimento() {
    setSessaoVendaId(criarSessaoVenda())
    limparResultado()
    setCodigoDigitado('')
  }

  function falhaDaCamera(mensagem: string) {
    setCameraLigada(false)
    setAvisoCamera(mensagem)
  }

  const online = conexao === 'online'
  const ocupada = lendo || confirmandoVenda

  return (
    <section className="tela-leitura">
      <h2>Venda</h2>
      <p className="subtitulo">
        Leia o código de cada frasco. O sistema confere se é a unidade que sai primeiro e, se for,
        coloca no carrinho. Nada sai do estoque até você confirmar a venda.
      </p>

      {!online ? (
        // Não existe leitura nem venda offline: o veredito depende do estoque
        // inteiro do produto naquele instante, e isso mora no servidor.
        // Enfileirar a leitura para enviar depois só teria valor se alguém
        // desse o veredito na hora — e ninguém no navegador pode dar.
        <PortaoOffline estado={conexao} aoTentarDeNovo={verificar}>
          Ler e confirmar a venda não funcionam offline: o sistema precisa consultar o estoque para
          saber qual frasco sai primeiro. O carrinho continua aqui até a conexão voltar.
        </PortaoOffline>
      ) : (
        <>
          <div className="atendimento">
            <p>
              {sessaoVendaId ? (
                <>
                  Atendimento em andamento. Ele termina quando a venda do carrinho é confirmada, e
                  as saídas dele ficam agrupadas no relatório.
                </>
              ) : (
                <>
                  Sem agrupamento de atendimento neste navegador (exige HTTPS ou localhost). A
                  venda funciona normalmente; só o relatório por atendimento fica sem dado.
                </>
              )}
            </p>
            {/* Com itens no carrinho, o atendimento termina pela confirmação
                ou pelo esvaziamento: encerrar aqui deixaria o carrinho de um
                cliente no atendimento do próximo. */}
            {carrinho.length === 0 && (
              <button type="button" className="secundario" onClick={encerrarAtendimento}>
                Encerrar atendimento
              </button>
            )}
          </div>

          <div className="camera">
            {cameraLigada ? (
              <>
                <LeitorCamera modo="unica" aoLer={lerPelaCamera} aoFalhar={falhaDaCamera} />
                <button type="button" className="secundario" onClick={() => setCameraLigada(false)}>
                  Desligar câmera
                </button>
              </>
            ) : (
              <button type="button" onClick={ligarCamera} disabled={confirmandoVenda}>
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
                ref={campoCodigo}
                id="codigo-qr"
                name="codigo-qr"
                autoComplete="off"
                value={codigoDigitado}
                onChange={(evento) => setCodigoDigitado(evento.target.value)}
                placeholder="PRF-XXXXXX"
              />
            </div>
            <button type="submit" disabled={ocupada || codigoDigitado.trim() === ''}>
              {lendo ? 'Lendo…' : 'Ler código'}
            </button>
          </form>

          <div className="area-resultado" aria-live="polite">
            {erro && (
              <p className="erro" role="alert">
                {erro}
              </p>
            )}

            {aviso && (
              <p className="aviso-carrinho" role="status">
                {aviso}
              </p>
            )}

            {desfecho && <DesfechoDaVenda desfecho={desfecho} />}

            {resultado && (
              <Resultado
                resposta={resultado}
                painelDaExcecao={painelDaExcecao}
                botaoRemover={botaoRemover}
              />
            )}

            {resolucao && <ResolucaoDaExcecao resolucao={resolucao} />}

            {/* Também depois de um erro: a câmera desligou na leitura que
                falhou, e este é o caminho de volta para ela. */}
            {(resultado || resolucao || erro || aviso || desfecho) && (
              <button type="button" className="secundario" onClick={lerProximo}>
                Ler próximo
              </button>
            )}
          </div>
        </>
      )}

      {/* Fora do portão de offline: a queda de conexão não apaga o carrinho,
          só impede confirmar até ela voltar (T34, Decisão 2). */}
      {(online || carrinho.length > 0) && (
        <Carrinho
          itens={carrinho}
          podeConfirmar={online && !ocupada}
          confirmando={confirmandoVenda}
          aoRemover={remover}
          aoVerOpcoes={(pendencia) => {
            limparResultado()
            setResultado(pendencia)
          }}
          aoConfirmar={() => void confirmarVenda()}
          aoEsvaziar={() => void esvaziar()}
        />
      )}
    </section>
  )
}

/**
 * O carrinho do atendimento. Lista o que o servidor liberou, na ordem em que
 * foi lido — a ordem de baixa é decidida no servidor, na confirmação (T33b).
 */
function Carrinho({
  itens,
  podeConfirmar,
  confirmando,
  aoRemover,
  aoVerOpcoes,
  aoConfirmar,
  aoEsvaziar,
}: {
  itens: ItemCarrinho[]
  podeConfirmar: boolean
  confirmando: boolean
  aoRemover: (unidadeId: string) => void
  aoVerOpcoes: (pendencia: RespostaLeitura) => void
  aoConfirmar: () => void
  aoEsvaziar: () => void
}) {
  return (
    <section className="carrinho" aria-labelledby="titulo-carrinho">
      <h3 id="titulo-carrinho">
        Carrinho {itens.length > 0 && <span className="contagem">({itens.length})</span>}
      </h3>

      {itens.length === 0 ? (
        <p className="subtitulo">Vazio. Cada frasco liberado na leitura entra aqui.</p>
      ) : (
        <>
          <ul className="itens-carrinho">
            {itens.map(({ unidade, pendencia }) => (
              <li
                key={unidade.id}
                className={pendencia ? 'item-carrinho item-com-pendencia' : 'item-carrinho'}
              >
                <DadosDaUnidade unidade={unidade} />
                {pendencia && <PendenciaDoItem pendencia={pendencia} aoVerOpcoes={aoVerOpcoes} />}
                <button
                  type="button"
                  className="secundario"
                  disabled={confirmando}
                  onClick={() => aoRemover(unidade.id)}
                  aria-label={`Remover ${unidade.codigoQr} do carrinho`}
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>

          <div className="acoes-carrinho">
            <button type="button" disabled={!podeConfirmar} onClick={aoConfirmar}>
              {confirmando ? 'Confirmando…' : 'Confirmar venda'}
            </button>
            <button
              type="button"
              className="secundario"
              disabled={confirmando}
              onClick={aoEsvaziar}
            >
              Esvaziar carrinho
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Por que o item não saiu na confirmação. Mesma regra dos vereditos: o rótulo
 * vem do campo `veredito`, e a explicação é a `mensagem` do servidor.
 */
function PendenciaDoItem({
  pendencia,
  aoVerOpcoes,
}: {
  pendencia: RespostaLeitura
  aoVerOpcoes: (pendencia: RespostaLeitura) => void
}) {
  return (
    <div className="pendencia" role="note">
      <p>
        <strong>Não vendida.</strong> {pendencia.mensagem}
      </p>
      {pendencia.veredito === 'BLOQUEAR_FIFO' && (
        <p>
          Saia com esta: <strong>{pendencia.unidadeCorreta.codigoQr}</strong>
        </p>
      )}
      {pendencia.veredito === 'EXCECAO_VENCIDO' && (
        <button type="button" className="secundario" onClick={() => aoVerOpcoes(pendencia)}>
          Ver o que fazer com esta unidade
        </button>
      )}
    </div>
  )
}

/**
 * O resultado da confirmação, item a item. A contagem só escolhe o título; o
 * que cada unidade virou está na mensagem do servidor.
 */
function DesfechoDaVenda({ desfecho }: { desfecho: DesfechoVenda }) {
  const { vendidas, restantes } = desfecho
  const titulo =
    vendidas.length === 0
      ? 'Nenhuma unidade vendida'
      : restantes === 0
        ? 'Venda registrada'
        : 'Venda registrada em parte'

  return (
    <section className={vendidas.length > 0 ? 'resultado resultado-confirmar' : 'resultado resultado-bloqueio'}>
      <h3>{titulo}</h3>
      {vendidas.length > 0 && (
        <ul className="vendidas">
          {vendidas.map((item) => (
            <li key={item.unidadeId}>{item.mensagem}</li>
          ))}
        </ul>
      )}
      {restantes > 0 && (
        <p>
          {restantes === 1
            ? '1 unidade continua no carrinho'
            : `${restantes} unidades continuam no carrinho`}
          : o estoque mudou desde a leitura. O motivo está em cada item.
        </p>
      )}
    </section>
  )
}

/**
 * Os quatro layouts. O título é rótulo de layout; o texto que explica o que
 * aconteceu é sempre `resposta.mensagem`, escrita no servidor (RNF04).
 */
function Resultado({
  resposta,
  painelDaExcecao,
  botaoRemover,
}: {
  resposta: RespostaLeitura
  painelDaExcecao: (unidade: UnidadeLida) => ReactNode
  botaoRemover: (unidade: UnidadeLida) => ReactNode
}) {
  switch (resposta.veredito) {
    case 'CONFIRMAR':
      return (
        <section className="resultado resultado-confirmar">
          <h3>No carrinho</h3>
          <p>{resposta.mensagem}</p>
          <DadosDaUnidade unidade={resposta.unidade} />
          {/* Ali mesmo, para o frasco errado que acabou de ser lido. */}
          {botaoRemover(resposta.unidade)}
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
          {/* A tela não escolhe o destino do frasco: ela oferece os três
              caminhos do PRD 6.1, e a escolha é da pessoa no balcão. */}
          {painelDaExcecao(resposta.unidade)}
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

/**
 * O desfecho dos dois caminhos terminais da exceção (PRD 6.1). Como nos
 * vereditos, o título é rótulo de layout — escolhido pelo campo `resultado` — e
 * o texto que explica o que aconteceu é o do servidor.
 *
 * Não há botão de desfazer: nem o descarte nem a venda autorizada têm estorno
 * no sistema, e isso está registrado como limitação em
 * `docs/notas-para-artigo.md`.
 */
function ResolucaoDaExcecao({ resolucao }: { resolucao: Resolucao }) {
  const descarte = resolucao.resultado === 'DESCARTE_REGISTRADO'

  return (
    <section className={descarte ? 'resultado resultado-descarte' : 'resultado resultado-override'}>
      <h3>{descarte ? 'Descarte registrado' : 'Venda autorizada'}</h3>
      <p>{resolucao.mensagem}</p>
      {/* O override vende na hora (T33b, Decisão 3): sem esta frase, quem tem
          outros itens no carrinho pode achar que ele espera a confirmação. */}
      {!descarte && <p>Esta venda já foi registrada e não faz parte do carrinho.</p>}
      <DadosDaUnidade unidade={resolucao.unidade} />
    </section>
  )
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
