# Redesign — especificação (proposta do Claude Design, 2026-10-21)

**Este documento é a fonte de verdade do redesign.** Ele substitui o escopo de T36, T37 e T38
(marcadas como `substituída` no backlog em 2026-10-21, por decisão do orientando). O que
estava naquelas tarefas e não está aqui **não** faz parte do redesign; se for preciso, vira
tarefa nova. A implementação está dividida em T40–T45 (`tasks/`), e cada tarefa remete às
seções daqui.

A proposta foi feita com o Claude a partir do app em produção (gestor, 2026-10-21), depois de
T35. Os tokens e componentes de T35 continuam sendo a base técnica (CSS próprio com variáveis,
classes de tom); o que muda são os **valores**, o **layout** e a **navegação** descritos abaixo.

## O que tem nesta pasta

| Arquivo | O que mostra |
|---|---|
| `telas/inicio.html` | Tela Início do gestor (computador), com o menu lateral agrupado |
| `telas/catalogo.html` | Catálogo de produtos (computador): lista primeiro, cadastro em painel |
| `telas/venda-celular.html` | Venda no celular (390 × 844), com a barra inferior |
| `telas/descarte-celular.html` | Fila de descarte no celular, em lista compacta |
| `telas/linguagem-visual.html` | Escala de validade, cores base, tipografia e agrupamento do menu |

As telas são HTML estático com estilo inline e abrem direto no navegador
(`playwright-cli open file://…/docs/redesign/claude-design/telas/inicio.html`). São mockups:
os dados vêm do banco de produção de 2026-10-21 sem o prefixo "TESTE", e o código
`PRF-XXXXXX` do carrinho é ilustrativo. O HTML **não** é para ser copiado para o React: o que
vale é o layout, a hierarquia e os valores desta especificação, aplicados com os tokens e as
classes de `frontend/src/estilos.css`. Quando o mockup e este texto divergirem, vale o texto.

## Regras que continuam valendo

- O fluxo do `CLAUDE.md`: uma tarefa por vez (T40 → T41 → as demais), testes verdes,
  conferência com `playwright-cli`, commit, backlog atualizado, decisões em
  `docs/decisoes.md`.
- As regras inegociáveis. Em especial a **RNF04**: faixa de validade, dias para vencer e
  contagens vêm sempre do servidor. Nenhum card, distintivo ou cor desta especificação nasce de
  comparação de datas no navegador. Onde a tela ainda não recebe o dado pronto, a tarefa
  acrescenta o campo no backend (está dito em cada uma).
- As regras de papel de `TELAS` (`App.tsx`) e do backend não mudam: item de menu, botão ou tela
  que o papel não alcança não aparece.
- Os comportamentos de T29 (toasts), T30 (sessão expirada), T31 (leitura única), T34
  (carrinho) e T39 (confirmação) não mudam: só a aparência.

## Decisões fixadas por esta proposta

Cada uma revisa uma decisão de T35 e está registrada em `docs/decisoes.md` (2026-10-21).

1. **Vencida é vermelha.** O tom roxo `vencido` de T35 deixa de existir como cor própria: a
   unidade vencida é a primeira faixa da escala de validade, em vermelho. A classe
   `tom-vencido` e as classes de domínio dela podem continuar existindo (para não quebrar
   teste), apontando para as cores da faixa vencida.
2. **Escala de validade em cinco faixas**, as mesmas que o servidor já devolve no dashboard
   (`VENCIDA`, `ATE_7_DIAS`, `DE_8_A_30_DIAS`, `DE_31_A_90_DIAS`, `ACIMA_DE_90_DIAS`), cada uma
   com cor própria (tabela abaixo).
3. **Fontes Manrope (texto) e JetBrains Mono (códigos)**, empacotadas no build com
   `@fontsource/manrope` e `@fontsource/jetbrains-mono`. Nunca pelo Google Fonts: o PWA precisa
   abrir offline (RNF07), e o arquivo da fonte entra no cache do service worker como o resto.
4. **Sem barra verde no topo.** No computador, a marca e o usuário vão para o menu lateral; no
   celular, cada tela começa pelo próprio título. `theme_color` e `<meta name="theme-color">`
   passam a ser o fundo da página (`#F6F7F5`), para a barra de status do celular emendar no
   app. O ícone do PWA não muda.
5. **Gestor começa no Início.** `rotaInicial` passa a mandar o gestor para `/inicio`; a
   atendente continua em `/venda`.
6. **Borda de controle `#66726E`** (5,00:1 sobre branco) em campos, botões secundários,
   filtros e botões de paginação. Mantém o critério de T35 para o balcão ao sol.
7. **O app se chama ShelfLife Manager** (decisão do orientando, 2026-10-21), no lugar de
   "Controle de Estoque FIFO por Validade" e "Estoque FIFO". É o nome na marca do menu, no
   login, no título da aba e no manifest do PWA (`short_name` "ShelfLife", que cabe embaixo do
   ícone na tela inicial do celular). O lema "Primeiro que vence, primeiro que sai" continua.
   Implementação em T46.

## Linguagem visual

### Cores base

| Token | Valor novo | Valor de T35 | Uso | Contraste |
|---|---|---|---|---|
| `--cor-primaria` | `#0F5C52` | `#0f766e` | botões primários, item ativo, marca | branco sobre ela 7,86:1 |
| `--cor-primaria-escura` | `#0A3F38` | `#115e59` | hover de link e de botão primário | |
| `--cor-primaria-suave` | `#E3F0EC` | `#f0fdfa` | fundo do item ativo do menu | primária sobre ela 6,71:1 |
| `--cor-texto` | `#16201E` | `#1f2937` | texto | 15,52:1 sobre o fundo |
| `--cor-texto-suave` | `#5B6763` | `#4b5563` | apoio, legendas, rótulos de grupo | 5,48:1 sobre o fundo, 5,89:1 sobre branco |
| `--cor-texto-menu` *(novo)* | `#3B4643` | — | itens do menu não ativos | 9,80:1 sobre branco |
| `--cor-fundo` | `#F6F7F5` | `#f3f4f6` | fundo da página | |
| `--cor-superficie` | `#FFFFFF` | `#ffffff` | cartões, menu lateral, barra inferior | |
| `--cor-borda` | `#E2E6E3` | `#d1d5db` | borda de cartão, divisórias | decorativa |
| `--cor-borda-campo` | `#66726E` | `#6b7280` | borda de controle (decisão 6) | 5,00:1 sobre branco |
| `--cor-barra` | sai | `#115e59` | (decisão 4) | |

`--cor-foco` (`#1d4ed8`) e o anel de foco de T35 continuam como estão.

### Escala de validade

| Faixa (servidor) | Rótulo | Distintivo: texto / fundo | Contraste | Cor na barra do estoque |
|---|---|---|---|---|
| `VENCIDA` | Vencida | `#A8231A` / `#FDECEA` | 6,29:1 | `#C4321F` |
| `ATE_7_DIAS` | Até 7 dias | `#9A3C06` / `#FEF0E1` | 6,21:1 | `#E0731A` |
| `DE_8_A_30_DIAS` | 8 a 30 dias | `#7A5600` / `#FDF6DC` | 6,14:1 | `#E3A92B` |
| `DE_31_A_90_DIAS` | 31 a 90 dias | `#1F6F4A` / `#E6F3EC` | 5,36:1 | `#6FA89A` |
| `ACIMA_DE_90_DIAS` | +90 dias | `#0F5C52` / `#E3F0EC` | 6,71:1 | `#0F5C52` |

- Botão de ação sobre a faixa vencida ("Resolver descarte"): texto branco sobre `#A8231A`
  (7,19:1). É o mesmo vermelho da variante `perigo` de botão, que passa a usar estes valores.
- Os tons semânticos de T35 se alinham à escala: `perigo` = faixa vencida; `atencao` = faixa
  8 a 30 dias (é a "janela de alerta"); `sucesso` = faixa 31 a 90 dias. `inativo` continua
  neutro.
- As cores da barra empilhada ficam abaixo de 3:1 sobre branco nas faixas do meio. Isso só é
  aceitável porque a barra **nunca aparece sem a legenda**, que repete cada faixa com nome e
  número.
- O distintivo diz o estado em texto ("Vencida", "há 49 dias", "vence em 16 dias"), nunca só
  pela cor.

### Tipografia

| Elemento | Computador | Celular |
|---|---|---|
| Título de tela | 30 px / 800, espaçamento −0,02em | 24 px / 800 |
| Título de seção e de cartão | 16 px / 800 | 16 px / 800 |
| Corpo | 14 px / 500 | 15 px / 500 |
| Rótulo de grupo do menu | 11 px / 700, caixa alta, espaçamento 0,08em | idem |
| Item do menu | 14 px / 600 (ativo 700) | 12 px / 700 na barra inferior |
| Número em destaque | 36–40 px / 800, rótulo ao lado em 14 px / 600 | 32 px / 800 |
| Distintivo | 12 px / 800 | 12 px / 800 |
| Códigos (`PRF-…`, `ZZ-…`) | JetBrains Mono 13 px / 500 | JetBrains Mono 12–16 px |

### Espaçamento e forma

- Escala de T35 (4/8/12/16/24/32), mais 40 px de margem lateral do conteúdo no computador e
  20 px no celular.
- Raio: 14 px em cartões, 10 px em botões e campos, 12 px no campo de código da Venda, pílula
  em distintivos e filtros.
- Cartões **sem sombra**: borda de 1 px em `--cor-borda` sobre fundo branco.
- Alvo de toque de 44 px em tudo que é clicável (`--alvo-toque`); 48 px no campo e no botão
  "Ler" da Venda, 52 px no botão de confirmar a venda.
- Ícones de traço (2 px, cantos arredondados), 18 px no menu e nos botões, 22 px na barra
  inferior. Ícone sozinho sempre com `aria-label`.

## Navegação

O menu agrupa as telas por tarefa. Grupos e itens respeitam os `papeis` de `TELAS`: item que o
papel não alcança não aparece, e grupo vazio também não.

| Grupo | Item | Rota | Papéis | Distintivo |
|---|---|---|---|---|
| — | Início | `/inicio` *(nova)* | GESTOR | |
| Operação | Venda | `/venda` | ATENDENTE, GESTOR | |
| Operação | Consultar produto | `/consulta` | ATENDENTE, GESTOR | |
| Operação | Recebimento | `/recebimento` | GESTOR | |
| Operação | Etiquetas | `/etiquetas` | GESTOR | |
| Validade | Alertas | `/alertas` | GESTOR | não lidos (já existe, T19), laranja |
| Validade | Descarte | `/descartes` | GESTOR | unidades na fila, vermelho: o `total` de `GET /descartes/pendentes` |
| Gestão | Relatórios | `/dashboard` | GESTOR | |
| Gestão | Catálogo | `/produtos` | ATENDENTE, GESTOR | |
| Gestão | Contas de acesso | `/usuarios` | GESTOR | |
| Gestão | Configurar alertas | `/alertas/configuracao` | GESTOR | |
| Rodapé | Nome, papel, "Minha senha", Sair | `/minha-senha` | ATENDENTE, GESTOR | |

- Os rótulos da tabela são os novos (Recebimento, Catálogo, Descarte, Relatórios). As rotas
  **não mudam**: testes, favoritos e o roteiro manual dependem delas.
- O título de cada tela (`<h1>`) acompanha o rótulo do menu.

### Por tamanho de tela

- **Computador (> 1024 px):** menu lateral fixo de 232 px, branco, com borda à direita. No
  topo, a marca (quadrado de 34 px na cor primária com o ícone, "ShelfLife Manager" e o lema
  "Primeiro que vence, primeiro que sai"); no rodapé, as iniciais, o nome, o papel, o link
  "Minha senha" e o botão de sair. Item ativo com fundo `--cor-primaria-suave` e texto na cor
  primária.
- **Tablet (600–1024 px):** o mesmo menu lateral, recolhido aos ícones (64 px), com o nome no
  `title` e no `aria-label`; expande ao tocar no botão de menu.
- **Celular (< 600 px):** barra inferior fixa, branca, com borda em cima.
  - Gestor: Venda, Consultar, **Validade** e Mais.
  - Atendente: Venda, Consultar e Mais.
  - "Validade" leva a `/descartes` e mostra o distintivo de descarte.
  - "Mais" abre uma folha de baixo para cima com o resto do menu, nos mesmos grupos, e o
    rodapé do usuário.
- **Celular, telas de validade:** `/descartes` e `/alertas` ganham, no topo, um seletor de duas
  abas, **Descarte** e **Alertas**, cada uma com sua contagem; trocar de aba troca de rota.

## Telas

### Início do gestor (`/inicio`, `telas/inicio.html`)

De cima para baixo:

1. **Cabeçalho:** data por extenso (vinda do servidor, ver abaixo) e "Bom dia, {primeiro
   nome}"; à direita, a busca e o botão primário "Nova venda" (leva a `/venda`).
   - A busca aceita código de etiqueta ou nome: o que começa com `PRF-` abre a Consulta já com
     o código; o resto abre o Catálogo já filtrado.
2. **"Precisa da sua atenção":** três cartões lado a lado, que empilham no celular.
   - **Vencidas:** distintivo "Vencidas", número de unidades vencidas em estoque, frase curta e
     botão "Resolver descarte" (vermelho), que leva a `/descartes`.
   - **Alertas:** distintivo "Alertas", número de alertas não lidos e botão secundário "Ver
     alertas".
   - **Próximo vencimento:** distintivo da faixa da unidade, dias para vencer, nome do produto,
     código e data; botão secundário "Ver unidade" (abre a Consulta com o código). Sem unidade
     a vencer, o cartão diz isso.
3. **"Estoque por validade":** total de unidades, barra empilhada pelas cinco faixas (faixa
   zerada não aparece na barra, mas aparece na legenda) e legenda com as cinco.
4. **"Últimos 30 dias":** saídas registradas, acerto na primeira leitura, descartes e
   bloqueios de FIFO, com link "Relatório" para `/dashboard`.

**Dados.** Estoque por faixa, vencidas e números do período já vêm de `GET /dashboard`. Alertas
não lidos já são contados em `App.tsx`. Faltam no servidor: o **próximo vencimento** (a unidade
em estoque, ainda não vencida, de validade mais próxima, com produto, código, data, dias e
faixa) e a **data de hoje** para a saudação, que não pode ser o relógio do navegador. Os dois
entram na resposta de `GET /dashboard`.

### Venda no celular (`/venda`, `telas/venda-celular.html`)

- **Cabeçalho:** título "Venda" e, embaixo, o estado do atendimento com um ponto verde
  ("Atendimento em andamento"). "Encerrar atendimento" fica no cabeçalho, à direita, como botão
  secundário, e continua aparecendo **só com o carrinho vazio** (regra de T34).
- **Leitor:** área escura (`#12201D`) da largura da tela, 268 px de altura, raio 18 px, com a
  moldura de mira e uma linha de leitura; dentro dela, "Aponte para o código da etiqueta" e o
  botão branco "Ligar câmera". Com a câmera ligada, o vídeo ocupa essa área.
- **Código digitado:** rótulo "Ou digite o código da etiqueta", campo em fonte mono e botão
  primário "Ler" ao lado.
- **Carrinho:** cartão com o título, a contagem de frascos e um item por linha: ícone de
  confirmação, nome, marca e código, a frase do servidor de que é a unidade certa, e o botão de
  remover (44 px, `aria-label`).
- **Confirmar venda · N frascos:** botão primário de 52 px, preso acima da barra inferior.
- Vereditos de bloqueio, de unidade vencida e o painel de exceção mantêm o comportamento atual
  e ganham só as cores da escala.
- **Computador:** a mesma ordem numa coluna central de até 640 px, com o menu lateral.

### Validade: descarte e alertas (`/descartes`, `/alertas`, `telas/descarte-celular.html`)

- Lista compacta num único cartão, uma linha por unidade, separada por divisória, em vez de um
  cartão alto por unidade. A faixa lateral colorida dos cartões atuais sai.
- **Descarte:** nome na primeira linha; na segunda, o distintivo vermelho "há N dias" (o
  `diasVencida` do servidor) e o código; botão secundário "Resolver" à direita. "Resolver"
  continua abrindo o `PainelExcecaoVencido`.
- **Alertas:** mesma linha. Distintivo pela `situacao` do servidor: `VENCIDA` → vermelho, "há N
  dias"; `NA_JANELA` → âmbar (faixa 8 a 30 dias, a janela de alerta), "vence em N dias". Alerta
  lido fica com o texto suave; o botão é "Marcar como lido".
- A frase de contexto da tela vira uma linha só, abaixo do seletor de abas (celular) ou do
  título (computador).
- Paginação (T27) continua no fim da lista.

### Catálogo (`/produtos`, `telas/catalogo.html`)

- **Cabeçalho:** título, contagem de produtos ativos e, para o gestor, os botões "Importar
  planilha" (secundário) e "Novo produto" (primário).
- **Lista primeiro:** um cartão com a barra de busca (T26) e os filtros de categoria em
  pílulas; a tabela com Código (mono), Produto (nome e marca embaixo), Categoria, Situação
  (distintivo "Ativo" verde ou "Inativo" neutro) e o menu "…" de ações; no rodapé, "Mostrar
  inativos" e a paginação (T27).
- **Painel "Novo produto"** ao lado da lista no computador (largura mínima 280 px) e em tela
  cheia no celular: Código interno (mono), Nome, Marca, Categoria (com as categorias que já
  existem) e "Cadastrar produto". Contador e limite de T25 continuam. Abaixo, o link para
  importar planilha.
- **Importação** (`ImportacaoProdutos`) abre no mesmo painel.
- **Menu "…" da linha:** Inativar (variante `perigo`, com a confirmação de T39) ou Reativar.
- No celular, a tabela rola dentro do cartão; a página não rola na horizontal.
- **Dados.** Filtrar por categoria não existe hoje na API: `GET /produtos` ganha o parâmetro
  `categoria`, e o servidor passa a devolver a lista de categorias existentes (para as pílulas e
  para o campo do painel).

## O que esta especificação não muda

Login, Recebimento, Etiquetas, Contas de acesso, Minha senha, Configurar alertas, Relatórios
(o dashboard), Consultar produto, os diálogos e os toasts **não têm layout novo**: recebem os
tokens e as fontes (T40) e o menu novo (T41), e só. A folha de impressão de etiquetas
(`@media print`) não muda em nada.

## Tarefas

| ID | Tarefa | Depende de |
|---|---|---|
| T40 | Linguagem visual: tokens, escala de validade, fontes e manifest | T35 |
| T41 | Navegação por tarefa: menu lateral, barra inferior e fim da barra do topo | T40 |
| T42 | Tela Início do gestor | T41 |
| T43 | Venda no novo layout | T41 |
| T44 | Descarte e alertas em lista compacta | T41 |
| T45 | Catálogo com a lista primeiro | T41 |
| T46 | Nome do app: ShelfLife Manager | T41 |

T42 a T45 podem ser feitas em qualquer ordem depois de T41.
