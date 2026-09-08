# T10 — Tela de leitura de QR (câmera + fallback manual), PWA e detecção de offline

**Depende de:** T08
**Incremento:** 2 (Núcleo: saída com validação FIFO + EventoLog)
**Bloqueia:** T12 (que reaproveita esta tela para os três caminhos da unidade vencida)

> Decisões validadas pelo orientando em 2026-09-08: 1, 3 e 4 como propostas; a 2 foi
> **revertida** — o roteador entra nesta tarefa. Ver a seção de decisões abaixo.

## Objetivo

Dar rosto ao núcleo do sistema. `POST /saidas/ler` existe e decide desde T08; T10 é a
primeira vez que uma atendente consegue operar o fluxo de saída sem `curl` — apontar a
câmera para o frasco, receber o veredito e, quando bloqueada, ler outro frasco até
confirmar (RF05, RF06).

A tarefa tem três metades desiguais:

1. **A tela** — câmera do navegador com fallback de digitação, e quatro layouts de
   resultado escolhidos pelo campo `veredito` da resposta.
2. **A detecção de offline** (RNF07) — a tela de saída só habilita se houver caminho até
   o backend, e bloqueia com mensagem explícita quando não houver. Nunca valida FIFO com
   dado local.
3. **O PWA** — o manifest já existe desde T01; falta a política de cache do service
   worker, que precisa garantir que uma leitura **nunca** seja servida do cache nem
   repetida automaticamente.

Nada de regra nova: a tela não decide veredito, não compara validade, não ordena unidade
e não escreve mensagem de veredito (RNF03, RNF04). Ela escolhe *layout* pelo campo
`veredito` e exibe o campo `mensagem` como veio do servidor.

## Critério de aceite

### O serviço (`frontend/src/services/saidas.ts`)

- [x] Tipo `RespostaLeitura` espelhando exatamente o que `saida.service.ts` devolve —
      quatro ramos discriminados por `veredito`, com `mensagem` em todos
- [x] `lerCodigoQr(codigoQr, sessaoVendaId)` chamando `requisitarApi`, sem tratamento de
      veredito: os quatro vereditos chegam em 200 e voltam como dado, não como erro
- [x] `verificarBackend()` — `GET /health`, usado pelo portão de offline. Devolve
      booleano; não lança
- [x] Nenhuma cópia de regra: nada de `if` sobre validade, status ou ordem de unidades em
      arquivo de frontend. A busca por `dataValidade <` no frontend não pode ter resultado

### A tela (`frontend/src/pages/TelaLeituraQr.tsx`)

- [x] Rota `/leitura`, alcançável por `ATENDENTE` e `GESTOR` (mesma lista de papéis da
      rota do backend) e presente na navegação dos dois. Ver Decisão 2 para o mapa de
      rotas completo e para o redirecionamento de `/` por papel
- [x] Câmera via `html5-qrcode` (fixado em `docs/arquitetura.md` seção 1), iniciada só
      quando a atendente pede ("Ligar câmera"), não na montagem da tela
- [x] **Fallback manual sempre visível**, não escondido atrás da falha da câmera: é o
      caminho da etiqueta riscada, e em T08 ele já é dado da pesquisa (RF12). Campo de
      texto + "Ler código"
- [x] Permissão de câmera negada, dispositivo sem câmera, ou navegador sem `getUserMedia`
      (contexto não-seguro) → mensagem própria da tela dizendo que o caminho é digitar.
      Este texto é da interface, não é veredito — não conflita com a RNF04
- [x] Quatro layouts pelo campo `veredito`, todos exibindo `mensagem` sem reescrever:
      - `CONFIRMAR` — sucesso, com produto, validade e código. Redigido como fato
        consumado (a venda já ocorreu; ver T08 Decisão 2)
      - `BLOQUEAR_FIFO` — o layout mais importante da tela: destaque para o código da
        unidade correta, com produto e validade dos **dois** lados (lida e correta), e
        contador de tentativas
      - `EXCECAO_VENCIDO` — informa e para. Sem botão de ação: os três caminhos são T11
      - `ERRO` — `QR_NAO_ENCONTRADO` e `UNIDADE_JA_BAIXADA` com a mensagem do servidor
- [x] Após qualquer veredito a tela volta pronta para a próxima leitura sem recarregar —
      é isso que torna o laço do RF06 operável (ler errado, ler de novo, confirmar)
- [x] Resultado anunciado em região `aria-live`: no balcão a tela é olhada de relance
- [x] Leitura em andamento desabilita o botão e ignora leitura repetida do mesmo código
      pela câmera enquanto a resposta não chega — a câmera dispara em rajada, e cada
      disparo viraria um `LEITURA_QR_SAIDA` (RF12)

### `sessaoVendaId` (agrupador de atendimento)

- [x] Gerado no cliente com `crypto.randomUUID()`, **um por atendimento**
- [x] Enviado em **todas** as leituras do ciclo, inclusive as bloqueadas e as que dão erro
      — é o que permite reconstruir o atendimento inteiro no relatório (RF13)
- [x] Trocado apenas por ação explícita ("Encerrar atendimento"), nunca por temporizador e
      nunca automaticamente após `CONFIRMAR`: um atendimento tem vários itens
- [x] Teste provando que duas leituras seguidas mandam o mesmo `sessaoVendaId`, que ele
      acompanha também o `BLOQUEAR_FIFO`, e que "Encerrar atendimento" muda o valor
- [x] Isso fecha a verificação manual que o backlog registrou para T10 ("conferir que a
      tela gera um `sessaoVendaId` por atendimento e o envia em todas as leituras")

### Offline (RNF07, `docs/arquitetura.md` seção 6)

- [x] Portão em dois sinais, na ordem barata primeiro: `navigator.onLine` e, se online,
      `GET /health`. A tela de leitura só habilita com os dois positivos
- [x] Offline → a leitura é bloqueada com mensagem explícita ("Sem conexão com o
      servidor. A leitura de QR não funciona offline — o sistema precisa consultar o
      estoque para saber qual frasco sai primeiro."), com botão "Tentar de novo"
- [x] Reage aos eventos `online`/`offline` do navegador, sem *polling*
- [x] **Nenhuma fila de leituras offline.** Uma leitura enfileirada só teria valor se
      alguém decidisse o veredito na hora, e quem decide é o servidor (RNF03/RNF04);
      guardar para validar depois entregaria à atendente um "pode vender" que o estoque
      não sustenta mais
- [x] Queda no meio da leitura (`ErroApi` com status 0 / `SEM_RESPOSTA`) cai no mesmo
      estado bloqueado, sem inventar veredito

### PWA (`vite.config.ts`)

- [x] `/saidas/ler` e `/health` em `NetworkOnly`, sem `BackgroundSync`. Um retry
      automático geraria uma segunda `LEITURA_QR_SAIDA` e inflaria o denominador da taxa
      de acerto na primeira leitura, que é o indicador do TCC (RF12, decisão de
      2026-09-08 sobre 200 uniforme, item **c**)
- [x] `navigateFallback` para o app shell — necessário duas vezes agora: para o app
      instalado abrir offline mostrando o bloqueio da tela (em vez do erro de rede do
      navegador, que não explica nada) e para que uma URL de tela recarregada direto
      resolva, já que a Decisão 2 dá URL própria a cada tela
- [x] O manifest de T01 não muda

### Testes (Vitest + Testing Library)

- [x] `TelaLeituraQr.test.tsx`: os quatro vereditos renderizados a partir da resposta
      falsa; laço do RF06 (bloqueio → segunda leitura → confirmação) numa mesma montagem;
      `sessaoVendaId` estável entre leituras e trocado ao encerrar; normalização deixada
      ao servidor (minúscula digitada chega ao backend como digitada — quem normaliza é
      `codigoQr.ts`, T08); bloqueio quando offline; recuperação ao voltar online
- [x] `App.test.tsx`: navegação entre rotas sem recarregar, redirecionamento de `/` por
      papel, `/recebimento` inalcançável para ATENDENTE, e rota protegida sem sessão
      levando a `/login`. Os testes passam a montar o `App` sob `MemoryRouter` com rota
      inicial explícita — os de T03b/T05 são adaptados, não reescritos
- [x] `html5-qrcode` isolado atrás de um componente fino (`components/LeitorCamera.tsx`)
      e substituído por dublê nos testes — jsdom não tem `getUserMedia` nem decodifica
      imagem. É a razão de a câmera precisar de verificação em celular real
- [x] `npm test` verde e `npm run typecheck` limpo nos dois projetos
- [x] Conferência no navegador com `playwright-cli` conforme CLAUDE.md, restrita ao que
      esta tarefa mexe: caminho manual até um veredito, e `network-state-set offline`
      para o bloqueio da RNF07. A câmera não é conferível ali (ver abaixo)

## Pontos que precisam da sua validação antes de eu codar

**Decisão 1 — nada de fila offline, nem "modo degradado" de leitura.**
A alternativa seria guardar as leituras feitas sem rede e enviá-las quando a conexão
voltar. Estou propondo não fazer, e não é por custo: um QR lido offline só serve se
alguém disser na hora se aquele frasco pode sair, e essa decisão depende do estoque
inteiro do SKU naquele instante — é a função do servidor (RNF03). Enfileirar significaria
ou deixar a atendente vender sem veredito, ou dar um veredito que pode estar errado
quando chegar ao servidor. O PWA continua útil offline como app instalado (abre, mostra a
tela, explica o bloqueio); o que não existe é saída offline. Isso é limitação real da
solução e vai para `docs/notas-para-artigo.md`.

**Decisão 2 — entra biblioteca de roteamento (decidida pelo orientando, 2026-09-08).**
T03b e T05 adiaram o roteamento dizendo que a decisão seria de T10. Eu havia proposto
manter as abas por estado; **o orientando decidiu adotar roteador para separar as telas**,
e é isso que esta tarefa implementa. `react-router-dom` (v7), `BrowserRouter`, uma rota
por tela:

| Rota | Tela | Papel |
|---|---|---|
| `/login` | `TelaLogin` | público (redireciona para dentro se já houver sessão) |
| `/leitura` | `TelaLeituraQr` | ATENDENTE, GESTOR |
| `/produtos` | `TelaProdutos` | ATENDENTE, GESTOR |
| `/recebimento` | `TelaRecebimento` | GESTOR |

`/` redireciona conforme o papel: ATENDENTE para `/leitura` (é a única coisa que ela faz
no sistema), GESTOR para `/produtos`. Rota desconhecida cai no mesmo redirecionamento.

O guarda de sessão continua sendo o `App` — o que muda é que ele passa a decidir *rota*
em vez de *ramo de render*. As três situações de T03b (`verificando`, `anonimo`,
`autenticado`) permanecem, e `verificando` continua sendo o que impede a tela de login de
piscar antes de `GET /auth/me` responder. Esconder rota por papel segue sendo conveniência
de interface: quem recusa é o 403 do backend (RNF04).

Consequência que esta tarefa precisa cobrir: URL própria por tela exige que o servidor
devolva o app shell em caminho fundo (`/leitura` recarregado direto). No `vite dev` isso
já vale; no PWA instalado é o `navigateFallback` que esta tarefa configura de qualquer
forma. Em produção, dependerá do host estático — anotar como requisito de publicação.

**Decisão 3 — a câmera fica isolada num componente que os testes substituem.**
`html5-qrcode` entra como dependência nova do frontend (já fixada em
`docs/arquitetura.md` seção 1, não é escolha desta tarefa). Ela não é testável em jsdom, e
o `playwright-cli` não aponta câmera para um frasco. Então: o componente
`LeitorCamera.tsx` faz uma coisa só — pedir a câmera e emitir o texto lido — e todo o
resto da tela é testado com esse componente dublado. Consequência que precisa ser dita
alto: **o caminho da câmera termina T10 verificado apenas por leitura de código**, e a
verificação real é a que o backlog já reserva a você (celular real, `getUserMedia` exige
HTTPS ou `localhost`).

**Decisão 4 — `EXCECAO_VENCIDO` informa e para.**
A tela mostra o veredito e a mensagem, sem oferecer corrigir, descartar ou autorizar.
Esses são os três caminhos da seção 6.1 do PRD e são T11/T12. Se preferir que T10 já
mostre os botões desabilitados anunciando o que vem, digo agora — mas botão inerte no
balcão costuma ser pior que ausência.

## Estado ao fim de T10

`npm test` fecha em **47 verdes** no frontend (35 herdados de T03b–T05, ajustados ao
roteador, mais 12 da tela de leitura) e nos mesmos **148 do backend, sem uma linha
editada** — nenhum arquivo de `backend/` foi tocado nesta tarefa. `npm run typecheck`
limpo nos dois projetos, e `npm run build` gera o service worker com
`createHandlerBoundToURL("index.html")` e a regra `NetworkOnly` de `/saidas/ler` e
`/health`.

Conferido no navegador com `playwright-cli` (método do CLAUDE.md para UI), contra backend
e banco de desenvolvimento:

- login como ATENDENTE caindo direto em `/leitura`, com a URL trocando de fato;
- `BLOQUEAR_FIFO` real: `PRF-PW9VDK` (validade 01/03/2027) bloqueado apontando
  `PRF-474MZJ` (30/11/2026), com as duas unidades lado a lado e o contador de tentativas
  vindo do servidor;
- `EXCECAO_VENCIDO` de `PRF-VJRJ6K`, digitado em **minúsculas** — prova de que o cliente
  manda o código cru e quem normaliza é o backend;
- `network-state-set offline` fechando o portão e `online` reabrindo;
- viewport de celular (390×844): título do veredito e código a buscar cabem sem rolagem;
- nenhum erro de console além dos dois 401 de `/auth/me` anteriores ao login.

`CONFIRMAR` ficou de fora do navegador de propósito, pelo mesmo motivo de T08 e T09:
consumiria uma unidade do banco de desenvolvimento, e já tem casos automatizados.

Um achado da conferência virou correção de comportamento, registrado em
`docs/decisoes.md` (2026-09-08): **o veredito exibido sobrevivia à queda de conexão** e
reaparecia intacto ao reconectar. Um veredito vale para o estoque de um instante — durante
a queda, outra atendente pode ter baixado a unidade apontada —, então ele passou a ser
descartado quando o portão fecha. Tem teste próprio.

Registrado em `docs/notas-para-artigo.md` (2026-09-08): a recusa de operar offline como
consequência do que o sistema oferece (veredito, não registro), com a assimetria entre
funções que acumulam dado e funções que decidem sobre recurso disputado; e a fronteira do
teste automatizado caindo exatamente na ponte entre mundo físico e digital, que é o que
torna a verificação em celular real uma tarefa nomeada em vez de uma lacuna implícita.

## Notas técnicas

- **A tela não normaliza o código digitado.** `codigoQr.ts` no backend já faz maiúsculas,
  aparo e as confusões de Crockford (`I`/`L` → `1`, `O` → `0`), e T08 registrou que esse
  módulo é o dono único do formato, que é provisório até a RNF08 (T16). Normalizar
  também no cliente criaria um segundo dono e mascararia divergência entre os dois.
- **Código fora do padrão não é barrado na tela** — segue para a API e volta como
  `QR_NAO_ENCONTRADO`, com `LEITURA_QR_SAIDA` gravado. Mesma razão de T08: etiqueta
  ilegível é dado da pesquisa (RF12).
- **`/health` é liveness puro** (decisão de 2026-09-07): responde mesmo com o banco fora.
  Então o portão de offline detecta "backend inalcançável", não "sistema pronto". Banco
  fora com backend de pé vira 500 na leitura, tratado como erro comum — sinalizar
  prontidão de banco exigiria endpoint novo, que não é escopo daqui.
- **`crypto.randomUUID` exige contexto seguro**, o mesmo que `getUserMedia` já exige. Em
  `localhost` e em HTTPS os dois funcionam; num IP de rede local sem TLS, nenhum dos dois
  — o que reforça a verificação em celular real como teste de ambiente, não só de tela.
- A tela é a primeira do projeto operada com uma mão só, segurando um frasco na outra:
  alvo de toque grande e resultado legível de relance vêm antes de qualquer refinamento
  visual, como já assume `estilos.css`.

## Fora de escopo desta tarefa

- Os três caminhos da unidade vencida — corrigir, descartar, override de GESTOR (T11 no
  backend, T12 na tela).
- Fila de descarte pendente (T13), dashboard e relatório por `sessaoVendaId` (T20/T21).
- Impressão de etiquetas (T14/T15) e qualquer mudança no formato do `codigoQr`.
- Estorno de saída registrada por engano: não existe no sistema e está registrado como
  limitação em `docs/notas-para-artigo.md` (2026-09-08).
- Alterar `validarSaidaFifo`, o tipo `Veredito`, `saida.service.ts` ou qualquer suíte de
  backend.
