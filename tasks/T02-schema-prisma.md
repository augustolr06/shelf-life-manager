# T02 — Schema Prisma completo + migração inicial

**Depende de:** T01
**Incremento:** 1 (Fundação)

## Objetivo
Implementar o schema Prisma completo definido em `docs/arquitetura.md` seção 3 e gerar a primeira migração.

## Critério de aceite
- [ ] Todas as entidades da seção 3 de `docs/arquitetura.md` presentes em `schema.prisma`: `Usuario`, `Produto`, `UnidadeProduto`, `Saida`, `Descarte`, `ConfiguracaoAlerta`, `Alerta`, `EventoLog`
- [ ] `UnidadeProduto.dataValidade` mapeado como `@db.Date` (RNF01) — confirmar que o tipo gerado no Postgres é `DATE`, não `TIMESTAMP`
- [ ] Índice composto `(produtoId, status, dataValidade)` em `UnidadeProduto` presente na migração
- [ ] Índice único em `UnidadeProduto.codigoQr`
- [ ] Migração roda limpa em um banco vazio (`prisma migrate dev`)
- [ ] Seed script mínimo (`prisma/seed.ts`) com 1 usuário GESTOR e 1 usuário ATENDENTE para facilitar testes manuais nas próximas tarefas

## Notas técnicas
- Schema de referência completo está em `docs/arquitetura.md` seção 3 — copiar e ajustar, não redesenhar do zero.
- `EventoLog` não deve ter `@updatedAt` nem qualquer campo que sugira atualização (RNF05).

## Fora de escopo desta tarefa
Endpoints de API, autenticação, lógica de negócio.
