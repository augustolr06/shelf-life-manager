import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { SeletorProduto } from '../components/SeletorProduto'
import { ErroApi } from '../services/api'
import { formatarData } from '../services/datas'
import type { Produto } from '../services/produtos'
import {
  cadastrarUnidades,
  type ItemLote,
  type ResultadoRecebimento,
} from '../services/unidades'
import type { ImpressaoPedida } from './TelaEtiquetas'

/**
 * Recebimento de mercadoria (RF03). A tela existe para o caso que o controle
 * manual não resolve: uma entrega em que unidades do mesmo produto chegam com
 * validades diferentes. Por isso a validade é por linha, e não uma só para o
 * recebimento inteiro.
 */

const LINHA_VAZIA: ItemLote = { dataValidade: '', quantidade: 1 }

export function TelaRecebimento() {
  const navegar = useNavigate()
  // O produto escolhido no seletor (T28): nunca o texto digitado.
  const [produto, setProduto] = useState<Produto | null>(null)

  const [linhas, setLinhas] = useState<ItemLote[]>([{ ...LINHA_VAZIA }])
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // O produto vai junto do resultado: as etiquetas são das unidades que
  // chegaram, mesmo que o seletor já mostre outro produto.
  const [recebido, setRecebido] = useState<{
    resultado: ResultadoRecebimento
    produto: Produto
  } | null>(null)

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
    if (!produto) return
    setEnviando(true)

    try {
      const resultado = await cadastrarUnidades(produto.id, linhas)
      setRecebido({ resultado, produto })
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

  /**
   * Leva o lote recém-cadastrado para a folha de etiquetas (T15).
   *
   * Os ids vão por estado de rota e não pela URL: um recebimento de 500
   * unidades daria cerca de 18 KB de query string. Recarregar a folha no mesmo
   * navegador mantém o lote (o React Router guarda o estado no History API);
   * levar o endereço para outra aba ou outro aparelho, não — e lá a folha cai
   * no seletor em vez de abrir sozinha o estoque inteiro do SKU.
   */
  function imprimirEtiquetas({
    resultado,
    produto,
  }: {
    resultado: ResultadoRecebimento
    produto: Produto
  }) {
    const pedido: ImpressaoPedida = {
      produtoId: produto.id,
      produtoNome: produto.nome,
      unidadeIds: resultado.unidades.map((unidade) => unidade.id),
    }
    navegar('/etiquetas', { state: pedido })
  }

  const totalUnidades = linhas.reduce((soma, linha) => soma + (linha.quantidade || 0), 0)
  const podeEnviar =
    produto !== null && linhas.length > 0 && linhas.every((linha) => linha.dataValidade !== '')

  return (
    <section className="tela-recebimento">
      <h2>Registrar recebimento</h2>
      <p className="subtitulo">
        Cada unidade recebe um código próprio. Unidades do mesmo produto podem ter validades
        diferentes — adicione uma linha por validade.
      </p>

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      <form className="formulario-recebimento" onSubmit={registrar}>
        <SeletorProduto valor={produto} aoEscolher={setProduto} />

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
          <h3>{recebido.resultado.unidades.length} unidade(s) cadastrada(s)</h3>

          {recebido.resultado.avisos.map((aviso) => (
            <p className="erro" role="alert" key={`${aviso.codigo}-${aviso.dataValidade}`}>
              {aviso.mensagem}
            </p>
          ))}

          <p className="subtitulo">
            Cada unidade recebeu um código próprio. Imprima as etiquetas e cole uma em cada
            frasco antes de guardá-los na prateleira.
          </p>

          <button type="button" onClick={() => imprimirEtiquetas(recebido)}>
            Imprimir etiquetas destas unidades
          </button>

          <table>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Validade</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {recebido.resultado.unidades.map((unidade) => (
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
