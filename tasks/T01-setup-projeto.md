# T01 — Setup do projeto

**Depende de:** —
**Incremento:** 1 (Fundação)

## Objetivo
Criar a estrutura inicial de backend e frontend conforme `docs/arquitetura.md` seção 2, com as ferramentas configuradas mas sem lógica de negócio ainda.

## Critério de aceite
- [x] Monorepo com pastas `/backend` e `/frontend` conforme a estrutura da seção 2 de `docs/arquitetura.md`
- [x] Backend: Fastify rodando com um endpoint `/health` respondendo 200
- [x] Backend: Prisma instalado e conectado ao PostgreSQL (via `.env` com `DATABASE_URL`)
- [x] Frontend: projeto Vite + React + TypeScript rodando
- [x] Frontend: `vite-plugin-pwa` configurado (manifest básico, sem service worker customizado ainda)
- [x] Vitest configurado em ambos os lados, com um teste trivial passando em cada
- [x] Git inicializado, `.gitignore` cobrindo `node_modules`, `.env`, build outputs
- [x] `README.md` na raiz com instruções de setup local (variáveis de ambiente, comandos de start)

## Notas técnicas
- Ver `docs/arquitetura.md` seção 1 para versões e escolhas de stack.
- Não criar ainda o schema Prisma completo — isso é T02.
- Não implementar autenticação — isso é T03.

## Fora de escopo desta tarefa
Qualquer entidade de domínio, autenticação, ou lógica de negócio.
