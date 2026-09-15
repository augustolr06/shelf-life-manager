# Roteiro de deploy

Como subir este sistema num endereço público, e como operá-lo depois. Escrito em T23
(2026-09-09), para o piloto de dois usuários na perfumaria.

Quem procura *por que* cada decisão é assim: `docs/decisoes.md`, entradas de 2026-09-09.
Este arquivo é o passo a passo, não a justificativa.

## O que sobe onde

Três coisas, independentes:

| Peça | O quê | Observação |
|---|---|---|
| Banco | PostgreSQL gerenciado (Neon, Prisma Postgres, Supabase) | Precisa de **duas** strings: a com pooler e a direta |
| Backend | `backend/` — Fastify | Uma função serverless ou um processo persistente; o passo 4 muda conforme |
| Frontend | `frontend/` — build estático do Vite (PWA) | Só arquivos; `frontend/vercel.json` já traz o rewrite de SPA |

O frontend **precisa** de HTTPS: sem contexto seguro não há câmera (`getUserMedia`), não há
`crypto.randomUUID` — e sem ele o agrupamento por atendimento cai fora (T10) — e não há Web
Push (T19b).

## 1. Banco

Crie o Postgres na hospedagem escolhida e guarde as duas strings de conexão. Depois, da sua
máquina:

```bash
cd backend
DATABASE_URL="<url-com-pooler>" DIRECT_URL="<url-direta>" npx prisma migrate deploy
```

As migrações de `src/db/migrations/` sobem aqui. **Não** coloque `migrate deploy` no build: em
serverless ele rodaria concorrente a cada deploy.

## 2. Usuários

O `seed` cria as duas contas com a senha padrão de desenvolvimento, que **não pode** ficar num
endereço público. Rode o seed e troque as duas senhas em seguida:

```bash
DATABASE_URL="<url-direta>" npm run prisma:seed

DATABASE_URL="<url-direta>" npm run usuario:senha -- gestor@estoque.local
DATABASE_URL="<url-direta>" npm run usuario:senha -- atendente@estoque.local
```

A senha é lida do stdin (mínimo de 12 caracteres). Com pipe ela não aparece na tela:

```bash
printf '%s' 'a-senha-escolhida' | DATABASE_URL="<url-direta>" npm run usuario:senha -- gestor@estoque.local
```

A partir daqui a loja se vira sozinha: a gestora cria as demais contas, desativa quem sai e
redefine a senha de quem esquecer, tudo em **Contas de acesso** (T22). O script continua
sendo a saída de emergência para o caso que a interface não alcança — gestor único que
esqueceu a **própria** senha, e por isso não consegue entrar para redefini-la.

## 3. Backend — variáveis de ambiente

| Variável | Valor |
|---|---|
| `DATABASE_URL` | string **com pooler** |
| `DIRECT_URL` | string **direta** |
| `JWT_SECRET` | novo, nunca o do `.env` local — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FRONTEND_ORIGIN` | URL exata do frontend em produção, sem barra no fim |
| `NODE_ENV` | `production` — é o que liga `SameSite=None` + `Secure` no cookie |
| `ALERTA_AGENDADOR_INTERNO` | `false` em serverless, `true` em processo persistente (passo 4) |
| `CRON_SECRET` | outro valor aleatório, só se o agendador for externo |
| `LOG_LEVEL` | `info` no piloto (uma linha por requisição) |
| `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` | `npm run push:chaves`. Sem elas o push fica desligado e o resto sobe normal |

`prisma generate` roda sozinho no `postinstall`.

## 4. Backend — o relógio da RF08

A varredura de alertas (RF08) tem duas formas de ser disparada, e **exatamente uma** deve
estar ativa. As duas chamam a mesma função; o que muda é quem chama.

### Em hospedagem com processo persistente (Render, Fly, Railway, VPS)

Nada a fazer: `ALERTA_AGENDADOR_INTERNO=true` e o `setInterval` de T18 funciona. Confira no
log da subida a linha `relógio da RF08: agendador interno ligado`.

### Em hospedagem serverless (Vercel)

Não existe processo entre requisições: o intervalo nunca dispara.

1. `ALERTA_AGENDADOR_INTERNO=false`
2. `CRON_SECRET` definido
3. `backend/vercel.json` já declara o cron (`0 9 * * *`, que é **UTC** — 6h em Brasília)

A plataforma chama `GET /interno/varredura-alertas` com `Authorization: Bearer $CRON_SECRET`.
Sem `CRON_SECRET` a rota responde 503 e a RF08 fica sem relógio nenhum.

Detalhes que valem saber: no plano Hobby da Vercel o cron roda **no máximo uma vez por dia** e
a execução só é garantida dentro da hora; o cron só dispara em deploy de produção.

### Saída de emergência, em qualquer hospedagem

```bash
DATABASE_URL="<url-com-pooler>" npm run alertas:varrer
```

Roda uma varredura agora e sai. Serve para demonstrar, para cobrir um dia em que o agendador
falhou, e para operar o piloto sem configurar cron nenhum.

## 5. Frontend

| Variável | Valor |
|---|---|
| `VITE_API_URL` | URL do backend em produção, sem barra no fim |

Build `npm run build`, saída `dist/`. O `frontend/vercel.json` já traz o rewrite que faz
`/leitura`, `/produtos` e as demais telas resolverem no `index.html` — sem ele, recarregar
qualquer tela que não seja a raiz devolve 404 da hospedagem. Em outra hospedagem, configure o
equivalente: é obrigatório, não opcional.

## 6. Verificação pós-deploy

Nesta ordem — cada passo depende do anterior:

1. `curl https://<api>/health` → `{"status":"ok"}`
2. Login pelo navegador. No DevTools, o cookie `sessao` precisa aparecer com `Secure` e
   `SameSite=None`. **Se falhar aqui, é `NODE_ENV` ou `FRONTEND_ORIGIN`.**
3. Abra `https://<frontend>/leitura` **direto na barra de endereço**, com uma aba anônima
   (sem service worker instalado). Tem de abrir a tela, não um 404.
4. Instale o PWA no celular e leia uma etiqueta impressa com a câmera (fecha a verificação
   manual de T10 e permite fazer T16 em condição real).
5. Ligue o modo avião com o app instalado: tem de aparecer o bloqueio explícito da RNF07, não
   o erro de rede do navegador.
6. Ative as notificações no aparelho e dispare `npm run alertas:varrer` com uma unidade dentro
   da janela — fecha a verificação manual de T19b.
7. Erre a senha onze vezes seguidas: a décima primeira tem de responder "Muitas tentativas".
8. Em **Contas de acesso**, crie a conta da atendente com a senha que ela vai usar, e confira
   que ela entra. Desative uma conta de teste e confirme que ela deixa de entrar.

## 7. Backup — o passo que não é opcional

O `EventoLog` é append-only e é a base do indicador do TCC (RF12). Perdê-lo não é perder o
estado da aplicação: é perder o material do artigo, que não se recupera refazendo o deploy.

Ao fim de cada dia de piloto:

```bash
pg_dump "<url-direta>" --format=custom --file="backup-$(date +%F).dump"
```

Guarde fora da hospedagem (o plano gratuito de um banco gerenciado costuma ter janela curta de
retenção, ou nenhuma). Para restaurar num banco vazio:

```bash
pg_restore --dbname="<url-direta-do-banco-novo>" --clean --if-exists backup-2026-09-09.dump
```

Teste a restauração **uma vez**, num banco descartável, antes de precisar dela.

## 8. Operação do dia a dia

| Preciso de... | Comando |
|---|---|
| Rodar a varredura de alertas agora | `npm run alertas:varrer` |
| Criar conta, desativar alguém, trocar papel | tela **Contas de acesso**, como GESTOR |
| Trocar a própria senha | tela **Minha senha**, qualquer papel |
| Destravar quem esqueceu a senha | **Contas de acesso** → Redefinir senha |
| Destravar o **gestor único** que esqueceu a própria senha | `npm run usuario:senha -- <email>` |
| Ver o que aconteceu no balcão | log da hospedagem, com `LOG_LEVEL=info` |
| Aplicar uma migração nova | `DATABASE_URL="<url-direta>" npx prisma migrate deploy` |

Todos usam a string **direta** quando escrevem schema, e a **com pooler** quando só leem e
gravam dados.

## 9. O que este deploy não tem

Honestamente, para não descobrir no meio do piloto:

- **Recuperação de senha por e-mail.** Quem esquece depende da gestora redefinir pela tela;
  não há link de "esqueci minha senha", porque não há serviço de envio configurado.
- **Segundo fator, expiração de senha, histórico de senhas usadas.** Nada disso está no PRD.
- **Contador de tentativas compartilhado entre instâncias.** O limite de login vive na memória
  do processo: em serverless com várias instâncias, o teto efetivo é instâncias × 10.
- **Backup automático.** O passo 7 é manual, e é você quem lembra.
- **Monitoramento.** Se o backend cair de madrugada, ninguém é avisado — e, com o agendador
  interno, a varredura daquele dia não acontece (trade-off registrado desde T18).
- **Ambiente de homologação.** O piloto escreve no mesmo banco que gera o dado do artigo.
