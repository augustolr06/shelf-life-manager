# T17 — CRUD de ConfiguracaoAlerta (RF08)

**Depende de:** T02 (o schema já tem `ConfiguracaoAlerta` e `Alerta`). Na prática também de
T03b/T04, que estabeleceram o padrão de tela de gestão com formulário e lista
**Incremento:** 5 (Alertas proativos)
**Bloqueia:** T18 (o job periódico, que lê estas configurações), e por consequência T19

## Objetivo

Dar ao gestor o parâmetro que ele hoje não tem: **quantos dias antes do vencimento o sistema
deve avisar**.

Todo o sistema construído até aqui é reativo. O FIFO age quando alguém lê um QR no balcão
(T07–T10); a fila de descarte (T13) mostra o que **já** venceu — quer dizer, a perda já
consumada. Entre "o frasco está no estoque" e "o frasco venceu" existe uma janela em que
ainda dá para fazer alguma coisa a respeito (promoção, destaque na vitrine — a jornada J3 do
PRD), e nada no sistema atual enxerga essa janela.

A RF08 abre essa janela, e ela é **configurável de propósito**: 30 dias é razoável para um
perfume e absurdo para um item de giro rápido, e quem sabe qual número serve é a gestora da
loja, não o código.

Esta tarefa entrega **só o parâmetro**: os endpoints e a tela onde ele é definido. Ninguém
lê essa configuração ainda — quem vai varrer o estoque contra ela é T18, e quem vai entregar
o aviso é T19. É a mesma fatia fina que T14 fez com o símbolo do QR antes de T15 imprimi-lo.

## Critério de aceite

### Backend — `modules/alerta/`

- [x] Módulo `src/modules/alerta/` (a pasta já existe com `.gitkeep`), com
      `configuracaoAlerta.routes.ts` e `configuracaoAlerta.service.ts`. O nome dos arquivos
      leva o prefixo da entidade porque o módulo vai receber o `Alerta` em si (T18/T19), e
      configuração e alerta emitido são coisas diferentes
- [x] `GET /configuracao-alerta`, papel `GESTOR`: lista **todas** as configurações,
      ativas e inativas, ordenadas por `diasAntecedencia` decrescente (a janela mais larga
      primeiro — é a que dispara antes). Sem paginação: são poucas por definição (ver
      Decisão 3). Responde `{ configuracoes: [...] }`
- [x] `POST /configuracao-alerta`, papel `GESTOR`: cria. Corpo `{ diasAntecedencia, canal }`,
      responde 201 `{ configuracao }`
- [x] `PATCH /configuracao-alerta/:id`, papel `GESTOR`: altera `diasAntecedencia`, `canal`
      e/ou `ativo`. Corpo com `minProperties: 1`, como `PATCH /produtos/:id`. 404
      `CONFIGURACAO_NAO_ENCONTRADA` se o id não existir
- [x] `DELETE /configuracao-alerta/:id`, papel `GESTOR`: **inativa** (`ativo = false`),
      nunca apaga — ver Decisão 2. Responde `{ configuracao }` com o novo estado, como
      `DELETE /produtos/:id`. 404 se não existir
- [x] `diasAntecedencia` é inteiro de **1 a 365** (ver Decisão 4)
- [x] `canal` é um dos três valores fechados `IN_APP`, `PUSH`, `AMBOS`, declarados em uma
      constante do módulo e usados tanto no `enum` do JSON Schema quanto no tipo TypeScript.
      Coluna continua `String` no Prisma, sem migração — ver Decisão 1
- [x] **Não pode haver duas configurações ativas com o mesmo `diasAntecedencia`** (Decisão
      5). Violação responde 409 `ANTECEDENCIA_JA_CONFIGURADA`, tanto no `POST` quanto no
      `PATCH` (inclusive ao reativar via `ativo: true`). A verificação e a escrita ficam
      dentro de um `prisma.$transaction`
- [x] Nenhum `EventoLog` é gravado por nenhuma dessas rotas — Decisão 6. Os nove tipos do
      PRD são lista fechada e nenhum descreve mudança de configuração
- [x] Nenhuma alteração em `schema.prisma`, em `validarSaidaFifo`, nos módulos existentes
      ou em migração. Nenhuma varredura de estoque, nenhuma criação de `Alerta`: isso é T18
- [x] `src/db/seed.ts` passa a criar uma configuração padrão de **30 dias / `IN_APP`**
      (o exemplo da jornada J3 do PRD), idempotente como o resto do seed. Sem ela, T18 sobe
      sem nada a fazer e a tela abre vazia na demonstração
- [x] `app.ts` registra `rotasConfiguracaoAlerta`

### Backend — testes (Vitest contra PostgreSQL real, `tests/alerta/`)

- [x] `backend/tests/alerta/configuracaoAlerta.test.ts`, com os apoios de
      `tests/apoio/cenario.ts` (`criarUsuario`, `cookieDeSessao`) e o reset de
      `tests/apoio/bancoDeTeste.ts`
- [x] `POST` cria e devolve 201 com o corpo persistido; `ativo` nasce `true` sem ser enviado
- [x] `GET` devolve a lista na ordem da janela mais larga para a mais estreita, com ativas e
      inativas juntas, e lista vazia é 200 com `configuracoes: []`
- [x] `PATCH` altera cada um dos três campos; `PATCH` com corpo vazio é 400 `CORPO_INVALIDO`
      (é o `errorHandler` de T12b respondendo, não código novo)
- [x] `DELETE` deixa `ativo = false` e **a linha continua no banco** — conferido por consulta
      direta, não pelo corpo da resposta. Reativar por `PATCH { ativo: true }` funciona
- [x] Bordas de `diasAntecedencia`: 0 e 366 são 400; 1 e 365 são aceitos; não-inteiro (`7.5`)
      é 400
- [x] `canal` fora dos três valores é 400
- [x] Duplicidade: segunda ativa com a mesma antecedência é 409; **a mesma antecedência é
      aceita se a primeira estiver inativa**; e reativar uma inativa cuja antecedência
      voltou a colidir é 409
- [x] Papel: `ATENDENTE` recebe 403 nas quatro rotas; sem cookie, 401 nas quatro
- [x] `PATCH` e `DELETE` de id inexistente são 404 `CONFIGURACAO_NAO_ENCONTRADA`
- [x] Nenhuma linha nova em `EventoLog` depois de criar, alterar e inativar uma configuração
      — a prova da Decisão 6

### Frontend — tela de configuração

- [x] `services/configuracaoAlerta.ts`, espelho do endpoint no estilo de `produtos.ts`.
      Exporta `Canal` como união dos três literais e a lista de rótulos em português
- [x] `pages/TelaConfiguracaoAlerta.tsx`, rota `/alertas/configuracao`, registrada em
      `App.tsx` na lista `TELAS` com `papeis: ['GESTOR']` — mesma lista de papéis das rotas
      do backend. Rótulo da aba: "Alertas"
- [x] Formulário de criação com o campo de dias (`<input type="number">`) e o seletor de
      canal; lista das configurações existentes com dias, canal e situação (ativa/inativa)
- [x] Cada linha tem alterar (edição inline dos mesmos campos) e inativar/reativar, no
      padrão que `TelaProdutos` já usa para o catálogo
- [x] A tela **diz explicitamente que ainda não há verificação periódica** enquanto T18 não
      existir — ver Decisão 7. Uma tela que aceita configurar um alerta que nunca chega é
      pior que uma tela ausente
- [x] Mensagem de erro exibida é sempre a `mensagem` do servidor (RNF04) — inclusive o 409
      de antecedência duplicada, que é o caso que o usuário vai encontrar de verdade
- [x] Nenhuma regra de negócio na tela: nada de recusar antecedência duplicada no cliente,
      nada de comparar datas. O `min`/`max` do input é conveniência de teclado, e quem recusa
      é o 400 do backend
- [x] Estado vazio explícito ("Nenhuma janela de antecedência configurada")

### Frontend — testes (Vitest + Testing Library)

- [x] Lista renderizada a partir da resposta falsa, com dias, canal em português e situação
- [x] Criar envia `{ diasAntecedencia, canal }` e recarrega a lista
- [x] 409 de antecedência duplicada exibe a mensagem do servidor e mantém o formulário
      preenchido (o usuário vai querer só trocar o número)
- [x] Alterar uma linha envia só os campos mexidos
- [x] Inativar e reativar chamam as rotas certas e refletem a nova situação
- [x] Estado vazio e estado de erro de carregamento
- [x] O aviso de "ainda não há verificação periódica" aparece
- [x] As suítes existentes continuam passando **sem edição**, exceto `App.test.tsx` se ele
      afirmar a lista de abas do GESTOR

### Fechamento

- [x] `npm test` e `npm run typecheck` verdes nos dois projetos
- [x] Conferência no navegador com `playwright-cli` conforme CLAUDE.md, restrita a esta tela:
      criar uma configuração contra o banco de desenvolvimento, receber o 409 real da
      duplicidade, inativar e reativar. `console error` limpo
- [x] `docs/decisoes.md` e `docs/notas-para-artigo.md` com as entradas do dia
- [x] `docs/arquitetura.md`: seção 5 passa a listar as quatro rotas (hoje só `GET/POST`) com
      a forma da resposta; seção 2 registra o módulo `alerta` deixando de ser placeholder;
      seção 3 ganha a nota sobre o conjunto fechado de `canal` numa coluna `String`
- [x] `tasks/backlog.md` com T17 `concluída` e a linha do arquivo de detalhe

## Estado ao fim de T17

As sete decisões abaixo foram **confirmadas pelo orientando** antes da implementação, sem
alteração.

`npm test` fecha em **247 verdes no backend** (227 herdados, mais 20 desta tarefa) e **89 no
frontend** (78 herdados, sem uma linha editada, mais 11 da tela nova). `npm run typecheck`
limpo nos dois projetos.

Código novo: `modules/alerta/` no backend (serviço e rota; a pasta deixou de ser
placeholder), `services/configuracaoAlerta.ts` e `pages/TelaConfiguracaoAlerta.tsx` no
frontend. `app.ts` registra as rotas; `App.tsx` ganhou a aba "Alertas" em
`/alertas/configuracao`, restrita a GESTOR; `seed.ts` cria a janela padrão de 30 dias;
`estilos.css` ganhou `.nota-informativa` e reusa o estilo do formulário do catálogo.
`validarSaidaFifo`, o schema Prisma e os módulos existentes não foram tocados.

Conferido no navegador com `playwright-cli` (método do CLAUDE.md para UI), contra o backend e
o banco de desenvolvimento, em viewport de celular (390×844):

- a aba "Alertas" aparece para a GESTOR, e a tela abre com a janela de 30 dias que o seed
  criou, com o aviso de que a verificação periódica ainda não existe;
- tentar criar uma segunda janela de 30 dias devolve o 409 real, e a tela exibe a mensagem do
  servidor com o formulário ainda preenchido;
- criada uma janela de 7 dias / "No aplicativo e push", que entra na lista **abaixo** da de
  30 — a ordem da mais larga para a mais estreita vem do servidor;
- inativada pela lista e alterada por edição inline de 7 para 10 dias. No banco: as **duas
  linhas continuam lá**, a segunda com `ativo = false` — a prova de que o `DELETE` não apaga
  — e `EventoLog` sem nenhuma linha nova, a prova da Decisão 6 fora do teste;
- console sem nenhum erro além dos dois 401 de `/auth/me` da tela de login, anteriores a esta
  tarefa, e do 409 que eu mesmo provoquei.

Um achado, registrado e resolvido aqui: `.aviso` é vermelho como `.erro` (é o mesmo achado
que T13 fez ao criar `.nota-sucesso`), e o aviso de "o job ainda não existe" não é falha da
ação que o gestor acabou de fazer. Entrou `.nota-informativa`, neutra.

O banco de desenvolvimento ficou com duas configurações depois da conferência: a de 30 dias
do seed, ativa, e uma de 10 dias inativa, que sobrou do teste manual. É dado de demonstração
e não atrapalha T18 (que só olhará as ativas); apagar exigiria `DELETE` direto por `psql`,
que é justamente o que a aplicação não faz.

## Pontos que precisavam da sua validação antes de eu codar (confirmados)

**Decisão 1 — `canal` é conjunto fechado de três valores (`IN_APP`, `PUSH`, `AMBOS`), mas
continua `String` no banco.**
O PRD descreve "alerta in-app **e/ou** notificação push" num campo só, então o valor precisa
conseguir dizer "os dois" — daí `AMBOS`, em vez de exigir duas configurações. O conjunto é
fechado porque `canal` livre viraria dado sujo que T19 teria de adivinhar como entregar.
Não vira `enum` do Prisma para não abrir migração numa tarefa que o schema de T02 já
atende, e porque a seção 3 da arquitetura declara `canal String` — a alternativa é um
`enum` e uma migração, o que é defensável, só não é o mínimo. Se você preferir o `enum`
no banco, é a hora de dizer.

**Decisão 2 — `DELETE` inativa, não apaga.**
Duas razões, e a segunda é a que importa: (a) é o precedente do catálogo, decidido em T04;
(b) `Alerta.configuracaoId` é FK obrigatória, então apagar uma configuração que já emitiu
alertas ou quebra a integridade ou leva junto o histórico de alertas emitidos — que é dado
da pesquisa (RF12/RF13). Inativar preserva a rastreabilidade de "este alerta foi emitido
sob a janela de 30 dias que hoje não existe mais". Isso **estende a seção 5 da
arquitetura**, que só previa `GET/POST`.

**Decisão 3 — a lista é coleção, não configuração única, e não é paginada.**
A rota tem nome singular (`/configuracao-alerta`, fixado na arquitetura, e eu mantenho o
nome como mantive `/descartes/pendentes` em T13), mas o modelo é tabela com `id` e 1:N para
`Alerta`, e o uso real justifica: uma janela larga para decisão comercial (30 dias) e uma
estreita de última chamada (7 dias) são configurações distintas com canais possivelmente
distintos. Sem paginação porque a lista tem ordem de grandeza de unidades — se um dia tiver
dezenas, o problema é outro.

**Decisão 4 — `diasAntecedencia` vai de 1 a 365, e o 0 fica de fora.**
O 0 significaria "avise no dia em que vence". Esse dia a unidade ainda está no pool do FIFO
e ainda é vendável (a borda que T13 testou), e no dia seguinte ela aparece na fila de
descarte — ou seja, o 0 duplicaria por notificação o que a fila já mostra por varredura, com
um dia de diferença. O teto de 365 é arbitrário e existe só para que um erro de digitação
(3650) não vire uma janela que inclui o estoque inteiro. Se você achar que "avisa no dia" tem
uso real na loja, o mínimo vira 0 e eu ajusto o teste de borda.

**Decisão 5 — duas configurações ativas não podem ter a mesma antecedência.**
Duas janelas de 30 dias fariam T18 gerar dois `Alerta` para a mesma unidade no mesmo dia,
o que polui a contagem de alertas emitidos que a RF13 vai reportar. A restrição é do
serviço, dentro de uma transação, e **não** um índice único no banco: um índice único
parcial ("único entre as ativas") exige SQL cru na migração, e o volume aqui é uma gestora
mexendo em configuração de vez em quando, não escrita concorrente. Fica registrado que a
garantia é de aplicação, não de banco — é o oposto da escolha da RNF02, e de propósito:
lá o dado em disputa é o estoque em atendimento simultâneo.

**Decisão 6 — nenhuma rota desta tarefa grava `EventoLog`.**
Os nove tipos de evento são lista fechada vinda do PRD, e `eventoLog.service.ts` registra
por escrito que acrescentar um tipo depois do piloto começar quebra a comparabilidade dos
dados. Nenhum dos nove descreve mudança de configuração. A consequência é real e vai para
`notas-para-artigo.md`: **se a janela for alterada no meio do piloto, não há registro de
quando nem de qual era antes**, e a série de alertas emitidos passa a misturar dois regimes
sem que a análise perceba. Se você quiser rastreabilidade disso, é um décimo tipo de evento
— decisão sua, e melhor tomada agora que depois do piloto.

**Decisão 7 — a tela avisa que a verificação periódica ainda não existe.**
Entre T17 e T18, configurar uma janela não produz alerta nenhum. Um aviso na tela é uma
linha de texto e evita que a demonstração (ou você, daqui a duas semanas) conclua que o
alerta está quebrado. Sai quando T18 entrar.

## Notas técnicas

- **Esta tarefa não decide nada sobre "estar dentro da janela".** A comparação
  `dataValidade <= hoje + diasAntecedencia` é de T18, e quando ela for escrita precisa usar
  `hojeComoData()`, como o FIFO e a fila de descarte usam — pelo mesmo motivo da nota de
  T13: três noções de "hoje" no sistema abrem faixas de unidade invisíveis. Aqui não há data
  nenhuma, só um inteiro.
- **`canal` não é entregue por ninguém ainda.** Aceitar `PUSH` em T17 cria uma configuração
  que nada honra até T19. É a ordem do backlog, e é preferível a inventar um subconjunto
  provisório de canais que mudaria de significado duas tarefas adiante.
- **A tela é de gestão, não de balcão.** Nada aqui é feito com cliente esperando; pode ter
  formulário mais denso que a tela de leitura. Ainda assim vale o alvo de toque de celular:
  a gestora usa o mesmo aparelho.
- **O seed ganha uma configuração, e isso é dado de demonstração, não migração.** Rodar
  `prisma db seed` num banco que já tem configuração não deve duplicar — mesma idempotência
  dos usuários.

## Fora de escopo desta tarefa

- **A varredura periódica do estoque e a criação de `Alerta`** — T18. Nenhuma linha de
  `Alerta` é escrita ou lida aqui.
- **Entrega do aviso**, in-app ou push: lista de notificações, badge, service worker de
  push, VAPID, permissão do navegador — T19.
- **Marcar alerta como lido** (`Alerta.lidoEm`) — T19.
- **Qualquer contagem ou relatório de alertas emitidos** — RF13, T20/T21.
- **Configuração por produto ou por categoria** ("avise 60 dias antes só para importados").
  O PRD descreve uma janela do sistema, não por SKU. Se a loja precisar, é tarefa própria e
  muda o modelo.
- **Um décimo tipo de `EventoLog` para mudança de configuração** — Decisão 6, sua decisão.
- **`enum` de `canal` no Prisma e a migração correspondente** — Decisão 1, sua decisão.
