import { useEffect, useState, type FormEvent } from 'react'
import { ErroApi } from '../services/api'
import { formatarData } from '../services/datas'
import { listarProdutos, type Produto } from '../services/produtos'
import {
  cadastrarUnidades,
  type ItemLote,
  type ResultadoRecebimento,
} from '../services/unidades'

/**
 * Recebimento de mercadoria (RF03). A tela existe para o caso que o controle
 * manual não resolve: uma entrega em que unidades do mesmo produto chegam com
 * validades diferentes. Por isso a validade é por linha, e não uma só para o
 * recebimento inteiro.
 */

const LINHA_VAZIA: ItemLote = { dataValidade: '', quantidade: 1 }

export function TelaRecebimento() {
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [totalProdutos, setTotalProdutos] = useState(0)
  const [termo, setTermo] = useState('')
  const [produtoId, setProdutoId] = useState('')
  const [carregandoCatalogo, setCarregandoCatalogo] = useState(true)

  const [linhas, setLinhas] = useState<ItemLote[]>([{ ...LINHA_VAZIA }])
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [recebido, setRecebido] = useState<ResultadoRecebimento | null>(null)

  useEffect(() => {
    void buscarCatalogo('')
  }, [])

  async function buscarCatalogo(busca: string) {
    setCarregandoCatalogo(true)
    setErro(null)
    try {
      // Só produtos ativos: o backend recusa receber unidade de produto
      // inativo, e oferecê-lo na lista só levaria ao 409.
      const resultado = await listarProdutos({ busca })
      setProdutos(resultado.produtos)
      setTotalProdutos(resultado.total)
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível carregar o catálogo.')
    } finally {
      setCarregandoCatalogo(false)
    }
  }

  function filtrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setProdutoId('')
    void buscarCatalogo(termo.trim())
  }

  function alterarLinha(indice: number, alteracao: Partial<ItemLote>) {
    setLinhas((atuais) =>
      atuais.map((linha, i) => (i === indice ? { ...linha, ...alteracao } : linha)),
    )
  }

  function adicionarLinha() {
    setLinhas((atuais) => [...atuais, { ...LINHA_VAZIA }])
  }

  function removerLinha(indice: number) {
    setLinhas((atuais) => atuais.filter((_, i) => i !== indice))
  }

  async function registrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setRecebido(null)
    setEnviando(true)

    try {
      const resultado = await cadastrarUnidades(produtoId, linhas)
      setRecebido(resultado)
      // O formulário volta ao zero: o próximo recebimento é outro evento, e
      // reenviar o mesmo lote por engano geraria etiquetas duplicadas.
      setLinhas([{ ...LINHA_VAZIA }])
    } catch (falha) {
      // Produto inativo, lote grande demais, sessão expirada: a mensagem é a
      // que o backend escreveu (RNF04).
      setErro(
        falha instanceof ErroApi ? falha.message : 'Não foi possível registrar o recebimento.',
      )
    } finally {
      setEnviando(false)
    }
  }

  const totalUnidades = linhas.reduce((soma, linha) => soma + (linha.quantidade || 0), 0)
  const podeEnviar =
    produtoId !== '' && linhas.length > 0 && linhas.every((linha) => linha.dataValidade !== '')

  return (
    <section className="tela-recebimento">
      <h2>Registrar recebimento</h2>
      <p className="subtitulo">
        Cada unidade recebe um código próprio. Unidades do mesmo produto podem ter validades
        diferentes — adicione uma linha por validade.
      </p>

      <form className="filtros" onSubmit={filtrar}>
        <div className="campo">
          <label htmlFor="busca-produto">Buscar produto por nome ou código</label>
          <input
            id="busca-produto"
            name="busca-produto"
            value={termo}
            onChange={(evento) => setTermo(evento.target.value)}
          />
        </div>
        <button type="submit">Buscar</button>
      </form>

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      <form className="formulario-recebimento" onSubmit={registrar}>
        <div className="campo">
          <label htmlFor="produto">Produto</label>
          <select
            id="produto"
            name="produto"
            required
            value={produtoId}
            onChange={(evento) => setProdutoId(evento.target.value)}
            disabled={carregandoCatalogo}
          >
            <option value="">
              {carregandoCatalogo ? 'Carregando catálogo…' : 'Selecione o produto'}
            </option>
            {produtos.map((produto) => (
              <option key={produto.id} value={produto.id}>
                {produto.codigoInterno} — {produto.nome} ({produto.marca})
              </option>
            ))}
          </select>
          {!carregandoCatalogo && totalProdutos > produtos.length && (
            <small>
              Mostrando {produtos.length} de {totalProdutos} produtos. Refine a busca para achar os
              demais.
            </small>
          )}
          {!carregandoCatalogo && totalProdutos === 0 && (
            <small>Nenhum produto ativo encontrado. Cadastre-o antes em Catálogo de produtos.</small>
          )}
        </div>

        <fieldset className="validades">
          <legend>Validades recebidas</legend>

          {linhas.map((linha, indice) => (
            <div className="linha-validade" key={indice}>
              <div className="campo">
                <label htmlFor={`validade-${indice}`}>Validade</label>
                <input
                  id={`validade-${indice}`}
                  type="date"
                  required
                  value={linha.dataValidade}
                  onChange={(evento) =>
                    alterarLinha(indice, { dataValidade: evento.target.value })
                  }
                />
              </div>
              <div className="campo campo-quantidade">
                <label htmlFor={`quantidade-${indice}`}>Unidades</label>
                <input
                  id={`quantidade-${indice}`}
                  type="number"
                  min={1}
                  max={200}
                  required
                  value={linha.quantidade}
                  onChange={(evento) =>
                    alterarLinha(indice, { quantidade: Number(evento.target.value) })
                  }
                />
              </div>
              <button
                type="button"
                className="secundario"
                onClick={() => removerLinha(indice)}
                disabled={linhas.length === 1}
                aria-label={`Remover validade ${indice + 1}`}
              >
                Remover
              </button>
            </div>
          ))}

          <button type="button" className="secundario" onClick={adicionarLinha}>
            Adicionar outra validade
          </button>
        </fieldset>

        <p className="resumo-lote">Total: {totalUnidades} unidade(s) neste recebimento.</p>

        <button type="submit" disabled={!podeEnviar || enviando}>
          {enviando ? 'Registrando…' : 'Registrar recebimento'}
        </button>
      </form>

      {recebido && (
        <section className="resultado-recebimento" aria-live="polite">
          <h3>{recebido.unidades.length} unidade(s) cadastrada(s)</h3>

          {recebido.avisos.map((aviso) => (
            <p className="erro" role="alert" key={`${aviso.codigo}-${aviso.dataValidade}`}>
              {aviso.mensagem}
            </p>
          ))}

          <p className="subtitulo">
            Anote ou imprima estes códigos e cole cada um na sua unidade. A impressão de etiquetas
            entra em uma etapa seguinte do projeto.
          </p>

          <table>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Validade</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {recebido.unidades.map((unidade) => (
                <tr key={unidade.id}>
                  <td>{unidade.codigoQr}</td>
                  <td>{formatarData(unidade.dataValidade)}</td>
                  <td>{unidade.status === 'EM_ESTOQUE' ? 'Em estoque' : unidade.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </section>
  )
}
