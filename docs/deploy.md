# Roteiro de deploy

Como subir este sistema num endereço público, e como operá-lo depois. Escrito em T23
(2026-09-09) e fixado na hospedagem escolhida em 2026-09-15, para o piloto na perfumaria.

**A pilha decidida:** frontend na **Vercel**, backend no **Render**, banco no **Neon**.
O porquê está em `docs/decisoes.md`; este arquivo é o passo a passo. O código continua
portátil — a seção 9 diz o que muda se algum dos três for trocado.

## O que sobe onde

| Peça | Onde | Observação |
|---|---|---|
| Banco | Neon | Duas strings de conexão: a **com pooler** e a **direta** |
| Backend (`backend/`) | Render, Web Service | Processo persistente: o relógio da RF08 roda dentro dele (seção 3.3) |
| Frontend (`frontend/`) | Vercel | Build estático do Vite; `frontend/vercel.json` já traz o rewrite de SPA |

Os três puxam do mesmo repositório (`augustolr06/shelf-life-manager`), cada um apontando para
sua pasta.

O frontend **precisa** de HTTPS, e é por isso que ele não pode ser servido de qualquer jeito:
sem contexto seguro não há câmera (`getUserMedia`), não há `crypto.randomUUID` — e sem ele o
agrupamento por atendimento cai fora (T10) — e não há Web Push (T19b).

## Ordem, e o ovo e a galinha das URLs

O backend precisa saber a URL do frontend (`FRONTEND_ORIGIN`, para o CORS) e o frontend
precisa saber a do backend (`VITE_API_URL`). Uma depende da outra, mas as duas são previsíveis
antes de existirem:

- Render: `https://<nome-do-serviço>.onrender.com`
- Vercel: `https://<nome-do-projeto>.vercel.app`

Escolha os dois nomes antes de começar e preencha as variáveis já com eles. Se errar, o
sintoma é login que não completa — e o conserto é corrigir `FRONTEND_ORIGIN` e reimplantar.

## 1. Banco — Neon

1. Crie um projeto no Neon (PostgreSQL 15+, como pede `docs/arquitetura.md`).
2. Copie as **duas** strings de conexão. Elas diferem por um sufixo no host:
   - **com pooler** — o host termina em `-pooler`. É o `DATABASE_URL` da aplicação.
   - **direta** — sem `-pooler`. É o `DIRECT_URL`, usado só pelo `prisma migrate`.

As duas são obrigatórias, e trocá-las de lugar falha de formas diferentes: a aplicação na
direta esgota conexão, e a migração pelo pooler **falha sempre** — `migrate deploy` se
serializa com um advisory lock de sessão, que o pooler em modo transaction não sustenta.

> **Autosuspend.** O Neon suspende a computação após ~5 minutos ociosa, em todos os planos. A
> primeira consulta depois disso acorda o banco e demora mais que as outras. Some isso ao
> spin-down do Render (seção 3.3) e você tem a primeira leitura do dia mais lenta que as
> demais — previsto, não é defeito.

## 2. Migração e usuários

Da sua máquina, uma vez:

```bash
cd backend
DATABASE_URL="<url-com-pooler>" DIRECT_URL="<url-direta>" npx prisma migrate deploy
```

**Não** coloque `migrate deploy` no build do Render: ele rodaria a cada deploy, e uma migração
é ato deliberado.

Depois, as contas. O `seed` cria as duas com a senha padrão de desenvolvimento, que **não
pode** ficar num endereço público — troque as duas em seguida:

```bash
DATABASE_URL="<url-direta>" npm run prisma:seed

printf '%s' 'a-senha-da-gestora'  | DATABASE_URL="<url-direta>" npm run usuario:senha -- gestor@estoque.local
printf '%s' 'a-senha-da-atendente' | DATABASE_URL="<url-direta>" npm run usuario:senha -- atendente@estoque.local
```

A senha é lida do stdin (mínimo de 12 caracteres); com `printf` ela não aparece na tela nem
no histórico do shell, desde que você não repita o comando com a senha depois.

A partir daqui a loja se vira sozinha: a gestora cria as demais contas, desativa quem sai e
redefine a senha de quem esquecer, em **Contas de acesso** (T22). O script continua sendo a
saída de emergência para o caso que a interface não alcança — gestor único que esqueceu a
**própria** senha, e por isso não consegue entrar para redefini-la.

## 3. Backend — Render

### 3.1 O serviço

**New → Web Service**, apontando para o repositório:

| Campo | Valor |
|---|---|
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm install --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/health` |

> **O `--include=dev` não é enfeite.** O Render aplica as variáveis do painel **também no
> build**, e `NODE_ENV=production` (que o runtime precisa, senão o cookie não sai `Secure`)
> faz o `npm install` pular as devDependencies. Neste projeto isso derruba o build duas vezes:
> `prisma` e `typescript` são devDependencies, então falham o `postinstall`
> (`prisma generate`) e o `npm run build` (`tsc`). O sintoma é `tsc: not found` ou um Prisma
> Client desatualizado.

### 3.2 Variáveis de ambiente

| Variável | Valor |
|---|---|
| `DATABASE_URL` | string **com pooler** do Neon |
| `DIRECT_URL` | string **direta** do Neon |
| `JWT_SECRET` | novo, nunca o do `.env` local — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FRONTEND_ORIGIN` | `https://<projeto>.vercel.app`, sem barra no fim |
| `NODE_ENV` | `production` — é o que liga `SameSite=None` + `Secure` no cookie |
| `ALERTA_AGENDADOR_INTERNO` | `true` (Render é processo persistente) |
| `CRON_SECRET` | só se você montar o cron externo da seção 3.3 |
| `LOG_LEVEL` | `info` no piloto — uma linha por requisição |
| `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` | `npm run push:chaves`. Sem elas o push fica desligado e o resto sobe normal |

### 3.3 O relógio da RF08, e o spin-down do plano free

Em processo persistente o `setInterval` de T18 é o relógio: `ALERTA_AGENDADOR_INTERNO=true`, e
a linha `relógio da RF08: agendador interno ligado` aparece no log da subida.

**No plano free do Render isso tem uma ressalva que muda o comportamento da RF08.** O serviço
é desligado após 15 minutos sem requisição, e volta em 30–60 segundos na requisição seguinte.
O que isso faz com o relógio, concretamente:

- O intervalo de 24 h **quase nunca chega a disparar**: o processo raramente vive tanto.
- Em compensação, a varredura de inicialização roda **a cada vez que o serviço acorda** — e ela
  é idempotente, então repetir não emite alerta duplicado.
- Na prática, a varredura acontece na **primeira requisição do dia**, que costuma ser o login
  da manhã. O alerta in-app funciona.
- O que se perde é a outra metade da RF08: **o push não chega a quem não abriu o app**, porque
  nada roda enquanto ninguém usa o sistema. Num dia em que a loja não abrir o app, não há
  varredura nenhuma.

Três saídas, em ordem de custo:

1. **Plano Starter (pago).** Sem spin-down, o `setInterval` funciona como projetado e a
   primeira leitura do dia deixa de ser lenta. É o que eu faria se o piloto for medir tempo de
   atendimento — o cold start contamina justamente esse número.
2. **Cron externo, de graça.** Um workflow agendado no GitHub Actions chamando a rota faz duas
   coisas ao mesmo tempo: dispara a varredura e acorda o serviço. Defina `CRON_SECRET` no
   Render e o mesmo valor como *secret* do repositório:

   ```yaml
   # .github/workflows/varredura-alertas.yml
   on:
     schedule:
       - cron: '0 9 * * *'   # 9h UTC = 6h em Brasília
     workflow_dispatch:
   jobs:
     varrer:
       runs-on: ubuntu-latest
       steps:
         - run: |
             curl --fail --show-error --silent \
               -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
               https://<nome-do-serviço>.onrender.com/interno/varredura-alertas
   ```

   Sem `CRON_SECRET` no Render a rota responde 503 — ela não existe por engano.
3. **Manual.** `npm run alertas:varrer` da sua máquina, apontando `DATABASE_URL` para o Neon.
   Roda uma varredura agora e sai. Serve para demonstração e para cobrir um dia em que o
   agendador falhou.

## 4. Frontend — Vercel

**Add New → Project**, importando o mesmo repositório:

| Campo | Valor |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Vite (detectado) |
| Build Command | `npm run build` (padrão) |
| Output Directory | `dist` (padrão) |

Variável de ambiente:

| Variável | Valor |
|---|---|
| `VITE_API_URL` | `https://<nome-do-serviço>.onrender.com`, sem barra no fim |

O `frontend/vercel.json` já versionado traz o rewrite que faz `/leitura`, `/produtos` e as
demais telas resolverem no `index.html`. Sem ele, abrir ou recarregar qualquer tela que não
seja a raiz devolve o 404 da Vercel — e o service worker **não** cobre esse caso, porque na
primeira visita ele ainda não está instalado.

## 5. Verificação pós-deploy

Nesta ordem — cada passo depende do anterior:

1. `curl https://<api>.onrender.com/health` → `{"status":"ok"}`. No plano free, a **primeira**
   chamada pode demorar até um minuto; é o spin-down, não falha.
2. Login pelo navegador. No DevTools, o cookie `sessao` precisa aparecer com `Secure` e
   `SameSite=None`. **Se falhar aqui, é `NODE_ENV` ou `FRONTEND_ORIGIN`.**
3. Abra `https://<frontend>.vercel.app/leitura` **direto na barra de endereço**, numa aba
   anônima (sem service worker instalado). Tem de abrir a tela, não um 404.
4. Instale o PWA no celular e leia uma etiqueta impressa com a câmera — fecha a verificação
   manual de T10 e permite fazer T16 em condição real.
5. Ligue o modo avião com o app instalado: tem de aparecer o bloqueio explícito da RNF07, não
   o erro de rede do navegador.
6. Ative as notificações no aparelho e dispare a varredura (seção 3.3) com uma unidade dentro
   da janela — fecha a verificação manual de T19b.
7. Erre a senha onze vezes seguidas: a décima primeira tem de responder "Muitas tentativas".
8. Em **Contas de acesso**, crie a conta da atendente com a senha que ela vai usar e confira
   que ela entra. Desative uma conta de teste e confirme que ela deixa de entrar.
9. Deixe o sistema parado por 20 minutos e faça uma leitura de QR. É o pior caso do balcão —
   Render dormindo **e** Neon suspenso — e é o número que você quer conhecer antes que a
   atendente o descubra com um cliente na frente.

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
| Rodar a varredura de alertas agora | `npm run alertas:varrer`, ou o `workflow_dispatch` do workflow da seção 3.3 |
| Criar conta, desativar alguém, trocar papel | tela **Contas de acesso**, como GESTOR |
| Trocar a própria senha | tela **Minha senha**, qualquer papel |
| Destravar quem esqueceu a senha | **Contas de acesso** → Redefinir senha |
| Destravar o **gestor único** que esqueceu a própria senha | `npm run usuario:senha -- <email>` |
| Ver o que aconteceu no balcão | aba **Logs** do serviço no Render, com `LOG_LEVEL=info` |
| Aplicar uma migração nova | `DIRECT_URL="<url-direta>" DATABASE_URL="<url-direta>" npx prisma migrate deploy` |

A regra das duas strings: a **direta** quando se escreve schema, a **com pooler** quando só se
lê e grava dado.

## 8. O que este deploy não tem

Honestamente, para não descobrir no meio do piloto:

- **Continuidade no plano free.** Render dorme em 15 min, Neon suspende em 5. A primeira
  requisição depois disso é lenta, e a varredura automática depende de alguém acordar o
  serviço (seção 3.3).
- **Recuperação de senha por e-mail.** Quem esquece depende da gestora redefinir pela tela;
  não há link de "esqueci minha senha", porque não há serviço de envio configurado.
- **Segundo fator, expiração de senha, histórico de senhas usadas.** Nada disso está no PRD.
- **Backup automático.** A seção 6 é manual, e é você quem lembra.
- **Monitoramento.** Se o backend cair de madrugada, ninguém é avisado.
- **Ambiente de homologação.** O piloto escreve no mesmo banco que gera o dado do artigo.

Uma coisa que o plano free **não** tira: como o Render mantém uma instância só, o contador de
tentativas de login (T23) é exato — ele vive na memória do processo, e só seria aproximado com
várias instâncias.

## 9. Se mudar de hospedagem

O código não está preso a nenhum dos três. O que precisa acompanhar a mudança:

- **Backend em serverless** (Vercel, por exemplo): `ALERTA_AGENDADOR_INTERNO=false` e um cron
  da plataforma chamando `GET /interno/varredura-alertas` com o `CRON_SECRET` — não há
  processo entre requisições para o `setInterval` viver. O `backend/vercel.json` já versionado
  declara esse cron, e existe só para esse cenário; com o backend no Render, ele não é lido
  por ninguém.
- **Frontend em outra hospedagem estática**: configurar o equivalente ao rewrite de SPA. É
  obrigatório, não opcional.
- **Banco em outro provedor**: continuar dando duas strings, pooled e direta.
- **Frontend e API sob o mesmo domínio registrável** (`app.loja.com` e `api.loja.com`): o
  cookie pode voltar a `sameSite: 'lax'` em `modules/auth/cookie.ts`, que é a opção mais
  conservadora. Hoje ele é `'none'` porque `.vercel.app` e `.onrender.com` são cross-site.
