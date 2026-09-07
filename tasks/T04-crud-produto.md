# T04 — CRUD de Produto (catálogo)

**Depende de:** T02, T03
**Incremento:** 1 (Fundação)

## Objetivo
Implementar o CRUD de `Produto` (RF02): código interno, nome, marca, categoria.

## Critério de aceite
- [x] `POST /produtos` (GESTOR) — cria produto, `codigoInterno` único (erro claro em duplicata)
- [x] `GET /produtos` — lista com paginação simples e busca por nome/código
- [x] `GET /produtos/:id` — detalhe
- [x] `PATCH /produtos/:id` (GESTOR) — edição
- [x] `DELETE /produtos/:id` (GESTOR) — **inativa** (`ativo = false`), nunca exclui fisicamente. Decidido em `docs/decisoes.md` (2026-09-07); o campo `ativo` já existe no schema
- [x] `GET /produtos` oculta inativos por padrão, com filtro explícito para incluí-los
- [x] Testes de validação (campos obrigatórios, unicidade de `codigoInterno`)
- [x] Frontend: tela simples de listagem e cadastro de produto (uso do GESTOR) — inclui busca, filtro de inativos, paginação e os botões Inativar/Reativar, que são o acesso ao `DELETE` e ao seu desfazer. Edição de campos pela tela ficou de fora: o `PATCH` existe e é testado na API, mas a tela pedida é de listagem e cadastro

## Notas técnicas
- Ver `docs/arquitetura.md` seção 5 para o contrato de rota.
- Não confundir `Produto` (SKU/tipo) com `UnidadeProduto` (item físico) — esse é o relacionamento crítico do PRD (seção 5, "Regras de modelagem"): modelar quantidade como inteiro em `Produto` invalidaria a proposta do trabalho.

## Fora de escopo desta tarefa
Cadastro de unidades individuais — isso é T05.

## Como foi verificado
- 25 testes de rota no backend (`backend/tests/produto.test.ts`), com o Prisma Client mockado, cobrindo papel, validação de corpo, paginação, filtro de inativos e tradução de erro do Prisma (P2002/P2025) em 409/404
- 9 testes de componente (`frontend/src/pages/TelaProdutos.test.tsx`)
- Conferência por `curl` contra o PostgreSQL real: criação com normalização, duplicata em minúsculas rejeitada com 409, 403 para ATENDENTE, busca sem diferenciar maiúsculas, `DELETE` seguido de consulta direta ao banco mostrando que a linha continua lá com `ativo = f`
- Conferência no navegador com `playwright-cli` **não executada** — mesma indisponibilidade registrada em T03b (nenhum navegador compatível instalado na máquina)
