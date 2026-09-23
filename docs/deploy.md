# Roteiro de deploy

Como subir este sistema num endereço público, e como operá-lo depois. Escrito em T23
(2026-09-09) e fixado na hospedagem escolhida em 2026-09-15, para o piloto na perfumaria.

**A pilha decidida:** frontend e backend na **Vercel**, em dois projetos, com o banco no
**Neon**. O porquê está em `docs/decisoes.md`; este arquivo é o passo a passo. O código
continua portátil — a seção 9 diz o que muda se a hospedagem for trocada.

## O que sobe onde

| Peça | Onde | Observação |
|---|---|---|
| Banco | Neon | Duas strings de conexão: a **com pooler** e a **direta** |
| Backend (`backend/`) | Vercel, projeto próprio | Serverless: **o relógio da RF08 vem de fora**, pelo cron da plataforma (seção 3.3) |
| Frontend (`frontend/`) | Vercel, outro projeto | Build estático do Vite; `frontend/vercel.json` já traz o rewrite de SPA |

Os dois projetos puxam do mesmo repositório (`augustolr06/shelf-life-manager`), cada um com
seu **Root Directory**. São projetos separados de propósito: o frontend é arquivo estático e o
backend é função, e cada um tem seu ciclo de build.

O frontend **precisa** de HTTPS, e é por isso que ele não pode ser servido de qualquer jeito:
sem contexto seguro não há câmera (`getUserMedia`), não há `crypto.randomUUID` — e sem ele o
agrupamento por atendimento cai fora (T10) — e não há Web Push (T19b). A Vercel dá HTTPS em
todo deploy.

## Ordem, e o ovo e a galinha das URLs

O backend precisa saber a URL do frontend (`FRONTEND_ORIGIN`, para o CORS) e o frontend
precisa saber a do backend (`VITE_API_URL`). Uma depende da outra, mas as duas são previsíveis
antes de existirem: `https://<nome-do-projeto>.vercel.app`.

Escolha os dois nomes antes de começar e preencha as variáveis já com eles. Se errar, o
sintoma é login que não completa — e o conserto é corrigir `FRONTEND_ORIGIN` e reimplantar.

> **Os dois são `*.vercel.app`, e isso é cross-site.** `.vercel.app` está na Public Suffix
> List, então dois projetos ali são sites diferentes para o navegador — que é exatamente o
> cenário para o qual T23 mudou o cookie para `SameSite=None` + `Secure`. Não é preciso fazer
> nada; é só saber que `NODE_ENV=production` é o que liga isso.

## 1. Banco — Neon

1. Crie um projeto no Neon (PostgreSQL 15+, como pede `docs/arquitetura.md`).
2. Copie as **duas** strings de conexão. Elas diferem por um sufixo no host:
   - **com pooler** — o host termina em `-pooler`. É o `DATABASE_URL` da aplicação.
   - **direta** — sem `-pooler`. É o `DIRECT_URL`, usado só pelo `prisma migrate`.

As duas são obrigatórias, e trocá-las de lugar falha de formas diferentes: a aplicação na
direta esgota conexão — e em serverless isso acontece rápido, porque cada instância abre as
suas —, e a migração pelo pooler **falha sempre**, porque `migrate deploy` se serializa com um
advisory lock de sessão que o pooler em modo transaction não sustenta.

> **Autosuspend.** O Neon suspende a computação após ~5 minutos ociosa, em todos os planos. A
> primeira consulta depois disso acorda o banco e demora mais que as outras. Somada ao cold
> start da função, é a razão do passo 9 da verificação.

## 2. Migração e usuários

Da sua máquina, uma vez:

```bash
cd backend
DATABASE_URL="<url-com-pooler>" DIRECT_URL="<url-direta>" npx prisma migrate deploy
```

**Não** coloque `migrate deploy` no build: em serverless ele rodaria concorrente a cada
deploy, e uma migração é ato deliberado.

Depois, as contas. O `seed` cria as duas com a senha padrão de desenvolvimento, que **não
pode** ficar num endereço público — troque as duas em seguida:

```bash
DATABASE_URL="<url-direta>" npm run prisma:seed

printf '%s' 'a-senha-da-gestora'   | DATABASE_URL="<url-direta>" npm run usuario:senha -- gestor@estoque.local
printf '%s' 'a-senha-da-atendente' | DATABASE_URL="<url-direta>" npm run usuario:senha -- atendente@estoque.local
```

A senha é lida do stdin (mínimo de 12 caracteres); com `printf` ela não aparece na tela.

A partir daqui a loja se vira sozinha: a gestora cria as demais contas, desativa quem sai e
redefine a senha de quem esquecer, em **Contas de acesso** (T22). O script continua sendo a
saída de emergência para o caso que a interface não alcança — gestor único que esqueceu a
**própria** senha, e por isso não consegue entrar para redefini-la.

## 3. Backend — Vercel

### 3.1 O projeto

**Add New → Project**, importando o repositório:

| Campo | Valor |
|---|---|
| Root Directory | `backend` |
| Framework Preset | Other (a Vercel detecta Fastify sozinha) |
| Build / Output | deixe o padrão |

Não há build command a escrever: a Vercel detecta o Fastify pelo entrypoint e o transforma
numa função só. O `postinstall: prisma generate` roda no install, e as devDependencies são
instaladas no build por padrão.

> **Como a Vercel escolhe o entrypoint.** O builder de Fastify procura `app`, `index` e
> `server` (em `src/` e na raiz) e fica **só com os que contêm, no texto, um
> `import ... from 'fastify'`** — é regex sobre o arquivo, não análise de imports. Vence o
> primeiro que casar. O `"main"` do `package.json` não é saída: ele só é consultado se nenhum
> candidato casar, e o arquivo dele também precisa casar com o mesmo regex.
>
> Por isso o `src/server.ts` importa o tipo `FastifyInstance` — o import é requisito de deploy,
> e `tests/entrypointVercel.test.ts` quebra se ele sumir. E a fábrica se chama
> `src/buildApp.ts` para **não** estar na lista: com o nome antigo, `src/app.ts`, ela casava,
> passava na frente e era escolhida.
>
> Os sintomas, para reconhecer: `Invalid export found in module ".../src/app.js"` no log de
> runtime (escolheu o arquivo errado) e `No entrypoint found which imports fastify` no log de
> build (nenhum candidato casou).
>
> **E o `listen()` não pode ter `await` no topo do módulo.** O runtime captura o servidor
> trocando o `listen` por um que nunca chama o callback; com `await`, o import do `server.ts`
> nunca termina e a requisição cai após 60 s com `INTERNAL_FUNCTION_INVOCATION_FAILED`.

### 3.2 Variáveis de ambiente

| Variável | Valor |
|---|---|
| `DATABASE_URL` | string **com pooler** do Neon |
| `DIRECT_URL` | string **direta** do Neon |
| `JWT_SECRET` | novo, nunca o do `.env` local — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FRONTEND_ORIGIN` | `https://<projeto-do-frontend>.vercel.app`, sem barra no fim |
| `ALERTA_AGENDADOR_INTERNO` | **`false`** — obrigatório aqui (seção 3.3) |
| `CRON_SECRET` | outro valor aleatório. Sem ele a rota do cron responde 503 |
| `LOG_LEVEL` | `info` no piloto — uma linha por requisição |
| `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` | `npm run push:chaves`. Sem elas o push fica desligado e o resto sobe normal |

`NODE_ENV=production` a Vercel define sozinha — é o que liga `SameSite=None` + `Secure` no
cookie.

### 3.3 O relógio da RF08

**Em serverless não existe processo entre requisições**, então o `setInterval` de T18 não tem
onde viver: ele nunca dispararia, e a varredura de inicialização rodaria a cada cold start —
inofensiva, porque é idempotente, mas é uma consulta ao estoque inteiro por partida. Por isso
`ALERTA_AGENDADOR_INTERNO=false` não é preferência, é requisito desta hospedagem.

Quem dispara a varredura é o cron da Vercel. O `backend/vercel.json` já versionado declara:

```json
{ "crons": [{ "path": "/interno/varredura-alertas", "schedule": "0 9 * * *" }] }
```

A plataforma chama a rota com `Authorization: Bearer $CRON_SECRET`; a comparação é em tempo
constante, e sem `CRON_SECRET` configurado a rota responde 503 — ela não existe por engano.

Quatro detalhes do cron que mudam o que esperar dele:

- O horário é **UTC**. `0 9` é 6h em Brasília.
- No plano Hobby o cron roda **no máximo uma vez por dia**; um agendamento mais frequente é
  recusado no deploy. Isso casa com a janela da RF08, que é medida em dias.
- A execução é garantida **dentro da hora**, não no minuto. Um job das 9h pode rodar às 9h47.
- O cron só dispara em **deploy de produção**. Preview não tem cron.

Confira no log da subida a linha `relógio da RF08: agendador interno desligado; a varredura
depende de agendador externo`. Se aparecer a outra, a variável não pegou.

**Saída de emergência**, para demonstrar ou para cobrir um dia em que o cron falhou:

```bash
DATABASE_URL="<url-com-pooler>" npm run alertas:varrer
```

Roda uma varredura agora e sai. É a mesma função que a rota chama.

## 4. Frontend — Vercel

**Add New → Project**, importando o mesmo repositório num **segundo** projeto:

| Campo | Valor |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Vite (detectado) |
| Build Command | `npm run build` (padrão) |
| Output Directory | `dist` (padrão) |

Variável de ambiente:

| Variável | Valor |
|---|---|
| `VITE_API_URL` | `https://<projeto-do-backend>.vercel.app`, sem barra no fim |

O `frontend/vercel.json` já versionado traz o rewrite que faz `/leitura`, `/produtos` e as
demais telas resolverem no `index.html`. Sem ele, abrir ou recarregar qualquer tela que não
seja a raiz devolve o 404 da Vercel — e o service worker **não** cobre esse caso, porque na
primeira visita ele ainda não está instalado.

## 5. Verificação pós-deploy

Nesta ordem — cada passo depende do anterior:

1. `curl https://<api>.vercel.app/health` → `{"status":"ok"}`.
2. Login pelo navegador. No DevTools, o cookie `sessao` precisa aparecer com `Secure` e
   `SameSite=None`. **Se falhar aqui, é `NODE_ENV` ou `FRONTEND_ORIGIN`.**
3. Abra `https://<frontend>.vercel.app/leitura` **direto na barra de endereço**, numa aba
   anônima (sem service worker instalado). Tem de abrir a tela, não um 404.
4. Instale o PWA no celular e leia uma etiqueta impressa com a câmera — fecha a verificação
   manual de T10 e permite fazer T16 em condição real.
5. Ligue o modo avião com o app instalado: tem de aparecer o bloqueio explícito da RNF07, não
   o erro de rede do navegador.
6. Chame a rota do cron à mão e confira que ela varre:
   ```bash
   curl -H "Authorization: Bearer <CRON_SECRET>" https://<api>.vercel.app/interno/varredura-alertas
   ```
   Com uma unidade dentro da janela e as notificações ativadas no aparelho, isso fecha a
   verificação manual de T19b. Confira também que **sem** o cabeçalho a resposta é 401.
7. Erre a senha onze vezes seguidas: a décima primeira tem de responder "Muitas tentativas".
8. Em **Contas de acesso**, crie a conta da atendente com a senha que ela vai usar e confira
   que ela entra. Desative uma conta de teste e confirme que ela deixa de entrar.
9. Deixe o sistema parado por 20 minutos e faça uma leitura de QR, cronometrando. É o pior
   caso do balcão — função fria **e** Neon suspenso — e é o número que você quer conhecer
   antes que a atendente o descubra com um cliente na frente.
10. No dia seguinte, confira em **Alertas** que a varredura das 9h UTC rodou sozinha. É a
    única parte do sistema cuja falha não aparece como erro: se o cron não disparou, a tela
    apenas não tem nada de novo.

## 6. Backup — o passo que não é opcional

O `EventoLog` é append-only e é a base do indicador do TCC (RF12). Perdê-lo não é perder o
estado da aplicação: é perder o material do artigo, que não se recupera refazendo o deploy.

Ao fim de cada dia de piloto:

```bash
pg_dump "<url-direta>" --format=custom --file="backup-$(date +%F).dump"
```

Guarde fora do Neon — o plano gratuito tem janela curta de retenção. Para restaurar num banco
vazio:

```bash
pg_restore --dbname="<url-direta-do-banco-novo>" --clean --if-exists backup-2026-09-15.dump
```

Teste a restauração **uma vez**, num banco descartável, antes de precisar dela.

## 7. Operação do dia a dia

| Preciso de... | Como |
|---|---|
| Rodar a varredura de alertas agora | `npm run alertas:varrer`, ou `curl` na rota do cron com o `CRON_SECRET` |
| Criar conta, desativar alguém, trocar papel | tela **Contas de acesso**, como GESTOR |
| Trocar a própria senha | tela **Minha senha**, qualquer papel |
| Destravar quem esqueceu a senha | **Contas de acesso** → Redefinir senha |
| Destravar o **gestor único** que esqueceu a própria senha | `npm run usuario:senha -- <email>` |
| Ver o que aconteceu no balcão | aba **Logs** do projeto do backend, com `LOG_LEVEL=info` |
| Conferir se o cron rodou | aba **Cron Jobs** do projeto do backend |
| Criar ou remover a massa de teste | `npm run ficticios:cadastrar` / `ficticios:remover` — seção 7.1 |
| Aplicar uma migração nova | `DIRECT_URL="<url-direta>" DATABASE_URL="<url-direta>" npx prisma migrate deploy` |

A regra das duas strings: a **direta** quando se escreve schema, a **com pooler** quando só se
lê e grava dado.

### 7.1 Produtos fictícios para testar em produção

Para testar o sistema publicado sem tocar no estoque real da loja, há uma planilha de produtos
fictícios e dois scripts: um que a cadastra e outro que remove do banco **tudo** o que esses
produtos deixaram.

**A marca é o prefixo `ZZ-` no código interno.** O cadastro recusa a planilha inteira se
alguma linha não tiver o prefixo, e a remoção apaga todo produto `ZZ-` do banco, inclusive o
que tiver sido criado à mão pela interface durante o roteiro de testes manuais. Por isso
**nenhum produto real pode ter código começando em `ZZ-`**.

**A planilha** é `backend/dados-ficticios/produtos-ficticios.csv`. Ela abre no Excel, no
LibreOffice ou no Google Planilhas, e deve ser salva como **CSV UTF-8** (no Excel: *CSV
UTF-8 (delimitado por vírgulas)*). O separador pode ser `;` ou `,`.

| Coluna | O que vai |
|---|---|
| `codigoInterno` | `ZZ-` + qualquer coisa. Maiúsculas e minúsculas dão no mesmo |
| `nome`, `marca`, `categoria` | Obrigatórios na primeira linha do produto. Nas seguintes podem ficar em branco |
| `validade` | `AAAA-MM-DD`, `DD/MM/AAAA`, ou relativa ao dia do cadastro: `HOJE`, `HOJE+60`, `HOJE-5` |
| `quantidade` | De 1 a 200 unidades com essa validade |

Cada linha é **uma validade de um produto**, como uma linha do recebimento. Um produto com
três validades ocupa três linhas. Com `validade` e `quantidade` em branco, o produto é criado
sem nenhuma unidade. Prefira a data relativa: a massa de teste "vencida há 5 dias" continua
sendo esse caso na semana seguinte. A planilha versionada é a massa da seção 3.1 do roteiro de
testes manuais.

**Cadastrar:**

```bash
cd backend
DATABASE_URL="<url-direta>" npm run ficticios:cadastrar -- <email-de-quem-registra> [planilha.csv]
```

A planilha é validada **inteira** antes de qualquer escrita. Se houver erro, a saída lista cada
um com o número da linha, e nada é gravado. O cadastro usa os mesmos serviços da interface:
cada unidade ganha `codigoQr`, aparece em **Etiquetas** para imprimir e gera seu
`UNIDADE_CADASTRADA`. A saída do script lista os códigos gerados. Produto que já existe é
pulado com todas as suas unidades, então rodar duas vezes não duplica o estoque de teste.

**Remover:**

```bash
DATABASE_URL="<url-direta>" npm run ficticios:remover                  # só mostra o que apagaria
DATABASE_URL="<url-direta>" npm run ficticios:remover -- --confirmar   # apaga
```

A remoção apaga os produtos `ZZ-` com suas unidades, saídas, descartes e alertas, **e os
eventos deles no `EventoLog`**. Essa é a única exceção à RNF05 no sistema. O porquê está em
`docs/decisoes.md` (2026-09-22). O trigger append-only fica desligado só dentro da transação
do script e volta a valer no commit, ou no rollback se algo falhar. Três cuidados:

- **Os dois scripts imprimem primeiro o banco de destino.** Confira antes de passar
  `--confirmar`: o mesmo comando roda contra o banco local e o de produção.
- **Fora do horário de atendimento.** Enquanto a remoção roda, o `EventoLog` fica travado, e
  toda leitura de QR espera por ela. São poucos segundos, mas o balcão para.
- **Faça o backup da seção 6 antes.** A remoção não tem desfazer.

O que ela **não** alcança: a leitura de um QR que não existe no banco. Esse evento não aponta
para produto nenhum, e fica.

## 8. O que este deploy não tem

Honestamente, para não descobrir no meio do piloto:

- **Contador de tentativas de login compartilhado.** O limite de T23 vive na memória da
  instância; com mais de uma instância ativa, o teto efetivo é instâncias × 10. Continua sendo
  freio contra varredura automatizada, deixa de ser teto exato.
- **Latência previsível na primeira requisição.** Função fria somada ao autosuspend do Neon:
  o passo 9 existe para você medir isso, não para consertar. O que já está feito é o desfecho:
  os prazos de transação (`db/opcoesDeTransacao.ts`) são generosos o bastante para que a
  primeira leitura do dia **demore** em vez de **falhar**.
- **Recuperação de senha por e-mail.** Quem esquece depende da gestora redefinir pela tela;
  não há link de "esqueci minha senha", porque não há serviço de envio configurado.
- **Segundo fator, expiração de senha, histórico de senhas usadas.** Nada disso está no PRD.
- **Backup automático.** A seção 6 é manual, e é você quem lembra.
- **Monitoramento.** Se o cron parar de disparar, ninguém é avisado — e o sintoma é ausência
  de alerta, não erro.
- **Ambiente de homologação.** O piloto escreve no mesmo banco que gera o dado do artigo.

## 9. Se mudar de hospedagem

O código não está preso à Vercel. O que precisa acompanhar a mudança:

- **Backend em processo persistente** (Fly.io, Render, Railway, VPS):
  `ALERTA_AGENDADOR_INTERNO=true` e o `setInterval` de T18 volta a ser o relógio — é a forma
  que a decisão original de T18 descreve. O `backend/vercel.json` deixa de ser lido, e o
  `CRON_SECRET` passa a ser opcional. Atenção a um detalhe que morde: hospedagem que **dorme**
  por inatividade (o plano gratuito do Render, por exemplo) é processo persistente no papel e
  não na prática — o intervalo de 24 h não chega a disparar, e o que roda é a varredura de
  inicialização a cada vez que o serviço acorda. O alerta in-app sobrevive; o push, que existe
  para alcançar quem não abriu o app, não.
- **Se a plataforma exigir build explícito** (Render, por exemplo): o build command precisa ser
  `npm install --include=dev && npm run build`. `prisma` e `typescript` são devDependencies, e
  `NODE_ENV=production` — que o runtime precisa para o cookie sair `Secure` — faz o
  `npm install` pulá-las. O sintoma é `tsc: not found`, que não sugere a causa.
- **Frontend em outra hospedagem estática**: configurar o equivalente ao rewrite de SPA. É
  obrigatório, não opcional.
- **Banco em outro provedor**: continuar dando duas strings, pooled e direta.
- **Frontend e API sob o mesmo domínio registrável** (`app.loja.com` e `api.loja.com`, ou um
  projeto só servindo os dois): o cookie pode voltar a `sameSite: 'lax'` em
  `modules/auth/cookie.ts`, que é a opção mais conservadora, e o CORS deixa de ser necessário.
  Hoje ele é `'none'` porque dois projetos em `.vercel.app` são cross-site.
