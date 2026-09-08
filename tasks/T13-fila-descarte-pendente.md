# T13 — Fila de descarte pendente no painel do GESTOR (RF11)

**Depende de:** T11 (os três caminhos no servidor). Na prática também de T12, que construiu
o `PainelExcecaoVencido` já pensando em ser reusado aqui
**Incremento:** 3 (Exceção de unidade vencida)
**Bloqueia:** T20 (dashboard, que agrega a perda que esta fila torna resolvível)

## Objetivo

Dar ao gestor um caminho para encontrar a unidade vencida **antes** que ela chegue ao
balcão.

Hoje, uma unidade vencida só é descoberta quando alguém lê o QR dela numa venda — e isso
depende de um cliente pedir aquele frasco específico. Enquanto ninguém o pede, a unidade
fica `EM_ESTOQUE`, fora do pool prioritário do FIFO (PRD 6.1) e invisível: não está no
relatório de perdas porque não foi descartada, e não está no fluxo de saída porque o FIFO a
exclui de propósito. É um limbo — a unidade some da operação sem sair do estoque.

A RF11 fecha esse limbo com uma listagem ativa: todas as unidades `EM_ESTOQUE` com validade
já expirada, no painel do gestor, para resolução ativa. É o mesmo dado que o PRD (seção
6.1) chama de "unidades excluídas do pool prioritário — alimentam a fila de descarte
pendente".

Esta tarefa é uma fatia vertical: o endpoint `GET /descartes/pendentes` e a tela que o
consome. **A resolução em si já existe** — são os três caminhos de T11/T12, e nenhum deles
é reimplementado aqui.

## Critério de aceite

### Backend — `GET /descartes/pendentes`

- [x] Módulo novo `src/modules/descarte/` (a pasta já existe com `.gitkeep`), com
      `descarte.routes.ts` e `descarte.service.ts`. Não entra em `excecao-vencido/`: aquele
      módulo é o *ato* de resolver uma unidade, este é a *descoberta* de quais existem
- [x] Rota `GET /descartes/pendentes`, papel `GESTOR` (contrato já fixado em
      `docs/arquitetura.md` seção 5). É painel de gestão, não fluxo de balcão
- [x] Critério da fila, idêntico ao da exclusão do pool FIFO: `status = EM_ESTOQUE` **e**
      `dataValidade < hoje`, com `hoje` vindo de `hojeComoData()` — a mesma função que
      `validarSaidaFifo` usa. Nenhuma segunda definição de "vencido" no sistema
- [x] Ordenação por `dataValidade` crescente (a mais vencida primeiro), com desempate por
      `codigoQr` para que a paginação seja estável. É a ordem da urgência, e é a mesma
      lógica de prioridade que o FIFO aplica ao pool não-vencido
- [x] Paginação no mesmo formato de `GET /produtos` (`pagina`, `tamanhoPagina`, padrão 20,
      máximo 100), respondendo `{ unidades, total, pagina, tamanhoPagina }`. Uma perfumaria
      de ~700 SKUs pode acumular fila longa, e a tela precisa saber o total
- [x] Cada item é o `UnidadeNaResposta` de `unidadeNaResposta.ts` (mesma forma que os três
      caminhos devolvem — é o que o `PainelExcecaoVencido` já recebe), acrescido de
      `diasVencida: number` e `dataEntrada`. Ver Decisão 2 para o `diasVencida`
- [x] A consulta traz o produto junto (`include`), sem N+1: a fila é uma lista, não uma
      resposta de unidade só
- [x] Unidade de produto inativo **entra** na fila. Produto inativado não devolve ao
      estoque o frasco físico que está na prateleira, e a perda continua sendo perda
- [x] Fila vazia é 200 com `unidades: []` e `total: 0`, nunca 404: "não há nada vencido" é
      resposta legítima, e é o estado que se deseja
- [x] Nenhum `EventoLog` é gravado por esta rota. Consultar a fila não é evento operacional
      — e um evento aqui não teria unidade única a que se referir. Ver Notas técnicas
- [x] Nenhuma alteração em `validarSaidaFifo`, em `excecao-vencido/` ou no schema Prisma

### Backend — testes (Vitest, contra PostgreSQL real, como T11)

- [x] `backend/tests/descarte/descartesPendentes.test.ts`, reusando os apoios de
      `tests/apoio/cenario.ts` (`criarUnidade` já recebe `diasAteVencer` negativo)
- [x] Traz só o que está vencido e `EM_ESTOQUE`: unidade a vencer amanhã fora, unidade
      vencida ontem dentro, unidade vencida já `VENDIDA` fora, já `DESCARTADA` fora
- [x] **Borda do dia corrente**: unidade que vence *hoje* **não** entra na fila — é o mesmo
      `>= hoje` que mantém ela no pool do FIFO, e vender hoje o que vence hoje é legítimo
- [x] Ordem: a mais vencida primeiro, com unidades de produtos diferentes misturadas (a
      fila é do estoque inteiro, não de um SKU)
- [x] `diasVencida` bate com a diferença de calendário, inclusive para 1 dia
- [x] Paginação: `total` conta a fila inteira e não a página; segunda página não repete nem
      pula item
- [x] Papel: `ATENDENTE` recebe 403; sem cookie, 401
- [x] Fila vazia responde 200 com lista vazia
- [x] Ponta a ponta com T11: descartar uma unidade da fila (`POST /excecao-vencido/descartar`)
      a remove da chamada seguinte; corrigir a validade para o futuro também. É a prova de
      que a fila e a resolução falam do mesmo estado

### Frontend — tela da fila

- [x] `services/descartes.ts`: espelho do endpoint, no mesmo estilo de `produtos.ts`.
      `UnidadePendente` estende o `UnidadeLida` de `saidas.ts` — não redeclara a forma da
      unidade, que é a mesma dos três caminhos
- [x] `pages/TelaDescartesPendentes.tsx`, rota `/descartes`, registrada em `App.tsx` na
      lista `TELAS` com `papeis: ['GESTOR']` — mesma lista de papéis da rota do backend
- [x] A lista mostra, por unidade: produto (nome, marca, código interno), `codigoQr`,
      validade e há quantos dias venceu. O "há quantos dias" vem do servidor
      (`diasVencida`), não é calculado na tela
- [x] Cabeçalho com o total de unidades pendentes, e paginação quando houver mais de uma
      página, no mesmo padrão de `TelaProdutos`
- [x] **Resolver reusa `PainelExcecaoVencido`**, sem duplicar nenhum dos três caminhos. Cada
      linha tem um botão "Resolver" que abre o painel para aquela unidade; um painel aberto
      por vez
- [x] `sessaoVendaId` vai `null`: não há atendimento aqui. O agrupador serve para amarrar as
      saídas de um cliente no balcão (T09), e inventar um para uma varredura de estoque
      poluiria o relatório com atendimentos que nunca existiram
- [x] O painel na fila oferece **correção e descarte, sem o override** — ver Decisão 1
- [x] Resolução bem-sucedida (descarte, ou correção que tire a unidade do vencimento)
      remove a linha da lista e mostra a `mensagem` do servidor, como o backend a escreveu
      (RNF04)
- [x] `UNIDADE_JA_BAIXADA` (409) na fila significa lista velha: exibe a mensagem do servidor
      e recarrega a fila, que é o equivalente ao "volta ao estado de nova leitura" de T12
- [x] Estado vazio explícito ("Nenhuma unidade vencida em estoque"), que é o estado desejado
      e não uma falha
- [x] Nenhuma comparação de validade, status ou ordem no frontend. A busca por
      `dataValidade <` continua sem resultado em `frontend/src`

### Frontend — testes (Vitest + Testing Library)

- [x] Lista renderizada a partir da resposta falsa: produto, código, validade formatada e o
      `diasVencida` que veio do servidor
- [x] Estado vazio e estado de erro de carregamento (mensagem do servidor)
- [x] "Resolver" abre o painel para aquela unidade, e só para ela
- [x] Descarte pela fila envia `unidadeId` **sem** `sessaoVendaId` e some com a linha
- [x] Correção pela fila envia a data e recarrega a fila
- [x] O override não aparece na fila, nem para `GESTOR` — Decisão 1
- [x] 409 `UNIDADE_JA_BAIXADA` exibe a mensagem do servidor e recarrega a fila
- [x] Os testes de `TelaLeituraQr` de T12 continuam passando **sem edição**: a mudança no
      painel é uma prop nova com padrão que preserva o comportamento do balcão

### Fechamento

- [x] `npm test` e `npm run typecheck` verdes nos dois projetos
- [x] Conferência no navegador com `playwright-cli` conforme CLAUDE.md, restrita a esta
      tela: a fila carregada contra o banco de desenvolvimento, um descarte real levando a
      linha embora, e a ausência do override. `console error` limpo
- [x] `docs/decisoes.md` e `docs/notas-para-artigo.md` com as entradas do dia
- [x] `docs/arquitetura.md`: seção 5 ganha a forma da resposta de `/descartes/pendentes`, e
      a seção 2 registra o módulo `descarte` deixando de ser placeholder
- [x] `tasks/backlog.md` com T13 `concluída`

## Estado ao fim de T13

As quatro decisões abaixo foram **confirmadas pelo orientando** antes da implementação, sem
alteração.

`npm test` fecha em **199 verdes no backend** (185 herdados, mais 14 desta fila) e **68 no
frontend** (59 herdados de T12, sem uma linha editada, mais 9 da tela nova). `npm run
typecheck` limpo nos dois projetos.

Código novo: `modules/descarte/` no backend (serviço e rota; a pasta deixou de ser
placeholder), `services/descartes.ts` e `pages/TelaDescartesPendentes.tsx` no frontend.
`App.tsx` ganhou a rota `/descartes` restrita a GESTOR; `PainelExcecaoVencido` ganhou a prop
`permitirOverride` (padrão `true`, que preserva o balcão) e teve o texto do descarte
reescrito para não afirmar que a unidade chegou por leitura de QR — desde agora ela pode ter
chegado pela fila. `validarSaidaFifo`, os três endpoints de T11 e o schema não foram
tocados.

Conferido no navegador com `playwright-cli` (método do CLAUDE.md para UI), contra o backend e
o banco de desenvolvimento, em viewport de celular (390×844):

- a aba "Fila de descarte" aparece para a GESTOR e **não** aparece para a ATENDENTE; o
  servidor recusa a rota para ela com 403 `PAPEL_INSUFICIENTE`, conferido por `curl`;
- as três unidades vencidas do banco listadas na ordem da mais vencida, com a contagem vinda
  do servidor ("2442 dias");
- o painel aberto pela fila oferecendo correção e descarte, **sem** o override;
- dois descartes reais em 201, um com motivo digitado. No banco: unidade em `DESCARTADA`, o
  `Descarte` com a gestora e o motivo, e um `DESCARTE_REGISTRADO` **sem `sessaoVendaId` e sem
  `LEITURA_QR_SAIDA` antes** — a prova de ponta a ponta de que a perda foi descoberta por
  varredura e não no balcão;
- console sem nenhum erro além dos dois 401 de `/auth/me` da tela de login, anteriores a esta
  tarefa.

Dois achados apareceram na conferência:

1. **Corrigido aqui:** desfecho bom não tinha cor no projeto. `.erro` e `.aviso` são ambos
   vermelhos, e o descarte concluído — o desfecho desejado desta tela — aparecia como
   falha. Entrou `.nota-sucesso`, e o tom da mensagem é escolhido pelo que o servidor
   respondeu, como a tela de leitura escolhe layout por veredito.
2. **Registrado, fora do escopo:** `MOTIVO_PADRAO_DE_DESCARTE` diz "constatada na leitura de
   saída", texto que fica errado quando o descarte vem da fila. O motivo é o registro da
   perda, então isso importa para a pesquisa — mas corrigir mexe no contrato de T11.
   Candidato a tarefa própria, como o `errorHandler` de T12 que virou T12b.

## Pontos que precisavam da sua validação antes de eu codar (confirmados)

**Decisão 1 — a fila oferece correção e descarte, mas não o override.**
O `PainelExcecaoVencido` hoje mostra os três caminhos para `GESTOR`. Proponho que, aberto a
partir da fila, ele mostre só dois, com uma prop nova (`permitirOverride`, padrão `true`,
para que a tela de leitura não mude em nada).

O motivo: o override é a autorização de uma **venda** de produto vencido, com um cliente
diante do balcão — é assim que a seção 6.1 do PRD o descreve, e é o que justifica a fricção
deliberada. Na fila não há venda: é uma varredura de estoque. Um botão "autorizar venda"
ali permitiria registrar `Saida` com `vendaDeUnidadeVencida = true` para unidades que
ninguém pediu, em lote, longe do ato que o registro deveria documentar — e esse registro é
permanente (RNF05) e tem peso legal. Deixar de fora não tira nada de ninguém: se o cliente
aparecer, a leitura de QR no balcão abre o caminho normalmente.

Se você discordar, a alternativa é mostrar os três também na fila; é uma linha de mudança,
mas prefiro que seja escolha sua, porque é uma restrição de design do PRD que estou
estendendo a um contexto que o PRD não previu.

**Decisão 2 — `diasVencida` é calculado no servidor e vai na resposta.**
A tela precisa mostrar urgência ("vencida há 47 dias"), e a alternativa seria calcular a
partir de `dataValidade` no frontend. Não quero: seria a primeira comparação de data no
`frontend/src`, justamente a coisa que T10 e T12 mantiveram fora de lá, e ficaria sujeita
ao fuso do navegador — enquanto o servidor já tem `hojeComoData()`, que é a mesma noção de
"hoje" que decide o FIFO. Custo: um campo a mais na resposta, derivado, que envelhece se a
página ficar aberta virando o dia. Aceito — a fila envelhece de qualquer forma, porque
outra pessoa pode resolver uma unidade a qualquer momento.

**Decisão 3 — a fila não filtra por produto nem tem busca nesta tarefa.**
Ordenada pela mais vencida, paginada, e só. Filtro por SKU e por faixa de vencimento é
material de dashboard (T20/T21), e adicioná-lo aqui seria adiantar tarefa futura. Se na
conferência a fila do banco de desenvolvimento se mostrar longa demais para ser navegável
sem filtro, registro a observação e ela vira decisão de outra tarefa, como T12 fez com o
`errorHandler`.

**Decisão 4 — a rota se chama `/descartes/pendentes` mas devolve unidades, não descartes.**
É o nome que `docs/arquitetura.md` seção 5 já fixou, e mantenho — mas vale você ver escrito
que o recurso listado é a unidade vencida ainda `EM_ESTOQUE`, ou seja, o descarte que
*ainda não aconteceu*. É a leitura correta de "fila de descarte **pendente**". O histórico
do que já foi descartado é outra listagem, e pertence ao dashboard (RF13).

## Notas técnicas

- **Um único conceito de "vencido" no sistema.** A cláusula desta consulta é a negação
  exata do filtro do pool prioritário (`dataValidade >= hoje` na seção 4 da arquitetura).
  Se as duas divergirem, aparece um buraco em que a unidade não está nem no FIFO nem na
  fila — invisível dos dois lados. Por isso `hojeComoData()` é compartilhada, e por isso o
  teste de borda do dia corrente existe.
- **A fila não grava evento, e isso tem consequência para a RF12.** Uma unidade resolvida
  pela fila produz `DESCARTE_REGISTRADO` **sem** um `LEITURA_QR_SAIDA` antes, ao contrário
  do que acontece no balcão. Não é defeito: a taxa de acerto na primeira leitura tem como
  denominador as leituras de QR, e uma resolução por varredura não é leitura. O que a
  análise precisa saber é distinguir as duas origens — e o `DESCARTE_REGISTRADO` sem
  leitura anterior no mesmo `sessaoVendaId` (que aqui é nulo) já faz essa distinção.
- **O painel foi desenhado em T12 para este reuso**: ele não sabe o que é `EXCECAO_VENCIDO`,
  recebe uma unidade e devolve o que o servidor respondeu. A prop de override é o único
  acréscimo previsto — se for preciso mais que isso, é sinal de que a tela da fila está
  querendo lógica que não é dela.
- **A fila é lista longa em tela de celular.** Cada linha precisa ser legível de relance e
  ter alvo de toque adequado, como as três ações de T12. A resolução acontece com o gestor
  em pé na prateleira, com o frasco na mão.
- **Recarregar depois de resolver, em vez de remover a linha localmente**, quando a
  resolução for correção: a unidade corrigida pode continuar vencida (correção para outra
  data no passado), e é o servidor quem sabe. Descarte é terminal e pode sair da lista
  direto.

## Fora de escopo desta tarefa

- **Qualquer alteração nos três caminhos de T11**, no `validarSaidaFifo` ou no schema.
- **Descarte em lote** ("descartar todas as vencidas deste produto"). É tentador numa fila,
  e é exatamente onde a perda deixaria de ser constatada uma a uma — cada `Descarte` é um
  frasco que alguém encontrou. Se for desejado, é decisão sua, em tarefa própria.
- **Histórico de descartes já realizados** e qualquer agregação de perda — RF13, T20/T21.
- **Alertas de vencimento próximo** (RF08) — incremento 5. Esta fila é do que **já** venceu;
  o que está por vencer é outro requisito, com configuração de antecedência própria.
- **Filtro por produto, por faixa de vencimento ou busca textual** — Decisão 3.
- **Notificação ao gestor de que a fila cresceu** — depende de T19.
- **Estorno de descarte** — limitação já declarada em `docs/notas-para-artigo.md`.
