import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { rotuloPapel, type Usuario } from '../services/auth'
import { Icone, type NomeIcone } from './Icone'

/**
 * Navegação por tarefa (T41), da especificação do redesign
 * (`docs/redesign/claude-design/README.md`, "Navegação"): menu lateral no
 * computador, o mesmo menu recolhido aos ícones no tablet, e barra inferior
 * com a folha "Mais" no celular. Qual dos dois aparece é o `App` quem decide,
 * com `useFormatoDaTela`.
 *
 * Os itens chegam já filtrados pelo papel. Esconder item é conveniência de
 * interface; quem recusa de fato é o 403 do backend (RNF04).
 */

/** Na ordem em que aparecem no menu. */
export const GRUPOS = ['Operação', 'Validade', 'Gestão'] as const
export type GrupoMenu = (typeof GRUPOS)[number]

export type Distintivo = 'alertasNaoLidos' | 'descartesPendentes'
export type Contagens = Record<Distintivo, number>

export type ItemMenu = {
  caminho: string
  rotulo: string
  /**
   * Sem grupo, a tela não entra na lista do menu: ela é alcançada por outro
   * lugar, como a "Minha senha", que fica no rodapé do usuário. A exceção é
   * `noTopo`.
   */
  grupo?: GrupoMenu
  /** Fora dos grupos e acima deles, como o Início (T42). */
  noTopo?: boolean
  icone: NomeIcone
  /** Contagem ao lado do rótulo, quando houver o que mostrar. */
  distintivo?: Distintivo
  /**
   * Atalho próprio na barra inferior do celular, com rótulo e ícone que
   * cabem nela. Quem não tem atalho vai para a folha "Mais".
   */
  barraInferior?: {
    rotulo: string
    icone: NomeIcone
    /** Outras rotas em que o atalho aparece marcado. */
    ativoTambemEm?: readonly string[]
  }
}

/** Alertas em laranja e descarte em vermelho, como na especificação. */
const DISTINTIVOS: Record<Distintivo, { classe: string; descrever: (n: number) => string }> = {
  alertasNaoLidos: {
    classe: 'distintivo-alerta',
    descrever: (n) => `${n} alerta(s) não lido(s)`,
  },
  descartesPendentes: {
    classe: 'distintivo-perigo',
    descrever: (n) => `${n} unidade(s) na fila de descarte`,
  },
}

type PropsContador = {
  item: ItemMenu
  contagens: Contagens
  /** Pílula cheia por cima do ícone, onde não há espaço ao lado do rótulo. */
  sobreIcone?: boolean
  /** As abas de validade mostram a contagem mesmo quando ela é zero. */
  mostrarZero?: boolean
}

function Contador({ item, contagens, sobreIcone = false, mostrarZero = false }: PropsContador) {
  if (!item.distintivo) return null
  const quantidade = contagens[item.distintivo]
  if (quantidade <= 0 && !mostrarZero) return null
  const { classe, descrever } = DISTINTIVOS[item.distintivo]
  return (
    <span
      className={`distintivo ${classe}${sobreIcone ? ' distintivo-sobre-icone' : ''}`}
      aria-label={descrever(quantidade)}
    >
      {quantidade}
    </span>
  )
}

/**
 * O nome do item quando o rótulo não está escrito ao lado do ícone (menu
 * recolhido) ou não vem antes da contagem (barra inferior, em que o número
 * fica em cima do ícone).
 */
function nomeAcessivel(rotulo: string, item: ItemMenu, contagens: Contagens): string {
  if (!item.distintivo || contagens[item.distintivo] <= 0) return rotulo
  return `${rotulo}, ${DISTINTIVOS[item.distintivo].descrever(contagens[item.distintivo])}`
}

type PropsGrupos = {
  itens: readonly ItemMenu[]
  contagens: Contagens
  recolhido?: boolean
  aoNavegar?: () => void
}

function GruposDoMenu({ itens, contagens, recolhido = false, aoNavegar }: PropsGrupos) {
  const idBase = useId()
  const doTopo = itens.filter((item) => item.noTopo)

  const itemDoMenu = (item: ItemMenu) => (
    <li key={item.caminho}>
      <NavLink
        to={item.caminho}
        // `end` para que `/alertas` não fique marcada como ativa
        // enquanto a tela aberta é `/alertas/configuracao`.
        end
        className={({ isActive }) => (isActive ? 'item-menu ativo' : 'item-menu')}
        title={recolhido ? item.rotulo : undefined}
        aria-label={recolhido ? nomeAcessivel(item.rotulo, item, contagens) : undefined}
        onClick={aoNavegar}
      >
        <span className="icone-do-item">
          <Icone nome={item.icone} />
          {recolhido && <Contador item={item} contagens={contagens} sobreIcone />}
        </span>
        {!recolhido && (
          <>
            <span className="rotulo-item">{item.rotulo}</span>
            <Contador item={item} contagens={contagens} />
          </>
        )}
      </NavLink>
    </li>
  )

  return (
    <>
      {doTopo.length > 0 && (
        <div className="grupo-menu">
          <ul>{doTopo.map(itemDoMenu)}</ul>
        </div>
      )}
      {GRUPOS.map((grupo, indice) => {
        const doGrupo = itens.filter((item) => item.grupo === grupo)
        // Grupo sem item que o papel alcance não aparece.
        if (doGrupo.length === 0) return null
        const idRotulo = `${idBase}-grupo-${indice}`

        return (
          <div key={grupo} className="grupo-menu">
            {/* Recolhido aos ícones, o nome do grupo some da vista mas continua
                dando nome à lista para o leitor de tela. */}
            <span id={idRotulo} className={recolhido ? 'visualmente-oculto' : 'rotulo-grupo'}>
              {grupo}
            </span>
            <ul aria-labelledby={idRotulo}>{doGrupo.map(itemDoMenu)}</ul>
          </div>
        )
      })}
    </>
  )
}

/** "Gestora de Loja" → "GL". */
function iniciais(nome: string): string {
  const palavras = nome.trim().split(/\s+/).filter(Boolean)
  const primeira = palavras[0]?.[0] ?? ''
  const ultima = palavras.length > 1 ? (palavras.at(-1)?.[0] ?? '') : ''
  return `${primeira}${ultima}`.toUpperCase()
}

type PropsRodape = {
  usuario: Usuario
  aoSair: () => void
  recolhido?: boolean
  aoNavegar?: () => void
}

/**
 * Quem está logado, a troca da própria senha e o sair. Desde T41 é o único
 * lugar em que aparecem: a barra do topo, que os mostrava, saiu.
 */
function RodapeUsuario({ usuario, aoSair, recolhido = false, aoNavegar }: PropsRodape) {
  const sair = (
    <button
      type="button"
      className="secundario botao-icone"
      aria-label="Sair"
      title="Sair"
      onClick={aoSair}
    >
      <Icone nome="sair" />
    </button>
  )

  if (recolhido) {
    return (
      <div className="rodape-usuario recolhido">
        <NavLink
          to="/minha-senha"
          end
          className={({ isActive }) => (isActive ? 'item-menu ativo' : 'item-menu')}
          title="Minha senha"
          aria-label={`Minha senha (${usuario.nome}, ${rotuloPapel(usuario.papel)})`}
          onClick={aoNavegar}
        >
          <span className="icone-do-item">
            <Icone nome="senha" />
          </span>
        </NavLink>
        {sair}
      </div>
    )
  }

  return (
    <div className="rodape-usuario">
      <span className="iniciais" aria-hidden="true">
        {iniciais(usuario.nome)}
      </span>
      <span className="identidade-usuario">
        <span className="nome-usuario">{usuario.nome}</span>
        <span className="papel-usuario">
          {rotuloPapel(usuario.papel)} ·{' '}
          <Link to="/minha-senha" onClick={aoNavegar}>
            Minha senha
          </Link>
        </span>
      </span>
      {sair}
    </div>
  )
}

type PropsNavegacao = {
  itens: readonly ItemMenu[]
  contagens: Contagens
  usuario: Usuario
  aoSair: () => void
}

/**
 * Menu lateral do computador e do tablet. No tablet (`recolhivel`) ele fica
 * nos ícones e abre por cima do conteúdo ao tocar no botão de menu; escolher
 * um item, o Esc ou um toque fora fecham de novo.
 */
export function MenuLateral({
  itens,
  contagens,
  usuario,
  aoSair,
  recolhivel,
}: PropsNavegacao & { recolhivel: boolean }) {
  const [expandido, setExpandido] = useState(false)
  const recolhido = recolhivel && !expandido
  const sobreposto = recolhivel && expandido

  // Do tablet para o computador e de volta: o menu volta recolhido, e não
  // aberto por cima do conteúdo como estava antes da troca.
  useEffect(() => {
    if (!recolhivel) setExpandido(false)
  }, [recolhivel])

  useEffect(() => {
    if (!sobreposto) return
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setExpandido(false)
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [sobreposto])

  const fechar = recolhivel ? () => setExpandido(false) : undefined
  const classes = ['menu-lateral', recolhido && 'recolhido', sobreposto && 'sobreposto']

  return (
    <>
      <nav className={classes.filter(Boolean).join(' ')} aria-label="Menu principal">
        <div className="marca">
          <span className="marca-simbolo">
            <Icone nome="marca" tamanho={20} />
          </span>
          {/* O nome do app (T46). O `short_name` do manifest é mais curto,
              "ShelfLife", porque embaixo do ícone do celular não cabe. */}
          <span className={recolhido ? 'visualmente-oculto' : 'marca-texto'}>
            <span className="marca-nome">ShelfLife Manager</span>
            <span className="marca-lema">Primeiro que vence, primeiro que sai</span>
          </span>
        </div>

        {recolhivel && (
          <button
            type="button"
            className="fantasma botao-icone botao-menu"
            aria-label="Menu"
            title={expandido ? 'Recolher menu' : 'Mostrar nomes do menu'}
            aria-expanded={expandido}
            onClick={() => setExpandido((atual) => !atual)}
          >
            <Icone nome={expandido ? 'fechar' : 'menu'} />
          </button>
        )}

        <GruposDoMenu
          itens={itens}
          contagens={contagens}
          recolhido={recolhido}
          aoNavegar={fechar}
        />

        <RodapeUsuario
          usuario={usuario}
          aoSair={aoSair}
          recolhido={recolhido}
          aoNavegar={fechar}
        />
      </nav>

      {/* Um toque fora fecha o menu aberto. Só para o dedo: no teclado, o
          Esc e o próprio botão de menu fazem o mesmo. */}
      {sobreposto && <div className="veu-menu" aria-hidden="true" onClick={fechar} />}
    </>
  )
}

/**
 * Barra inferior do celular: os atalhos que têm `barraInferior`, e o "Mais",
 * que abre a folha com o resto do menu e o rodapé do usuário.
 */
export function BarraInferior({ itens, contagens, usuario, aoSair }: PropsNavegacao) {
  const { pathname } = useLocation()
  const [folhaAberta, setFolhaAberta] = useState(false)
  const botaoMais = useRef<HTMLButtonElement>(null)

  const atalhos = itens.filter((item) => item.barraInferior)
  const restantes = itens.filter((item) => !item.barraInferior)
  const algumAtalhoAtivo = atalhos.some(
    (item) =>
      item.caminho === pathname || item.barraInferior?.ativoTambemEm?.includes(pathname),
  )

  // O foco volta a quem abriu a folha, como num diálogo; sem isso ele cairia
  // no início da página. Num efeito, depois de a folha sair do DOM: enquanto
  // o `<dialog>` modal está aberto, o resto da página é inerte, e o `focus()`
  // no "Mais" não pega.
  const folhaEstavaAberta = useRef(false)
  useEffect(() => {
    if (folhaAberta) {
      folhaEstavaAberta.current = true
    } else if (folhaEstavaAberta.current) {
      folhaEstavaAberta.current = false
      botaoMais.current?.focus()
    }
  }, [folhaAberta])

  const fecharFolha = () => setFolhaAberta(false)

  return (
    <>
      <nav className="barra-inferior" aria-label="Menu principal">
        {atalhos.map((item) => {
          const atalho = item.barraInferior!
          const naPropriaRota = item.caminho === pathname
          const ativo = naPropriaRota || atalho.ativoTambemEm?.includes(pathname) === true
          return (
            <Link
              key={item.caminho}
              to={item.caminho}
              className={ativo ? 'item-barra ativo' : 'item-barra'}
              // "Validade" em `/alertas`: marcada, mas o link leva ao
              // descarte, então ela é o item atual do conjunto, não a página.
              aria-current={naPropriaRota ? 'page' : ativo ? 'true' : undefined}
              aria-label={nomeAcessivel(atalho.rotulo, item, contagens)}
            >
              <span className="icone-do-item">
                <Icone nome={atalho.icone} tamanho={22} />
                <Contador item={item} contagens={contagens} sobreIcone />
              </span>
              {atalho.rotulo}
            </Link>
          )
        })}
        <button
          ref={botaoMais}
          type="button"
          // Marcado quando a tela aberta é uma das que só a folha alcança.
          className={algumAtalhoAtivo ? 'item-barra' : 'item-barra ativo'}
          aria-haspopup="dialog"
          aria-expanded={folhaAberta}
          onClick={() => setFolhaAberta(true)}
        >
          <span className="icone-do-item">
            <Icone nome="menu" tamanho={22} />
          </span>
          Mais
        </button>
      </nav>

      <FolhaMais
        aberta={folhaAberta}
        aoFechar={fecharFolha}
        itens={restantes}
        contagens={contagens}
        usuario={usuario}
        aoSair={aoSair}
      />
    </>
  )
}

/**
 * A folha "Mais", de baixo para cima, sobre o `<dialog>` nativo como o
 * `Dialogo` de T30: `showModal()` deixa a tela de trás inerte e prende o foco
 * na folha. Esc, toque fora, o botão fechar e escolher um item fecham.
 */
function FolhaMais({
  aberta,
  aoFechar,
  itens,
  contagens,
  usuario,
  aoSair,
}: PropsNavegacao & { aberta: boolean; aoFechar: () => void }) {
  const referencia = useRef<HTMLDialogElement>(null)
  const idTitulo = useId()

  useEffect(() => {
    const folha = referencia.current
    if (!aberta || !folha || folha.open) return
    folha.showModal()
    folha.querySelector<HTMLElement>('.fechar-folha')?.focus()
  }, [aberta])

  if (!aberta) return null

  return (
    <dialog
      ref={referencia}
      className="folha"
      aria-labelledby={idTitulo}
      // Esc tratado na tecla, pelo mesmo motivo do `Dialogo`: o Chrome ignora
      // o `preventDefault` do `cancel` repetido.
      onKeyDown={(evento) => {
        if (evento.key !== 'Escape') return
        evento.preventDefault()
        aoFechar()
      }}
      onCancel={(evento) => {
        evento.preventDefault()
        aoFechar()
      }}
      // O conteúdo ocupa a folha inteira; clique no próprio `<dialog>` foi no
      // fundo escurecido.
      onClick={(evento) => {
        if (evento.target === evento.currentTarget) aoFechar()
      }}
    >
      <div className="folha-conteudo">
        <div className="folha-cabecalho">
          <h2 id={idTitulo}>Mais</h2>
          <button
            type="button"
            className="fantasma botao-icone fechar-folha"
            aria-label="Fechar"
            onClick={aoFechar}
          >
            <Icone nome="fechar" />
          </button>
        </div>
        <nav aria-label="Outras telas">
          <GruposDoMenu itens={itens} contagens={contagens} aoNavegar={aoFechar} />
        </nav>
        <RodapeUsuario usuario={usuario} aoSair={aoSair} aoNavegar={aoFechar} />
      </div>
    </dialog>
  )
}

/** As duas telas de validade, na ordem das abas. */
const ABAS_VALIDADE = ['/descartes', '/alertas'] as const

/**
 * No celular, o atalho "Validade" leva ao descarte, e os alertas ficam a uma
 * aba de distância: o seletor Descarte | Alertas no topo das duas telas.
 *
 * São links, e não `role="tab"` como no mockup: trocar de aba troca de rota,
 * e o padrão de abas do ARIA promete trocar o painel no lugar, com as setas.
 */
export function AbasValidade({
  itens,
  contagens,
}: {
  itens: readonly ItemMenu[]
  contagens: Contagens
}) {
  const { pathname } = useLocation()
  const abas = ABAS_VALIDADE.flatMap((caminho) =>
    itens.filter((item) => item.caminho === caminho),
  )

  if (abas.length < ABAS_VALIDADE.length) return null
  if (!abas.some((item) => item.caminho === pathname)) return null

  return (
    <nav className="abas-validade" aria-label="Validade">
      {abas.map((item) => (
        <NavLink
          key={item.caminho}
          to={item.caminho}
          end
          className={({ isActive }) => (isActive ? 'aba-validade ativa' : 'aba-validade')}
        >
          {item.rotulo}
          <Contador item={item} contagens={contagens} mostrarZero />
        </NavLink>
      ))}
    </nav>
  )
}
