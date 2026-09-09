# T19b — Notificação push do alerta proativo (RF08)

**Depende de:** T19 (a entrega in-app, que é a lista para onde a notificação leva) e, por
tabela, T18 (a varredura, que é o único momento em que há o que notificar) e T17 (o canal
`PUSH`/`AMBOS`, que decide quais janelas notificam)
**Incremento:** 5 (Alertas proativos)
**Bloqueia:** nada. Fecha a RF08 e encerra o incremento 5

## Objetivo

Fazer o alerta chegar a quem **não abriu o sistema**.

T19 entregou a metade in-app: a gestora que abre o app vê a lista, o contador e marca como
lido. Ficou declarado em `docs/notas-para-artigo.md` como a limitação mais séria do
incremento — *"o in-app só alcança quem já abriu o sistema, e o push alcança quem não abriu;
a metade da RF08 que falta é justamente a que atacaria o gargalo"*. Numa perfumaria onde a
gestora abre o sistema uma vez por semana, o aviso de 30 dias chega com 23 dias de atraso, e
a janela vira decoração.

Esta tarefa é a outra metade: inscrição do aparelho, chaves VAPID, envio a partir da
varredura e um handler de `push` no service worker. É também a última fatia do incremento 5,
e a única do projeto cuja verificação final **não cabe nesta máquina**: push exige HTTPS e
aparelho real, o mesmo teste de campo que já está pendente na lista de verificações manuais.

## Decisões, confirmadas pelo orientando antes da implementação

As sete foram confirmadas como escritas; as três que estavam em aberto (1, 2 e 5) foram
respondidas na abertura da tarefa.

**Decisão 1 — `importScripts` no service worker gerado, em vez de trocar para `injectManifest`.**
A Decisão 1 de T19 supôs que o push exigiria trocar o `generateSW` do `vite-plugin-pwa` por
um `injectManifest` com service worker próprio. Ao olhar o custo de perto, é a troca errada:
o service worker de hoje carrega três regras da RNF07 escritas em T10 — `navigateFallback`
para o app abrir sem rede, `NetworkOnly` em `/saidas/ler` e `/health`, e o precache do app
shell —, e `injectManifest` obriga a reescrever todas à mão, em código que nenhum teste do
projeto cobre. Um erro ali não quebra a tela de alertas: quebra o comportamento offline do
balcão, que é justamente o que a RNF07 exige.

Proponho `workbox.importScripts: ['sw-push.js']` no `generateSW` atual: tudo que T10 decidiu
continua gerado pelo plugin, e o arquivo novo (`frontend/public/sw-push.js`) só acrescenta os
dois handlers que não existem hoje, `push` e `notificationclick`. A contrapartida a declarar:
é JavaScript solto em `public/`, fora do build do Vite — sem TypeScript, sem Vitest, sem
`typecheck`. Fica pequeno de propósito, e é o único trecho do frontend cuja verificação é a
de campo.

**Decisão 2 — uma notificação por passagem da varredura e por aparelho, agregada; nunca uma por unidade.**
O `Alerta` é por unidade desde T18, e continua sendo — é dele que a RF13 conta. A
**notificação** não pode seguir a mesma granularidade: um recebimento de 40 frascos com a
mesma validade entrando na janela dispararia 40 notificações no celular da gestora no mesmo
segundo, e o efeito prático de 40 notificações é o mesmo de zero (ela desliga o aviso).

A notificação diz quantas unidades entraram e em qual janela, e o toque abre `/alertas`, que
é onde o detalhe por unidade já está. Uma passagem que emitiu alertas em duas janelas
(30 e 7 dias) manda **uma** notificação, nomeando as duas. Passagem sem alerta novo não
manda nada — que é o caso da maioria dos dias.

**Decisão 3 — inscrição por aparelho, tabela nova `InscricaoPush`, e o alvo é conferido no envio.**
Web Push exige guardar por dispositivo o `endpoint` (URL do serviço do navegador) e as duas
chaves `p256dh`/`auth`. É a **única migração** desta tarefa. `endpoint` é `@unique`: reinscrever
o mesmo aparelho atualiza, não duplica. A inscrição aponta para o `Usuario` que a criou, e o
envio filtra por `papel: GESTOR` **no momento do envio**, não no da inscrição — assim uma
conta rebaixada de GESTOR para ATENDENTE para de receber sem que ninguém precise limpar
tabela. Mesma restrição de T19, pela mesma razão (Decisão 2 de T19).

**Decisão 4 — as chaves VAPID são opcionais no ambiente; sem elas o push fica desligado e nada mais muda.**
`JWT_SECRET` é obrigatória porque sem ela o sistema não tem sessão. Push é diferente: uma
loja que não queira notificação, uma máquina de desenvolvimento e a suíte de testes precisam
subir o servidor sem chave nenhuma. Então `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e
`VAPID_SUBJECT` entram em `shared/env.ts` como opcionais, com `npm run push:chaves` para
gerá-las. Sem elas: as rotas de inscrição respondem **503 `PUSH_NAO_CONFIGURADO`**, a
varredura não tenta enviar (e loga uma vez, não a cada passagem), e a tela diz que o push não
está configurado neste servidor. O que **não** acontece é o servidor recusar-se a subir, nem
a varredura falhar.

**Decisão 5 — nenhum décimo-primeiro tipo de evento.**
T19 acrescentou `ALERTA_LIDO` como ato consciente, e o comentário de `eventoLog.service.ts`
diz desde T09 que cada acréscimo custa comparabilidade. Proponho parar em dez: o envio do
push não é ato humano, não muda estoque, e o indicador que interessa — quanto tempo a loja
leva para reagir — já sai do par `ALERTA_PROATIVO_EMITIDO` → `ALERTA_LIDO`. O que se perde,
e que vai declarado em `docs/notas-para-artigo.md`: **o log não distingue "leu porque o push
chegou" de "leu porque abriu o app por conta própria"** — ou seja, o dado não isola o efeito
do push, que é exatamente a pergunta que esta tarefa levanta. O envio fica visível só no log
do servidor e no resumo da varredura.

A alternativa considerada e recusada: `NOTIFICACAO_PUSH_ENVIADA`, assinado pela conta de
sistema de T18, um por passagem e por aparelho. Mediria o efeito do push no tempo de reação,
que é a pergunta central desta tarefa — mas ao custo de mais um acréscimo à lista fechada do
PRD, e a pergunta continua respondível fora do log (a data de implantação do push separa os
dois períodos do piloto).

**Decisão 6 — inscrição morta é apagada no primeiro 404/410, e push perdido não é reenviado.**
404 e 410 são a forma padrão de o serviço do navegador dizer "este aparelho não existe mais"
(app desinstalado, permissão revogada): a linha é apagada na hora, senão a tabela vira lixo
que a varredura tenta todo dia. Qualquer outro erro é logado e a inscrição fica.

Não há fila de reenvio: a varredura seguinte não reemite alerta (índice único de T18), então
um push perdido está perdido. É aceitável porque **a lista in-app continua sendo a fonte de
verdade** — o push é o empurrão, não o registro. Vai declarado como limitação.

**Decisão 7 — o envio acontece depois do commit da varredura, e uma falha de push nunca desfaz um alerta.**
Chamada HTTP dentro de `$transaction` seguraria a transação pela latência da rede; e um
serviço de push fora do ar não pode fazer o `Alerta` deixar de existir. A varredura passa a
acumular o que emitiu e chama o envio **depois do laço**, com `try/catch` próprio: push que
falha vira log, e o resumo da passagem continua verdadeiro sobre o que foi gravado.

## Critério de aceite

### Backend — inscrição (`/push`)

- [x] Módulo novo `src/modules/push/` (`push.routes.ts`, `push.service.ts`, `envioPush.ts`) —
      inscrição e envio são coisas diferentes de alerta, e o módulo `alerta` já tem quatro
      responsabilidades
- [x] `GET /push/chave-publica` → `{ chavePublica }` (a VAPID pública, que o navegador exige
      para se inscrever). **Só GESTOR.** Sem chaves configuradas: 503 `PUSH_NAO_CONFIGURADO`
- [x] `POST /push/inscricoes`, corpo `{ endpoint, chaves: { p256dh, auth } }` → 201
      `{ inscricao: { id, criadoEm } }`. **Só GESTOR.** As chaves do aparelho **não voltam** na
      resposta
- [x] Reinscrever o mesmo `endpoint` **atualiza** (`upsert` pela chave natural) e responde 200,
      não 409: o navegador troca as chaves do mesmo aparelho por conta própria
- [x] `DELETE /push/inscricoes`, corpo `{ endpoint }` → 204. Endpoint desconhecido também é
      204 (desinscrever o que não existe é o estado desejado, não erro)
- [x] Corpo inválido cai no `errorHandler` de T12b, formato `{ erro, mensagem }`
- [x] Nenhuma das três rotas grava `EventoLog` (Decisão 5)
- [x] Migração `inscricao_push`: modelo `InscricaoPush` com `endpoint @unique`, `p256dh`,
      `auth`, `usuarioId` (FK) e `criadoEm`. Nenhuma outra tabela é tocada

### Backend — envio

- [x] `envioPush.ts` expõe `enviarNotificacoesPush(alertasEmitidos, opcoes?)`, com o remetente
      **injetável** (`opcoes.enviar`), como o agendador de T18 injeta a varredura: o que se
      testa aqui é a regra, não a biblioteca
- [x] Envia **só** os alertas de janela com canal `PUSH` ou `AMBOS`; janela `IN_APP` não gera
      notificação
- [x] **Uma notificação por aparelho por passagem** (Decisão 2), com a contagem de unidades e
      as janelas envolvidas; o payload leva também a URL `/alertas` que o `notificationclick`
      abre
- [x] Alvo: inscrições cujo usuário é **GESTOR no momento do envio** (Decisão 3)
- [x] 404/410 apagam a inscrição; outros erros são logados e a inscrição fica (Decisão 6)
- [x] Sem chaves VAPID: não envia, loga **uma vez** por processo, devolve resumo zerado
- [x] `varreduraAlertas.ts` chama o envio **depois** das transações, em `try/catch` próprio; o
      `ResumoDaVarredura` ganha `notificacoesEnviadas`. Nenhuma outra linha da varredura muda,
      e a regra de janela continua sendo dela
- [x] Nada de `validarSaidaFifo`, rotas de T17, rotas de `/alertas` ou agendador é alterado

### Backend — testes

- [x] `tests/push/inscricoesPush.test.ts` (PostgreSQL real): inscrição cria; reinscrição do
      mesmo endpoint atualiza e não duplica; `DELETE` remove e é 204 também para endpoint
      desconhecido; ATENDENTE recebe 403 nas três rotas e anônimo 401; corpo inválido é 400;
      sem chaves configuradas as rotas são 503 `PUSH_NAO_CONFIGURADO`
- [x] `tests/push/envioPush.test.ts` (PostgreSQL real, remetente falso): envia uma notificação
      por aparelho e não uma por unidade; ignora janela `IN_APP`; ignora inscrição de
      ATENDENTE; apaga a inscrição no 410 e mantém em erro 500; sem chaves não envia nada
- [x] `tests/mensagemPush.test.ts` (sem banco, na raiz de `tests/` pela regra de T14b): o
      texto agregado — uma unidade, várias unidades, duas janelas
- [x] `tests/alerta/varreduraAlertas.test.ts` ganha o caso "varredura chama o envio com o que
      emitiu, e uma falha de envio não derruba a varredura nem desfaz os alertas"
- [x] As suítes existentes continuam passando. **Uma exceção**: as cinco asserções de
      `ResumoDaVarredura` em `tests/alerta/varreduraAlertas.test.ts` ganharam o campo novo
      `notificacoesEnviadas: 0` — é a única edição em teste existente desta tarefa

### Frontend

- [x] `frontend/public/sw-push.js`: handlers `push` (mostra a notificação) e
      `notificationclick` (foca uma aba aberta do app ou abre `/alertas`). Nada mais
- [x] `vite.config.ts`: `workbox.importScripts: ['sw-push.js']`, sem alterar
      `navigateFallback`, `runtimeCaching` nem o manifest (Decisão 1)
- [x] `src/services/push.ts`: as três chamadas de API, espelhando o backend sem regra própria
- [x] `src/components/NotificacoesDoAparelho.tsx`: o bloco "Neste aparelho" da tela de
      configuração, com os estados **não suportado** (navegador sem `serviceWorker` ou
      `PushManager`), **permissão negada**, **push não configurado no servidor** (503),
      **inscrito** e **não inscrito**, mais os botões de ativar e desativar
- [x] Estado de inscrição vem do próprio navegador (`pushManager.getSubscription()`), sem rota
      de consulta no servidor
- [x] Montado em `TelaConfiguracaoAlerta`, que é onde o canal é escolhido; o aviso da tela é
      reescrito pela **quarta** vez, agora dizendo que push existe e depende do aparelho
- [x] Nenhum julgamento na tela (RNF04): quem decide o que notificar é o servidor
- [x] Testes em `src/components/NotificacoesDoAparelho.test.tsx` (Vitest + Testing Library):
      os cinco estados, ativar, desativar e a falha de 503; o teste do aviso em
      `TelaConfiguracaoAlerta.test.tsx` acompanha o texto novo

### Fechamento

- [x] `npm test` e `npm run typecheck` verdes nos dois projetos; `npm run test:sem-banco`
      continua verde
- [x] `npm run test:push` acrescentado ao `package.json` do backend, no padrão dos demais
- [x] `backend/.env.example` com as três variáveis novas e o comando que gera as chaves
- [x] Conferência no navegador com `playwright-cli`, restrita ao bloco novo da tela de
      configuração e ao aviso reescrito; `console error` limpo. **O caminho completo do push
      (permissão, inscrição real, notificação chegando) não é verificável aqui** — vai para a
      lista de verificações manuais do backlog, junto do teste de câmera de T10
- [x] `docs/arquitetura.md`: `web-push` na seção 1, `InscricaoPush` na seção 3, as três rotas
      na seção 5, o envio na 5.3 e a nota do `importScripts` na seção 6
- [x] `docs/decisoes.md` e `docs/notas-para-artigo.md` com as entradas do dia
- [x] `tasks/backlog.md`: T19b `concluída`, com o arquivo de detalhe, e a linha nova na tabela
      de verificações manuais

## Notas técnicas

- **`web-push` é a única dependência nova** (backend). Ela implementa a criptografia do
  payload (RFC 8291) e a assinatura VAPID (RFC 8292) — escrever isso à mão não é opção
  razoável num TCC, e não é o assunto do trabalho.
- **A chave privada VAPID nunca sai do backend**, e a pública é servida por rota autenticada
  em vez de ir embutida no bundle: assim trocar de chave não exige rebuild do frontend.
- **`endpoint` é dado sensível de aparelho** — é URL que permite mandar notificação para ele.
  Não vai em resposta de API, nem em `EventoLog`, nem em log de servidor (o log registra a
  contagem e o id da inscrição, não o endpoint).
- **O texto da notificação não nomeia o produto.** Notificação aparece em tela bloqueada; e
  com dezenas de unidades o nome de uma só seria arbitrário. Quem detalha é a lista.
- **Nenhuma regra de janela vive no módulo `push`**, pela mesma razão de T19: quem decide o
  que entra na janela é a varredura.

## Fora de escopo desta tarefa

- **Push para ATENDENTE** ou qualquer notificação no fluxo de balcão — Decisão 2 de T19.
- **Push de qualquer outro fato** (FIFO bloqueado, descarte pendente, unidade vencida): a RF08
  fala do alerta proativo.
- **Preferência de notificação por usuário** (horário, silenciar): a janela e o canal já são
  configuráveis por T17, e mais um eixo é complexidade sem cliente numa loja pequena.
- **Fila de reenvio, confirmação de entrega ou de leitura da notificação** — Decisão 6.
- **Trocar o service worker para `injectManifest`** — Decisão 1.
- **Alterar `validarSaidaFifo`, as rotas de T17/T19, o agendador ou a regra de janela da
  varredura.**
- **Qualquer migração além de `InscricaoPush`.**

## Estado ao fim de T19b

`npm test` fecha em **324 verdes no backend** (287 herdados de T19, mais 37: 10 do texto da
notificação, 10 das rotas de inscrição, 13 do envio e 4 do gancho na varredura) e **111 no
frontend** (100 de T19, mais 10 do componente novo e 1 do bloco na tela de configuração; o
teste do aviso foi reescrito para o texto da quarta versão). `npm run typecheck` limpo nos
dois projetos, e `npm run test:sem-banco` subiu de 96 para **106** — a suíte do texto da
notificação não precisa de banco e ficou na raiz de `tests/`, pela regra de T14b.

Código novo no backend: o módulo `modules/push/` inteiro (`vapid.ts`, `mensagemPush.ts`,
`push.service.ts`, `push.routes.ts`, `envioPush.ts`, `chaves.cli.ts`). `app.ts` registra as
três rotas; `varreduraAlertas.ts` acumula o que emitiu e chama o envio depois das transações,
com `notificacoesEnviadas` no resumo; `shared/env.ts` ganhou o comentário que aponta as
chaves VAPID para `vapid.ts`; `package.json` ganhou `push:chaves` e `test:push`. **Uma
migração** (`20260909060028_inscricao_push`), como previsto. No frontend:
`public/sw-push.js`, `services/push.ts`, `components/NotificacoesDoAparelho.tsx`, o bloco de
estilos correspondente, `importScripts` no `vite.config.ts` e o quarto aviso da
`TelaConfiguracaoAlerta`. Nem `validarSaidaFifo`, nem o agendador, nem as rotas de T17/T19
foram tocados.

**Conferência no navegador** (`playwright-cli`, método do CLAUDE.md). Havia um `vite dev`
pré-existente na 5173, então a conferência do caminho com service worker foi feita sobre o
**build servido por `vite preview`** (na 5174, com o backend reiniciado apontando o CORS para
lá — mudança só de variável de ambiente, nada em disco). Os quatro estados alcançáveis nesta
máquina:

- no `vite dev` (sem service worker registrado), o bloco diz **"Instale o aplicativo (ou
  recarregue a página)"** e **não chama o servidor** — que é o comportamento pretendido para
  navegador sem suporte;
- no build, com o servidor **sem chaves VAPID**, o bloco diz **"Este servidor não está
  configurado para enviar notificações"** e não oferece botão;
- com as chaves geradas por `npm run push:chaves` e passadas por ambiente, o bloco passa a
  oferecer **"Ativar notificações"**;
- ao clicar, o navegador automatizado **nega a permissão** (é o padrão do Playwright) e a tela
  vai para **"As notificações estão bloqueadas para este site"**, sem inscrever nada — o banco
  de desenvolvimento terminou com **zero** linhas em `InscricaoPush`.

`console error` limpo (0 erros, 0 avisos). O `dist/sw.js` gerado contém
`importScripts("sw-push.js")`, e o log da varredura ao subir passou a trazer
`notificacoesEnviadas: 0`.

**O que não foi verificado aqui, e por quê:** a notificação chegando de verdade. Web Push
exige contexto seguro, permissão concedida e um serviço externo (FCM); o navegador
automatizado nega a permissão por construção. Foi para a lista de verificações manuais do
backlog, junto do teste de câmera de T10.

As chaves VAPID usadas na conferência foram descartadas: nada foi gravado em `.env`, e a
loja gera o seu par com `npm run push:chaves`.
