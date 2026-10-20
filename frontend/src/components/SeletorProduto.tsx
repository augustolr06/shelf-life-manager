import { useCombobox, type UseComboboxState, type UseComboboxStateChangeOptions } from 'downshift'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useValorComAtraso } from '../hooks/useValorComAtraso'
import { ErroApi } from '../services/api'
import { listarProdutos, type Produto } from '../services/produtos'

/**
 * Escolha de produto num campo só, com filtro (T28): digita-se, a lista
 * filtra no servidor, e escolhe-se um item. Usado no Recebimento e nas
 * Etiquetas, que até T28 tinham um campo de busca com botão e um `<select>`
 * separado para o resultado.
 *
 * O valor do componente é **o produto escolhido**, nunca o texto digitado:
 * editar o texto depois de escolher desfaz a escolha, e sair do campo sem
 * escolher apaga o texto. Não existe "produto digitado" que chegue ao
 * servidor.
 *
 * O padrão WAI-ARIA de combobox (foco, teclado, `aria-activedescendant`) vem
 * do `useCombobox` do downshift (T28, Decisão 1); o visual é do projeto.
 *
 * Só aparecem produtos ativos, que é o padrão de `GET /produtos` (T28,
 * Decisão 2): o backend recusa receber unidade de produto inativo.
 */

type Props = {
  valor: Produto | null
  aoEscolher: (produto: Produto | null) => void
}

const { stateChangeTypes } = useCombobox

function nomeDoProduto(produto: Produto | null): string {
  return produto?.nome ?? ''
}

/**
 * Ajustes ao comportamento padrão do downshift.
 *
 * - **Sair do campo não escolhe nada.** O padrão escolhe o item destacado ao
 *   perder o foco, e um item fica destacado só por o mouse ter passado por
 *   cima dele. Escolher é clique, toque ou Enter.
 * - **Clicar no campo abre a lista, e não alterna.** O foco já abre (ver
 *   `onFocus`), e o clique que vem logo depois do foco fecharia de novo.
 * - **Desfazer a escolha não apaga o texto.** Quando `valor` vira `null`, o
 *   padrão troca o texto pelo nome do "nenhum produto", que é vazio — e a
 *   escolha é desfeita justamente porque alguém está editando o texto.
 */
function ajustarEstado(
  estado: UseComboboxState<Produto>,
  { type, changes }: UseComboboxStateChangeOptions<Produto>,
): Partial<UseComboboxState<Produto>> {
  switch (type) {
    case stateChangeTypes.InputBlur:
      return { ...changes, selectedItem: estado.selectedItem, inputValue: estado.inputValue }
    case stateChangeTypes.InputClick:
      return { ...changes, isOpen: true, highlightedIndex: estado.highlightedIndex }
    case stateChangeTypes.ControlledPropUpdatedSelectedItem:
      return estado.selectedItem ? changes : { ...changes, inputValue: estado.inputValue }
    default:
      return changes
  }
}

export function SeletorProduto({ valor, aoEscolher }: Props) {
  // `termo` é o que foi **digitado**, e não o que está na caixa: escolher um
  // item troca o texto pelo nome do produto, mas não dispara busca por ele.
  const [termo, setTermo] = useState('')
  const busca = useValorComAtraso(termo.trim())

  // `null` até a primeira resposta: depois dela, a lista anterior fica aberta
  // enquanto a próxima carrega, como no Catálogo (T26).
  const [produtos, setProdutos] = useState<Produto[] | null>(null)
  const [total, setTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const ultimaConsulta = useRef(0)

  const carregar = useCallback(async (termoDaBusca: string) => {
    // Só a consulta mais recente mexe na lista (T26, Decisão 3).
    const consulta = ++ultimaConsulta.current
    const ehAtual = () => consulta === ultimaConsulta.current

    setCarregando(true)
    setErro(null)
    try {
      const resultado = await listarProdutos({ busca: termoDaBusca })
      if (!ehAtual()) return
      setProdutos(resultado.produtos)
      setTotal(resultado.total)
    } catch (falha) {
      if (!ehAtual()) return
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível carregar o catálogo.')
    } finally {
      if (ehAtual()) setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar(busca)
  }, [busca, carregar])

  // Com erro, a lista anterior sai de vista: ela é de outro termo, e
  // aparecer embaixo do texto novo a faria passar por resultado dele.
  const itens = erro ? [] : (produtos ?? [])

  const {
    isOpen,
    highlightedIndex,
    getLabelProps,
    getInputProps,
    getMenuProps,
    getItemProps,
    openMenu,
    setInputValue,
  } = useCombobox<Produto>({
    items: itens,
    itemToString: nomeDoProduto,
    itemToKey: (produto) => produto?.id,
    selectedItem: valor,
    // O texto da caixa fica com o downshift, e não num estado daqui: ele avisa
    // as mudanças num efeito, depois de renderizar, e um texto controlado seria
    // reposto ao valor antigo entre duas teclas — digitando rápido, a segunda
    // tecla se perdia (visto no navegador; o jsdom não reproduz).
    initialInputValue: nomeDoProduto(valor),
    stateReducer: ajustarEstado,
    onSelectedItemChange: ({ selectedItem }) => aoEscolher(selectedItem ?? null),
    onInputValueChange: ({ type, inputValue }) => {
      if (type === stateChangeTypes.InputChange || type === stateChangeTypes.InputKeyDownEscape) {
        setTermo(inputValue)
      }
      // Editar o texto desfaz a escolha: o nome que está na caixa deixou de ser
      // o de um produto.
      if (type === stateChangeTypes.InputChange && valor) aoEscolher(null)
    },
  })

  function aoSairDoCampo() {
    // Só a saída de verdade chega aqui: o downshift impede que o clique num
    // item tire o foco do campo, e a lista e o "Tentar de novo" também.
    if (valor) return
    setInputValue('')
    setTermo('')
  }

  function tentarDeNovo() {
    void carregar(busca)
    openMenu()
  }

  return (
    <div className="campo seletor-produto">
      <label {...getLabelProps()}>Produto</label>
      <div className="seletor-produto-caixa">
        <input
          {...getInputProps({
            onFocus: () => {
              if (!isOpen) openMenu()
            },
            onBlur: aoSairDoCampo,
          })}
          placeholder="Digite o nome ou o código"
          // Espelho do `maxLength` de `busca` na listagem de produtos, como no
          // campo de busca do Catálogo (T26).
          maxLength={120}
          autoComplete="off"
        />

        {/* A lista fica sempre no DOM (o downshift precisa da referência), e só
            mostra conteúdo aberta. Os avisos ficam fora do `listbox`, que só pode
            conter opções. */}
        <div
          className="seletor-produto-lista"
          // Com erro, a lista some para não cobrir o aviso, que fica logo abaixo.
          hidden={!isOpen || erro !== null}
          // Clicar num aviso ou no rodapé não tira o foco do campo — o que, sem
          // produto escolhido, apagaria o texto.
          onMouseDown={(evento) => evento.preventDefault()}
        >
          <ul {...getMenuProps({ 'aria-label': 'Produtos encontrados' })}>
            {isOpen &&
              itens.map((produto, indice) => (
                <li
                  key={produto.id}
                  className={[
                    'seletor-produto-opcao',
                    indice === highlightedIndex && 'destacada',
                    produto.id === valor?.id && 'escolhida',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  {...getItemProps({ item: produto, index: indice })}
                >
                  {/* Nome, marca e código: dois produtos com o mesmo nome precisam
                      ser distinguíveis na lista. */}
                  <span className="seletor-produto-nome">{produto.nome}</span>
                  <span className="seletor-produto-detalhe">
                    {produto.marca} · {produto.codigoInterno}
                  </span>
                </li>
              ))}
          </ul>

          {isOpen && (
            <div className="seletor-produto-situacao" aria-live="polite">
              {carregando && produtos === null && <p>Carregando catálogo…</p>}
              {carregando && produtos !== null && <p>Carregando…</p>}
              {!carregando && !erro && itens.length === 0 && (
                <p>Nenhum produto ativo encontrado.</p>
              )}
              {!carregando && total > itens.length && (
                <p>
                  Mostrando {itens.length} de {total} — continue digitando para refinar.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {erro && (
        <div className="erro seletor-produto-erro" role="alert">
          <span>{erro}</span>{' '}
          <button
            type="button"
            className="secundario"
            // Sem tirar o foco do campo, para o texto digitado continuar lá.
            onMouseDown={(evento) => evento.preventDefault()}
            onClick={tentarDeNovo}
          >
            Tentar de novo
          </button>
        </div>
      )}
    </div>
  )
}
