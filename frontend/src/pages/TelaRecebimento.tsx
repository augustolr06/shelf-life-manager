import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icone } from '../components/Icone'
import { LeitorCamera } from '../components/LeitorCamera'
import { SeletorProduto } from '../components/SeletorProduto'
import { useFormatoDaTela } from '../hooks/useFormatoDaTela'
import { avisar } from '../services/avisos'
import { formatarData } from '../services/datas'
import { buscarProdutoPeloCodigo, type Produto } from '../services/produtos'
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

/** O código de barras lido na câmera e o produto do catálogo que tem esse código (T48). */
type Leitura = { codigo: string; produto: Produto | null }

export function TelaRecebimento() {
  const navegar = useNavigate()
  // O produto escolhido no seletor (T28): nunca o texto digitado.
  const [produto, setProduto] = useState<Produto | null>(null)

  // A leitura do código de barras da embalagem (T48), alternativa ao seletor.
  // Só no celular, como no cadastro do Catálogo (T47): é nele que a gestora
  // está com a caixa da entrega na mão.
  const cameraDisponivel = useFormatoDaTela() === 'celular'
  const [cameraLigada, setCameraLigada] = useState(false)
  const [avisoCamera, setAvisoCamera] = useState<string | null>(null)
  const [procurando, setProcurando] = useState(false)
  const [leitura, setLeitura] = useState<Leitura | null>(null)

  const [linhas, setLinhas] = useState<ItemLote[]>([{ ...LINHA_VAZIA }])
  const [enviando, setEnviando] = useState(false)
  // O produto vai junto do resultado: as etiquetas são das unidades que
  // chegaram, mesmo que o seletor já mostre outro produto.
  const [recebido, setRecebido] = useState<{
    resultado: ResultadoRecebimento
    produto: Produto
  } | null>(null)

  function escolherNoSeletor(escolhido: Produto | null) {
    setProduto(escolhido)
    // A nota da leitura fala do produto que a câmera achou; escolher outro no
    // seletor a torna velha.
    if (escolhido?.id !== leitura?.produto?.id) setLeitura(null)
  }

  function ligarCamera() {
    setAvisoCamera(null)
    setLeitura(null)
    setCameraLigada(true)
  }

  function falhaDaCamera(mensagem: string) {
    setCameraLigada(false)
    setAvisoCamera(mensagem)
  }

  /**
   * Leitura única (T31): a câmera desliga ao identificar o código, e a tela
   * pergunta ao servidor qual produto do catálogo tem esse código. Ativo, ele
   * vira o produto escolhido, como se tivesse sido escolhido no seletor;
   * inativo ou inexistente, a tela diz por que nada foi escolhido. Quem
   * recusa receber produto inativo continua sendo o backend (RNF04).
   */
  async function lerPelaCamera(codigo: string) {
    setCameraLigada(false)
    setProcurando(true)
    try {
      const encontrado = await buscarProdutoPeloCodigo(codigo)
      setLeitura({ codigo, produto: encontrado })
      if (encontrado?.ativo) setProduto(encontrado)
    } catch (falha) {
      avisar.erro(falha, 'Não foi possível procurar o código lido.')
    } finally {
      setProcurando(false)
    }
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
    setRecebido(null)
    if (!produto) return
    setEnviando(true)

    try {
      const resultado = await cadastrarUnidades(produto.id, linhas)
      setRecebido({ resultado, produto })
      setLeitura(null)
      // O toast confirma o clique; o resultado logo abaixo do formulário
      // continua sendo onde estão os códigos e o botão das etiquetas.
      avisar.sucesso(`${resultado.unidades.length} unidade(s) registrada(s).`)
      // O formulário volta ao zero: o próximo recebimento é outro evento, e
      // reenviar o mesmo lote por engano geraria etiquetas duplicadas.
      setLinhas([{ ...LINHA_VAZIA }])
    } catch (falha) {
      // Produto inativo, lote grande demais, sessão expirada: a mensagem é a
      // que o backend escreveu (RNF04).
      avisar.erro(falha, 'Não foi possível registrar o recebimento.')
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
    <section className="tela tela-recebimento">
      <h1>Recebimento</h1>
      <p className="subtitulo">
        Cada unidade recebe um código próprio. Unidades do mesmo produto podem ter validades
        diferentes — adicione uma linha por validade.
      </p>

      <form className="cartao formulario-coluna" onSubmit={registrar}>
        <SeletorProduto valor={produto} aoEscolher={escolherNoSeletor} />

        {cameraDisponivel && (
          <div className="leitura-recebimento">
            {cameraLigada ? (
              <div className="camera">
                <LeitorCamera
                  modo="unica"
                  leitura="codigo-de-barras"
                  aoLer={(codigo) => void lerPelaCamera(codigo)}
                  aoFalhar={falhaDaCamera}
                />
                <button type="button" className="secundario" onClick={() => setCameraLigada(false)}>
                  Desligar câmera
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="secundario"
                onClick={ligarCamera}
                aria-busy={procurando}
                disabled={procurando}
              >
                <Icone nome="camera" />
                {procurando ? 'Procurando o produto…' : 'Ler código de barras'}
              </button>
            )}

            {avisoCamera && (
              <p className="erro" role="alert">
                {avisoCamera}
              </p>
            )}
          </div>
        )}

        {leitura && <NotaDaLeitura leitura={leitura} />}

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

        <button type="submit" aria-busy={enviando} disabled={!podeEnviar || enviando}>
          {enviando ? 'Registrando…' : 'Registrar recebimento'}
        </button>
      </form>

      {recebido && (
        <section className="cartao resultado-recebimento" aria-live="polite">
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
                  <td className="codigo">{unidade.codigoQr}</td>
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

/**
 * O que a leitura do código de barras achou (T48). Inativo e inexistente não
 * escolhem nada, e a nota leva ao Catálogo, que é onde se reativa ou cadastra.
 */
function NotaDaLeitura({ leitura: { codigo, produto } }: { leitura: Leitura }) {
  if (produto?.ativo) {
    return (
      <p className="nota-sucesso" role="status">
        “{produto.nome}” escolhido pelo código de barras <span className="codigo">{codigo}</span>.
      </p>
    )
  }

  return (
    <p className="nota-atencao" role="alert">
      {produto ? (
        <>
          O código <span className="codigo">{codigo}</span> é de “{produto.nome}”, que está inativo e
          não recebe unidades. Reative-o no Catálogo, com “Mostrar inativos”.
        </>
      ) : (
        <>
          Nenhum produto do catálogo tem o código <span className="codigo">{codigo}</span>.
          Cadastre-o no Catálogo antes de receber.
        </>
      )}{' '}
      <Link to={`/produtos?busca=${encodeURIComponent(codigo)}`}>Ir para o Catálogo</Link>
    </p>
  )
}
