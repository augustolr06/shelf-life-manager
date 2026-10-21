import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarraEstoque } from '../components/BarraEstoque'
import { Icone } from '../components/Icone'
import { ErroApi } from '../services/api'
import type { Usuario } from '../services/auth'
import { buscarDashboard, formatarTaxa, type Dashboard, type ProximoVencimento } from '../services/dashboard'
import { formatarData, formatarDataPorExtenso } from '../services/datas'

/**
 * Início do gestor (T42, `docs/redesign/claude-design/README.md`, "Início do
 * gestor"): o que precisa de ação primeiro — vencidas, alertas e o próximo
 * vencimento —, depois o estoque por validade e o resumo do mês.
 *
 * Tudo vem de `GET /dashboard`, a mesma rota dos Relatórios, pedida sem
 * período: o servidor decide os últimos 30 dias, as faixas, os dias até o
 * próximo vencimento e até a data do cabeçalho (RNF04). Os alertas não lidos
 * são o contador que o `App` já mantém para o menu.
 */

type Props = {
  usuario: Usuario
  alertasNaoLidos: number
}

/**
 * A saudação pela hora do aparelho. É a única leitura de relógio da tela, e
 * não decide nada: a data escrita no cabeçalho, os dias e as faixas vêm do
 * servidor (`docs/decisoes.md`, T42).
 */
function saudacao(hora: number): string {
  if (hora < 12) return 'Bom dia'
  if (hora < 18) return 'Boa tarde'
  return 'Boa noite'
}

function plural(quantidade: number, singular: string, plural: string): string {
  return quantidade === 1 ? singular : plural
}

/**
 * Para onde a busca leva: código de etiqueta abre a Consulta, o resto abre o
 * Catálogo filtrado. O prefixo só escolhe a tela; quem normaliza e confere o
 * código continua sendo o backend (T08), que recebe o texto como foi digitado.
 */
function destinoDaBusca(texto: string): string {
  if (texto.toUpperCase().startsWith('PRF-')) {
    return `/consulta?${new URLSearchParams({ codigo: texto })}`
  }
  return `/produtos?${new URLSearchParams({ busca: texto })}`
}

export function TelaInicio({ usuario, alertasNaoLidos }: Props) {
  const [painel, setPainel] = useState<Dashboard | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [termo, setTermo] = useState('')
  const navegar = useNavigate()
  const primeiroNome = usuario.nome.trim().split(/\s+/)[0]

  useEffect(() => {
    let ativo = true

    buscarDashboard()
      .then((resposta) => {
        if (ativo) setPainel(resposta)
      })
      .catch((falha: unknown) => {
        if (!ativo) return
        setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível carregar o início.')
      })

    return () => {
      ativo = false
    }
  }, [])

  function buscar(evento: FormEvent) {
    evento.preventDefault()
    const texto = termo.trim()
    if (texto === '') return
    navegar(destinoDaBusca(texto))
  }

  return (
    <section className="tela tela-inicio">
      <header className="cabecalho-inicio">
        <div>
          {/* Sem data enquanto o servidor não responde: a do aparelho poderia
              ser outra que não a dos dias e faixas logo abaixo. */}
          {painel && <p className="data-de-hoje">{formatarDataPorExtenso(painel.hoje)}</p>}
          <h1>
            {saudacao(new Date().getHours())}, {primeiroNome}
          </h1>
        </div>

        <div className="acoes-inicio">
          <form role="search" className="busca-inicio" onSubmit={buscar}>
            <Icone nome="consultar" />
            <input
              type="search"
              enterKeyHint="search"
              aria-label="Buscar produto ou código"
              placeholder="Buscar produto ou código PRF-…"
              value={termo}
              onChange={(evento) => setTermo(evento.target.value)}
            />
          </form>
          <Link to="/venda" className="botao">
            <Icone nome="venda" />
            Nova venda
          </Link>
        </div>
      </header>

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
      {!painel && !erro && <p role="status">Carregando…</p>}

      {painel && (
        <>
          <section className="atencao" aria-labelledby="titulo-atencao">
            <h2 id="titulo-atencao">Precisa da sua atenção</h2>
            <div className="cartoes-atencao">
              <CartaoVencidas unidades={painel.perdas.unidadesVencidasEmEstoque} />
              <CartaoAlertas naoLidos={alertasNaoLidos} />
              <CartaoProximoVencimento proximo={painel.estoque.proximoVencimento} />
            </div>
          </section>

          <div className="paineis-inicio">
            <section className="cartao painel-estoque" aria-labelledby="titulo-estoque">
              <div className="cabecalho-painel">
                <h2 id="titulo-estoque">Estoque por validade</h2>
                <span className="subtitulo">Agora · não depende do período</span>
              </div>
              <p className="numero-com-rotulo">
                <span className="numero-destaque">{painel.estoque.unidadesEmEstoque}</span>
                {plural(painel.estoque.unidadesEmEstoque, 'unidade em estoque', 'unidades em estoque')}
              </p>
              <BarraEstoque
                total={painel.estoque.unidadesEmEstoque}
                faixas={painel.estoque.porFaixaDeVencimento}
              />
            </section>

            <section className="cartao painel-periodo" aria-labelledby="titulo-periodo">
              <div className="cabecalho-painel">
                <h2 id="titulo-periodo">Últimos 30 dias</h2>
                <Link to="/dashboard">Relatório</Link>
              </div>
              <dl className="numeros-periodo">
                <div>
                  <dt>saídas registradas</dt>
                  <dd>{painel.saidas.total}</dd>
                </div>
                <div>
                  <dt>acerto na 1ª leitura</dt>
                  {/* `null` é "nenhuma venda", não 0% (T20). */}
                  <dd>
                    {painel.saidas.taxaAcertoPrimeiraLeitura === null
                      ? 'sem saídas'
                      : formatarTaxa(painel.saidas.taxaAcertoPrimeiraLeitura)}
                  </dd>
                </div>
                <div>
                  <dt>descartes</dt>
                  <dd>{painel.perdas.descartes}</dd>
                </div>
                <div>
                  <dt>bloqueios de FIFO</dt>
                  <dd>{painel.fifo.alertasDisparados}</dd>
                </div>
              </dl>
            </section>
          </div>
        </>
      )}
    </section>
  )
}

function CartaoVencidas({ unidades }: { unidades: number }) {
  return (
    <article className="cartao cartao-atencao">
      <span className="distintivo distintivo-perigo">Vencidas</span>
      <p className="numero-com-rotulo">
        <span className="numero-destaque">{unidades}</span>
        {plural(unidades, 'unidade ainda no estoque', 'unidades ainda no estoque')}
      </p>
      {unidades > 0 ? (
        <>
          <p className="subtitulo">
            Ficam bloqueadas para venda até você decidir o destino de cada uma.
          </p>
          <Link to="/descartes" className="botao perigo">
            Resolver descarte
          </Link>
        </>
      ) : (
        <>
          <p className="subtitulo">Nenhuma unidade vencida esperando descarte.</p>
          <Link to="/descartes" className="botao secundario">
            Ver descarte
          </Link>
        </>
      )}
    </article>
  )
}

function CartaoAlertas({ naoLidos }: { naoLidos: number }) {
  return (
    <article className="cartao cartao-atencao">
      <span className="distintivo distintivo-alerta">Alertas</span>
      <p className="numero-com-rotulo">
        <span className="numero-destaque">{naoLidos}</span>
        {plural(naoLidos, 'alerta não lido', 'alertas não lidos')}
      </p>
      <p className="subtitulo">Unidades que entraram numa janela de aviso antes do vencimento.</p>
      <Link to="/alertas" className="botao secundario">
        Ver alertas
      </Link>
    </article>
  )
}

function CartaoProximoVencimento({ proximo }: { proximo: ProximoVencimento | null }) {
  if (!proximo) {
    return (
      <article className="cartao cartao-atencao">
        <span className="distintivo distintivo-inativo">Próximo vencimento</span>
        <p className="subtitulo">Nenhuma unidade em estoque a vencer.</p>
      </article>
    )
  }

  const { unidade, diasParaVencer, faixa } = proximo

  return (
    <article className="cartao cartao-atencao">
      {/* A cor é a da faixa que o servidor deu; o número ao lado diz o mesmo
          em texto. */}
      <span className={`distintivo faixa-${faixa.toLowerCase()}`}>Próximo vencimento</span>
      <p className="numero-com-rotulo">
        {diasParaVencer === 0 ? (
          <span className="numero-destaque">Hoje</span>
        ) : (
          <>
            <span className="numero-destaque">{diasParaVencer}</span>
            {plural(diasParaVencer, 'dia', 'dias')}
          </>
        )}
      </p>
      <p className="subtitulo">
        {unidade.produto.nome} · <span className="codigo">{unidade.codigoQr}</span> · vence{' '}
        {formatarData(unidade.dataValidade)}
      </p>
      <Link
        to={`/consulta?${new URLSearchParams({ codigo: unidade.codigoQr })}`}
        className="botao secundario"
      >
        Ver unidade
      </Link>
    </article>
  )
}
