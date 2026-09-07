# Log de Decisões de Design

Formato: cada entrada tem data, decisão e justificativa. Nunca editar entradas antigas — só adicionar novas. Se uma decisão for revertida, registre a reversão como nova entrada, não apague a anterior.

## 2026-08-25 — Decisões herdadas do PRD (congeladas antes do início da implementação)

**Unidade vencida no momento da venda (PRD seção 6.1).** O sistema permite a saída de unidade vencida mediante confirmação explícita registrada (correção de dado, descarte, ou override restrito ao GESTOR com justificativa obrigatória) — não bloqueia em definitivo. Justificativa: dar ao gestor uma via de decisão comercial consciente, mas com fricção deliberada e registro imutável, coerente com a legislação de defesa do consumidor.

**Venda multi-item (PRD seção 6.2).** Cada item é um ciclo de validação FIFO independente e sequencial. Sem entidade de carrinho, sem estado intermediário no servidor. Justificativa: elimina uma classe inteira de bugs de estado e minimiza a janela de concorrência do lock.

**Status derivado, não persistido.** "Vencida" é um predicado (`dataValidade < hoje`), não um valor de `status`. Justificativa: evita depender de um job diário cuja falha corromperia os dados da pesquisa.

## 2026-08-25 — Stack técnica

**Backend: Node.js + TypeScript + Fastify.** Escolhido por validação de schema nativa (JSON Schema), adequada ao contrato rígido do veredito FIFO, e por baixo overhead (ajuda RNF06).

**ORM: Prisma sobre PostgreSQL.** Prisma pela DX e migrações versionadas; PostgreSQL por suportar `SELECT ... FOR UPDATE` nativamente (RNF02) e tipo `DATE` (RNF01).

**Frontend: React + Vite, PWA via `vite-plugin-pwa`.** SPA leve, plugin de PWA maduro, boa integração com bibliotecas de leitura de QR via câmera.

**Autenticação: JWT em cookie httpOnly + bcrypt.** Simplicidade — sem estado de sessão a gerenciar no servidor, atende RF01 e RNF09.

**Testes: Vitest.** Mesma toolchain do Vite, TypeScript nativo, rápido.

## 2026-09-07 — Decisões de setup (T01)

**Raiz do repositório movida para a raiz do diretório do projeto.** `CLAUDE.md`, `docs/` e `tasks/` estavam aninhados em `estoque-fifo-context/context/`; foram movidos para a raiz, onde `backend/` e `frontend/` também foram criados. Justificativa: alinha o repositório ao diagrama da seção 2 de `docs/arquitetura.md`, que trata `/backend`, `/frontend`, `/docs` e `/tasks` como irmãos na raiz.

**PostgreSQL de desenvolvimento provisionado via Docker Compose, na porta 5434.** `docker-compose.yml` na raiz sobe um `postgres:16-alpine`. Justificativa: reprodutibilidade do ambiente para a banca e para qualquer máquina, sem depender de instalação nativa nem de privilégios de superusuário no banco. A porta 5434 foi escolhida porque 5432 e 5433 já estavam ocupadas na máquina de desenvolvimento; o `DATABASE_URL` é configurável, então quem já tiver um PostgreSQL 15+ local pode apontar para ele e ignorar o container.

**Schema Prisma em `backend/src/db/schema.prisma`, fora do caminho padrão.** O caminho é declarado em `backend/prisma.config.ts` (`defineConfig({ schema })`), e não pela chave `prisma` do `package.json`, que está depreciada no Prisma 6 e removida no 7. Justificativa: `docs/arquitetura.md` seção 2 posiciona o schema em `src/db/`. Consequência prática: as migrações de T02 serão geradas em `backend/src/db/migrations/`.

**`/health` é liveness puro, sem checar o banco.** Retorna 200 com `status` e `uptime`, sem tocar no PostgreSQL. Justificativa: T01 exige apenas que o endpoint responda 200, e o endpoint precisa continuar respondendo mesmo com o banco fora do ar para que o frontend distinga "backend inalcançável" (RNF07, `docs/arquitetura.md` seção 6) de "backend de pé, banco com problema". Se o fluxo de leitura de QR precisar de um sinal de prontidão do banco, isso entra como endpoint separado em T08/T10.

**Testes do frontend com Vitest + Testing Library em ambiente jsdom.** Justificativa: `docs/arquitetura.md` fixa Vitest, mas não o ambiente de renderização; jsdom + `@testing-library/react` é o par padrão para testar componentes React sob Vitest, e evita rediscussão quando as telas chegarem em T10.
