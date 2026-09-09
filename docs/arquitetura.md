# Arquitetura — Controle de Estoque FIFO por Validade

Última atualização: 2026-09-09 (seções 2 e 5 revisadas em T20, que acrescentou o módulo `dashboard` e as duas rotas agregadas da RF13; seções 1, 3, 5, 5.3 e 6 revisadas em T19b, que acrescentou a notificação push: dependência `web-push`, tabela `InscricaoPush`, as três rotas de `/push` e os handlers importados pelo service worker; seção 5 revisada em T19, que acrescentou as duas rotas de entrega do alerta e o décimo tipo de evento `ALERTA_LIDO`; seções 2, 3 e 5.3 revisadas em T18, que acrescentou a varredura periódica de alertas e o índice único de `Alerta`)

Este documento traduz os requisitos do PRD (`docs/PRD-original.md`) em decisões técnicas concretas. Referências entre parênteses (RF/RNF) apontam para o requisito original — consulte o PRD apenas se precisar do texto exato.

## 1. Stack

| Camada | Escolha | Justificativa |
|---|---|---|
| Backend | Node.js 20+ / TypeScript / Fastify | Validação de schema nativa (JSON Schema), adequada ao contrato rígido do veredito FIFO (seção 4). Overhead baixo, ajuda a cumprir RNF06 (<500ms). |
| ORM | Prisma sobre PostgreSQL | Migrações versionadas e tipos gerados. Suporta `$transaction` com query raw para lock explícito (RNF02), que a API de alto nível do Prisma não expõe diretamente. |
| Banco de dados | PostgreSQL 15+ | Suporta `SELECT ... FOR UPDATE` nativamente (RNF02) e tipo `DATE` (RNF01). Adequado à escala do projeto (RNF10) sem tuning especial. |
| Frontend | React + Vite + TypeScript | SPA leve, boa DX, plugin de PWA maduro. |
| Roteamento | `react-router-dom` | Uma URL por tela, decidido em T10 depois de duas tarefas adiando (T03b, T05). Exige app shell em caminho fundo — resolvido pelo `navigateFallback` do service worker. |
| PWA | `vite-plugin-pwa` | Manifest + service worker prontos para instalabilidade (RNF07). |
| Notificação push | `web-push` (backend) | Implementa a criptografia de payload (RFC 8291) e a assinatura VAPID (RFC 8292) do Web Push. Escrever isso à mão não é o assunto do trabalho (RF08, T19b). Chaves **opcionais**: sem elas o servidor sobe inteiro e só a notificação some. |
| Leitura de QR | `html5-qrcode` (câmera do navegador) | Compatível com PWA, sem exigir app nativo (RF05). |
| Geração de QR | `qrcode` (node-qrcode), no servidor | Gera SVG sem dependência nativa e expõe os metadados do símbolo (versão, nível, matriz), que é o que permite testar o símbolo e não uma string opaca (RF04, T14). |
| Autenticação | JWT em cookie `httpOnly` + `bcrypt` | Simples, sem estado de sessão a gerenciar no servidor. Atende RF01 e RNF09. |
| Testes | Vitest | Mesma toolchain do Vite, TypeScript nativo, rápido. |

## 2. Estrutura de pastas

```
/backend
  /src
    /modules
      /auth
      /produto
      /unidade
      /saida          <- contém validarSaidaFifo.ts (RNF03: função única)
      /excecao-vencido <- os três caminhos da unidade vencida (PRD 6.1)
      /descarte       <- a fila do que venceu e ainda está em estoque (RF11)
      /alerta         <- a janela de antecedência (RF08), a varredura periódica, seu agendador e a entrega
      /evento-log
      /dashboard      <- só conta o que os outros gravaram (RF13)
    /db
      schema.prisma
    /shared
  /tests
/frontend
  /src
    /pages
    /components
    /services         <- chamadas de API
  /public
/docs
/tasks
```

## 3. Modelo de dados (Prisma)

```prisma
enum Papel {
  ATENDENTE
  GESTOR
}

enum StatusUnidade {
  EM_ESTOQUE
  VENDIDA
  DESCARTADA
}

model Usuario {
  id        String @id @default(uuid())
  nome      String
  email     String @unique
  senhaHash String
  papel     Papel

  saidas              Saida[]          @relation("SaidaExecutadaPor")
  saidasAutorizadas   Saida[]          @relation("SaidaAutorizadaPor")
  descartes           Descarte[]
  eventos             EventoLog[]
  unidadesRegistradas UnidadeProduto[]
}

model Produto {
  id            String @id @default(uuid())
  codigoInterno String @unique
  nome          String
  marca         String
  categoria     String
  ativo         Boolean @default(true)   // inativação em vez de exclusão

  unidades UnidadeProduto[]
}

model UnidadeProduto {
  id              String         @id @default(uuid())
  produtoId       String
  produto         Produto        @relation(fields: [produtoId], references: [id])
  codigoQr        String         @unique
  dataValidade    DateTime       @db.Date   // RNF01: DATE, nunca DATETIME
  status          StatusUnidade  @default(EM_ESTOQUE)
  dataEntrada     DateTime       @default(now())
  registradoPorId String
  registradoPor   Usuario        @relation(fields: [registradoPorId], references: [id])
  saida           Saida?
  descarte        Descarte?
  alertas         Alerta[]

  @@index([produtoId, status, dataValidade])  // sustenta a consulta FIFO, executada a cada leitura
}

model Saida {
  id                    String          @id @default(uuid())
  unidadeId             String          @unique
  unidade               UnidadeProduto  @relation(fields: [unidadeId], references: [id])
  usuarioId             String
  usuario               Usuario         @relation("SaidaExecutadaPor", fields: [usuarioId], references: [id])
  dataHora              DateTime        @default(now())
  alertaFifoDisparado   Boolean         @default(false)
  tentativasAteAcerto   Int             @default(0)
  vendaDeUnidadeVencida Boolean         @default(false)
  justificativaOverride String?
  autorizadoPorId       String?
  // Restrict, não SET NULL: quem autorizou a venda de unidade vencida
  // (PRD 6.1) não pode ser apagado do registro.
  autorizadoPor         Usuario?        @relation("SaidaAutorizadaPor", fields: [autorizadoPorId], references: [id], onDelete: Restrict)
  sessaoVendaId         String?
}

model Descarte {
  id        String         @id @default(uuid())
  unidadeId String         @unique
  unidade   UnidadeProduto @relation(fields: [unidadeId], references: [id])
  usuarioId String
  usuario   Usuario        @relation(fields: [usuarioId], references: [id])
  dataHora  DateTime       @default(now())
  motivo    String
}

model ConfiguracaoAlerta {
  id               String   @id @default(uuid())
  diasAntecedencia Int
  // Conjunto fechado `IN_APP | PUSH | AMBOS`, garantido no JSON Schema da
  // rota e na constante `CANAIS` do serviço, não por `enum` do banco (T17).
  canal            String
  ativo            Boolean  @default(true)
  alertas          Alerta[]
}

model Alerta {
  id             String              @id @default(uuid())
  unidadeId      String
  unidade        UnidadeProduto      @relation(fields: [unidadeId], references: [id])
  configuracaoId String
  configuracao   ConfiguracaoAlerta  @relation(fields: [configuracaoId], references: [id])
  geradoEm       DateTime            @default(now())
  lidoEm         DateTime?

  // T18: o alerta acontece uma vez por par, e é isso que torna a varredura
  // idempotente. Aqui a garantia é do banco, ao contrário da unicidade de
  // ConfiguracaoAlerta.diasAntecedencia — ver seção 5.3.
  @@unique([unidadeId, configuracaoId])
}

model InscricaoPush {
  id        String   @id @default(uuid())
  // A URL do serviço de push do navegador para este aparelho. É credencial de
  // envio: não sai em resposta de API, em EventoLog nem em log de servidor.
  endpoint  String   @unique
  // As duas chaves que a RFC 8291 exige para cifrar o payload.
  p256dh    String
  auth      String
  // O envio confere o papel aqui, e no momento do envio: conta rebaixada para
  // ATENDENTE deixa de receber sem que ninguém limpe a tabela (T19b).
  usuarioId String
  usuario   Usuario  @relation(fields: [usuarioId], references: [id])
  criadoEm  DateTime @default(now())
}

model EventoLog {
  id         String   @id @default(uuid())
  tipoEvento String
  // Sem @relation de propósito: o log precisa sobreviver às entidades que
  // descreve (seção 5 do PRD declara os dois como nullable, sem FK).
  unidadeId  String?
  produtoId  String?
  usuarioId  String
  usuario    Usuario  @relation(fields: [usuarioId], references: [id])
  payload    Json
  ocorridoEm DateTime @default(now())
  // Sem @updatedAt. Sem endpoint de UPDATE/DELETE na aplicação (RNF05).
}
```

## 4. Especificação da função `validarSaidaFifo` (núcleo do sistema)

Local: `backend/src/modules/saida/validarSaidaFifo.ts`. Única função autorizada a decidir o veredito de uma leitura de QR (RNF03, RNF04) — nenhum outro módulo replica esta lógica.

```ts
type Veredito =
  | { tipo: 'ERRO'; motivo: 'QR_NAO_ENCONTRADO' | 'UNIDADE_JA_BAIXADA' }
  | { tipo: 'EXCECAO_VENCIDO'; unidade: UnidadeProduto }
  | { tipo: 'BLOQUEAR_FIFO'; unidadeCorreta: UnidadeProduto; tentativas: number }
  | { tipo: 'CONFIRMAR'; unidade: UnidadeProduto };

async function validarSaidaFifo(
  codigoQr: string,
  usuarioId: string,
  tx: PrismaTransactionClient,
  sessaoVendaId?: string | null   // agrupador opcional de relatório (T09)
): Promise<Veredito>
```

Executada **inteiramente dentro de uma transação Prisma (`prisma.$transaction`)**, com a unidade lida bloqueada via `SELECT ... FOR UPDATE` (query raw dentro da transação) — cumpre RNF02.

Ordem das verificações (idêntica à seção 7 do PRD — não reordenar):

1. QR existe? → não: `ERRO / QR_NAO_ENCONTRADO`
2. `status = EM_ESTOQUE`? → não: `ERRO / UNIDADE_JA_BAIXADA`
3. `dataValidade < hoje`? → sim: `EXCECAO_VENCIDO` (não passa pelo FIFO)
4. É a prioritária do pool não-vencido (`MIN(dataValidade) WHERE produtoId = X AND status = EM_ESTOQUE AND dataValidade >= hoje`)? → não: `BLOQUEAR_FIFO`, incrementa tentativas, grava evento `ALERTA_FIFO_DISPARADO`
5. Sim → `CONFIRMAR`: cria `Saida`, `status → VENDIDA`, grava evento `SAIDA_CONFIRMADA`

**Empate de validade.** O passo 4 compara **valores**, não identidade: havendo mais de uma unidade com a menor `dataValidade` do pool, todas são prioritárias e ler qualquer uma delas confirma. Apontar uma única vencedora arbitrária faria o sistema pedir um frasco fisicamente indistinguível do que está na mão da atendente — laço sem saída. Decidido em T06 (`docs/decisoes.md`, 2026-09-07).

**Eventos gravados pela função** (decidido em T06 — a tabela de eventos da seção 5 do PRD previa os quatro, sem dizer quem grava; a função é a única que vê a leitura inteira e roda dentro da transação). Desde T09 a escrita em si passa por `src/modules/evento-log/eventoLog.service.ts`, único ponto do sistema autorizado a inserir no `EventoLog`; a função continua decidindo *qual* evento cada ramo grava:

| Evento | Quando | `unidadeId` |
|---|---|---|
| `LEITURA_QR_SAIDA` | **toda** chamada, nos cinco ramos | a unidade lida, ou `null` no ramo 1 (código no `payload`) |
| `TENTATIVA_VENDA_UNIDADE_VENCIDA` | ramo 3 | a unidade vencida |
| `ALERTA_FIFO_DISPARADO` | ramo 4 | a unidade **lida**; a correta vai no `payload` como `unidadeCorretaId` |
| `SAIDA_CONFIRMADA` | ramo 5 | a unidade baixada |

Fora do fluxo de saída, o cadastro de unidades grava `UNIDADE_CADASTRADA` (um evento por
unidade, dentro da transação do lote), pelo mesmo módulo. A imutabilidade da tabela
(RNF05) deixou de ser convenção em T09: a migração `20260908120000_append_only_evento_log`
instala um trigger `BEFORE UPDATE OR DELETE` que recusa a operação no banco, alcançando
também quem chega por `psql` ou Prisma Studio. `TRUNCATE` não dispara trigger de linha, e é
o que mantém o reset das suítes funcionando.

Sem `LEITURA_QR_SAIDA` em toda leitura não há denominador para a taxa de acerto na primeira leitura, que é indicador do TCC (RF12).

**`tentativas` é derivado, não persistido.** Não há contador em `UnidadeProduto`, e a seção 6.2 do PRD proíbe estado intermediário no servidor. O número é a contagem de `ALERTA_FIFO_DISPARADO` do mesmo `produtoId` e mesmo `usuarioId` desde a última `SAIDA_CONFIRMADA` daquele par, incluindo o bloqueio da chamada corrente — o primeiro bloqueio devolve `tentativas: 1`. `Saida.tentativasAteAcerto` recebe esse total no momento da confirmação, e `Saida.alertaFifoDisparado` é `true` sempre que ele for maior que zero.

**O lock é da unidade lida, não do SKU.** Duas atendentes vendendo unidades diferentes do mesmo produto não podem esperar uma pela outra. Desde T11 o `SELECT ... FOR UPDATE` mora em `src/modules/unidade/travarUnidade.ts`, nas duas chaves de que o sistema precisa (`codigoQr` para a leitura, `id` para os caminhos da exceção) — a decisão continua toda aqui, o lock é que passou a ser compartilhado.

**A função tem um segundo chamador desde T11**, e continua sendo a única a decidir: a
correção de validade (`POST /excecao-vencido/corrigir`) revalida o FIFO chamando esta mesma
função, dentro da transação em que corrigiu a data. Ela grava o `LEITURA_QR_SAIDA` da
revalidação como em qualquer outra passagem — são dois eventos para uma resolução de
unidade vencida (o da leitura original e o da revalidação), que é também o que uma releitura
manual produziria.

## 5. Contratos de API (principais endpoints)

| Método | Rota | Papel | Descrição |
|---|---|---|---|
| POST | `/auth/login` | público | Autentica, retorna cookie JWT |
| POST | `/produtos` | GESTOR | Cria SKU (RF02) |
| GET | `/produtos` | qualquer autenticado | Lista/busca produtos |
| DELETE | `/produtos/:id` | GESTOR | **Inativa** (`ativo = false`). Nunca exclui fisicamente — ver seção 3 |
| POST | `/produtos/:id/unidades` | GESTOR | Cadastro em lote de unidades, validades por item (RF03) |
| GET | `/produtos/:id/unidades/etiquetas` | GESTOR | Gera etiquetas QR para impressão (RF04) |
| POST | `/saidas/ler` | ATENDENTE, GESTOR | Executa `validarSaidaFifo`, retorna veredito (RF05, RF06) e, no ramo `CONFIRMAR`, **efetiva a saída** (RF07) |
| POST | `/excecao-vencido/corrigir` | GESTOR | Caminho 1 da seção 6.1 do PRD |
| POST | `/excecao-vencido/descartar` | ATENDENTE, GESTOR | Caminho 2 da seção 6.1 do PRD |
| POST | `/excecao-vencido/override` | GESTOR | Caminho 3 da seção 6.1 do PRD — exige justificativa |
| GET | `/descartes/pendentes` | GESTOR | Fila de descarte pendente (RF11) |
| GET/POST | `/configuracao-alerta` | GESTOR | Lista e cria janelas de antecedência (RF08) |
| PATCH/DELETE | `/configuracao-alerta/:id` | GESTOR | Altera e **inativa** a janela (RF08) |
| GET | `/alertas` | GESTOR | Lista os alertas proativos emitidos pela varredura (RF08) |
| POST | `/alertas/:id/lido` | GESTOR | Reconhece o alerta: grava `lidoEm` e `ALERTA_LIDO` (RF08) |
| GET | `/push/chave-publica` | GESTOR | Chave pública VAPID, exigida pelo navegador para inscrever o aparelho (RF08) |
| POST | `/push/inscricoes` | GESTOR | Inscreve **este aparelho** na notificação push (RF08) |
| DELETE | `/push/inscricoes` | GESTOR | Remove a inscrição do aparelho, pelo `endpoint` no corpo (RF08) |
| GET | `/dashboard` | GESTOR | Os agregados da RF13, no recorte de período pedido |
| GET | `/dashboard/saidas` | GESTOR | Histórico de saídas, paginado — o único item da RF13 que é lista |

**Não existe `POST /saidas/confirmar`.** Uma versão anterior desta tabela listava um
endpoint separado de confirmação para o RF07, o que contradizia a seção 4 acima — o ramo 5
de `validarSaidaFifo` cria a `Saida` e muda o status dentro da própria transação da
leitura, que é também o que a seção 7 do PRD descreve. Um segundo passo honesto exigiria
revalidar o FIFO inteiro (aceitar o veredito afirmado pelo cliente violaria a RNF04) ou
manter reserva no servidor (proibido pela seção 6.2 do PRD). Removido em T09
(`docs/decisoes.md`, 2026-09-08): quando `/saidas/ler` responde `CONFIRMAR`, a venda já
aconteceu.

**Os três endpoints de `/excecao-vencido`** (T11) recebem a unidade pelo `unidadeId` que o
veredito `EXCECAO_VENCIDO` devolveu, mais o `sessaoVendaId` opcional. Conferem as mesmas
três pré-condições, **sob o lock da RNF02**: unidade existe (senão 404
`UNIDADE_NAO_ENCONTRADA`), está `EM_ESTOQUE` (senão 409 `UNIDADE_JA_BAIXADA`) e está
vencida (senão 409 `UNIDADE_NAO_VENCIDA`).

| Rota | Corpo além de `unidadeId` | Sucesso | Efeito |
|---|---|---|---|
| `corrigir` | `dataValidade` (`AAAA-MM-DD`) | 200 `{ correcao, revalidacao }` | Atualiza a validade, grava `VALIDADE_CORRIGIDA` com o valor anterior e **revalida o FIFO na mesma transação**, chamando `validarSaidaFifo`. `revalidacao` é o mesmo contrato de `/saidas/ler` — se o veredito for `CONFIRMAR`, a venda já aconteceu. Data igual à atual → 400 `VALIDADE_INALTERADA`; data no passado é aceita e revalida como `EXCECAO_VENCIDO` |
| `descartar` | `motivo` (opcional, ≤280) | 201 | Cria `Descarte`, status → `DESCARTADA`, grava `DESCARTE_REGISTRADO`. Sem `motivo`, grava texto padrão: a fricção da seção 6.1 é do override, não deste caminho |
| `override` | `justificativa` (10–500, obrigatória) | 201 | Cria `Saida` com `vendaDeUnidadeVencida = true`, `justificativaOverride` e `autorizadoPorId`, status → `VENDIDA`, grava `VENDA_VENCIDA_AUTORIZADA`. `tentativasAteAcerto = 0`: não passou pelo laço do FIFO. Não chama `validarSaidaFifo` |

A pré-condição de vencimento é o que impede o override de virar um contorno do bloqueio de
FIFO: ele é escape do bloqueio de **validade**, e só dele. Falha de pré-condição é 4xx e
não veredito em 200 como em `/saidas/ler` — ali a tela pergunta, aqui ela afirma uma ação
sobre um estado que julga conhecer (`docs/decisoes.md`, 2026-09-08).

**`GET /produtos/:id/unidades/etiquetas`** (T14) devolve as etiquetas imprimíveis do
produto: as unidades `EM_ESTOQUE` — vencidas inclusive, porque o frasco existe e precisa ser
legível —, ordenadas por `dataValidade` crescente com desempate por `codigoQr` e paginadas
(`pagina`, `tamanhoPagina`, padrão 100, máximo 500, o mesmo teto do lote de T05 para que um
recebimento inteiro caiba numa impressão):

```json
{
  "etiquetas": [{ "...UnidadeNaResposta": "...", "svg": "<svg viewBox=\"0 0 29 29\">...</svg>" }],
  "total": 6, "pagina": 1, "tamanhoPagina": 100
}
```

O `svg` vem do módulo `src/modules/unidade/simboloQr.ts`, único dono do símbolo (como
`codigoQr.ts` é o dono do formato): correção de erro **H** e versão 1 (21×21 módulos), que
cabem juntas porque o `codigoQr` tem exatamente os 10 caracteres alfanuméricos da capacidade
dessa combinação — e o módulo **lança** se a versão mudar, para que um formato maior apareça
como falha e não como etiqueta silenciosamente mais densa. O símbolo carrega o código puro,
nunca uma URL; sai sem largura, altura, `id`, `class` ou `style`, porque o tamanho físico é
decisão da impressão (T15) e a folha embute dezenas deles na mesma página. A query aceita
`unidadeIds` repetível, que restringe às unidades de um recebimento recém-cadastrado (é como
a tela de T15 imprime o lote que acabou de chegar em vez do estoque inteiro do SKU); id que
não pertence ao produto ou já saiu do estoque é ignorado, não recusado. Produto inativo
devolve etiquetas (o frasco continua na prateleira, como na fila de T13); produto inexistente
é 404, e produto sem nada a etiquetar é 200 com lista vazia. A rota não grava evento: gerar
etiqueta é consulta, e a consequência — o sistema não sabe quantas reimpressões houve — está
declarada como limitação em `docs/notas-para-artigo.md`.

**As quatro rotas de `/configuracao-alerta`** (T17) são o CRUD da janela de antecedência dos
alertas proativos, todas `GESTOR`. A configuração é **coleção**, não valor único: uma janela
larga (30 dias) serve para decisão comercial e uma estreita (7 dias) para última chamada.
`GET` devolve `{ configuracoes: [...] }` com ativas e inativas juntas, ordenadas por
`diasAntecedencia` decrescente e sem paginação (a lista tem ordem de grandeza de unidades);
as demais devolvem `{ configuracao }`.

```json
{ "id": "...", "diasAntecedencia": 30, "canal": "IN_APP", "ativo": true }
```

`diasAntecedencia` é inteiro de **1 a 365** — o 0 fica de fora porque a unidade que vence
hoje ainda está no pool do FIFO, e amanhã já estará na fila de descarte. `canal` é o conjunto
fechado `IN_APP | PUSH | AMBOS`; o `AMBOS` existe porque a RF08 fala em "in-app **e/ou**
push" num campo só. **Duas configurações ativas não podem ter a mesma antecedência** (409
`ANTECEDENCIA_JA_CONFIGURADA`, no `POST` e no `PATCH`, inclusive ao reativar): duas janelas
iguais gerariam dois `Alerta` para a mesma unidade no mesmo dia, inflando a contagem que a
RF13 reporta. A garantia é de aplicação, dentro de uma transação, não índice único no banco.
`DELETE` **inativa** (`ativo = false`) e nunca exclui, como em `/produtos/:id` e por uma
razão a mais: `Alerta.configuracaoId` é FK obrigatória, e apagar levaria junto o histórico de
alertas emitidos. Id inexistente é 404 `CONFIGURACAO_NAO_ENCONTRADA`. Nenhuma dessas rotas
grava `EventoLog` — nenhum dos nove tipos do PRD descreve mudança de configuração, e a
consequência (alterar a janela no meio do piloto não deixa rastro) está declarada em
`docs/notas-para-artigo.md`. Nenhuma delas lê ou escreve `Alerta`: a varredura periódica é
T18.

**As duas rotas de `/alertas`** (T19) são a entrega do que a varredura da seção 5.3 emitiu —
a metade in-app da RF08. Ambas `GESTOR`, pela mesma razão de T17 e T13: a jornada J3 termina
em decisão comercial, que não é ato de balcão. `GET /alertas` é paginado no formato de
`/descartes/pendentes` (`pagina`, `tamanhoPagina`, padrão 20, máximo 100), aceita
`apenasNaoLidos` e ordena por urgência (`dataValidade` crescente, desempate por `codigoQr`):

```json
{
  "alertas": [{
    "id": "...", "geradoEm": "2026-09-09T03:42:42.383Z", "lidoEm": null,
    "diasParaVencer": 15, "situacao": "NA_JANELA",
    "janela": { "configuracaoId": "...", "diasAntecedencia": 30, "canal": "IN_APP" },
    "unidade": { "...UnidadeNaResposta": "..." }
  }],
  "total": 2, "naoLidos": 2, "pagina": 1, "tamanhoPagina": 20
}
```

A lista traz os alertas cuja unidade **ainda está `EM_ESTOQUE`**: vendida ou descartada, não
há mais o que decidir sobre o frasco. A unidade que **venceu depois do aviso continua**, com
`situacao: 'VENCIDA'` e `diasParaVencer` negativo — é o caso que mede se a RF08 funcionou, e
some-lo esconderia da tela justamente o aviso que falhou. Assume-se com isso que a mesma
unidade apareça aqui e na fila de T13: os dois lugares dizem coisas diferentes
(`docs/decisoes.md`, 2026-09-09). `situacao` é decidido no servidor porque o frontend não
compara validade em lugar nenhum (RNF01, RNF04), e `naoLidos` **ignora** o filtro
`apenasNaoLidos`, por ser o contador da navegação. Janela inativada depois não esconde o
alerta já emitido: inativar diz "não emita mais", não "desfaça". `GET` não grava evento.

`POST /alertas/:id/lido` grava `lidoEm` — a primeira escrita nessa coluna desde T02 — e o
evento **`ALERTA_LIDO`**, décimo tipo do log e único fora da lista da seção 5 do PRD,
acrescentado conscientemente antes do piloto (`docs/decisoes.md`, 2026-09-09). O evento é
assinado pelo gestor que leu, na mesma transação, com payload
`{ alertaId, configuracaoId, diasAntecedencia, dataValidade, diasParaVencer, geradoEm }`; é o
par dele com o `ALERTA_PROATIVO_EMITIDO` da mesma unidade que diz quanto tempo a loja levou
para reagir. A rota é **idempotente**: o segundo `POST` devolve o `lidoEm` original e não
grava um segundo evento — a corrida entre dois cliques é resolvida por um `updateMany`
condicionado a `lidoEm: null`, sem lock (a RNF02 é sobre a baixa da unidade, que aqui não
acontece). Id inexistente é 404 `ALERTA_NAO_ENCONTRADO`. "Lido" é da loja e não de cada
gestor, porque `lidoEm` é uma coluna só. Alerta de janela com canal `PUSH` ou `AMBOS`
aparece nesta lista como qualquer outro: o canal decide se **também** sai notificação, nunca
se o alerta existe.

**As três rotas de `/push`** (T19b) são a inscrição de aparelhos na notificação — a metade
da RF08 que alcança quem **não abriu** o sistema. Todas `GESTOR`, pela mesma razão de T19.
A inscrição é **do navegador, não da pessoa**: o celular da gestora e o computador da loja
são duas linhas de `InscricaoPush`, e desativar num não cala o outro.
`GET /push/chave-publica` devolve `{ chavePublica }` — servida por rota autenticada em vez
de embutida no bundle, para que trocar o par VAPID seja um reinício e não um rebuild.
`POST /push/inscricoes` recebe `{ endpoint, chaves: { p256dh, auth } }` e devolve
`{ inscricao: { id, criadoEm } }`: **201** na primeira vez, **200** ao reinscrever o mesmo
`endpoint` (o navegador renova as chaves por conta própria, e recusar com 409 deixaria o
aparelho com chave velha, que falha em todo envio seguinte). `DELETE /push/inscricoes`
recebe `{ endpoint }` e responde 204 — inclusive para endpoint desconhecido, porque o estado
desejado já vale. As três respondem **503 `PUSH_NAO_CONFIGURADO`** quando o servidor não tem
chaves VAPID: aceitar inscrição num servidor que não envia seria prometer aviso que nunca
chega. Nenhuma grava `EventoLog` — a lista de tipos parou nos dez de T19
(`docs/decisoes.md`, 2026-09-09). O `endpoint` é credencial de envio e **não volta em
resposta nenhuma**.

**`GET /descartes/pendentes`** (T13) devolve a fila da RF11: as unidades `EM_ESTOQUE`
cuja `dataValidade` já passou, ordenadas da mais vencida para a menos (desempate por
`codigoQr`, para a paginação ser estável) e paginadas no mesmo formato de `GET /produtos`
(`pagina`, `tamanhoPagina`, padrão 20, máximo 100):

```json
{
  "unidades": [{ "...UnidadeNaResposta": "...", "diasVencida": 47, "dataEntrada": "..." }],
  "total": 12, "pagina": 1, "tamanhoPagina": 20
}
```

Cada item é o `UnidadeNaResposta` das demais respostas — é o que o painel dos três caminhos
já recebe — mais `diasVencida` e `dataEntrada`. **A cláusula da fila é a negação exata do
filtro do pool prioritário** do passo 4 da seção 4 (`dataValidade >= hoje`), com o mesmo
`hojeComoData()`: se as duas divergirem, aparece uma faixa de unidades que não sai pelo FIFO
nem consta da fila, invisível dos dois lados. Unidade de produto inativo entra na fila
(o frasco continua na prateleira). Fila vazia é 200 com lista vazia, nunca 404. A rota não
grava evento: consultar não é ato operacional.

O corpo de `/saidas/ler` aceita, além do `codigoQr`, um `sessaoVendaId` opcional — UUID
gerado no cliente que agrupa as saídas de um mesmo atendimento para fins de relatório.
Não cria estado nem semântica transacional (PRD seção 6.2).

**As duas rotas de `/dashboard`** (T20) são a consolidação da RF13 — a leitura do
instrumento que a RF12 construiu. Ambas `GESTOR`, pela mesma razão de T13, T17 e T19: são
decisão comercial e dado de pesquisa, não ato de balcão. Nenhuma das duas grava `EventoLog`,
e um evento aqui sujaria justamente a tabela de onde o painel lê.

Ambas recortam o tempo por `de` e `ate` (`AAAA-MM-DD`, opcionais; padrão: os **últimos 30
dias**, hoje inclusive), devolvem o período **ecoado** e recusam intervalo invertido com 400
`PERIODO_INVALIDO`. Data que não existe no calendário (31/02) é recusada pelo `format: 'date'`
do schema, como `CORPO_INVALIDO`.

```json
{
  "periodo": { "de": "2026-08-11", "ate": "2026-09-09" },
  "estoque": {
    "unidadesEmEstoque": 13,
    "porFaixaDeVencimento": [
      { "faixa": "VENCIDA", "unidades": 1 }, { "faixa": "ATE_7_DIAS", "unidades": 0 },
      { "faixa": "DE_8_A_30_DIAS", "unidades": 2 }, { "faixa": "DE_31_A_90_DIAS", "unidades": 3 },
      { "faixa": "ACIMA_DE_90_DIAS", "unidades": 7 }
    ]
  },
  "saidas": { "total": 2, "naPrimeiraLeitura": 2, "taxaAcertoPrimeiraLeitura": 1 },
  "fifo": { "alertasDisparados": 5, "substituicoesEfetivas": 0 },
  "perdas": { "descartes": 4, "unidadesVencidasEmEstoque": 1 },
  "overrides": { "total": 1 }
}
```

**A resposta mistura dois tempos, e diz isso na própria forma.** `estoque` e
`perdas.unidadesVencidasEmEstoque` são fotografia do **agora** e ignoram `de`/`ate`; `saidas`,
`fifo`, `perdas.descartes` e `overrides` são do **período**. Não há como uniformizar: "unidades
em estoque no período" não significa nada (o estoque de qual dia?), e "perdas agora" seria o
total histórico. Separá-los em objetos distintos é o que permite à tela rotular cada bloco
(`docs/decisoes.md`, 2026-09-09).

As **cinco faixas de vencimento são fixas no código** e saem sempre, inclusive zeradas —
faixa ausente vira buraco no gráfico e sugere dado não apurado. Elas são contíguas por
construção (cada piso é o teto da anterior mais um dia), e por isso a soma delas é
`unidadesEmEstoque`. A borda de `VENCIDA` é a mesma cláusula da fila de T13 e a negação exata
do pool prioritário do passo 4 da seção 4: o que vence **hoje** abre `ATE_7_DIAS`, não a faixa
de vencidas. `perdas.unidadesVencidasEmEstoque` é esse mesmo número, repetido no bloco onde
ele é lido como prejuízo iminente e não como distribuição de estoque.

`fifo.alertasDisparados` conta `ALERTA_FIFO_DISPARADO` no `EventoLog`; `substituicoesEfetivas`
conta `Saida` com `alertaFifoDisparado`. As duas tabelas são diferentes de propósito — um
bloqueio pode não terminar em venda —, e é essa diferença que o "vs." da RF13 pede para ver.
`taxaAcertoPrimeiraLeitura` é `null`, nunca `0`, quando não houve saída no período: 0% de
acerto e "nenhuma venda" são fatos opostos.

**`GET /dashboard/saidas`** é o único item da RF13 que é lista, e por isso rota própria em vez
de um campo do agregado. Paginada no formato de `/descartes/pendentes` (padrão 20, máximo
100), ordenada por `dataHora` **decrescente** com desempate por `id`, e com o filtro
`apenasOverrides` — que é o que dá corpo ao item "overrides autorizados", sem o qual ele seria
um número sem como olhar quais vendas o compõem. Cada linha traz o `UnidadeNaResposta` de
sempre, `dataHora` (instante, não data de calendário), `tentativasAteAcerto`,
`alertaFifoDisparado`, `vendaDeUnidadeVencida`, `justificativaOverride`, `sessaoVendaId`,
`usuario` e `autorizadoPor` (`null` em toda saída comum).

**O recorte do período é do dia local, não da meia-noite UTC.** `dataValidade` é `DATE`
(RNF01), mas `Saida.dataHora`, `Descarte.dataHora` e `EventoLog.ocorridoEm` são instantes.
Converter `de`/`ate` com o `dataDeString()` da seção 4 ancoraria o corte em UTC, e em BRT
(UTC-3) uma venda das 22h de segunda apareceria no relatório de terça — a mesma classe de erro
que a RNF01 evita na validade, entrando pela porta do recorte. Por isso `shared/data.ts` ganhou
o par `inicioDoDia`/`inicioDoDiaSeguinte`, que monta os instantes a partir dos componentes
**locais**, coerente com o `hojeComoData()` que já decide que dia é hoje na loja. O intervalo é
fechado no começo e aberto no fim.

### 5.1 Formato de erro da API

Toda resposta de erro — recusa de negócio, violação de schema, rota inexistente ou falha
interna — tem o mesmo corpo, para que o cliente não precise distinguir formatos conforme o
que deu errado:

```json
{ "erro": "CODIGO_DA_RECUSA", "mensagem": "Texto em português exibível ao usuário." }
```

`erro` é o código estável, que a interface usa para distinguir casos sem julgar nada por
conta própria (RNF04); `mensagem` é o único texto que vai à tela.

As recusas de negócio são **escritas nas rotas**, com código e texto específicos do caso
(`UNIDADE_NAO_VENCIDA`, `PAPEL_INSUFICIENTE`, `VALIDADE_INALTERADA`, ...). O que o próprio
Fastify gera passa pelo `setErrorHandler`/`setNotFoundHandler` registrados em
`backend/src/app.ts` (T12b), única fonte destes três casos:

| Situação | Status | `erro` | Observação |
|---|---|---|---|
| Violação de JSON Schema (corpo, query, params ou headers) | 400 | `CORPO_INVALIDO` | Acrescenta `campos: ['justificativa']` para diagnóstico. O texto exibido é sempre a `mensagem` genérica: traduzir regra a regra do ajv duplicaria as restrições que o schema já declara e as telas já espelham |
| Demais recusas do framework (JSON malformado, content-type não suportado) | preserva o status | `REQUISICAO_INVALIDA` | O handler troca o corpo da resposta, nunca o status |
| Exceção não tratada | 500 | `ERRO_INTERNO` | Texto fixo. A mensagem original fica **só** no log do servidor: erro do Prisma carrega nome de tabela, coluna e o valor que violou a constraint (RNF09) |
| Rota inexistente | 404 | `ROTA_NAO_ENCONTRADA` | — |

`campos` é pista de diagnóstico, não relatório de formulário: o ajv do Fastify roda com
`allErrors: false` e para na primeira falha. E `additionalProperties: false`, com o
`removeAdditional` padrão, **filtra** a propriedade desconhecida em vez de recusá-la — por
isso `campos` nunca cita campo fora do schema.

### 5.2 A etiqueta física (T15)

O único lugar do sistema dimensionado em **milímetros**: o resto é tela, aqui é papel. A
folha vive em `frontend/src/pages/TelaEtiquetas.tsx` (rota `/etiquetas`, `GESTOR`) e consome
`GET /produtos/:id/unidades/etiquetas` sem acrescentar nada ao dado — o símbolo, a ordem
(validade crescente, a mesma do FIFO) e a validade chegam prontos do servidor.

- **Impressão pelo navegador**, `window.print()` mais um bloco `@media print` em
  `estilos.css` que remove barra de topo, abas, seletores e botões. Sem geração de PDF e sem
  dependência nova; a contrapartida é que a fidelidade depende do navegador e das margens do
  diálogo, e por isso a medida final é física (RNF08 / T16).
- **Três tamanhos de símbolo** — 15, 20 e 25 mm de lado, aplicados por
  `[data-tamanho-mm]` na folha, com 20 mm de padrão. Com os 29 módulos do `viewBox` de T14,
  dão módulos de ~0,52, ~0,69 e ~0,86 mm. O tamanho escolhido **sai impresso no rodapé**,
  para que a validação física de T16 saiba de qual folha está falando.
- **Cada etiqueta traz símbolo, `codigoQr` em texto e validade** — e nada mais. O texto
  sustenta o fallback manual de T10; a validade é o que se lê na prateleira sem escanear; o
  nome do produto ficaria disputando espaço com o símbolo numa embalagem pequena (RF04).
- **O lote recém-recebido chega por estado de rota**, não pela URL (500 UUIDs seriam ~18 KB
  de query string). Entrar na tela sem esse estado **não carrega nada**: a gestora escolhe o
  produto e pede, porque abrir sozinha o estoque inteiro do SKU faria reimprimir etiqueta de
  frasco já etiquetado.
- **Imprime-se a página carregada**, no mesmo esquema de paginação da rota.

### 5.3 A varredura periódica de alertas (T18)

O único trabalho do sistema que **não** começa por uma requisição: não tem rota, não tem
usuário e não aparece na tabela acima. Vive em
`backend/src/modules/alerta/varreduraAlertas.ts`, roda por `agendador.ts` dentro do processo
do servidor (iniciado em `server.ts`, nunca em `buildApp()`) e pode ser disparada à mão com
`npm run alertas:varrer`.

Para cada `ConfiguracaoAlerta` **ativa**, a janela é `hoje <= dataValidade <= hoje + diasAntecedencia`,
com o mesmo `hojeComoData()` do FIFO e da fila de descarte. A borda inferior é a do pool
prioritário do passo 4 da seção 4: **o que já venceu não alerta**, porque é assunto da fila
de T13 — alertar sobre perda consumada seria a terceira apresentação do mesmo fato. Só
`status = EM_ESTOQUE`; unidade de produto inativo entra, como na fila.

Cada unidade nova na janela vira uma linha de `Alerta` mais um `ALERTA_PROATIVO_EMITIDO` no
`EventoLog`, na mesma transação (uma por janela, na forma de array, como o lote de T05). O
evento é **um por alerta**, com `unidadeId` e `produtoId`, e payload
`{ configuracaoId, diasAntecedencia, canal, dataValidade, diasParaVencer }` — é essa
granularidade que permite cruzar o alerta com a saída posterior da mesma unidade e responder
"a unidade alertada foi vendida antes de vencer?" (RF12).

**A varredura é idempotente**, e é isso que permite agendá-la por intervalo simples em vez
de guardar "última execução": o índice único `@@unique([unidadeId, configuracaoId])` fixa que
o alerta é a notícia da **entrada** da unidade na janela, e acontece uma vez. Duas janelas
ativas (30 e 7 dias) geram dois alertas para a mesma unidade, um por janela, em momentos
diferentes — que é o uso previsto em T17. Rodar dez vezes no mesmo dia deixa o banco como
uma. A garantia é do banco, e não da aplicação como em `ConfiguracaoAlerta`, porque aqui quem
escreve é um job automático sem ninguém olhando, e a contagem de alertas emitidos é dado da
pesquisa (RF13).

O evento é assinado pela **conta de sistema** `sistema@estoque.local` (papel `ATENDENTE`,
hash que nenhuma senha casa): `EventoLog.usuarioId` é FK obrigatória e a varredura não tem
usuário. A análise do piloto precisa saber excluí-la ao contar ações humanas.

O agendador roda uma vez ao subir e a cada `ALERTA_INTERVALO_HORAS` (padrão 24); ignora o
tique se a passagem anterior ainda não terminou, e uma falha de varredura é logada sem
derrubar o servidor — o balcão continua vendendo. A entrega do que ela emite é das duas rotas
de `/alertas` (T19), descritas na seção 5.

**A notificação push sai daqui** (T19b), em `modules/push/envioPush.ts`, chamado pela
varredura **depois** que as transações comitaram e nunca de dentro de uma: uma chamada HTTP
dentro de `$transaction` seguraria a transação pela latência da rede, e um serviço de push
fora do ar não pode fazer o `Alerta` deixar de existir. São notificados só os alertas de
janela com canal `PUSH` ou `AMBOS`, e só os aparelhos cujo dono é `GESTOR` **no momento do
envio**.

A notificação é **uma por passagem e por aparelho, agregada** ("12 unidades perto do
vencimento · Janela de 30 dias"), e o toque abre `/alertas`. É a única granularidade
diferente do resto do módulo: o `Alerta` é por unidade porque é dele que a RF13 conta, mas um
recebimento de 40 frascos que virasse 40 notificações faria a gestora desligar o aviso — e o
efeito prático de 40 notificações é o de zero. O texto não nomeia produto: notificação
aparece em tela bloqueada, e quem detalha é a lista.

Inscrição que responde **404 ou 410 é apagada na hora** (aparelho desinstalado, permissão
revogada); qualquer outro erro é logado e a inscrição fica. **Não há fila de reenvio**: a
passagem seguinte não reemite o alerta, então um push perdido está perdido — aceitável porque
a lista in-app continua sendo a fonte de verdade. Um envio que falhe **não desfaz** alerta
nenhum, e o `ResumoDaVarredura` ganhou `notificacoesEnviadas`.

## 6. Comportamento offline (RNF07)

O frontend verifica `navigator.onLine` e faz um *health check* ao backend antes de habilitar a tela de leitura de QR. Se offline: bloqueia o fluxo de saída com mensagem explícita — nunca tenta validar FIFO com dado local.

Detalhado em T10, a partir da implementação:

- **Os dois sinais são necessários.** `navigator.onLine` só sabe que existe uma rede; `GET /health` é o que confirma caminho até o backend. O portão reage aos eventos `online`/`offline` do navegador, sem varredura periódica.
- **Não há fila de leituras offline**, nem cópia local do estoque. Um QR lido sem rede só teria valor com veredito na hora, e o veredito depende do estoque inteiro do SKU naquele instante (RNF03). Uma queda no meio da leitura cai no mesmo bloqueio, sem veredito inventado pela tela.
- **O veredito exibido é descartado quando a conexão cai.** Ele vale para o estoque de um instante: durante a queda, outra atendente pode ter baixado a unidade apontada.
- **`/saidas/ler` e `/health` ficam em `NetworkOnly` no service worker**, sem retry automático — cache serviria decisão vencida, e retry gravaria um segundo `LEITURA_QR_SAIDA`, inflando o denominador da taxa de acerto na primeira leitura (RF12).
- O `navigateFallback` do service worker faz o app instalado abrir sem rede para mostrar o bloqueio, e sustenta o recarregamento direto de uma URL de tela (seção 1, roteamento).
- **Os handlers de push entram por `workbox.importScripts`** (T19b), e não trocando o `generateSW` por um `injectManifest`: as três regras acima continuam sendo geradas pelo plugin, em vez de virarem código nosso sem teste por trás — um erro ali quebraria o comportamento offline do balcão, e não a tela de alertas. O arquivo é `frontend/public/sw-push.js`, fora do build do Vite (sem TypeScript, sem Vitest), e por isso curto e sem regra de negócio: o texto da notificação vem pronto do servidor (RNF04).

## 7. Estratégia de testes

A função `validarSaidaFifo` precisa de cobertura para os 5 ramos da seção 4 acima **antes** de qualquer outra parte do incremento 2 ser implementada (exigência da seção 8 do PRD). Casos obrigatórios:

- QR inexistente
- unidade já vendida/descartada
- unidade vencida
- unidade não-prioritária (deve bloquear com FIFO)
- unidade prioritária (deve confirmar)
- concorrência: duas leituras simultâneas da mesma unidade — uma deve falhar por lock, não duplicar a baixa
