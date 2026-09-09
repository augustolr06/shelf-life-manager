# Backlog de Tarefas

Ordem de implementação segue a seção 8 do PRD (fatias verticais). Não pule a ordem de dependência mesmo que pareça mais rápido.

Status possíveis: `pendente`, `em-andamento`, `concluída`, `bloqueada`.

## Incremento 1 — Fundação (Auth + Produto + UnidadeProduto)

| ID | Tarefa | Status | Depende de | Arquivo de detalhe |
|---|---|---|---|---|
| T01 | Setup do projeto (scaffolding backend + frontend, Prisma init) | concluída | — | `tasks/T01-setup-projeto.md` |
| T02 | Schema Prisma completo + migração inicial | concluída | T01 | `tasks/T02-schema-prisma.md` |
| T03 | Módulo de autenticação (RF01) | concluída | T02 | `tasks/T03-autenticacao.md` |
| T03b | Tela de login e sessão no frontend | concluída | T03 | `tasks/T03b-tela-login.md` |
| T04 | CRUD de Produto (RF02) | concluída | T02, T03b | `tasks/T04-crud-produto.md` |
| T05 | Cadastro de UnidadeProduto individual e em lote (RF03) | concluída | T04 | `tasks/T05-cadastro-unidade.md` |

## Incremento 2 — Núcleo: saída com validação FIFO + EventoLog

| ID | Tarefa | Status | Depende de | Arquivo de detalhe |
|---|---|---|---|---|
| T06 | Casos de teste de `validarSaidaFifo` — escrever ANTES de T07 (exigência PRD seção 8) | concluída | T05 | `tasks/T06-testes-validar-saida-fifo.md` |
| T07 | Implementação de `validarSaidaFifo` (RF06, RNF02-04) | concluída | T06 | `tasks/T07-implementacao-validar-saida-fifo.md` |
| T08 | Endpoint de leitura de QR + loop de revalidação (RF05, RF06) | concluída | T07 | `tasks/T08-endpoint-leitura-qr.md` |
| T09 | Registro de saída + EventoLog append-only (RF07, RF12, RNF05) | concluída | T07 | `tasks/T09-registro-saida-evento-log.md` |
| T10 | Tela de leitura de QR no frontend (câmera + fallback manual) + config PWA e detecção offline (RF05, RNF07) | concluída | T08 | `tasks/T10-tela-leitura-qr.md` |

## Incremento 3 — Exceção de unidade vencida (PRD seção 6.1)

| ID | Tarefa | Status | Depende de | Arquivo de detalhe |
|---|---|---|---|---|
| T11 | Backend: ramo `EXCECAO_VENCIDO` + 3 endpoints (correção, descarte, override) | concluída | T07 | `tasks/T11-excecao-vencido-backend.md` |
| T12 | Frontend: tela de exceção com os 3 caminhos, override restrito a GESTOR | concluída | T11 | `tasks/T12-excecao-vencido-frontend.md` |
| T12b | Backend: `errorHandler` traduzindo erro de schema (achado de T12) | concluída | — | `tasks/T12b-erros-de-validacao.md` |
| T13 | Fila de descarte pendente no painel do GESTOR (RF11) | concluída | T11 | `tasks/T13-fila-descarte-pendente.md` |

## Incremento 4 — Cadastro em lote e etiquetas

| ID | Tarefa | Status | Depende de | Arquivo de detalhe |
|---|---|---|---|---|
| T14 | Geração de QR codes únicos por unidade (RF04) | concluída | T05 | `tasks/T14-geracao-qr-unidade.md` |
| T14b | `tests/descarte` fora das exclusões de `test:sem-banco` (achado de T14) | concluída | — | `tasks/T14b-test-sem-banco.md` |
| T15 | Renderização/impressão de etiquetas para embalagens pequenas (RF04) | concluída | T14 | `tasks/T15-etiquetas-impressao.md` |
| T16 | Validação manual de legibilidade física do QR em loja (RNF08) — tarefa não-código | pendente | T15 | — |

## Incremento 5 — Alertas proativos

| ID | Tarefa | Status | Depende de | Arquivo de detalhe |
|---|---|---|---|---|
| T17 | CRUD de ConfiguracaoAlerta (RF08) | concluída | T02 | `tasks/T17-configuracao-alerta.md` |
| T18 | Job de verificação periódica + geração de Alerta | concluída | T17, T05 | `tasks/T18-job-verificacao-alertas.md` |
| T19 | Entrega do alerta in-app (lista, contador, marcar como lido) | concluída | T18 | `tasks/T19-entrega-do-alerta.md` |
| T19b | Notificação push (VAPID, inscrição por dispositivo, service worker) | concluída | T19 | `tasks/T19b-notificacao-push.md` |

## Incremento 6 — Dashboard e relatórios

| ID | Tarefa | Status | Depende de | Arquivo de detalhe |
|---|---|---|---|---|
| T20 | Endpoints agregados de dashboard (RF13) | concluída | T09, T13 | `tasks/T20-endpoints-dashboard.md` |
| T21 | Frontend do dashboard | concluída | T20 | `tasks/T21-frontend-dashboard.md` |

## Incremento 7 — Preparação para produção

Levantado em 2026-09-09, ao avaliar se o sistema está pronto para uma V1 rodando de verdade
na loja. As tarefas anteriores fecham todos os RFs; estas duas fecham o que falta para o
sistema **sair da máquina de desenvolvimento** — e não estavam no PRD porque o PRD descreve
o produto, não a operação dele.

| ID | Tarefa | Status | Depende de | Arquivo de detalhe |
|---|---|---|---|---|
| T22 | Cadastro e gestão de usuários pelo GESTOR (RF01) | pendente | T03b, T04 | `tasks/T22-gestao-de-usuarios.md` |
| T23 | Endurecimento e preparação de deploy | em-andamento | T22 | `tasks/T23-preparacao-deploy.md` |

**T22 — escopo.** Hoje as únicas contas do sistema nascem de `src/db/seed.ts`, com senha
padrão compartilhada e e-mails `@estoque.local`; não existe rota de usuário nem troca de
senha. Isso é suficiente para desenvolver e insuficiente para a loja operar: a gestora não
consegue criar a conta de uma atendente nova nem trocar a própria senha sem alguém rodar SQL
no banco. A tarefa entrega o CRUD de `Usuario` restrito a `GESTOR` (o modelo já existe desde
T02) mais troca de senha pelo próprio usuário, seguindo o padrão de tela de gestão de T04.
Cuidados que a tarefa herda: o hash continua sendo `bcrypt` com o mesmo custo de
`auth.service.ts`, a senha nunca volta em resposta alguma, e o GESTOR não pode excluir a si
mesmo nem a conta de sistema da varredura (`modules/alerta/usuarioDoSistema.ts`).

**T23 — escopo.** Três frentes, todas verificadas no código em 2026-09-09:

1. **Segurança de borda**, hoje ausente: `/auth/login` está sem limite de tentativas e o
   Fastify sobe sem `@fastify/helmet`. Exposto na internet, isso é força bruta livre.
2. **Alvo de hospedagem** — decisão em aberto, e ela muda o resto da tarefa. Em servidor
   com processo persistente (Render/Fly/Railway), o `setInterval` de
   `modules/alerta/agendador.ts` continua valendo como está. Em serverless (Vercel), não
   existe processo entre requisições: a RF08 exige trocar o agendador por uma rota interna
   protegida por segredo, chamada por cron externo, e a varredura de inicialização precisa
   deixar de rodar a cada cold start. **Registrar a escolha em `docs/decisoes.md`** — ela
   contradiz ou confirma o trade-off já documentado em `docs/notas-para-artigo.md`
   ("backend fora do ar, varredura não roda").
3. **Configuração de produção**: `sameSite` do cookie de sessão (`modules/auth/cookie.ts`
   já prevê o caso — `'lax'` só funciona se frontend e backend forem same-site; domínios
   distintos exigem `'none' + secure`), `DATABASE_URL` com pooling e `directUrl` para
   `migrate deploy`, `JWT_SECRET` e chaves VAPID novas, `FRONTEND_ORIGIN` real no CORS, e
   um `docs/deploy.md` com o roteiro de subida e de restauração de backup — o `EventoLog` é
   append-only e é a base do indicador do TCC (RF12), então perdê-lo é perder o dado do
   artigo.

**Estado de T23 (2026-09-09):** a fatia de configuração de produção — cookie cross-site,
rewrite de SPA, `directUrl`, `postinstall` do Prisma e troca de senha por script — foi
antecipada e está concluída, porque é o que permite um deploy de piloto com dois usuários
sem depender de T22. Seguem pendentes o limite de tentativas no login, o `helmet`, a decisão
de hospedagem com o ajuste do relógio da RF08, e o `docs/deploy.md` com a rotina de backup.
Detalhes por fatia em `tasks/T23-preparacao-deploy.md`.

Ordem sugerida: T22 antes de T23, porque não faz sentido publicar na internet um sistema
cuja única credencial é a senha padrão do seed. Nenhuma das duas bloqueia a demonstração da
defesa — um deploy só para demonstração pode acontecer antes, e inclusive **destrava** as
verificações manuais de câmera, push e PWA offline listadas abaixo, que precisam de HTTPS.

---

## Verificações manuais a cargo do orientando

Não são tarefas de código e não bloqueiam a implementação, mas precisam acontecer antes da defesa. Detalhes e justificativas em `docs/decisoes.md` (2026-09-07).

| Quando | O quê | Impacto se falhar |
|---|---|---|
| **Agora, e sem depender de mais código** — T15 imprime a folha (tela `/etiquetas`) | Leitura física do QR em frasco curvo, plástico brilhante e embalagem pequena, sob a luz da loja (RNF08 / T16). Imprima a mesma folha nos três tamanhos (15, 20 e 25 mm — o rodapé de cada folha diz qual é), recorte, cole em frascos reais e leia com o celular. O resultado esperado é um veredito por tamanho | Pode reabrir o formato do `codigoQr`, que é provisório e está travado em 10 caracteres pelo nível H (`docs/decisoes.md`, T14), **e** decide qual tamanho fica fixo no código. Quanto antes for feito, menos código depende do formato atual |
| **Agora** — T10 concluída | Teste da câmera em celular real (RF05): a câmera abre, decodifica a etiqueta impressa, e o veredito aparece. `getUserMedia` exige HTTPS ou `localhost`, e o `playwright-cli` não lê QR de câmera física — é a única parte de T10 sem cobertura automatizada, isolada em `components/LeitorCamera.tsx`. No mesmo aparelho, conferir que a URL usada é segura: sem HTTPS não há câmera **nem** `crypto.randomUUID`, e o agrupamento de atendimento cai fora | Fluxo de leitura de QR não verificado no dispositivo-alvo |
| **Agora** — T19b concluída | Push em aparelho real (RF08): gerar as chaves com `npm run push:chaves`, preenchê-las no `.env`, instalar o PWA no celular por HTTPS, ativar em **Configurar alertas → Notificações neste aparelho** e rodar `npm run alertas:varrer` com uma janela de canal push e uma unidade nova na janela. A notificação deve chegar com o app fechado, e o toque deve abrir `/alertas`. Web Push exige contexto seguro e um serviço externo (FCM), e nem a suíte nem o `playwright-cli` alcançam isso — no navegador automatizado a permissão é sempre negada, que foi o estado conferido | Metade da RF08 não verificada de ponta a ponta: o alerta continua chegando pela lista in-app, que é a fonte de verdade |
| Junto com o teste da câmera | Instalar o PWA no celular e abrir com o modo avião ligado: deve abrir e mostrar o bloqueio explícito da RNF07, não o erro de rede do navegador | O comportamento offline foi conferido em navegador de desktop (`network-state-set offline`), não no app instalado |
| ~~Ao concluir T10~~ **resolvido em T10** | ~~Conferir que a tela gera um `sessaoVendaId` por atendimento e o envia em todas as leituras do ciclo~~ — virou teste automatizado (`TelaLeituraQr.test.tsx`): agrupador estável entre leituras, presente também na bloqueada, e trocado só ao encerrar o atendimento | — |
| Quando os dados forem cedidos | Substituir o seed inventado pelo catálogo real da perfumaria | Apenas qualidade de demonstração |
| Quando houver oportunidade | Reexercitar no navegador as telas de T03b (login) e T04 (catálogo), que ficaram sem conferência por falta de navegador compatível na época. O `playwright-cli` passou a encontrar um Chrome utilizável em T05 | Telas anteriores nunca vistas em navegador — foi assim que o defeito de CORS de T04 escapou |

---

## Convenção para novos arquivos de tarefa

Ao iniciar uma tarefa que ainda não tem arquivo de detalhe, gere `tasks/TNN-slug.md` seguindo o formato de `tasks/T01-setup-projeto.md` (objetivo, critério de aceite, notas técnicas, fora de escopo), usando `docs/arquitetura.md` como fonte. Depois de gerado, ele passa a ser a fonte de verdade para aquela tarefa — não regenerar do zero em sessões seguintes, só atualizar se o escopo mudar (e registrar a mudança em `docs/decisoes.md`).
