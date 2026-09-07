# T02 — Schema Prisma completo + migração inicial

**Depende de:** T01
**Incremento:** 1 (Fundação)

## Objetivo
Implementar o schema Prisma completo definido em `docs/arquitetura.md` seção 3 e gerar a primeira migração.

## Critério de aceite
- [x] Todas as entidades da seção 3 de `docs/arquitetura.md` presentes em `schema.prisma`: `Usuario`, `Produto`, `UnidadeProduto`, `Saida`, `Descarte`, `ConfiguracaoAlerta`, `Alerta`, `EventoLog`
- [x] `UnidadeProduto.dataValidade` mapeado como `@db.Date` (RNF01) — confirmar que o tipo gerado no Postgres é `DATE`, não `TIMESTAMP`
- [x] Índice composto `(produtoId, status, dataValidade)` em `UnidadeProduto` presente na migração
- [x] Índice único em `UnidadeProduto.codigoQr`
- [x] Migração roda limpa em um banco vazio (`prisma migrate dev`)
- [x] Seed script mínimo (`src/db/seed.ts` — ver decisão de 2026-09-07) com 1 usuário GESTOR e 1 usuário ATENDENTE para facilitar testes manuais nas próximas tarefas

## Notas técnicas
- Schema de referência completo está em `docs/arquitetura.md` seção 3 — copiar e ajustar, não redesenhar do zero.
- `EventoLog` não deve ter `@updatedAt` nem qualquer campo que sugira atualização (RNF05).

## Fora de escopo desta tarefa
Endpoints de API, autenticação, lógica de negócio.
