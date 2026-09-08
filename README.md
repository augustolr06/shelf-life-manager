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
| Backlog de tarefas com status | `tasks/backlog.md` |
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
`estoque123` — credenciais de desenvolvimento, não usar fora dele.

Verificação rápida:

```bash
curl http://localhost:3333/health   # {"status":"ok","uptime":...}
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

## Variáveis de ambiente (backend/.env)

| Variável | Descrição | Padrão |
|---|---|---|
| `DATABASE_URL` | String de conexão do PostgreSQL | — (obrigatória) |
| `PORT` | Porta do servidor Fastify | `3333` |
| `FRONTEND_ORIGIN` | Origem permitida do frontend (usada a partir de T03) | `http://localhost:5173` |

## Comandos

### Backend (`cd backend`)

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor em modo watch |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Roda o build de produção |
| `npm test` | Roda todos os testes (Vitest) — inclui os que exigem PostgreSQL |
| `npm run test:sem-banco` | Só as suítes com Prisma mockado, sem precisar de container |
| `npm run test:fifo` | Só a suíte da validação FIFO (exige PostgreSQL) |
| `npm run typecheck` | Checagem de tipos sem emitir, `src/` e `tests/` |
| `npm run prisma:generate` | Gera o Prisma Client |
| `npm run prisma:migrate` | Cria/aplica migração de desenvolvimento |
| `npm run prisma:seed` | Popula o banco com os usuários de desenvolvimento |
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
