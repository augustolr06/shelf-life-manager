# Arquitetura — Controle de Estoque FIFO por Validade

Última atualização: 2026-09-08 (seções 2 e 5 revisadas em T13)

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
| Leitura de QR | `html5-qrcode` (câmera do navegador) | Compatível com PWA, sem exigir app nativo (RF05). |
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
      /alerta
      /evento-log
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
| GET/POST | `/configuracao-alerta` | GESTOR | RF08 |
| GET | `/dashboard` | GESTOR | RF13 |

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

## 6. Comportamento offline (RNF07)

O frontend verifica `navigator.onLine` e faz um *health check* ao backend antes de habilitar a tela de leitura de QR. Se offline: bloqueia o fluxo de saída com mensagem explícita — nunca tenta validar FIFO com dado local.

Detalhado em T10, a partir da implementação:

- **Os dois sinais são necessários.** `navigator.onLine` só sabe que existe uma rede; `GET /health` é o que confirma caminho até o backend. O portão reage aos eventos `online`/`offline` do navegador, sem varredura periódica.
- **Não há fila de leituras offline**, nem cópia local do estoque. Um QR lido sem rede só teria valor com veredito na hora, e o veredito depende do estoque inteiro do SKU naquele instante (RNF03). Uma queda no meio da leitura cai no mesmo bloqueio, sem veredito inventado pela tela.
- **O veredito exibido é descartado quando a conexão cai.** Ele vale para o estoque de um instante: durante a queda, outra atendente pode ter baixado a unidade apontada.
- **`/saidas/ler` e `/health` ficam em `NetworkOnly` no service worker**, sem retry automático — cache serviria decisão vencida, e retry gravaria um segundo `LEITURA_QR_SAIDA`, inflando o denominador da taxa de acerto na primeira leitura (RF12).
- O `navigateFallback` do service worker faz o app instalado abrir sem rede para mostrar o bloqueio, e sustenta o recarregamento direto de uma URL de tela (seção 1, roteamento).

## 7. Estratégia de testes

A função `validarSaidaFifo` precisa de cobertura para os 5 ramos da seção 4 acima **antes** de qualquer outra parte do incremento 2 ser implementada (exigência da seção 8 do PRD). Casos obrigatórios:

- QR inexistente
- unidade já vendida/descartada
- unidade vencida
- unidade não-prioritária (deve bloquear com FIFO)
- unidade prioritária (deve confirmar)
- concorrência: duas leituras simultâneas da mesma unidade — uma deve falhar por lock, não duplicar a baixa
