# T09 — Registro de saída + EventoLog append-only

**Depende de:** T07
**Incremento:** 2 (Núcleo: saída com validação FIFO + EventoLog)
**Bloqueia:** T11, T13, T20

## Objetivo

Fechar as duas pontas que o incremento 2 ainda deixa abertas: o **registro de saída**
(RF07) e o **EventoLog como instrumento de pesquisa** (RF12, RNF05).

O grosso do RF07 já existe desde T07 — o ramo `CONFIRMAR` cria a `Saida` com timestamp,
usuário responsável e `tentativasAteAcerto` dentro da transação da leitura. O que falta é
o `sessaoVendaId`, único campo da entidade `Saida` que nada preenche, e a resolução da
incoerência entre as seções 4 e 5 da arquitetura que T08 registrou sem resolver.

O EventoLog, por sua vez, hoje é escrito por uma função privada de
`validarSaidaFifo.ts`, com `tipoEvento` como `string` livre, e a RNF05 é só uma convenção
escrita no CLAUDE.md — nada no sistema impede um `UPDATE`. Como o log é **instrumento de
coleta do TCC** (RF12) e não apenas auditoria, essa diferença importa: um evento com o
tipo escrito errado, ou uma linha corrigida a posteriori, corrompe o dado da pesquisa em
silêncio.

Nada de lógica de FIFO nova. `validarSaidaFifo` continua sendo a única a decidir (RNF03).

## Decisões já tomadas pelo orientando (2026-09-08)

Estas duas vinham marcadas em `tasks/backlog.md` como pendentes de decisão antes desta
tarefa. Foram decididas na abertura de T09 e são premissa do que está abaixo.

**1. `POST /saidas/confirmar` sai da arquitetura.** O RF07 é atendido por `/saidas/ler`.
A seção 5 de `docs/arquitetura.md` é corrigida para refletir a seção 4 do mesmo documento,
que é também o que a seção 7 do PRD já descrevia: o passo 5 da validação cria a `Saida` e
muda o status, sem segundo passo. O modelo de dois passos foi descartado por custo
desproporcional — exigiria revalidar o FIFO inteiro na segunda chamada (aceitar o veredito
afirmado pelo cliente violaria a RNF04) ou manter reserva no servidor (proibido pela seção
6.2 do PRD), e quebraria `validarSaidaFifo` em "decidir" e "efetivar", invalidando a suíte
de T06.

**2. `sessaoVendaId` entra em T09**, e não em T10. O campo já existe no schema desde T02 e
nada o preenche.

## Critério de aceite

### O EventoLog vira módulo próprio

- [x] `src/modules/evento-log/eventoLog.service.ts` passa a ser o **único** ponto do
      sistema que escreve na tabela. `validarSaidaFifo` deixa de ter sua função privada
      `registrarEvento` e passa a chamar a compartilhada
- [x] `TipoEvento` é uma união fechada de TypeScript com os nove tipos da seção 5 do PRD.
      `tipoEvento` continua `String` no banco (o schema não muda), mas nenhum chamador
      consegue escrever um tipo que não esteja na união
- [x] O módulo expõe **apenas** escrita por `create`. Nenhuma função de `update`, `delete`
      ou `upsert` existe nele (RNF05)
- [x] A função recebe o cliente de transação de quem chama, como `validarSaidaFifo` já
      faz: o evento precisa comitar junto com o fato que ele descreve, nunca depois
- [x] Nenhum comportamento observável muda nos eventos que T07 já gravava: mesmos tipos,
      mesmos `unidadeId`/`produtoId`, mesmos payloads. A suíte de T06 continua verde
      **sem uma linha editada**

### Append-only deixa de ser convenção e vira garantia (RNF05)

- [x] Migração nova com trigger `BEFORE UPDATE OR DELETE` em `EventoLog` que levanta
      exceção. A proibição passa a valer para qualquer caminho — aplicação, Prisma Studio,
      `psql` — e não só para o código que lembrar dela
- [x] O trigger **não** cobre `TRUNCATE` (trigger de linha não dispara em `TRUNCATE`), que
      é o que mantém `limparBanco` funcionando na suíte. A distinção é deliberada, e o
      comentário que já existe em `tests/apoio/bancoDeTeste.ts` a antecipa
- [x] Teste contra banco real: `INSERT` passa, `UPDATE` e `DELETE` são recusados — tanto
      pelo client do Prisma quanto por SQL cru

### `UNIDADE_CADASTRADA` (RF12 — o evento que falta)

- [x] O cadastro de unidades (T05) passa a gravar `UNIDADE_CADASTRADA`, **um evento por
      unidade**, dentro da mesma transação do lote
- [x] Payload: `codigoQr`, `dataValidade` como texto `AAAA-MM-DD` (RNF01, mesma regra de
      T07) e `unidadesNoLote`, que é o que permite reconstruir o recebimento sem uma
      entidade `Lote` que o PRD não previu
- [x] Lote que falha por código repetido não deixa evento órfão: a transação já é uma só
      para o lote inteiro
- [x] `cadastrarUnidades` continua na forma de array do `$transaction`. Os `id` das
      unidades passam a ser gerados explicitamente com `randomUUID()` para que o evento
      possa referenciá-los no mesmo array — é o que o `@default(uuid())` do Prisma já
      fazia no client, agora à vista

### `sessaoVendaId` (RF07)

- [x] `POST /saidas/ler` aceita `sessaoVendaId` **opcional** no corpo, UUID gerado no
      cliente (PRD seção 5)
- [x] O valor é gravado em `Saida.sessaoVendaId` na confirmação, e vai também no payload de
      `LEITURA_QR_SAIDA` — sem isso, uma leitura bloqueada não é atribuível ao atendimento
      em que aconteceu, e o indicador "quantos atendimentos esbarraram no FIFO" (RF13) fica
      sem denominador
- [x] Ausente no corpo → `null` na `Saida`, sem erro
- [x] Formato inválido → 400. Ver "Ponto 3" abaixo: é a exceção deliberada à regra de T08
      de não recusar entrada malformada
- [x] `sessaoVendaId` não cria estado, não agrupa transação e não entra em nenhuma
      decisão — atravessa a função como valor opaco (PRD seção 6.2)

### Documentação

- [x] `docs/arquitetura.md` seção 5: `POST /saidas/confirmar` removido da tabela, com nota
      curta de que o RF07 é atendido por `/saidas/ler`
- [x] `docs/arquitetura.md` seção 4: a lista de eventos gravados menciona o módulo
      `evento-log` como único escritor, e `UNIDADE_CADASTRADA` passa a ter dono
- [x] `tasks/backlog.md`: a linha "Antes de T09 — decidir o destino de
      `POST /saidas/confirmar`" sai da tabela de verificações manuais, resolvida
- [x] `docs/decisoes.md` e `docs/notas-para-artigo.md` com as entradas de 2026-09-08

### Testes

- [x] Suíte nova `backend/tests/evento-log/eventoLog.test.ts`, contra PostgreSQL real — o
      trigger não existe fora do banco, e é ele o objeto do teste
- [x] Cobre: recusa de `UPDATE`/`DELETE`, `UNIDADE_CADASTRADA` no lote (inclusive lote que
      falha), `sessaoVendaId` gravado na `Saida` e no payload da leitura, ausência do
      campo, e 400 no formato inválido
- [x] `npm run test:sem-banco` passa a excluir também `tests/evento-log/**`
- [x] `npm run test:fifo` continua nos **46 de T06, sem uma linha editada**
- [x] `npm test` verde, `npm run typecheck` limpo nos dois projetos

## Estado ao fim de T09

`npm test` fecha em **148 verdes** (133 de T03–T08 + 15 daqui), `npm run test:sem-banco` em
70 sem container, `npm run test:fifo` nos mesmos **46 de T06, sem uma linha editada**, e
`npm run typecheck` limpo nos dois projetos. `src/modules/saida/validarSaidaFifo.ts` mudou
— perdeu a função privada de log e ganhou o parâmetro opcional — mas nenhum caso de T06 foi
tocado, e o tipo `Veredito` continua idêntico.

Conferido também por `curl` no servidor real, contra o banco de desenvolvimento (método do
CLAUDE.md para backend): leitura com agrupador válido devolvendo `BLOQUEAR_FIFO` em 200 e
21ms — folgado dentro da RNF06 —, com o `sessaoVendaId` aparecendo no payload do
`LEITURA_QR_SAIDA`; agrupador malformado em 400; `UPDATE` e `DELETE` no `EventoLog` pelo
`psql` recusados pelo trigger, com a mensagem legível; e um recebimento de 2 unidades pela
API gerando 2 `UNIDADE_CADASTRADA`, cada um com `unidadeId` casando com a unidade real.
`CONFIRMAR` ficou de fora do `curl` pelo mesmo motivo de T08 — consumiria uma unidade do
banco de desenvolvimento, e já tem casos automatizados contra banco real.

Decisões registradas em `docs/decisoes.md` (2026-09-08): remoção de `/saidas/confirmar`;
trigger em vez de trava no client; mensagem do trigger que ensina em vez de só recusar;
módulo `evento-log` com união fechada de tipos; `PrismaPromise` crua para servir os dois
chamadores; `dataParaPayload` no módulo do log e não em `shared/data.ts`;
`UNIDADE_CADASTRADA` por unidade e não por lote; ids explícitos no lote; a assimetria de
validação entre `codigoQr` e `sessaoVendaId`; a chave sempre presente no payload.

Em `docs/notas-para-artigo.md` (2026-09-08), três entradas: a irreversibilidade da venda e
a ausência de estorno como limitação honesta; o log de pesquisa protegido de quem o mantém,
não de quem o ataca; e o critério de recusar ou aceitar dado malformado conforme a origem
do dado.

Entrou no backlog uma verificação manual nova para T10: conferir que a tela gera e envia o
`sessaoVendaId` em **todas** as leituras do ciclo. O backend aceita a ausência em silêncio,
então um frontend que esqueça não quebra nada — só esvazia o agrupamento da RF13.

## Pontos validados pelo orientando antes de eu codar

**Ponto 1 — o trigger de banco, e não só disciplina no código.**
A alternativa mais leve seria uma extensão do Prisma Client que lança em `update`/`delete`
de `eventoLog`. Estou propondo o trigger porque a RNF05 protege o **instrumento de coleta
do TCC**, não um invariante interno do código: o risco realista não é o backend chamar
`update` por engano, é alguém abrir o Prisma Studio ou o `psql` para "corrigir" uma linha
durante o piloto na loja. Uma trava no client não alcança esse caminho; o trigger alcança
todos. Custo: uma migração com SQL cru (Prisma não modela trigger), que passa a ser
aplicada também no banco de teste pelo `migrate deploy` que a suíte já roda.

**Ponto 2 — `UNIDADE_CADASTRADA` é escopo de T09, embora mexa no módulo de T05.**
É o único evento da tabela da seção 5 do PRD que descreve funcionalidade já implementada e
que ninguém grava. T14/T15 são sobre etiquetas, não sobre o log; se não entrar aqui, ele
não tem dono. A mudança em `unidade.service.ts` é pequena (ids explícitos e um `create` a
mais por unidade no array da transação) e não altera contrato de rota nem resposta.
`tests/unidade.test.ts` ganha `eventoLog.create` no duplo do Prisma. Se você preferir que
T05 fique intocada, isso vira uma tarefa própria — mas então o backlog precisa registrá-la,
porque hoje ela não existe em lugar nenhum.

**Ponto 3 — `sessaoVendaId` malformado responde 400, ao contrário do `codigoQr`.**
T08 decidiu deliberadamente **não** recusar código de QR fora do padrão, porque a leitura
de uma etiqueta danificada é dado da pesquisa e recusá-la por schema a apagaria do log.
A assimetria aqui é proposital: `codigoQr` é digitado por uma pessoa no balcão e pode vir
torto pelo mundo físico; `sessaoVendaId` é gerado por `crypto.randomUUID()` no próprio
cliente e só vem torto se o cliente estiver quebrado. Aceitar em silêncio um agrupador
inválido produziria relatório de atendimento errado sem nenhum sinal. O custo é que uma
leitura legítima é perdida quando o frontend erra — e é por isso que estou trazendo o
ponto em vez de decidir sozinho.

**Ponto 4 — a resposta de `/saidas/ler` não muda.** Nem `Veredito`, nem `RespostaLeitura`,
nem o `saidaId` (que não é devolvido hoje e continua não sendo). `sessaoVendaId` entra só
como campo de entrada. Isso mantém intacto o contrato que T10 e T11 vão consumir.

## Notas técnicas

- **`validarSaidaFifo` ganha um quarto parâmetro opcional**, `sessaoVendaId?: string`.
  Parâmetro opcional não quebra nenhuma das chamadas de T06, que continuam compilando e
  passando sem edição. O valor não é lido por nenhuma decisão — vai direto para o `create`
  da `Saida` e para o payload.
- **O trigger em SQL cru.** `CREATE FUNCTION` + `CREATE TRIGGER` numa migração gerada com
  `prisma migrate dev --create-only`. Prisma não representa triggers em `schema.prisma`, e
  por isso ele não entra no cálculo de drift — a migração é preservada e reaplicada
  normalmente por `migrate deploy`.
- **A mensagem do trigger precisa ser legível.** Quem esbarrar nela vai ser um
  desenvolvedor ou o próprio orientando no meio do piloto; ela cita a RNF05 e a operação
  recusada, não só "permission denied".
- **Um evento por unidade cadastrada, não um por lote.** `EventoLog.unidadeId` é singular,
  e é a granularidade que permite cruzar o cadastro com as leituras posteriores da mesma
  unidade. Um lote de 50 unidades gera 50 linhas — irrelevante na escala da RNF10.
- **`randomUUID()` de `node:crypto`.** É o que o Prisma já usa por baixo do
  `@default(uuid())`; explicitar não muda formato nem unicidade.
- **A suíte nova roda em sequência com as outras**, pelo `fileParallelism: false` que T08
  introduziu — ela divide o mesmo `estoque_fifo_test`.

## Fora de escopo desta tarefa

- Qualquer endpoint de **leitura** do EventoLog: consulta, exportação, agregação. O log é
  escrito aqui e lido em T20 (dashboard, RF13).
- Os três caminhos da unidade vencida e os eventos `VALIDADE_CORRIGIDA`,
  `DESCARTE_REGISTRADO` e `VENDA_VENCIDA_AUTORIZADA` (T11). A união `TipoEvento` já os
  declara, porque a lista vem do PRD — mas nada os grava nesta tarefa.
- `ALERTA_PROATIVO_EMITIDO` (T18), pelo mesmo motivo.
- Qualquer tela: a geração do `sessaoVendaId` no cliente é T10. Aqui o campo só é aceito e
  gravado.
- Alterar `schema.prisma`. A migração desta tarefa contém apenas o trigger; nenhuma coluna
  entra ou sai.
- Alterar a suíte de T06 por qualquer motivo.
