# Controle de Estoque FIFO por Validade

Sistema de controle de estoque por unidade física (QR Code único por item), com saída
obrigatoriamente FIFO por **data de validade** — não por data de entrada.

Trabalho de Conclusão de Curso — Sistemas de Informação, UNIFEI.

## Documentação

| Preciso de... | Arquivo |
|---|---|
| Contexto do projeto e regras de trabalho | `CLAUDE.md` |
| Stack, modelo de dados, contratos de API, função FIFO | `docs/arquitetura.md` |
| Histórico de decisões de design | `docs/decisoes.md` |
| Pontos de decisão e descobertas para o artigo do TCC | `docs/notas-para-artigo.md` |
| Backlog de tarefas com status | `tasks/backlog.md` |
| Como subir e operar em produção | `docs/deploy.md` |
| Requisitos originais completos | `docs/PRD-original.md` |

## Estrutura

```
backend/    Node.js 20+ / TypeScript / Fastify / Prisma / PostgreSQL
frontend/   React / Vite / TypeScript / PWA
docs/       Documentação de arquitetura e decisões
tasks/      Backlog e detalhamento de tarefas
```

## Pré-requisitos

- Node.js 20 ou superior (desenvolvido com 22)
- Docker e Docker Compose (para o PostgreSQL de desenvolvimento)

Se preferir usar um PostgreSQL 15+ já instalado na máquina em vez do container,
basta apontar `DATABASE_URL` para ele e pular o passo do Docker.

## Setup local

### 1. Banco de dados

```bash
docker compose up -d
```

Sobe um PostgreSQL 16 em `localhost:5434` (usuário `estoque`, senha `estoque`,
banco `estoque_fifo`). A porta 5434 foi escolhida para não conflitar com
instâncias nativas em 5432/5433 — veja `docker-compose.yml`.

### 2. Backend

```bash
cd backend
cp .env.example .env      # ajuste DATABASE_URL se não estiver usando o Docker
npm install
npm run prisma:migrate    # aplica as migrações e gera o Prisma Client
npm run prisma:seed       # cria um usuário GESTOR e um ATENDENTE
npm run dev               # http://localhost:3333
```

O seed é idempotente: rodar de novo não duplica usuários. Ele cria
`gestor@estoque.local` e `atendente@estoque.local`, ambos com a senha
`estoque123` — credenciais de desenvolvimento, não usar fora dele. Cria também
`sistema@estoque.local`, a conta que assina os eventos da varredura automática
de alertas (T18): ela não autentica, e nenhuma senha entra nela.

Verificação rápida:

```bash
curl http://localhost:3333/health   # {"status":"ok","uptime":...}
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env      # opcional: só se o backend não estiver em localhost:3333
npm install
npm run dev               # http://localhost:5173
```

## Variáveis de ambiente (backend/.env)

| Variável | Descrição | Padrão |
|---|---|---|
| `DATABASE_URL` | String de conexão do PostgreSQL | — (obrigatória) |
| `JWT_SECRET` | Segredo de assinatura do JWT de sessão (T03). Gere o seu: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | — (obrigatória) |
| `PORT` | Porta do servidor Fastify | `3333` |
| `FRONTEND_ORIGIN` | Origem permitida do frontend (usada a partir de T03) | `http://localhost:5173` |
| `ALERTA_INTERVALO_HORAS` | Intervalo da varredura de alertas proativos, em horas (T18) | `24` |
| `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` | Par de chaves do Web Push (T19b). **Opcionais**: sem elas o servidor sobe inteiro e só a notificação push fica desligada — as rotas de inscrição respondem 503. Gere o par com `npm run push:chaves`; trocá-lo depois invalida todas as inscrições existentes | — (vazias) |
| `VAPID_SUBJECT` | Contato exigido pela RFC 8292 (`mailto:` ou `https:`) | `mailto:estoque@exemplo.local` |

`backend/.env.example` traz todas elas comentadas — é a referência que acompanha o
código; esta tabela existe para ser lida antes de copiar o arquivo.

### Frontend (`frontend/.env`)

| Variável | Descrição | Padrão |
|---|---|---|
| `VITE_API_URL` | URL do backend Fastify. O frontend roda em 5173 e o backend em 3333, então as chamadas são cross-origin (CORS com credenciais, T03) | `http://localhost:3333` |

## Comandos

### Backend (`cd backend`)

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor em modo watch |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Roda o build de produção |
| `npm test` | Roda todos os testes (Vitest) — inclui os que exigem PostgreSQL |
| `npm run test:sem-banco` | Só as suítes que não usam banco, sem precisar de container |
| `npm run test:fifo` | Só a suíte da validação FIFO (exige PostgreSQL) |
| `npm run test:saida` · `test:evento-log` · `test:excecao` · `test:descarte` · `test:etiquetas` · `test:alerta` · `test:push` · `test:dashboard` | Uma suíte de banco por vez (todas exigem PostgreSQL) |
| `npm run typecheck` | Checagem de tipos sem emitir, `src/` e `tests/` |
| `npm run prisma:generate` | Gera o Prisma Client |
| `npm run prisma:migrate` | Cria/aplica migração de desenvolvimento |
| `npm run prisma:seed` | Popula o banco com os usuários de desenvolvimento, a janela de alerta padrão e a conta de sistema |
| `npm run alertas:varrer` | Roda uma varredura de alertas proativos agora e sai (T18). O caminho normal é o agendador dentro do servidor |
| `npm run usuario:senha` | Troca a senha de um usuário existente: `npm run usuario:senha -- <email>`, com a senha lida do stdin (T23). Recusa senha com menos de 12 caracteres e a conta de sistema |
| `npm run push:chaves` | Gera um par de chaves VAPID para o Web Push e imprime as linhas prontas para o `.env` (T19b). Não escreve em arquivo nenhum |
| `npm run prisma:studio` | Abre o Prisma Studio |

#### Testes que exigem PostgreSQL

A partir de T06 a validação FIFO é testada contra um banco de verdade: o lock
`SELECT ... FOR UPDATE` da RNF02 e a semântica de `DATE` da RNF01 não existem
fora do PostgreSQL. Essas suítes usam o banco **`estoque_fifo_test`**, separado
do de desenvolvimento — elas truncam todas as tabelas entre os testes.

Para rodá-las, copie `backend/.env.test.example` para `backend/.env.test` e
suba o container (`docker compose up -d`). O banco de teste e as migrações são
criados sozinhos na primeira execução. Sem container, use
`npm run test:sem-banco`.

**Convenção de organização das suítes.** Suíte que exige PostgreSQL mora em uma
**subpasta** de `tests/` (`tests/fifo/`, `tests/saida/`, `tests/evento-log/`,
`tests/excecao-vencido/`, `tests/descarte/`, `tests/etiquetas/`, `tests/alerta/`,
`tests/push/`, `tests/dashboard/`); suíte que roda sem banco é **arquivo solto**
em `tests/`. Não é só arrumação: é o critério que `npm run test:sem-banco` usa
(`--exclude "tests/*/**"`). Uma suíte nova de banco criada em subpasta já nasce
excluída do script, sem editar `package.json` — e uma suíte **sem** banco precisa
ficar solta em `tests/`, ou será pulada em silêncio.
A exceção é `tests/apoio/`, que não tem suíte nenhuma: são os utilitários que as
outras importam, e por isso a regra por pasta a ignora sem prejuízo.

**Estado atual:** os 46 casos de `tests/fifo/validarSaidaFifo.test.ts` passam.
A suíte foi escrita antes da implementação, como exige a seção 8 do PRD, e
fazê-la passar sem editá-la foi a tarefa T07. Três desses casos só passam com o
lock da RNF02: sem o `FOR UPDATE`, a leitura concorrente perdedora estoura na
restrição de unicidade de `Saida` em vez de devolver um veredito.

O schema Prisma fica em `backend/src/db/schema.prisma` (não no caminho padrão
`prisma/schema.prisma`) — o caminho está declarado em `backend/prisma.config.ts`,
que também aponta o comando de seed. As migrações ficam em
`backend/src/db/migrations/` e o seed em `backend/src/db/seed.ts`.

### Frontend (`cd frontend`)

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento Vite |
| `npm run build` | Build de produção (gera manifest e service worker do PWA) |
| `npm run preview` | Serve o build de produção localmente |
| `npm test` | Roda os testes (Vitest + Testing Library) |
| `npm run typecheck` | Checagem de tipos |

O PWA só gera manifest e service worker no build — em `npm run dev` eles não
são produzidos por padrão.
