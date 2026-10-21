/**
 * Ícones de traço do menu (T41), da Venda (T43) e do Catálogo (T45), copiados dos mockups da especificação do
 * redesign (`docs/redesign/claude-design/telas/`). SVG inline, sem biblioteca:
 * são poucos, e o PWA abre offline (RNF07) sem precisar de arquivo à parte.
 *
 * Todo ícone é `aria-hidden`: ele sempre acompanha um texto, visível ou no
 * `aria-label` de quem o contém.
 */
const TRACOS = {
  marca: <path d="M5 18h14M5 13h10M5 8h6" />,
  inicio: <path d="M4 11l8-7 8 7v9h-5v-6h-6v6H4z" />,
  venda: (
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" />
  ),
  consultar: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  recebimento: <path d="M3 13h5l1 3h6l1-3h5M5 5h14l2 8v6H3v-6z" />,
  etiquetas: (
    <>
      <path d="M20 12l-8 8-8-8V4h8z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  alertas: <path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />,
  descarte: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  validade: (
    <>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 9.5V13l2.5 2M9 3h6" />
    </>
  ),
  relatorios: <path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" />,
  catalogo: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  contas: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.8-1.6-5-4-5.8" />
    </>
  ),
  configurar: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  // Estes dois não estão nos mockups: a chave da "Minha senha" no menu
  // recolhido do tablet, e o fechar da folha "Mais".
  senha: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2" />
    </>
  ),
  fechar: <path d="M6 6l12 12M18 6L6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  sair: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  // Venda (T43): o botão da câmera e o estado de cada item do carrinho. O de
  // atenção não está no mockup; é o do item que a confirmação não vendeu.
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  confirmado: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  atencao: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </>
  ),
  // Catálogo (T45): os botões do cabeçalho e o menu "…" da linha.
  importar: <path d="M12 15V4M8 8l4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />,
  novo: <path d="M12 5v14M5 12h14" />,
  maisAcoes: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
} as const

export type NomeIcone = keyof typeof TRACOS

export function Icone({ nome, tamanho = 18 }: { nome: NomeIcone; tamanho?: number }) {
  return (
    <svg
      className="icone"
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {TRACOS[nome]}
    </svg>
  )
}
