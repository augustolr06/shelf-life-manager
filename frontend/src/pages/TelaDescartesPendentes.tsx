import { useCallback, useEffect, useState } from 'react'
import { PainelExcecaoVencido } from '../components/PainelExcecaoVencido'
import { ErroApi } from '../services/api'
import type { Usuario } from '../services/auth'
import { formatarData } from '../services/datas'
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

export function TelaDescartesPendentes({ usuario }: { usuario: Usuario }) {
  const [unidades, setUnidades] = useState<UnidadePendente[]>([])
  const [total, setTotal] = useState(0)
  const [tamanhoPagina, setTamanhoPagina] = useState(20)
  const [pagina, setPagina] = useState(1)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  /**
   * O que aconteceu com a última unidade resolvida.
   *
   * O tom não é julgamento próprio: é a mesma escolha de *layout* por veredito
   * que a tela de leitura faz (RNF04). Descarte concluído é desfecho bom;
   * bloqueio de FIFO depois de uma correção, ou unidade que outra pessoa já
   * resolveu, não são — e pintá-los de verde diria à gestora que deu certo.
   */
  const [nota, setNota] = useState<{ tom: 'sucesso' | 'recusa'; texto: string } | null>(null)

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
      setTamanhoPagina(fila.tamanhoPagina)
      setEmResolucao(null)
    } catch (falha) {
      setErro(
        falha instanceof ErroApi ? falha.message : 'Não foi possível carregar a fila de descarte.',
      )
    } finally {
      setCarregando(false)
    }
  }, [pagina])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const totalPaginas = Math.max(1, Math.ceil(total / tamanhoPagina))

  return (
    <section className="tela-descartes">
      <h2>Fila de descarte pendente</h2>
      <p className="subtitulo">
        Unidades que já venceram e continuam no estoque. Elas não saem pelo fluxo normal de
        venda — ficam aqui até serem resolvidas.
      </p>

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      {nota && (
        <p
          className={nota.tom === 'sucesso' ? 'nota-sucesso' : 'erro'}
          role={nota.tom === 'sucesso' ? 'status' : 'alert'}
        >
          {nota.texto}
        </p>
      )}

      {carregando ? (
        <p role="status">Carregando fila…</p>
      ) : unidades.length === 0 ? (
        // O estado desejado, não uma falha.
        <p>Nenhuma unidade vencida em estoque.</p>
      ) : (
        <>
          <p className="resumo-fila">
            {total} unidade(s) vencida(s) em estoque — página {pagina} de {totalPaginas}
          </p>

          <ul className="fila-descarte">
            {unidades.map((unidade) => (
              <li key={unidade.id} className="pendente">
                <div className="dados-pendente">
                  <h3>{unidade.produto.nome}</h3>
                  <p className="subtitulo">
                    {unidade.produto.marca} · {unidade.produto.codigoInterno}
                  </p>
                  {/* Mesma lista de definição das telas de leitura: o CSS
                      de `.dados-unidade` é uma grade de dt/dd diretos. */}
                  <dl className="dados-unidade">
                    <dt>Etiqueta</dt>
                    <dd>{unidade.codigoQr}</dd>
                    <dt>Validade</dt>
                    <dd>{formatarData(unidade.dataValidade)}</dd>
                    <dt>Vencida há</dt>
                    {/* Contagem do servidor: comparar datas no navegador
                        dependeria do fuso do aparelho (RNF01). */}
                    <dd>
                      {unidade.diasVencida} dia{unidade.diasVencida > 1 ? 's' : ''}
                    </dd>
                  </dl>
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
                    // saído da fila (validade futura), continuado nela (outra
                    // data no passado) ou sido vendida na revalidação — e é o
                    // servidor quem sabe qual dos três. A fila é recarregada em
                    // vez de a linha ser removida no palpite da tela.
                    aoRevalidar={(revalidacao) => {
                      setNota({
                        tom: revalidacao.veredito === 'CONFIRMAR' ? 'sucesso' : 'recusa',
                        texto: revalidacao.mensagem,
                      })
                      void carregar()
                    }}
                    // Descarte é terminal: a unidade saiu do estoque, e a linha
                    // pode sair da lista sem nova ida à rede.
                    aoResolver={(resolucao) => {
                      setNota({ tom: 'sucesso', texto: resolucao.mensagem })
                      setUnidades((atuais) => atuais.filter((u) => u.id !== resolucao.unidade.id))
                      setTotal((atual) => Math.max(0, atual - 1))
                      setEmResolucao(null)
                    }}
                    // Lista velha: outra pessoa resolveu esta unidade desde que a
                    // fila foi carregada. É o equivalente, aqui, ao "volta ao
                    // estado de nova leitura" do balcão (T12).
                    aoPerderUnidade={(mensagem) => {
                      setNota({ tom: 'recusa', texto: mensagem })
                      void carregar()
                    }}
                    // Sem o portão de conexão da tela de leitura (RNF07): aqui
                    // não há veredito de FIFO a descartar, e recarregar já mostra
                    // o erro de rede como qualquer outra falha de carregamento.
                    aoCairConexao={() => void carregar()}
                  />
                ) : (
                  <button type="button" onClick={() => setEmResolucao(unidade.id)}>
                    Resolver
                  </button>
                )}
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
