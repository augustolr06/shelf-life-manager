import { useCallback, useEffect, useRef, useState } from 'react'
import { Paginacao } from '../components/Paginacao'
import { PainelExcecaoVencido } from '../components/PainelExcecaoVencido'
import { ErroApi } from '../services/api'
import { avisar } from '../services/avisos'
import type { Usuario } from '../services/auth'
import { formatarData, formatarDiasVencida } from '../services/datas'
import { listarDescartesPendentes, type UnidadePendente } from '../services/descartes'

/**
 * Fila de descarte pendente (RF11): as unidades vencidas que continuam no
 * estoque, para o gestor resolver ativamente.
 *
 * É a contrapartida da tela de leitura. Lá a unidade vencida é encontrada por
 * acidente — só aparece quando um cliente pede aquele frasco. Aqui ela é
 * procurada: enquanto ninguém a pede, a unidade fica num limbo em que não sai
 * pelo FIFO (que exclui vencidas do pool) e não entra no relatório de perdas
 * (que só conhece o que foi descartado).
 *
 * A tela não decide nada, como as outras: o que é "vencido", a ordem da fila e
 * há quantos dias cada unidade venceu vêm prontos do servidor (RNF04). Resolver
 * é o `PainelExcecaoVencido` de T12, sem um caminho reimplementado — só sem o
 * override, que é ato de venda e não existe numa varredura de estoque.
 */

type Props = {
  usuario: Usuario
  /**
   * O `total` da fila a cada recarga, para o distintivo da navegação (T41).
   * Opcional pelo mesmo motivo do `aoAtualizarNaoLidos` dos alertas: a tela
   * funciona sozinha nos testes.
   */
  aoAtualizarPendentes?: (pendentes: number) => void
}

export function TelaDescartesPendentes({ usuario, aoAtualizarPendentes }: Props) {
  const [unidades, setUnidades] = useState<UnidadePendente[]>([])
  const [total, setTotal] = useState(0)
  const [tamanhoPagina, setTamanhoPagina] = useState(20)
  const [pagina, setPagina] = useState(1)
  const inicioDaLista = useRef<HTMLParagraphElement>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Um painel aberto por vez: são caminhos sobre uma unidade específica, e a
  // fila inteira aberta viraria uma parede de formulários.
  const [emResolucao, setEmResolucao] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const fila = await listarDescartesPendentes(pagina)
      setUnidades(fila.unidades)
      setTotal(fila.total)
      aoAtualizarPendentes?.(fila.total)
      setTamanhoPagina(fila.tamanhoPagina)
      setEmResolucao(null)
    } catch (falha) {
      setErro(
        falha instanceof ErroApi ? falha.message : 'Não foi possível carregar a fila de descarte.',
      )
    } finally {
      setCarregando(false)
    }
  }, [pagina, aoAtualizarPendentes])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const totalPaginas = Math.max(1, Math.ceil(total / tamanhoPagina))

  return (
    <section className="tela tela-descartes">
      <h1>Descarte</h1>
      <p className="subtitulo frase-contexto">Vencidas não saem na venda. Decida o destino.</p>

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      {carregando ? (
        <p role="status">Carregando fila…</p>
      ) : unidades.length === 0 ? (
        // O estado desejado, não uma falha.
        <p>Nenhuma unidade vencida em estoque.</p>
      ) : (
        <>
          <p className="resumo-fila" ref={inicioDaLista}>
            {total} unidade(s) vencida(s) em estoque — página {pagina} de {totalPaginas}
          </p>

          {/* Lista compacta (T44): uma linha por unidade, para a fila inteira
              caber na tela do celular. Marca e validade ficam no `title`; a
              validade também está no painel de resolução, que é onde ela é
              corrigida. */}
          <ul className="cartao lista-compacta">
            {unidades.map((unidade) => (
              <li
                key={unidade.id}
                className="linha-compacta"
                title={`${unidade.produto.marca} · validade ${formatarData(unidade.dataValidade)}`}
              >
                <div className="dados-linha">
                  <span className="nome-linha">{unidade.produto.nome}</span>
                  <span className="detalhe-linha">
                    {/* Contagem do servidor: comparar datas no navegador
                        dependeria do fuso do aparelho (RNF01). */}
                    <span className="distintivo faixa-vencida">
                      {formatarDiasVencida(unidade.diasVencida)}
                    </span>
                    <span className="codigo">{unidade.codigoQr}</span>
                  </span>
                </div>

                {emResolucao === unidade.id ? (
                  <PainelExcecaoVencido
                    unidade={unidade}
                    // A rota já é GESTOR-only, dos dois lados; o painel
                    // recebe o papel de quem está logado e não uma constante,
                    // para não afirmar autorização que não veio da sessão.
                    papel={usuario.papel}
                    // Não há venda acontecendo numa varredura de estoque: o
                    // override é escape do balcão, com cliente na frente (T13).
                    permitirOverride={false}
                    // Sem atendimento: o agrupador amarra as saídas de um
                    // cliente no balcão (T09), e inventar um aqui poluiria o
                    // relatório com atendimentos que nunca existiram.
                    sessaoVendaId={null}
                    // A correção revalidou o FIFO no servidor. A unidade pode ter
                    // saído da fila (validade futura) ou continuado nela (outra
                    // data no passado), e é o servidor quem sabe qual. Desde
                    // T33b, revalidar não vende: `CONFIRMAR` aqui é a unidade de
                    // volta à prateleira. A fila é recarregada em vez de a linha
                    // ser removida no palpite da tela.
                    //
                    // O desfecho vira toast (T29), e o tipo não é julgamento
                    // próprio: é a mesma escolha de *layout* por veredito que a
                    // tela de leitura faz (RNF04). Bloqueio de FIFO depois da
                    // correção não é desfecho bom, e pintá-lo de verde diria à
                    // gestora que deu certo.
                    aoRevalidar={(revalidacao) => {
                      if (revalidacao.veredito === 'CONFIRMAR') {
                        avisar.sucesso(revalidacao.mensagem)
                      } else {
                        avisar.erro(revalidacao.mensagem)
                      }
                      void carregar()
                    }}
                    // Descarte é terminal: a unidade saiu do estoque, e a linha
                    // pode sair da lista sem nova ida à rede.
                    aoResolver={(resolucao) => {
                      avisar.sucesso(resolucao.mensagem)
                      setUnidades((atuais) => atuais.filter((u) => u.id !== resolucao.unidade.id))
                      setTotal((atual) => Math.max(0, atual - 1))
                      aoAtualizarPendentes?.(Math.max(0, total - 1))
                      setEmResolucao(null)
                    }}
                    // Lista velha: outra pessoa resolveu esta unidade desde que a
                    // fila foi carregada. É o equivalente, aqui, ao "volta ao
                    // estado de nova leitura" do balcão (T12).
                    aoPerderUnidade={(mensagem) => {
                      avisar.erro(mensagem)
                      void carregar()
                    }}
                    // Sem o portão de conexão da tela de leitura (RNF07): aqui
                    // não há veredito de FIFO a descartar, e recarregar já mostra
                    // o erro de rede como qualquer outra falha de carregamento.
                    aoCairConexao={() => void carregar()}
                  />
                ) : (
                  <button
                    type="button"
                    className="secundario"
                    onClick={() => setEmResolucao(unidade.id)}
                  >
                    Resolver
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <Paginacao
        pagina={pagina}
        totalPaginas={totalPaginas}
        aoMudar={setPagina}
        alvoRolagem={inicioDaLista}
      />
    </section>
  )
}
