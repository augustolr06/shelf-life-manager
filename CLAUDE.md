# Controle de Estoque FIFO por Validade — Contexto do Projeto

> Leia este arquivo primeiro em toda sessão nova. Ele existe para você não precisar reler o PRD inteiro a cada vez.

## O que é este projeto

Sistema de controle de estoque por unidade física (QR Code único por item) com saída obrigatoriamente FIFO por **data de validade** (não por data de entrada). Projeto de TCC (Sistemas de Informação) para uma perfumaria de pequeno porte (~700 SKUs).

O PRD completo está em `docs/PRD-original.md`. Não precisa reler o PRD inteiro em sessões normais — `docs/arquitetura.md` já traduz os requisitos relevantes em decisões técnicas.

## Onde encontrar cada coisa

| Preciso de...                                                          | Arquivo                     |
| ---------------------------------------------------------------------- | --------------------------- |
| Stack, modelo de dados, contratos de API, especificação da função FIFO | `docs/arquitetura.md`       |
| Histórico de decisões de design e por quê                              | `docs/decisoes.md`          |
| Lista de todas as tarefas do projeto, com status                       | `tasks/backlog.md`          |
| Detalhes de implementação de UMA tarefa específica                     | `tasks/TNN-slug.md`         |
| Requisitos originais completos (referência, não reler por padrão)      | `docs/PRD-original.md`      |
| Pontos de decisão e descobertas relevantes para o artigo do TCC        | `docs/notas-para-artigo.md` |
| Como subir em produção, variáveis de ambiente, backup e operação        | `docs/deploy.md`            |

## Como trabalhar neste projeto

1. No início de cada sessão, leia `tasks/backlog.md` e identifique a próxima tarefa `pendente` cujas dependências já estejam `concluída`.
2. Abra o arquivo de detalhe daquela tarefa em `tasks/`. Se ele ainda não existir, gere-o a partir da entrada do backlog e de `docs/arquitetura.md`, seguindo o mesmo formato dos arquivos já existentes em `tasks/` (objetivo, critério de aceite, notas técnicas, fora de escopo).
3. Implemente **apenas essa tarefa**. Não adiante trabalho de tarefas futuras, mesmo que pareça mais eficiente no momento.
4. Ao terminar: rode os testes, faça commit descritivo, e atualize o status da tarefa em `tasks/backlog.md` para `concluída`.
5. Se você tomar qualquer decisão de design não coberta por `docs/arquitetura.md` (nome de variável não conta; decisão de arquitetura, sim), registre em `docs/decisoes.md` com data.

## Verificação de alterações de UI

Alterações que mudam o que o usuário vê ou com o que ele interage — componentes e páginas em `frontend/src/`, `frontend/index.html`, estilos, ou o manifest do PWA — devem ser conferidas no navegador com o `playwright-cli` antes do commit, **além** dos testes de Vitest.

Roteiro:

1. Suba o frontend (`cd frontend && npm run dev`) e também o backend, se a tela consumir a API.
2. `playwright-cli open http://localhost:5173`
3. Navegue até a tela alterada e exercite **apenas o caminho que a alteração afeta**. Confirme o resultado com `snapshot` (estrutura acessível) ou `screenshot` (aparência).
4. `playwright-cli console error` para verificar que não surgiu erro de runtime.
5. `playwright-cli close` ao terminar.

Para o comportamento offline exigido pela RNF07, `playwright-cli network-state-set offline` simula a queda de rede sem precisar desligar o backend.

Limites — respeitar estritamente:

- **Só para UI.** Alteração em backend, schema Prisma, `validarSaidaFifo`, migração, script ou arquivo de configuração continua sendo verificada pelos métodos atuais: Vitest, `npm run typecheck`, `curl` no endpoint. Não abra o navegador para esse tipo de mudança.
- **Só o necessário.** Confira o fluxo que você mexeu, não a aplicação inteira. Sem varredura de regressão, e sem repetir no navegador o que um teste de Vitest já cobre.
- **Não substitui teste automatizado.** O `playwright-cli` é conferência manual assistida e não gera arquivo de teste. Os testes de componente continuam em Vitest + Testing Library, e são eles que entram no commit.
- Se o `playwright-cli` não estiver disponível na máquina, diga isso explicitamente e siga com a verificação por Vitest. Não instale nada por conta própria.

## Regras inegociáveis (não violar mesmo se parecer mais simples de outro jeito)

- **RNF01** — `dataValidade` é sempre `DATE`, nunca `DATETIME`/`TIMESTAMP`.
- **RNF02** — a validação FIFO e a baixa da unidade ocorrem numa única transação de banco com lock (`SELECT ... FOR UPDATE`). Nunca duas queries separadas sem lock.
- **RNF03** — a lógica de FIFO vive em **uma única função server-side** (`validarSaidaFifo`, ver `docs/arquitetura.md` seção 4). Nunca duplicar essa lógica em outro lugar (controller, frontend, ORM hook).
- **RNF04** — o frontend nunca decide o veredito. Ele só reflete o que o backend retornou.
- **RNF05** — `EventoLog` é append-only. Nunca gerar `UPDATE` ou `DELETE` nessa tabela pela aplicação.
- **Seção 8 do PRD** — os casos de teste da função `validarSaidaFifo` (tarefa T06) são escritos **antes** da implementação (T07), não depois.

## Documentação para o artigo do TCC

Este projeto é a implementação de referência de um artigo sobre controle de estoque por FIFO de validade para lojas de pequeno porte que recebem produtos em entregas mistas (unidades do mesmo SKU com validades diferentes) e hoje fazem esse controle manualmente.

Registre em `docs/notas-para-artigo.md` qualquer ponto que seja relevante para apresentar a solução no artigo. Isso é mais amplo que `docs/decisoes.md` (que é só o histórico técnico) — inclui:

- uma escolha de design que resolve especificamente uma limitação do processo manual (o exemplo já registrado: QR por unidade física, não por lote)
- um trade-off que apareceu durante a implementação e que não estava previsto no PRD
- uma descoberta feita ao escrever testes (ex: um caso de borda do FIFO que revela algo sobre o problema em si, não só sobre o código)
- uma limitação da solução que deveria ser mencionada honestamente no artigo (escopo não coberto, trabalho futuro)

Não espere ser perguntado — se notar algo que se encaixa nesses critérios durante qualquer tarefa, registre por conta própria, seguindo o formato já usado no arquivo. Isso é adicional ao passo 5 do fluxo acima (que é sobre `docs/decisoes.md`), não um substituto — uma mesma decisão pode gerar entrada nos dois arquivos, com enquadramentos diferentes (um técnico, um voltado ao problema/solução do artigo).

## Stack (decidida em `docs/decisoes.md`)

- Backend: Node.js + TypeScript + Fastify + Prisma + PostgreSQL
- Frontend: React + Vite + TypeScript, PWA via `vite-plugin-pwa`
- Testes: Vitest
