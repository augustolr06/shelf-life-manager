# Arquitetura — Controle de Estoque FIFO por Validade

Última atualização: 2026-09-07

Este documento traduz os requisitos do PRD (`docs/PRD-original.md`) em decisões técnicas concretas. Referências entre parênteses (RF/RNF) apontam para o requisito original — consulte o PRD apenas se precisar do texto exato.

## 1. Stack

| Camada | Escolha | Justificativa |
|---|---|---|
| Backend | Node.js 20+ / TypeScript / Fastify | Validação de schema nativa (JSON Schema), adequada ao contrato rígido do veredito FIFO (seção 4). Overhead baixo, ajuda a cumprir RNF06 (<500ms). |
| ORM | Prisma sobre PostgreSQL | Migrações versionadas e tipos gerados. Suporta `$transaction` com query raw para lock explícito (RNF02), que a API de alto nível do Prisma não expõe diretamente. |
| Banco de dados | PostgreSQL 15+ | Suporta `SELECT ... FOR UPDATE` nativamente (RNF02) e tipo `DATE` (RNF01). Adequado à escala do projeto (RNF10) sem tuning especial. |
| Frontend | React + Vite + TypeScript | SPA leve, boa DX, plugin de PWA maduro. |
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
      /descarte
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
  tx: PrismaTransactionClient
): Promise<Veredito>
```

Executada **inteiramente dentro de uma transação Prisma (`prisma.$transaction`)**, com a unidade lida bloqueada via `SELECT ... FOR UPDATE` (query raw dentro da transação) — cumpre RNF02.

Ordem das verificações (idêntica à seção 7 do PRD — não reordenar):

1. QR existe? → não: `ERRO / QR_NAO_ENCONTRADO`
2. `status = EM_ESTOQUE`? → não: `ERRO / UNIDADE_JA_BAIXADA`
3. `dataValidade < hoje`? → sim: `EXCECAO_VENCIDO` (não passa pelo FIFO)
4. É a prioritária do pool não-vencido (`MIN(dataValidade) WHERE produtoId = X AND status = EM_ESTOQUE AND dataValidade >= hoje`)? → não: `BLOQUEAR_FIFO`, incrementa tentativas, grava evento `ALERTA_FIFO_DISPARADO`
5. Sim → `CONFIRMAR`: cria `Saida`, `status → VENDIDA`, grava evento `SAIDA_CONFIRMADA`

## 5. Contratos de API (principais endpoints)

| Método | Rota | Papel | Descrição |
|---|---|---|---|
| POST | `/auth/login` | público | Autentica, retorna cookie JWT |
| POST | `/produtos` | GESTOR | Cria SKU (RF02) |
| GET | `/produtos` | qualquer autenticado | Lista/busca produtos |
| DELETE | `/produtos/:id` | GESTOR | **Inativa** (`ativo = false`). Nunca exclui fisicamente — ver seção 3 |
| POST | `/produtos/:id/unidades` | GESTOR | Cadastro em lote de unidades, validades por item (RF03) |
| GET | `/produtos/:id/unidades/etiquetas` | GESTOR | Gera etiquetas QR para impressão (RF04) |
| POST | `/saidas/ler` | ATENDENTE, GESTOR | Executa `validarSaidaFifo`, retorna veredito (RF05, RF06) |
| POST | `/saidas/confirmar` | ATENDENTE, GESTOR | Confirma saída após veredito `CONFIRMAR` (RF07) |
| POST | `/excecao-vencido/corrigir` | GESTOR | Caminho 1 da seção 6.1 do PRD |
| POST | `/excecao-vencido/descartar` | ATENDENTE, GESTOR | Caminho 2 da seção 6.1 do PRD |
| POST | `/excecao-vencido/override` | GESTOR | Caminho 3 da seção 6.1 do PRD — exige justificativa |
| GET | `/descartes/pendentes` | GESTOR | Fila de descarte pendente (RF11) |
| GET/POST | `/configuracao-alerta` | GESTOR | RF08 |
| GET | `/dashboard` | GESTOR | RF13 |

## 6. Comportamento offline (RNF07)

O frontend verifica `navigator.onLine` e faz um *health check* ao backend antes de habilitar a tela de leitura de QR. Se offline: bloqueia o fluxo de saída com mensagem explícita — nunca tenta validar FIFO com dado local.

## 7. Estratégia de testes

A função `validarSaidaFifo` precisa de cobertura para os 5 ramos da seção 4 acima **antes** de qualquer outra parte do incremento 2 ser implementada (exigência da seção 8 do PRD). Casos obrigatórios:

- QR inexistente
- unidade já vendida/descartada
- unidade vencida
- unidade não-prioritária (deve bloquear com FIFO)
- unidade prioritária (deve confirmar)
- concorrência: duas leituras simultâneas da mesma unidade — uma deve falhar por lock, não duplicar a baixa
