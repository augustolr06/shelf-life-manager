import { useState, type FormEvent } from 'react'
import { ErroApi } from '../services/api'
import type { Papel } from '../services/auth'
import { formatarData } from '../services/datas'
import {
  autorizarVendaVencida,
  corrigirValidade,
  descartarUnidade,
  MAXIMO_JUSTIFICATIVA,
  MAXIMO_MOTIVO,
  MINIMO_JUSTIFICATIVA,
  type Resolucao,
} from '../services/excecaoVencido'
import type { RespostaLeitura, UnidadeLida } from '../services/saidas'

/**
 * Os três caminhos da unidade vencida (PRD seção 6.1), na ordem de proeminência
 * que o PRD determina: correção de dado, baixa por descarte e — por último,
 * atrás de um passo a mais — override de venda.
 *
 * **O override não é o botão primário**, e isso é restrição de design do PRD e
 * não preferência estética: comercializar produto com validade expirada é
 * vedado pela legislação de defesa do consumidor, e o `EventoLog` é imutável.
 * O registro do ato é permanente.
 *
 * O painel não sabe o que é `EXCECAO_VENCIDO`. Ele recebe uma unidade e devolve
 * o que o servidor respondeu — quem escolhe layout por veredito é a tela de
 * leitura. É o que permite T13 reusá-lo a partir da fila de descarte, onde não
 * houve leitura de QR nenhuma.
 */

type Props = {
  unidade: UnidadeLida
  /** Esconder caminho por papel é conveniência: quem recusa é o 403 (RNF04). */
  papel: Papel
  /** O atendimento em curso acompanha os três caminhos, como acompanha as leituras. */
  sessaoVendaId: string | null
  /** A correção revalida o FIFO no servidor e devolve um veredito comum. */
  aoRevalidar: (revalidacao: RespostaLeitura) => void
  /** Descarte e override tiram a unidade do estoque: a resolução é terminal. */
  aoResolver: (resolucao: Resolucao) => void
  /** Alguém resolveu esta unidade antes: o veredito em tela não vale mais. */
  aoPerderUnidade: (mensagem: string) => void
  /** Rede caiu no meio da resolução — mesmo portão da RNF07, sem erro genérico. */
  aoCairConexao: () => void
}

export function PainelExcecaoVencido({
  unidade,
  papel,
  sessaoVendaId,
  aoRevalidar,
  aoResolver,
  aoPerderUnidade,
  aoCairConexao,
}: Props) {
  const gestor = papel === 'GESTOR'

  const [novaValidade, setNovaValidade] = useState(unidade.dataValidade)
  const [motivo, setMotivo] = useState('')
  const [justificativa, setJustificativa] = useState('')
  const [overrideAberto, setOverrideAberto] = useState(false)

  // Uma ação em voo desabilita as três: são caminhos mutuamente exclusivos
  // sobre a mesma unidade, e o lock da RNF02 faria a segunda perder de todo
  // jeito.
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function executar(acao: () => Promise<void>) {
    if (enviando) return
    setEnviando(true)
    setErro(null)

    try {
      await acao()
    } catch (falha) {
      if (falha instanceof ErroApi && falha.status === 0) {
        aoCairConexao()
        return
      }

      // A unidade foi resolvida por outra pessoa enquanto o frasco estava na
      // mão. O veredito em tela valia para o estoque de um instante que passou
      // — a tela volta ao estado de nova leitura, em vez de oferecer caminhos
      // sobre algo que já saiu do estoque.
      if (falha instanceof ErroApi && falha.codigo === 'UNIDADE_JA_BAIXADA') {
        aoPerderUnidade(falha.message)
        return
      }

      // Nos demais casos, a mensagem exibida é a que o backend escreveu.
      setErro(
        falha instanceof ErroApi ? falha.message : 'Não foi possível concluir esta ação.',
      )
    } finally {
      setEnviando(false)
    }
  }

  function corrigir(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    // A tela não compara a data digitada com a atual: a validade gravada é
    // cópia de estado do servidor, e outra pessoa pode tê-la corrigido nesse
    // meio tempo. `VALIDADE_INALTERADA` é recusa do backend, sob lock (T12,
    // Decisão 3).
    void executar(async () => {
      const { revalidacao } = await corrigirValidade(unidade.id, novaValidade, sessaoVendaId)
      aoRevalidar(revalidacao)
    })
  }

  function descartar() {
    void executar(async () => {
      aoResolver(await descartarUnidade(unidade.id, motivo, sessaoVendaId))
    })
  }

  function autorizar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    void executar(async () => {
      aoResolver(await autorizarVendaVencida(unidade.id, justificativa, sessaoVendaId))
    })
  }

  const faltam = MINIMO_JUSTIFICATIVA - justificativa.trim().length

  return (
    <div className="caminhos-excecao">
      <h4>O que fazer com esta unidade</h4>

      {/* Caminho 1. Primeiro na ordem do PRD: o erro de digitação no cadastro
          de entrada é o caso em que nada foi perdido de fato. */}
      {gestor && (
        <form className="caminho caminho-correcao" onSubmit={corrigir}>
          <h5>A validade está errada no cadastro</h5>
          <p>
            Corrija a data e o sistema revalida a ordem de saída do zero. A validade
            cadastrada hoje é {formatarData(unidade.dataValidade)}.
          </p>
          <div className="campo">
            <label htmlFor="validade-corrigida">Validade impressa na embalagem</label>
            <input
              id="validade-corrigida"
              type="date"
              required
              value={novaValidade}
              onChange={(evento) => setNovaValidade(evento.target.value)}
            />
          </div>
          <button type="submit" disabled={enviando}>
            {enviando ? 'Enviando…' : 'Corrigir validade'}
          </button>
        </form>
      )}

      {/* Caminho 2. O de menor atrito, de propósito: é ele que produz o dado de
          perda que a pesquisa quer medir. */}
      <div className="caminho caminho-descarte">
        <h5>A unidade está vencida mesmo</h5>
        <p>
          A unidade sai do estoque e entra no relatório de perdas. O motivo é opcional — sem
          ele, o sistema registra que o vencimento foi constatado na leitura de saída.
        </p>
        <div className="campo">
          <label htmlFor="motivo-descarte">Motivo (opcional)</label>
          <input
            id="motivo-descarte"
            name="motivo-descarte"
            autoComplete="off"
            maxLength={MAXIMO_MOTIVO}
            value={motivo}
            onChange={(evento) => setMotivo(evento.target.value)}
          />
        </div>
        <button type="button" disabled={enviando} onClick={descartar}>
          {enviando ? 'Enviando…' : 'Registrar descarte'}
        </button>
      </div>

      {/* Caminho 3. Último, e atrás de um passo a mais. */}
      {gestor ? (
        <div className="caminho caminho-override">
          {overrideAberto ? (
            <form onSubmit={autorizar}>
              <h5>Autorizar a venda desta unidade vencida</h5>
              <p className="aviso-override">
                A venda de produto com validade expirada é vedada pela legislação de defesa do
                consumidor. Esta autorização fica registrada de forma permanente, com seu nome.
              </p>
              <div className="campo">
                <label htmlFor="justificativa-override">Justificativa</label>
                <textarea
                  id="justificativa-override"
                  name="justificativa-override"
                  rows={3}
                  required
                  minLength={MINIMO_JUSTIFICATIVA}
                  maxLength={MAXIMO_JUSTIFICATIVA}
                  value={justificativa}
                  onChange={(evento) => setJustificativa(evento.target.value)}
                />
                {/* Espelho do mínimo do servidor (Decisão 3): o que a tela pode
                    antecipar é o texto que a pessoa acabou de digitar. */}
                {faltam > 0 && (
                  <small>
                    Faltam {faltam} caractere{faltam > 1 ? 's' : ''} para a justificativa.
                  </small>
                )}
              </div>
              <button type="submit" disabled={enviando || faltam > 0}>
                {enviando ? 'Enviando…' : 'Autorizar venda'}
              </button>
              <button
                type="button"
                className="secundario"
                disabled={enviando}
                onClick={() => setOverrideAberto(false)}
              >
                Cancelar
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="secundario"
              disabled={enviando}
              onClick={() => setOverrideAberto(true)}
            >
              Autorizar a venda mesmo assim
            </button>
          )}
        </div>
      ) : (
        // Botão inerte no balcão é pior que ausência (T10, Decisão 4): a tela
        // diz onde os outros dois caminhos estão, em vez de exibi-los mortos.
        <p className="subtitulo">
          Corrigir a validade cadastrada e autorizar a venda de unidade vencida são ações do
          gestor.
        </p>
      )}

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
    </div>
  )
}
