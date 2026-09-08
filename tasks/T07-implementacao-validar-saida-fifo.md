# T07 — Implementação de `validarSaidaFifo`

**Depende de:** T06
**Incremento:** 2 (Núcleo: saída com validação FIFO + EventoLog)
**Bloqueia:** T08, T09, T10, T11

## Objetivo

Substituir o esqueleto de `backend/src/modules/saida/validarSaidaFifo.ts` pela
implementação real dos cinco ramos da seção 4 de `docs/arquitetura.md`, de modo que a
suíte escrita em T06 passe **sem que nenhum caso dela seja editado**.

Esta é a função que dá razão de existir ao trabalho: é o único ponto do sistema que
decide se uma unidade física pode sair (RNF03), e o frontend apenas exibe o que ela
devolve (RNF04).

## Critério de aceite

A definição de pronto é objetiva: **os 46 casos de `backend/tests/fifo/validarSaidaFifo.test.ts`
passam**, e a suíte não é tocada. O que segue é a leitura desse contrato em termos de
implementação, para orientar o código — não é uma segunda lista de requisitos.

### Contrato da função

- [x] Assinatura preservada: `validarSaidaFifo(codigoQr, usuarioId, tx)`, recebendo o
      cliente de transação de quem chama — a função **não** abre transação própria
- [x] Tipo `Veredito` inalterado (é o contrato que T08 e T10 vão consumir)
- [x] `NAO_IMPLEMENTADO` e o `throw` do esqueleto deixam de existir

### Ordem das verificações (seção 7 do PRD — não reordenar)

- [x] 1. QR inexistente → `ERRO / QR_NAO_ENCONTRADO`
- [x] 2. `status ≠ EM_ESTOQUE` → `ERRO / UNIDADE_JA_BAIXADA` (**antes** da checagem de validade)
- [x] 3. `dataValidade < hoje` → `EXCECAO_VENCIDO`, sem alterar nada na unidade
- [x] 4. Não é prioritária do pool não-vencido → `BLOQUEAR_FIFO` com `unidadeCorreta` e `tentativas`
- [x] 5. É prioritária → `CONFIRMAR`: cria `Saida`, muda status para `VENDIDA`

### Lock e transação (RNF02)

- [x] A unidade lida é bloqueada com `SELECT ... FOR UPDATE` dentro do `tx` recebido,
      antes de qualquer decisão
- [x] O lock é da **unidade lida**, nunca do produto: duas atendentes vendendo unidades
      diferentes do mesmo SKU não esperam uma pela outra
- [x] A leitura pós-lock enxerga a baixa da transação concorrente que comitou antes —
      é isso que faz a perdedora devolver `UNIDADE_JA_BAIXADA` em vez de estourar na
      restrição `@unique` de `Saida.unidadeId`

### Pool prioritário (ramo 4)

- [x] Filtro: mesmo `produtoId`, `status = EM_ESTOQUE`, `dataValidade >= hoje`
- [x] Prioritária é definida por **valor** de `dataValidade`, não por identidade: qualquer
      unidade cuja validade seja igual à mínima do pool confirma (empate, decidido em T06)
- [x] Unidade vencida nunca é apontada como `unidadeCorreta`

### Eventos (RNF05 — só `INSERT`)

- [x] `LEITURA_QR_SAIDA` em toda chamada, nos cinco ramos, com `unidadeId`/`produtoId`
      nulos no ramo 1 e o código no `payload`
- [x] `TENTATIVA_VENDA_UNIDADE_VENCIDA` no ramo 3
- [x] `ALERTA_FIFO_DISPARADO` no ramo 4, com a unidade **lida** em `unidadeId` e a correta
      no `payload` como `unidadeCorretaId`
- [x] `SAIDA_CONFIRMADA` no ramo 5
- [x] Nenhum `UPDATE`/`DELETE` em `EventoLog`

### `tentativas` derivado (decisão 2 de T06)

- [x] Contagem de `ALERTA_FIFO_DISPARADO` do par (`produtoId`, `usuarioId`) desde a última
      `SAIDA_CONFIRMADA` do mesmo par, **incluindo** o bloqueio corrente
- [x] `Saida.tentativasAteAcerto` recebe o total do ciclo na confirmação, e
      `Saida.alertaFifoDisparado` é `true` sempre que esse total for maior que zero
- [x] Nenhum contador persistido em `UnidadeProduto` nem estado de sessão no servidor
      (seção 6.2 do PRD)

### Verificação

- [x] `npm run test:fifo` fecha em 46 verdes
- [x] `npm test` fecha em 112 verdes (66 de T03–T05 + 46 de T07)
- [x] `npm run test:sem-banco` continua em 66 verdes, sem container
- [x] `npm run typecheck` limpo (inclui `tsconfig.tests.json`)

## Estado ao fim de T07

Suíte de T06 intacta e verde: **46 passam**, sem uma linha editada. `npm test` fecha em
**112 verdes** (66 de T03–T05 + 46 daqui), `npm run test:sem-banco` em 66 sem container, e
`npm run typecheck` limpo nos dois projetos.

Fora do critério de aceite, foi feita uma **verificação de que o lock não é decoração**:
removido o `FOR UPDATE` e reexecutada a suíte, os três casos de concorrência falham — e
falham na forma exata que T06 previu, com `Unique constraint failed on the fields:
(unidadeId)`, isto é, a perdedora chegando ao `create` da `Saida` em vez de reler a linha
já baixada. Os outros 43 casos passam com ou sem lock. Restaurado em seguida. O achado
virou entrada em `docs/decisoes.md` e em `docs/notas-para-artigo.md` (2026-09-08): o que a
RNF02 protege não é a integridade do estoque, que a restrição de unicidade já garantiria,
é a legibilidade da recusa no balcão.

Decisões tomadas durante a implementação, todas em `docs/decisoes.md` (2026-09-08):
releitura pelo client tipado depois do lock; `>` estrito na fronteira do ciclo de
tentativas, que subconta em vez de inflar o indicador; desempate estável do pool por
`dataEntrada` sem virar ordem total; `LEITURA_QR_SAIDA` gravado por último, carregando o
veredito no `payload`; datas do `payload` como texto `AAAA-MM-DD`.

## Notas técnicas

- **`FOR UPDATE` exige query raw.** A API de alto nível do Prisma não expõe lock de linha
  (é o motivo pelo qual a seção 1 da arquitetura escolheu Prisma "com query raw para lock
  explícito"). O padrão adotado é bloquear com `$queryRaw` e reler o registro pelo client
  tipado dentro da mesma transação — o lock já está tomado, e o objeto devolvido ao
  chamador continua sendo um `UnidadeProduto` do Prisma, com `dataValidade` já convertida
  e `status` como enum. Um `SELECT *` cru devolveria linha destipada, e o `Veredito`
  carrega essa unidade para a tela.
- **Isolamento.** As transações rodam no `READ COMMITTED` padrão do Postgres. É o que
  garante o comportamento que o teste de concorrência exige: a perdedora fica parada no
  `FOR UPDATE`, e ao ser liberada relê a linha na versão já comitada.
- **Comparação com "hoje".** Usar `hojeComoData()` de `src/shared/data.ts`, nunca
  `new Date()`. A coluna é `DATE` (RNF01) e a função já ancora na meia-noite UTC a partir
  do calendário local — é o que faz a borda "vence hoje" cair do lado certo.
- **Vencida é `< hoje`, não `<= hoje`.** A unidade vence no fim do dia impresso.
- O `payload` de `EventoLog` é `Json` não-nulo: todo evento grava um objeto, mesmo quando
  não há nada além do código lido.
- Nenhum outro arquivo do backend precisa mudar. O endpoint que abre a transação e chama
  esta função é T08.

## Fora de escopo desta tarefa

- Endpoint `POST /saidas/ler` e o laço de revalidação pela API (T08).
- `POST /saidas/confirmar` e o módulo de `EventoLog` como serviço próprio (T09).
- Qualquer tela (T10) — nada de frontend nesta tarefa.
- Os três caminhos da exceção de unidade vencida (T11). Aqui a unidade vencida apenas
  recebe o veredito `EXCECAO_VENCIDO` e permanece intacta.
- Alterar a suíte de T06 por qualquer motivo. Se um caso parecer errado, isso é uma
  conversa com o orientando e uma entrada em `docs/decisoes.md`, não uma edição.
