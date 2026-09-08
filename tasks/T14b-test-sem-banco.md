# T14b — `tests/descarte` fora das exclusões de `test:sem-banco` (achado de T14)

**Depende de:** nada. O script existe desde T06 e a suíte órfã, desde T13
**Incremento:** 4, como correção transversal — descoberta durante T14, não planejada
**Bloqueia:** nada formalmente. Só a promessa de "roda sem container", que hoje está quebrada

## Objetivo

Fazer `npm run test:sem-banco` voltar a rodar sem PostgreSQL.

O script existe por uma promessa registrada em `docs/decisoes.md` (T06): até T05 a suíte
inteira rodava com o Prisma mockado, e isso a tornava executável na máquina da banca. T06
quebrou essa garantia por necessidade — o lock da RNF02 e o `DATE` da RNF01 não existem fora
do banco — então a garantia virou um script que exclui as suítes de banco:

```
"test:sem-banco": "vitest run --exclude \"tests/fifo/**\" --exclude \"tests/saida/**\"
                   --exclude \"tests/evento-log/**\" --exclude \"tests/excecao-vencido/**\"
                   --exclude \"tests/etiquetas/**\""
```

São **cinco** exclusões para **seis** suítes de banco. `tests/descarte/`, criada em T13, não
entrou na lista. Numa máquina sem `backend/.env.test` ou sem container, `test:sem-banco`
falha na hora de abrir o banco — exatamente o cenário que o script existe para atender.

Cada suíte nova de banco desde T06 exigiu lembrar de editar essa linha (T08, T09, T11, T14
lembraram; T13 não). A lista é o tipo de coisa que só falha quando ninguém está olhando, e
já falhou uma vez.

## Critério de aceite

- [x] `npm run test:sem-banco` **não executa nenhuma** das seis suítes que exigem
      PostgreSQL: `tests/fifo`, `tests/saida`, `tests/evento-log`, `tests/excecao-vencido`,
      `tests/descarte`, `tests/etiquetas`
- [x] Continua executando **todas** as suítes sem banco, que hoje são os arquivos soltos em
      `tests/`: `auth`, `codigoQr`, `cors`, `erros`, `health`, `produto`, `simboloQr`,
      `unidade`. A contagem de verdes antes e depois desta tarefa é a mesma
- [x] Verificado **com o banco realmente indisponível**, não só por inspeção da linha:
      `backend/.env.test` movido de lado temporariamente (é o que `bancoDeTeste.ts` lê, e a
      ausência dele é a condição de "máquina sem banco"), `npm run test:sem-banco` verde,
      arquivo devolvido ao lugar
- [x] `npm test` continua nos **227 verdes** de T14, sem edição de nenhum teste (T14
      escreveu "224" em prosa, mas a decomposição da própria T14 — 199 + 11 + 17 — soma 227)
- [x] Entra `npm run test:descarte`, para simetria: as outras cinco suítes de banco têm
      atalho próprio (`test:fifo`, `test:saida`, `test:evento-log`, `test:excecao`,
      `test:etiquetas`) e a de T13 é a única sem — mesmo deslize, mesma origem
- [x] `npm run typecheck` limpo. **Nenhum arquivo `.ts` alterado** em `src/` ou `tests/`:
      esta tarefa mexe em `package.json` e em documentação, nada mais
- [x] `README.md` (seção "Comandos") reflete o que os scripts fazem hoje
- [x] `docs/decisoes.md` com a entrada do dia, fechando o achado que T14 deixou aberto
- [x] `tasks/backlog.md` com T14b `concluída` e a coluna de arquivo de detalhe preenchida
- [x] **Sem conferência de navegador**: nada em `frontend/src` é tocado. É `package.json`,
      que o CLAUDE.md verifica por Vitest e `typecheck`

## Ponto decidido pelo orientando antes da implementação

> **Resolvido em 2026-09-08:** as duas propostas foram aceitas como escritas abaixo — a
> regra por pasta (opção **b**) e a entrada do atalho `test:descarte`. Registrado em
> `docs/decisoes.md`.

**Decisão — corrigir a lista, ou trocar o mecanismo que deixa a lista errar?**

Recomendo a segunda. Existe uma convenção no repositório que ninguém declarou mas que as
seis suítes seguem sem exceção: **suíte de banco mora em subpasta de `tests/`, suíte sem
banco é arquivo solto em `tests/`**. Não é coincidência — as de banco precisam do
`vi.mock` do cliente compartilhado e foram agrupadas por assunto desde T06. Se a convenção
virar o critério do script, a exclusão passa a ser uma só e nunca mais precisa de manutenção:

```
"test:sem-banco": "vitest run --exclude \"tests/*/**\""
```

Uma linha, sem lista, e a sétima suíte de banco já nasce excluída. `tests/apoio/` também
cai fora, o que é correto: não tem teste, só infraestrutura.

O que peço que você veja escrito, porque é uma troca e não um ganho puro: **o modo de errar
muda de lado.** Hoje, uma suíte de banco esquecida na lista faz `test:sem-banco` *falhar* —
barulhento, e foi assim que T14 achou o problema. Com a regra por pasta, uma suíte **sem**
banco criada dentro de uma subpasta seria *silenciosamente pulada* — ninguém percebe, e a
contagem de verdes cai sem explicação. Falha silenciosa é pior que falha barulhenta; o que
me faz recomendar mesmo assim é que a convenção é forte (seis de seis) e que a regra fica
escrita no README e em `docs/decisoes.md`, enquanto a lista atual não está escrita em lugar
nenhum — é só uma linha de `package.json` que se espera que alguém lembre de editar.

As duas alternativas, se preferir:

- **(a) Só corrigir a lista** — acrescentar `--exclude "tests/descarte/**"` e parar aí.
  É o título literal da tarefa, é uma linha, e mantém a falha barulhenta. O custo é que a
  sétima suíte de banco vai depender de alguém lembrar de novo, e a memória já falhou uma
  vez em cinco oportunidades.
- **(b) Regra por pasta** (recomendada, acima), com a convenção documentada.


## Notas técnicas

- **`--exclude` do Vitest aceita glob e substitui `exclude` do config**, não soma. Como o
  projeto não define `exclude` próprio em `vitest.config.ts`, não há nada sendo perdido; os
  padrões do Vitest (`node_modules`, `dist`) continuam valendo por outro caminho. Confirmar
  na execução que `dist/` não é varrido.
- **A condição de "sem banco" é a ausência de `backend/.env.test`.** `bancoDeTeste.ts` lê a
  URL só desse arquivo — nunca do `.env` nem do ambiente do processo — e lança com mensagem
  explícita se ele não existe. É por isso que a verificação desta tarefa é mover o arquivo,
  e não derrubar o container: mover o arquivo testa a mesma porta de entrada que a máquina
  da banca encontraria.
- **A suíte de T13 não é tocada.** `tests/descarte/descartesPendentes.test.ts` está correta
  como está: ela precisa de banco, ela é uma suíte de banco. O defeito é o script não saber
  disso.
- **Por que isso não foi corrigido dentro de T14.** Precedente de T12b: achado de uma tarefa
  vira tarefa própria, para que o commit de T14 contenha só T14. Registrado em
  `docs/decisoes.md` no fim de T14 e no backlog.

## Fora de escopo desta tarefa

- **Qualquer alteração em teste, rota, serviço ou schema.** Nenhum `.ts` muda.
- **Mudar a estratégia de teste de banco** — banco por worker, `fileParallelism`,
  testcontainers. `fileParallelism: false` foi decidido em T09 por um motivo registrado, e
  reabrir isso não tem relação com o defeito de uma linha.
- **CI.** O projeto não tem pipeline, e criar uma para "garantir que não aconteça de novo"
  é tarefa própria, com decisão própria.
- **Renomear ou reorganizar as suítes existentes** para reforçar a convenção. Se a opção (b)
  for escolhida, ela só *reconhece* a organização que já existe — não move arquivo nenhum.
- **Contagem de cobertura, relatório de testes, `--coverage`.** Nada disso está no projeto e
  não entra por causa deste ajuste.

## Estado ao fim de T14b

`test:sem-banco` passou de cinco exclusões para uma: `--exclude "tests/*/**"`. Entrou
`test:descarte`. **Nenhum `.ts` foi tocado** — o diff de código é `package.json`, duas
linhas.

O defeito foi reproduzido antes de ser corrigido, com `backend/.env.test` movido de lado
(condição exata de "máquina sem banco": `bancoDeTeste.ts` lê a URL só desse arquivo):

- script **antigo**, sem banco: `tests/descarte/descartesPendentes.test.ts` vermelho,
  `1 failed | 8 passed`, com a mensagem `Arquivo .../backend/.env.test não encontrado`;
- script **novo**, mesma condição: `8 passed (8)`, **89 asserções verdes**, exatamente os
  oito arquivos soltos de `tests/`.

Arquivo devolvido ao lugar em seguida. Com banco, `npm test` fecha em **227 verdes** nos 14
arquivos, sem edição de nenhum teste, e `npm run typecheck` limpo. Frontend intocado.

A convenção que o script agora lê — suíte de banco em subpasta, suíte sem banco solta em
`tests/` — ficou escrita no `README.md`, que é o que faltava para a lista antiga: ela não
estava documentada em lugar nenhum e dependia de memória. Registro em `docs/decisoes.md` e
uma nota em `docs/notas-para-artigo.md` sobre o que o episódio diz da reprodutibilidade de
uma implementação de referência: 138 das 227 asserções exigem PostgreSQL, e são as que
provam o núcleo defendido no artigo.
