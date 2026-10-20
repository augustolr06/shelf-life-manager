# T30 — Aviso de sessão expirada em modal que leva ao login

**Depende de:** nada pendente (sessão por cookie desde T03/T03b)
**Incremento:** 9 (Ajustes de uso em formulários e listas)
**Bloqueia:** T39 (reaproveita o componente de diálogo)

## Objetivo

Quando o JWT expira (`DURACAO_SESSAO_SEGUNDOS`, em `backend/src/modules/auth/`), a próxima
requisição responde 401 `NAO_AUTENTICADO`. Hoje esse 401 cai no `catch` de cada tela e vira
mais uma mensagem de erro inline: a pessoa continua vendo a tela, tenta de novo, recebe o
mesmo erro, e não sabe que precisa entrar outra vez. O `App` só descobre que não há sessão no
próximo carregamento da página.

## Comportamento

1. Qualquer requisição autenticada que receba 401 `NAO_AUTENTICADO` avisa o `App`.
2. O `App` abre um **modal** sobre a tela atual: "Sua sessão expirou. Entre novamente para
   continuar." com um botão **Entrar novamente**.
3. O botão leva à tela de login. Depois de entrar, a pessoa volta para a **rota em que
   estava** (e não para a tela inicial do papel).
4. A tela que fez a requisição não mostra o erro inline por cima do modal.

## Decisões que esta tarefa toma (registrar em `docs/decisoes.md`)

1. **Modal, não toast.** O toast pode passar despercebido, e a pessoa continuaria clicando em
   uma tela que não funciona mais. Toda ação a partir daqui falha; o modal bloqueia a tela
   porque a tela de fato está bloqueada.
2. **O que ainda estava na tela se perde.** Um recebimento meio digitado não sobrevive ao
   login. Guardar rascunho é trabalho à parte — anotar como limitação.
3. **Detecção num ponto só:** `requisitarApi` em `services/api.ts`, pelo par status 401 +
   código `NAO_AUTENTICADO`, e não pela mensagem. Ficam de fora a verificação inicial de
   `GET /auth/me` (ali 401 é "não está logado", não "expirou") e `POST /auth/login` (401 é
   senha errada).
4. **Componente de diálogo reaproveitável** (`components/Dialogo.tsx`, sobre `<dialog>`
   nativo, com foco preso e Esc), porque T39 vai precisar dele para as confirmações.

## Critério de aceite

- [x] `requisitarApi` notifica 401 `NAO_AUTENTICADO` por um mecanismo simples (callback
      registrado pelo `App` ou `EventTarget`), sem importar React em `services/`
- [x] Modal com foco no botão, sem fechar por clique fora (não há para onde voltar)
- [x] Após o login, retorno à rota anterior
- [x] 401 do login e do `/auth/me` inicial **não** abrem o modal
- [x] 403 `PAPEL_INSUFICIENTE` **não** abre o modal (é outra situação)
- [x] Testes: `api.ts` notificando; `App.test.tsx` com uma tela recebendo 401 e o modal
      aparecendo; retorno à rota
- [x] Conferência no navegador com o `playwright-cli`: apagar o cookie de sessão
      (`cookie-clear` ou DevTools) e clicar numa ação

## Fora de escopo

- Renovação automática da sessão (refresh token).
- Aviso antes de expirar ("sua sessão expira em 5 minutos").
- Preservar rascunho de formulário.
