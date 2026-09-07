# Controle de Estoque FIFO por Validade — Contexto do Projeto

> Leia este arquivo primeiro em toda sessão nova. Ele existe para você não precisar reler o PRD inteiro a cada vez.

## O que é este projeto

Sistema de controle de estoque por unidade física (QR Code único por item) com saída obrigatoriamente FIFO por **data de validade** (não por data de entrada). Projeto de TCC (Sistemas de Informação) para uma perfumaria de pequeno porte (~700 SKUs).

O PRD completo está em `docs/PRD-original.md`. Não precisa reler o PRD inteiro em sessões normais — `docs/arquitetura.md` já traduz os requisitos relevantes em decisões técnicas.

## Onde encontrar cada coisa

| Preciso de... | Arquivo |
|---|---|
| Stack, modelo de dados, contratos de API, especificação da função FIFO | `docs/arquitetura.md` |
| Histórico de decisões de design e por quê | `docs/decisoes.md` |
| Lista de todas as tarefas do projeto, com status | `tasks/backlog.md` |
| Detalhes de implementação de UMA tarefa específica | `tasks/TNN-slug.md` |
| Requisitos originais completos (referência, não reler por padrão) | `docs/PRD-original.md` |

## Como trabalhar neste projeto

1. No início de cada sessão, leia `tasks/backlog.md` e identifique a próxima tarefa `pendente` cujas dependências já estejam `concluída`.
2. Abra o arquivo de detalhe daquela tarefa em `tasks/`. Se ele ainda não existir, gere-o a partir da entrada do backlog e de `docs/arquitetura.md`, seguindo o mesmo formato dos arquivos já existentes em `tasks/` (objetivo, critério de aceite, notas técnicas, fora de escopo).
3. Implemente **apenas essa tarefa**. Não adiante trabalho de tarefas futuras, mesmo que pareça mais eficiente no momento.
4. Ao terminar: rode os testes, faça commit descritivo, e atualize o status da tarefa em `tasks/backlog.md` para `concluída`.
5. Se você tomar qualquer decisão de design não coberta por `docs/arquitetura.md` (nome de variável não conta; decisão de arquitetura, sim), registre em `docs/decisoes.md` com data.

## Regras inegociáveis (não violar mesmo se parecer mais simples de outro jeito)

- **RNF01** — `dataValidade` é sempre `DATE`, nunca `DATETIME`/`TIMESTAMP`.
- **RNF02** — a validação FIFO e a baixa da unidade ocorrem numa única transação de banco com lock (`SELECT ... FOR UPDATE`). Nunca duas queries separadas sem lock.
- **RNF03** — a lógica de FIFO vive em **uma única função server-side** (`validarSaidaFifo`, ver `docs/arquitetura.md` seção 4). Nunca duplicar essa lógica em outro lugar (controller, frontend, ORM hook).
- **RNF04** — o frontend nunca decide o veredito. Ele só reflete o que o backend retornou.
- **RNF05** — `EventoLog` é append-only. Nunca gerar `UPDATE` ou `DELETE` nessa tabela pela aplicação.
- **Seção 8 do PRD** — os casos de teste da função `validarSaidaFifo` (tarefa T06) são escritos **antes** da implementação (T07), não depois.

## Stack (decidida em `docs/decisoes.md`)

- Backend: Node.js + TypeScript + Fastify + Prisma + PostgreSQL
- Frontend: React + Vite + TypeScript, PWA via `vite-plugin-pwa`
- Testes: Vitest
