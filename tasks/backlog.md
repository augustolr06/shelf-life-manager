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
| T09 | Registro de saída + EventoLog append-only (RF07, RF12, RNF05) | pendente | T07 | *gerar ao iniciar* |
| T10 | Tela de leitura de QR no frontend (câmera + fallback manual) + config PWA e detecção offline (RF05, RNF07) | pendente | T08 | *gerar ao iniciar* |

## Incremento 3 — Exceção de unidade vencida (PRD seção 6.1)

| ID | Tarefa | Status | Depende de |
|---|---|---|---|
| T11 | Backend: ramo `EXCECAO_VENCIDO` + 3 endpoints (correção, descarte, override) | pendente | T07 |
| T12 | Frontend: tela de exceção com os 3 caminhos, override restrito a GESTOR | pendente | T11 |
| T13 | Fila de descarte pendente no painel do GESTOR (RF11) | pendente | T11 |

## Incremento 4 — Cadastro em lote e etiquetas

| ID | Tarefa | Status | Depende de |
|---|---|---|---|
| T14 | Geração de QR codes únicos por unidade (RF04) | pendente | T05 |
| T15 | Renderização/impressão de etiquetas para embalagens pequenas (RF04) | pendente | T14 |
| T16 | Validação manual de legibilidade física do QR em loja (RNF08) — tarefa não-código | pendente | T15 |

## Incremento 5 — Alertas proativos

| ID | Tarefa | Status | Depende de |
|---|---|---|---|
| T17 | CRUD de ConfiguracaoAlerta (RF08) | pendente | T02 |
| T18 | Job de verificação periódica + geração de Alerta | pendente | T17, T05 |
| T19 | Notificação in-app / push | pendente | T18 |

## Incremento 6 — Dashboard e relatórios

| ID | Tarefa | Status | Depende de |
|---|---|---|---|
| T20 | Endpoints agregados de dashboard (RF13) | pendente | T09, T13 |
| T21 | Frontend do dashboard | pendente | T20 |

---

## Verificações manuais a cargo do orientando

Não são tarefas de código e não bloqueiam a implementação, mas precisam acontecer antes da defesa. Detalhes e justificativas em `docs/decisoes.md` (2026-09-07).

| Quando | O quê | Impacto se falhar |
|---|---|---|
| **Já é possível** — T05 gera códigos (ex.: `PRF-PW9VDK`) | Leitura física do QR em frasco curvo, plástico brilhante e embalagem pequena, sob a luz da loja (RNF08 / T16) | Pode reabrir o formato do `codigoQr`, que é provisório. Quanto antes for feito, menos código depende do formato atual |
| Ao concluir T10 | Teste da câmera em celular real (RF05). `getUserMedia` exige HTTPS ou `localhost`, e o `playwright-cli` não lê QR de câmera física — **avisar o orientando** | Fluxo de leitura de QR não verificado no dispositivo-alvo |
| **Antes de T09** | Decidir o destino de `POST /saidas/confirmar`: a seção 4 da arquitetura já efetiva a baixa na leitura, e a seção 5 lista um endpoint separado de confirmação. As duas não podem valer juntas — ver `docs/decisoes.md` (2026-09-08) | T09 começa sem contrato definido para o RF07 |
| Quando os dados forem cedidos | Substituir o seed inventado pelo catálogo real da perfumaria | Apenas qualidade de demonstração |
| Quando houver oportunidade | Reexercitar no navegador as telas de T03b (login) e T04 (catálogo), que ficaram sem conferência por falta de navegador compatível na época. O `playwright-cli` passou a encontrar um Chrome utilizável em T05 | Telas anteriores nunca vistas em navegador — foi assim que o defeito de CORS de T04 escapou |

---

## Convenção para novos arquivos de tarefa

Ao iniciar uma tarefa que ainda não tem arquivo de detalhe, gere `tasks/TNN-slug.md` seguindo o formato de `tasks/T01-setup-projeto.md` (objetivo, critério de aceite, notas técnicas, fora de escopo), usando `docs/arquitetura.md` como fonte. Depois de gerado, ele passa a ser a fonte de verdade para aquela tarefa — não regenerar do zero em sessões seguintes, só atualizar se o escopo mudar (e registrar a mudança em `docs/decisoes.md`).
