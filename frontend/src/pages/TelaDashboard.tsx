import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ErroApi } from '../services/api'
import {
  buscarDashboard,
  listarHistoricoDeSaidas,
  type Dashboard,
  type Faixa,
  type HistoricoDeSaidas,
  type PeriodoPedido,
} from '../services/dashboard'
import { formatarData, formatarInstante } from '../services/datas'

/**
 * O painel da RF13: os números que o `EventoLog` e as tabelas operacionais
 * acumularam, lidos de uma vez.
 *
 * Esta tela é a mais literal de todas na regra de que o frontend não decide
 * nada (RNF04). Ela não classifica faixa de vencimento, não calcula taxa, não
 * sabe o que é "vencido" e nem sequer sabe qual é o período padrão — pergunta
 * ao servidor sem `de`/`ate` e exibe o intervalo que voltou **ecoado**. A única
 * aritmética daqui é de apresentação: largura de barra, percentual formatado e
 * a divisão da paginação, a mesma que T13 e T19 já fazem.
 *
 * O que a tela precisa comunicar além dos números é a distinção que a resposta
 * carrega na forma: `estoque` é fotografia do **agora**; saídas, FIFO,
 * descartes e overrides são do **período escolhido**. Um painel que empilha os
 * dois sem rótulo transforma o número certo em interpretação errada — foi por
 * isso que T20 os separou em objetos distintos, e é aqui que essa separação ou
 * fica legível, ou se perde.
 */

/**
 * O nome de cada faixa na tela. As cinco chaves existem sempre, na ordem em que
 * o servidor as devolve — ele garante que nenhuma some, inclusive zerada, e
 * reordená-las aqui quebraria a leitura de "mais urgente primeiro".
 */
const ROTULO_DA_FAIXA: Record<Faixa, string> = {
  VENCIDA: 'Já vencidas',
  ATE_7_DIAS: 'Vencem em até 7 dias',
  DE_8_A_30_DIAS: 'Vencem em 8 a 30 dias',
  DE_31_A_90_DIAS: 'Vencem em 31 a 90 dias',
  ACIMA_DE_90_DIAS: 'Vencem em mais de 90 dias',
}

/**
 * A taxa que o servidor calculou, como percentual de uma casa.
 *
 * `null` **não** vira `0%`: são fatos opostos (nenhuma venda no período versus
 * nenhum acerto de primeira), e essa distinção foi criada em T20 justamente
 * para a tela ter de dizer a verdade aqui.
 */
function formatarTaxa(taxa: number): string {
  return `${(taxa * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`
}

export function TelaDashboard() {
  const [painel, setPainel] = useState<Dashboard | null>(null)
  const [historico, setHistorico] = useState<HistoricoDeSaidas | null>(null)

  /**
   * O recorte pedido, ou `null` enquanto ninguém pediu nada — e `null` é o que
   * faz a URL sair sem `de`/`ate`, deixando o padrão dos últimos 30 dias com
   * quem é dono dele.
   */
  const [periodoAplicado, setPeriodoAplicado] = useState<PeriodoPedido | null>(null)
  const [campoDe, setCampoDe] = useState('')
  const [campoAte, setCampoAte] = useState('')

  const [pagina, setPagina] = useState(1)
  const [apenasOverrides, setApenasOverrides] = useState(false)

  const [carregandoPainel, setCarregandoPainel] = useState(true)
  const [carregandoHistorico, setCarregandoHistorico] = useState(true)
  const [erroPainel, setErroPainel] = useState<string | null>(null)
  const [erroHistorico, setErroHistorico] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    setCarregandoPainel(true)
    setErroPainel(null)

    buscarDashboard(periodoAplicado)
      .then((resposta) => {
        if (!ativo) return
        setPainel(resposta)
        // Os campos começam vazios porque o padrão é do servidor. Depois da
        // primeira resposta eles passam a mostrar o intervalo que ele usou, para
        // que ajustar o período parta do que está na tela — sem que a tela tenha
        // calculado data nenhuma.
        setCampoDe((atual) => atual || resposta.periodo.de)
        setCampoAte((atual) => atual || resposta.periodo.ate)
      })
      .catch((falha: unknown) => {
        if (!ativo) return
        setErroPainel(
          falha instanceof ErroApi ? falha.message : 'Não foi possível carregar o painel.',
        )
      })
      .finally(() => {
        if (ativo) setCarregandoPainel(false)
      })

    return () => {
      ativo = false
    }
  }, [periodoAplicado])

  useEffect(() => {
    let ativo = true
    setCarregandoHistorico(true)
    setErroHistorico(null)

    listarHistoricoDeSaidas({ periodo: periodoAplicado, pagina, apenasOverrides })
      .then((resposta) => {
        if (ativo) setHistorico(resposta)
      })
      .catch((falha: unknown) => {
        if (!ativo) return
        setErroHistorico(
          falha instanceof ErroApi ? falha.message : 'Não foi possível carregar o histórico.',
        )
      })
      .finally(() => {
        if (ativo) setCarregandoHistorico(false)
      })

    return () => {
      ativo = false
    }
  }, [periodoAplicado, pagina, apenasOverrides])

  function aplicarPeriodo(evento: FormEvent) {
    evento.preventDefault()
    // Ponta vazia vai como ausente e o servidor completa com o padrão dela.
    // Intervalo invertido também sobe: quem recusa é o 400 `PERIODO_INVALIDO`,
    // não uma segunda regra escrita aqui (RNF04).
    setPeriodoAplicado({ de: campoDe || undefined, ate: campoAte || undefined })
    setPagina(1)
  }

  const totalPaginas = historico
    ? Math.max(1, Math.ceil(historico.total / historico.tamanhoPagina))
    : 1

  // A barra mais longa é a maior faixa, não o estoque inteiro: com 700 unidades
  // em "mais de 90 dias", as faixas urgentes virariam traços invisíveis.
  const maiorFaixa = painel
    ? Math.max(...painel.estoque.porFaixaDeVencimento.map((contagem) => contagem.unidades), 1)
    : 1

  return (
    <section className="tela-dashboard">
      <h2>Dashboard</h2>
      <p className="subtitulo">
        A consolidação do que o sistema registrou. Os números do estoque são de agora; os de
        movimento são do período selecionado.
      </p>

      <form className="filtros seletor-periodo" onSubmit={aplicarPeriodo}>
        <div className="campo">
          <label htmlFor="periodo-de">De</label>
          <input
            id="periodo-de"
            type="date"
            value={campoDe}
            onChange={(evento) => setCampoDe(evento.target.value)}
          />
        </div>
        <div className="campo">
          <label htmlFor="periodo-ate">Até</label>
          <input
            id="periodo-ate"
            type="date"
            value={campoAte}
            onChange={(evento) => setCampoAte(evento.target.value)}
          />
        </div>
        <button type="submit">Aplicar período</button>
      </form>

      {erroPainel && (
        <p className="erro" role="alert">
          {erroPainel}
        </p>
      )}

      {carregandoPainel && !painel ? (
        <p role="status">Carregando painel…</p>
      ) : painel ? (
        <>
          <section className="bloco-painel">
            <h3>Estoque agora</h3>
            <p className="subtitulo">
              Fotografia do momento: não muda com o período selecionado.
            </p>

            <p className="indicador-destaque">
              <strong>{painel.estoque.unidadesEmEstoque}</strong> unidade(s) em estoque
            </p>

            <ul className="grafico-faixas">
              {painel.estoque.porFaixaDeVencimento.map((contagem) => (
                <li key={contagem.faixa} className={`faixa faixa-${contagem.faixa.toLowerCase()}`}>
                  <span className="rotulo-faixa">{ROTULO_DA_FAIXA[contagem.faixa]}</span>
                  {/* A barra é decoração: o número ao lado é a informação, e é
                      ele que o leitor de tela anuncia. */}
                  <span
                    className="barra-faixa"
                    aria-hidden="true"
                    // Faixa zerada não desenha barra: o traço mínimo que mantém
                    // visível a faixa de uma unidade mentiria sobre a de zero.
                    style={{
                      width:
                        contagem.unidades === 0
                          ? 0
                          : `max(2px, ${(contagem.unidades / maiorFaixa) * 100}%)`,
                    }}
                  />
                  <span className="valor-faixa">{contagem.unidades}</span>
                </li>
              ))}
            </ul>

            <p className="nota-vencidas">
              {painel.perdas.unidadesVencidasEmEstoque} unidade(s) vencida(s) ainda em estoque —{' '}
              <Link to="/descartes">resolver na fila de descarte</Link>
            </p>
          </section>

          <section className="bloco-painel">
            <h3>
              No período — {formatarData(painel.periodo.de)} a {formatarData(painel.periodo.ate)}
            </h3>

            <ul className="indicadores">
              <li className="indicador">
                <span className="valor-indicador">{painel.saidas.total}</span>
                <span className="rotulo-indicador">saída(s) registrada(s)</span>
              </li>

              <li className="indicador">
                <span className="valor-indicador">
                  {painel.saidas.taxaAcertoPrimeiraLeitura === null
                    ? '—'
                    : formatarTaxa(painel.saidas.taxaAcertoPrimeiraLeitura)}
                </span>
                <span className="rotulo-indicador">
                  {painel.saidas.taxaAcertoPrimeiraLeitura === null
                    ? 'sem saídas no período'
                    : `acerto na primeira leitura (${painel.saidas.naPrimeiraLeitura} de ${painel.saidas.total})`}
                </span>
                {/* A limitação conhecida do indicador, dita onde ele é lido: o
                    override grava zero tentativas sem ter passado pelo laço do
                    FIFO, e por isso entra na conta como acerto de primeira
                    (`docs/notas-para-artigo.md`, T20). O número exibido continua
                    sendo o do servidor — o que a tela acrescenta é o aviso. */}
                {painel.saidas.taxaAcertoPrimeiraLeitura !== null &&
                  painel.overrides.total > 0 && (
                    <span className="nota-indicador">
                      inclui {painel.overrides.total} venda(s) autorizada(s) de unidade vencida,
                      que não passaram pela validação de FIFO
                    </span>
                  )}
              </li>

              <li className="indicador">
                <span className="valor-indicador">{painel.perdas.descartes}</span>
                <span className="rotulo-indicador">descarte(s) no período</span>
              </li>

              <li className="indicador">
                <span className="valor-indicador">{painel.overrides.total}</span>
                <span className="rotulo-indicador">venda(s) de unidade vencida autorizada(s)</span>
              </li>
            </ul>

            {/* O "vs." literal da RF13: quantas vezes o sistema bloqueou, e
                quantas vezes o bloqueio terminou em venda da unidade certa. Os
                dois números vêm de tabelas diferentes de propósito — um bloqueio
                pode não terminar em venda —, e é essa diferença que se olha. */}
            <div className="confronto-fifo">
              <div className="lado-confronto">
                <span className="valor-indicador">{painel.fifo.alertasDisparados}</span>
                <span className="rotulo-indicador">bloqueio(s) de FIFO</span>
              </div>
              <span className="versus">vs.</span>
              <div className="lado-confronto">
                <span className="valor-indicador">{painel.fifo.substituicoesEfetivas}</span>
                <span className="rotulo-indicador">substituição(ões) efetiva(s)</span>
              </div>
            </div>
          </section>
        </>
      ) : null}

      <section className="bloco-painel historico-saidas">
        <h3>Histórico de saídas</h3>

        <div className="filtro-historico">
          <label>
            <input
              type="checkbox"
              checked={apenasOverrides}
              onChange={(evento) => {
                setApenasOverrides(evento.target.checked)
                // Trocar o filtro reinicia a paginação: a página 3 do conjunto
                // maior costuma não existir no menor.
                setPagina(1)
              }}
            />
            Mostrar só as vendas autorizadas de unidade vencida
          </label>
        </div>

        {erroHistorico && (
          <p className="erro" role="alert">
            {erroHistorico}
          </p>
        )}

        {carregandoHistorico && !historico ? (
          <p role="status">Carregando histórico…</p>
        ) : !historico ? null : historico.saidas.length === 0 ? (
          // Período sem movimento é resposta, não falha.
          <p>
            {apenasOverrides
              ? 'Nenhuma venda autorizada de unidade vencida no período.'
              : 'Nenhuma saída registrada no período.'}
          </p>
        ) : (
          <>
            <p className="resumo-historico">
              {historico.total} saída(s) no período — página {historico.pagina} de {totalPaginas}
            </p>

            <ul className="lista-saidas">
              {historico.saidas.map((saida) => (
                <li key={saida.id} className={saida.vendaDeUnidadeVencida ? 'saida override' : 'saida'}>
                  <div className="dados-saida">
                    <h4>{saida.unidade.produto.nome}</h4>
                    <p className="subtitulo">
                      {saida.unidade.produto.marca} · {saida.unidade.produto.codigoInterno}
                    </p>

                    <dl className="dados-unidade">
                      <dt>Etiqueta</dt>
                      <dd>{saida.unidade.codigoQr}</dd>
                      <dt>Validade</dt>
                      {/* Data de calendário: fatiada, nunca convertida por fuso (RNF01). */}
                      <dd>{formatarData(saida.unidade.dataValidade)}</dd>
                      <dt>Saída</dt>
                      {/* Instante, ao contrário da validade: aqui a hora local é o dado. */}
                      <dd>{formatarInstante(saida.dataHora)}</dd>
                      <dt>Atendente</dt>
                      <dd>{saida.usuario.nome}</dd>
                      <dt>Tentativas até o acerto</dt>
                      <dd>{saida.tentativasAteAcerto}</dd>
                    </dl>

                    {saida.alertaFifoDisparado && (
                      <p className="marca-fifo">Houve bloqueio de FIFO antes desta venda</p>
                    )}

                    {saida.vendaDeUnidadeVencida && (
                      <div className="marca-override">
                        <p>Venda de unidade vencida autorizada</p>
                        {saida.justificativaOverride && (
                          <p className="justificativa">"{saida.justificativaOverride}"</p>
                        )}
                        {saida.autorizadoPor && (
                          <p className="autorizador">Autorizada por {saida.autorizadoPor.nome}</p>
                        )}
                      </div>
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
    </section>
  )
}
