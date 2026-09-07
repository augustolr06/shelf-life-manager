# T03 — Módulo de autenticação

**Depende de:** T02
**Incremento:** 1 (Fundação)

## Objetivo
Implementar login e controle de acesso por papel (RF01), conforme `docs/arquitetura.md` seção 1 (JWT em cookie httpOnly + bcrypt).

## Critério de aceite
- [x] `POST /auth/login` — valida email/senha (bcrypt), retorna JWT em cookie `httpOnly` + `secure` (em produção)
- [x] `POST /auth/logout` — limpa o cookie
- [x] Middleware Fastify que decodifica o JWT e injeta `usuario` no request
- [x] Middleware de autorização por papel (`ATENDENTE`, `GESTOR`) reutilizável em qualquer rota
- [x] Rota protegida de teste (`GET /auth/me`) retornando o usuário autenticado
- [x] Testes cobrindo: login válido, senha incorreta, acesso a rota restrita sem papel adequado

## Notas técnicas
- Toda ação de saída precisa ser atribuível a um usuário (RF01) — este middleware é pré-requisito de praticamente todo o resto do sistema, por isso vem cedo no incremento 1.
- Não implementar recuperação de senha, refresh token, ou 2FA — fora de escopo do PRD.

## Fora de escopo desta tarefa
CRUD de usuário (criação de novos usuários pode ser feita via seed/admin direto no banco por ora, já que RF01 não especifica tela de cadastro de operador).
