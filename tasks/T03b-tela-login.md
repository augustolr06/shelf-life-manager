# T03b — Tela de login e sessão no frontend

**Depende de:** T03
**Incremento:** 1 (Fundação)

## Objetivo
Dar ao frontend a capacidade de autenticar e de saber quem está logado, consumindo o backend entregue em T03 (`POST /auth/login`, `POST /auth/logout`, `GET /auth/me`). Sem isso nenhuma tela protegida do sistema é utilizável no navegador, porque o cookie de sessão é `httpOnly` e não pode ser criado pelo JavaScript do frontend.

Tarefa criada em 2026-09-07, fora do backlog original: T03 entregou apenas o lado servidor da RF01, e nenhuma tarefa seguinte (T04, T10) previa a tela de login que ambas pressupõem.

## Critério de aceite
- [x] Camada de acesso à API em `frontend/src/services/` que envia `credentials: 'include'` em toda requisição (sem isso o navegador não manda o cookie de sessão) e trata 401 como "sessão ausente"
- [x] Tela de login com campos e-mail e senha, rotulados e associados aos inputs (acessível por `getByLabelText`)
- [x] Erro de credencial exibido na tela com a mensagem devolvida pelo backend — o frontend não decide o motivo da falha (RNF04)
- [x] Estado de sessão restaurado ao abrir o app via `GET /auth/me`: quem já tem cookie válido não vê a tela de login
- [x] Enquanto a sessão é verificada, a tela não pisca entre "login" e "conteúdo" — há um estado de carregando explícito
- [x] Botão de sair chamando `POST /auth/logout` e voltando à tela de login
- [x] Nome e papel do usuário logado visíveis na interface
- [x] Testes de componente (Vitest + Testing Library, `fetch` mockado) cobrindo: login com sucesso, credencial inválida, sessão restaurada, e logout
- [x] Conferência no navegador com `playwright-cli` conforme CLAUDE.md, restrita ao fluxo login → conteúdo → logout. Executada em 2026-09-07 após o Chrome ser instalado na máquina: login com credencial do seed, sessão restaurada com nome e papel na barra de topo, logout voltando à tela de login. Sem erro de runtime no console — os 401 registrados são a resposta esperada de `/auth/me` sem sessão

## Notas técnicas
- O `App` passa a ser o guardião de sessão: decide entre "carregando", "login" e "autenticado". As telas de domínio (T04 em diante) são renderizadas dentro do ramo autenticado e assumem que há usuário.
- A URL do backend vem de variável de ambiente do Vite (`VITE_API_URL`), com `http://localhost:3333` como padrão de desenvolvimento — o backend roda em outra porta, e o CORS com `credentials: true` já foi configurado em T03.
- Não guardar token, papel ou dados do usuário em `localStorage`/`sessionStorage`: a fonte da verdade da sessão é o cookie `httpOnly` mais o `GET /auth/me`. Persistir papel no cliente abriria caminho para o frontend decidir autorização, o que a RNF04 proíbe.
- O papel exibido na interface é informativo. A recusa por papel insuficiente continua sendo o 403 do backend (T03), e é ele que a interface reflete.
- Sem biblioteca de roteamento: o sistema ainda tem uma tela só. Se o roteamento virar necessário em T10, entra como decisão registrada naquela tarefa.

## Fora de escopo desta tarefa
Cadastro/edição de usuário, recuperação de senha, refresh token, "lembrar-me". Nenhuma tela de domínio (produtos é T04, leitura de QR é T10) — o ramo autenticado pode exibir apenas um marcador de conteúdo até T04 preenchê-lo.
