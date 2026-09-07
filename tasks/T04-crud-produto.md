# T04 — CRUD de Produto (catálogo)

**Depende de:** T02, T03
**Incremento:** 1 (Fundação)

## Objetivo
Implementar o CRUD de `Produto` (RF02): código interno, nome, marca, categoria.

## Critério de aceite
- [ ] `POST /produtos` (GESTOR) — cria produto, `codigoInterno` único (erro claro em duplicata)
- [ ] `GET /produtos` — lista com paginação simples e busca por nome/código
- [ ] `GET /produtos/:id` — detalhe
- [ ] `PATCH /produtos/:id` (GESTOR) — edição
- [ ] `DELETE /produtos/:id` (GESTOR) — **inativa** (`ativo = false`), nunca exclui fisicamente. Decidido em `docs/decisoes.md` (2026-09-07); o campo `ativo` já existe no schema
- [ ] `GET /produtos` oculta inativos por padrão, com filtro explícito para incluí-los
- [ ] Testes de validação (campos obrigatórios, unicidade de `codigoInterno`)
- [ ] Frontend: tela simples de listagem e cadastro de produto (uso do GESTOR)

## Notas técnicas
- Ver `docs/arquitetura.md` seção 5 para o contrato de rota.
- Não confundir `Produto` (SKU/tipo) com `UnidadeProduto` (item físico) — esse é o relacionamento crítico do PRD (seção 5, "Regras de modelagem"): modelar quantidade como inteiro em `Produto` invalidaria a proposta do trabalho.

## Fora de escopo desta tarefa
Cadastro de unidades individuais — isso é T05.
