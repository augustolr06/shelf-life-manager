import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ImportacaoProdutos } from '../components/ImportacaoProdutos'
import { ErroApi } from '../services/api'
import type { Usuario } from '../services/auth'
import {
  criarProduto,
  inativarProduto,
  listarProdutos,
  reativarProduto,
  type DadosProduto,
  type Produto,
} from '../services/produtos'

const CAMPOS_VAZIOS: DadosProduto = {
  codigoInterno: '',
  nome: '',
  marca: '',
  categoria: '',
}

type Props = {
  usuario: Usuario
}

export function TelaProdutos({ usuario }: Props) {
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [total, setTotal] = useState(0)
  const [tamanhoPagina, setTamanhoPagina] = useState(20)
  const [pagina, setPagina] = useState(1)
  const [busca, setBusca] = useState('')
  const [termoDigitado, setTermoDigitado] = useState('')
  const [incluirInativos, setIncluirInativos] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [novo, setNovo] = useState<DadosProduto>(CAMPOS_VAZIOS)
  const [erroFormulario, setErroFormulario] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // A escrita é restrita a GESTOR (RF02). Esconder o formulário é conveniência
  // de interface, não autorização: quem decide continua sendo o 403 do
  // backend (RNF04), inclusive se esta condição estiver errada.
  const podeEditar = usuario.papel === 'GESTOR'

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const resultado = await listarProdutos({ busca, incluirInativos, pagina })
      setProdutos(resultado.produtos)
      setTotal(resultado.total)
      setTamanhoPagina(resultado.tamanhoPagina)
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível carregar o catálogo.')
    } finally {
      setCarregando(false)
    }
  }, [busca, incluirInativos, pagina])

  useEffect(() => {
    void carregar()
  }, [carregar])

  function buscarProdutos(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    // Volta à primeira página: a página atual pode nem existir no novo filtro.
    setPagina(1)
    setBusca(termoDigitado.trim())
  }

  async function cadastrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErroFormulario(null)
    setSalvando(true)

    try {
      await criarProduto(novo)
      setNovo(CAMPOS_VAZIOS)
      await carregar()
    } catch (falha) {
      // Código interno duplicado chega como 409 com mensagem própria do
      // backend — a tela só exibe o que recebeu.
      setErroFormulario(
        falha instanceof ErroApi ? falha.message : 'Não foi possível cadastrar o produto.',
      )
    } finally {
      setSalvando(false)
    }
  }

  async function alternarSituacao(produto: Produto) {
    setErro(null)
    try {
      const atualizado = produto.ativo
        ? await inativarProduto(produto.id)
        : await reativarProduto(produto.id)

      // Se o produto inativado sai do filtro corrente, recarrega; senão basta
      // trocar a linha no lugar.
      if (!atualizado.ativo && !incluirInativos) {
        await carregar()
        return
      }
      setProdutos((atuais) => atuais.map((p) => (p.id === atualizado.id ? atualizado : p)))
    } catch (falha) {
      setErro(
        falha instanceof ErroApi ? falha.message : 'Não foi possível alterar a situação do produto.',
      )
    }
  }

  const totalPaginas = Math.max(1, Math.ceil(total / tamanhoPagina))

  return (
    <section className="tela-produtos">
      <h2>Catálogo de produtos</h2>

      {podeEditar && (
        <form className="formulario-produto" onSubmit={cadastrar}>
          <h3>Cadastrar produto</h3>

          {(
            [
              ['codigoInterno', 'Código interno'],
              ['nome', 'Nome'],
              ['marca', 'Marca'],
              ['categoria', 'Categoria'],
            ] as const
          ).map(([campo, rotulo]) => (
            <div className="campo" key={campo}>
              <label htmlFor={campo}>{rotulo}</label>
              <input
                id={campo}
                name={campo}
                required
                value={novo[campo]}
                onChange={(evento) =>
                  setNovo((atual) => ({ ...atual, [campo]: evento.target.value }))
                }
              />
            </div>
          ))}

          {erroFormulario && (
            <p className="erro" role="alert">
              {erroFormulario}
            </p>
          )}

          <button type="submit" disabled={salvando}>
            {salvando ? 'Cadastrando…' : 'Cadastrar'}
          </button>
        </form>
      )}

      {podeEditar && <ImportacaoProdutos aoImportar={() => void carregar()} />}

      <form className="filtros" onSubmit={buscarProdutos}>
        <div className="campo">
          <label htmlFor="busca">Buscar por nome ou código</label>
          <input
            id="busca"
            name="busca"
            value={termoDigitado}
            onChange={(evento) => setTermoDigitado(evento.target.value)}
          />
        </div>
        <button type="submit">Buscar</button>
        <label className="caixa-selecao">
          <input
            type="checkbox"
            checked={incluirInativos}
            onChange={(evento) => {
              setPagina(1)
              setIncluirInativos(evento.target.checked)
            }}
          />
          Mostrar produtos inativos
        </label>
      </form>

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      {carregando ? (
        <p role="status">Carregando produtos…</p>
      ) : produtos.length === 0 ? (
        <p>Nenhum produto encontrado.</p>
      ) : (
        <table>
          <caption>
            {total} produto(s) — página {pagina} de {totalPaginas}
          </caption>
          <thead>
            <tr>
              <th scope="col">Código</th>
              <th scope="col">Nome</th>
              <th scope="col">Marca</th>
              <th scope="col">Categoria</th>
              <th scope="col">Situação</th>
              {podeEditar && <th scope="col">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {produtos.map((produto) => (
              <tr key={produto.id} className={produto.ativo ? undefined : 'linha-inativa'}>
                <td>{produto.codigoInterno}</td>
                <td>{produto.nome}</td>
                <td>{produto.marca}</td>
                <td>{produto.categoria}</td>
                <td>{produto.ativo ? 'Ativo' : 'Inativo'}</td>
                {podeEditar && (
                  <td>
                    <button type="button" onClick={() => void alternarSituacao(produto)}>
                      {produto.ativo ? 'Inativar' : 'Reativar'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
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
