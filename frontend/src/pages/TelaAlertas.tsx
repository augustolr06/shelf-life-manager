import { useCallback, useEffect, useState } from 'react'
import { ErroApi } from '../services/api'
import { listarAlertas, marcarAlertaComoLido, type Alerta } from '../services/alertas'
import { formatarData } from '../services/datas'

/**
 * Os alertas proativos que a varredura emitiu (RF08), entregues a quem pode
 * agir.
 *
 * Fecha a jornada J3 do PRD. Até T18 o alerta era registro: a gestora
 * configurava a janela, o job cruzava a janela com o estoque e a linha ficava
 * no banco sem mudar o comportamento de ninguém na loja. Aqui ele vira aviso —
 * e o "marcar como lido" é o reconhecimento que fecha o ciclo.
 *
 * Como as demais telas, esta não decide nada. O que está na janela, a ordem, os
 * dias que faltam e se a unidade já venceu vêm prontos do servidor (RNF04);
 * inclusive `situacao`, porque comparar validade no navegador dependeria do
 * fuso do aparelho (RNF01).
 *
 * **Não há resolução de unidade aqui.** O `PainelExcecaoVencido` de T12 trata
 * da unidade *vencida*, e o alerta existe justamente enquanto ela não venceu: a
 * ação que ele pede é comercial (promoção, vitrine) e acontece fora do sistema.
 * Quando a unidade vence assim mesmo, a tela aponta para a fila de descarte,
 * que é onde ela se resolve (T13).
 */

export function TelaAlertas({ aoAtualizarNaoLidos }: { aoAtualizarNaoLidos?: (naoLidos: number) => void }) {
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [total, setTotal] = useState(0)
  const [naoLidos, setNaoLidos] = useState(0)
  const [tamanhoPagina, setTamanhoPagina] = useState(20)
  const [pagina, setPagina] = useState(1)
  const [apenasNaoLidos, setApenasNaoLidos] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  // Qual alerta está sendo marcado: o botão da linha vira "Marcando…" sem
  // travar a lista inteira.
  const [marcando, setMarcando] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const lista = await listarAlertas({ pagina, apenasNaoLidos })
      setAlertas(lista.alertas)
      setTotal(lista.total)
      setNaoLidos(lista.naoLidos)
      setTamanhoPagina(lista.tamanhoPagina)
      aoAtualizarNaoLidos?.(lista.naoLidos)
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível carregar os alertas.')
    } finally {
      setCarregando(false)
    }
  }, [pagina, apenasNaoLidos, aoAtualizarNaoLidos])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function marcarComoLido(alerta: Alerta) {
    setMarcando(alerta.id)
    setErro(null)
    try {
      const atualizado = await marcarAlertaComoLido(alerta.id)

      if (apenasNaoLidos) {
        // Com o filtro ligado, o alerta lido deixa de pertencer à lista que
        // está na tela. Sai daqui mesmo, sem nova ida à rede.
        setAlertas((atuais) => atuais.filter((a) => a.id !== atualizado.id))
        setTotal((atual) => Math.max(0, atual - 1))
      } else {
        // Sem filtro, ele continua visível — marcar não esconde nada, e é isso
        // que serve de desfazer para quem clicou por engano.
        setAlertas((atuais) => atuais.map((a) => (a.id === atualizado.id ? atualizado : a)))
      }

      const restantes = Math.max(0, naoLidos - 1)
      setNaoLidos(restantes)
      aoAtualizarNaoLidos?.(restantes)
    } catch (falha) {
      setErro(
        falha instanceof ErroApi ? falha.message : 'Não foi possível marcar o alerta como lido.',
      )
    } finally {
      setMarcando(null)
    }
  }

  const totalPaginas = Math.max(1, Math.ceil(total / tamanhoPagina))

  return (
    <section className="tela-alertas">
      <h2>Alertas de vencimento</h2>
      <p className="subtitulo">
        Unidades que entraram na janela de antecedência configurada. Ainda dá tempo de decidir
        o que fazer com elas — promoção, destaque na vitrine — antes da perda.
      </p>

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      <div className="filtro-alertas">
        <label>
          <input
            type="checkbox"
            checked={apenasNaoLidos}
            onChange={(evento) => {
              setApenasNaoLidos(evento.target.checked)
              // Trocar o filtro reinicia a paginação: a página 3 do conjunto
              // maior costuma não existir no menor.
              setPagina(1)
            }}
          />
          Mostrar só os não lidos
        </label>
      </div>

      {carregando ? (
        <p role="status">Carregando alertas…</p>
      ) : alertas.length === 0 ? (
        // O estado desejado, não uma falha: nada perto de vencer.
        <p>
          {apenasNaoLidos
            ? 'Nenhum alerta não lido.'
            : 'Nenhuma unidade dentro da janela de alerta.'}
        </p>
      ) : (
        <>
          <p className="resumo-alertas">
            {total} alerta(s) — {naoLidos} não lido(s) — página {pagina} de {totalPaginas}
          </p>

          <ul className="lista-alertas">
            {alertas.map((alerta) => (
              <li
                key={alerta.id}
                className={
                  alerta.situacao === 'VENCIDA'
                    ? 'alerta vencido'
                    : alerta.lidoEm
                      ? 'alerta lido'
                      : 'alerta'
                }
              >
                <div className="dados-alerta">
                  <h3>{alerta.unidade.produto.nome}</h3>
                  <p className="subtitulo">
                    {alerta.unidade.produto.marca} · {alerta.unidade.produto.codigoInterno}
                  </p>

                  <dl className="dados-unidade">
                    <dt>Etiqueta</dt>
                    <dd>{alerta.unidade.codigoQr}</dd>
                    <dt>Validade</dt>
                    <dd>{formatarData(alerta.unidade.dataValidade)}</dd>
                    <dt>{alerta.situacao === 'VENCIDA' ? 'Vencida há' : 'Vence em'}</dt>
                    {/* Contagem do servidor, nos dois casos: a tela não compara
                        datas (RNF01), e nem decide qual dos dois rótulos usar —
                        quem decide é `situacao`. */}
                    <dd>
                      {Math.abs(alerta.diasParaVencer)} dia
                      {Math.abs(alerta.diasParaVencer) === 1 ? '' : 's'}
                    </dd>
                    <dt>Janela</dt>
                    <dd>avisado {alerta.janela.diasAntecedencia} dias antes</dd>
                  </dl>

                  {alerta.situacao === 'VENCIDA' && (
                    <p className="nota-vencida" role="note">
                      Esta unidade venceu depois do aviso. O destino dela — descarte, correção
                      de validade — está na fila de descarte.
                    </p>
                  )}
                </div>

                <div className="acoes-alerta">
                  {alerta.lidoEm ? (
                    <span className="marca-lido">Lido</span>
                  ) : (
                    <button
                      type="button"
                      disabled={marcando === alerta.id}
                      onClick={() => void marcarComoLido(alerta)}
                    >
                      {marcando === alerta.id ? 'Marcando…' : 'Marcar como lido'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
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
