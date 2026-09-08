# T06 — Casos de teste de `validarSaidaFifo` (escritos ANTES da implementação)

**Depende de:** T05
**Incremento:** 2 (Núcleo: saída com validação FIFO + EventoLog)
**Bloqueia:** T07 (implementação), e por consequência T08–T13

## Objetivo

Transformar a especificação da função FIFO (`docs/arquitetura.md` seção 4, PRD seção 7)
numa suíte de testes executável **antes** de existir implementação — exigência explícita
da seção 8 do PRD e do `CLAUDE.md`.

O produto desta tarefa não é código de produção: é o **contrato executável** que T07 terá
que satisfazer. Ao final de T06 a suíte existe, roda, e falha inteira. T07 é a tarefa de
fazê-la passar sem editá-la.

Como consequência inevitável, T06 também entrega a **infraestrutura de teste com banco
real** — decidida em `docs/decisoes.md` (2026-09-07): o lock `SELECT ... FOR UPDATE` da
RNF02 e o caso de concorrência da seção 7 da arquitetura não são reproduzíveis com mock,
que é o que todas as suítes até aqui (T03–T05) usaram.

## Critério de aceite

### Infraestrutura de teste

- [x] Banco de teste separado (`estoque_fifo_test`) no mesmo container do `docker-compose.yml`,
      nunca o `estoque_fifo` de trabalho manual — conforme decisão de 2026-09-07
- [x] `backend/.env.test` (e `.env.test.example` versionado) com `DATABASE_URL` apontando
      para o banco de teste
- [x] Setup global do Vitest que aplica as migrações (`prisma migrate deploy`) no banco de
      teste antes da suíte, e limpa as tabelas entre os testes
- [x] Se o container não estiver de pé, a falha é uma mensagem explícita mandando subir o
      `docker compose`, não um erro de conexão cru
- [x] `npm run test:sem-banco` roda as suítes de T03–T05 (que seguem mockadas) sem exigir
      Postgres — a máquina da banca continua conseguindo rodar a suíte sem container

### Stub de `validarSaidaFifo`

- [x] `backend/src/modules/saida/validarSaidaFifo.ts` passa a existir contendo **apenas** o
      tipo `Veredito` (cópia literal da seção 4 da arquitetura) e uma função que lança
      `NAO_IMPLEMENTADO_T07`
- [x] Nenhuma lógica de FIFO no stub. Se o stub decidir qualquer coisa, T06 virou T07

### Casos de teste — ramo 1: QR não encontrado

- [x] Código inexistente devolve `ERRO / QR_NAO_ENCONTRADO`
- [x] Nada é gravado: nenhuma `Saida`, nenhuma mudança de status

### Casos de teste — ramo 2: unidade já baixada

- [x] Unidade `VENDIDA` devolve `ERRO / UNIDADE_JA_BAIXADA`
- [x] Unidade `DESCARTADA` devolve `ERRO / UNIDADE_JA_BAIXADA`
- [x] A verificação vem **antes** da de validade: unidade vencida **e** já vendida devolve
      `UNIDADE_JA_BAIXADA`, não `EXCECAO_VENCIDO` (a ordem da seção 7 do PRD não é decorativa)

### Casos de teste — ramo 3: unidade vencida

- [x] `dataValidade` anterior a hoje devolve `EXCECAO_VENCIDO` com a unidade lida
- [x] **Borda:** `dataValidade == hoje` **não** é vencida — a unidade vence no fim do dia,
      não no começo. Segue por FIFO normalmente
- [x] Unidade vencida devolve `EXCECAO_VENCIDO` mesmo quando existe outra unidade não-vencida
      do mesmo SKU: o ramo 3 curto-circuita o FIFO, nunca devolve `BLOQUEAR_FIFO`
- [x] Unidade vencida **não** é baixada nem alterada pela função — o destino dela é decidido
      pelos três caminhos da seção 6.1 do PRD (T11)

### Casos de teste — ramo 4: bloqueio FIFO

- [x] Unidade com validade maior que a prioritária devolve `BLOQUEAR_FIFO` com `unidadeCorreta`
      apontando a de menor `dataValidade`
- [x] **Caso central do trabalho:** existindo uma unidade *vencida* com validade menor que
      todas, ela **não** pode ser apontada como `unidadeCorreta`. O pool prioritário exclui
      vencidas (`dataValidade >= hoje`, PRD 6.1) — sem isso o sistema empurraria produto
      vencido para o cliente, que é o oposto do objetivo
- [x] O pool ignora unidades de **outro produto**: unidade de SKU diferente com validade menor
      não bloqueia
- [x] O pool ignora unidades `VENDIDA` e `DESCARTADA`
- [x] **Empate de validade:** havendo duas unidades com a mesma menor validade, ler **qualquer
      uma das duas** confirma. Bloquear pedindo "a outra" seria um laço infinito, já que as
      duas são igualmente prioritárias
- [x] Nada é baixado no bloqueio: status continua `EM_ESTOQUE`, nenhuma `Saida` criada
- [x] O bloqueio grava `ALERTA_FIFO_DISPARADO` no `EventoLog`
- [x] `tentativas` reflete quantas leituras erradas houve no ciclo corrente (ver ponto em
      aberto 2 abaixo)

### Casos de teste — ramo 5: confirmação

- [x] Unidade prioritária devolve `CONFIRMAR`
- [x] Unidade única do SKU devolve `CONFIRMAR`
- [x] Efeitos: `Saida` criada com o `usuarioId` recebido, status da unidade → `VENDIDA`,
      `SAIDA_CONFIRMADA` gravado no `EventoLog`
- [x] `Saida.alertaFifoDisparado` e `Saida.tentativasAteAcerto` refletem o ciclo: confirmação
      direta grava `false`/`0`; confirmação após N bloqueios grava `true`/`N`

### Casos de teste — laço de revalidação (RF06, J2 do PRD)

- [x] Sequência completa: lê a errada (bloqueia) → lê a errada de novo (bloqueia, tentativas
      sobe) → lê a correta (confirma, com o total de tentativas registrado na `Saida`)
- [x] Depois da confirmação, a próxima unidade do mesmo SKU vira a prioritária — o pool
      encolhe corretamente

### Casos de teste — concorrência (RNF02)

- [x] Duas execuções simultâneas sobre a **mesma unidade prioritária**: exatamente uma
      devolve `CONFIRMAR`; a outra devolve `ERRO / UNIDADE_JA_BAIXADA`
- [x] Ao final existe **uma única** linha em `Saida` para aquela unidade, e o status é
      `VENDIDA` uma vez só
- [x] O teste falha se a implementação abrir mão do lock — isto é, precisa ser um teste que
      um `findUnique` seguido de `update` sem transação não consegue passar

## Decisões tomadas na abertura de T06 (validadas pelo orientando)

Registradas também em `docs/decisoes.md` (2026-09-07, seção T06).

**1. `validarSaidaFifo` grava os quatro eventos.** Além de `ALERTA_FIFO_DISPARADO` (ramo 4) e
`SAIDA_CONFIRMADA` (ramo 5), que a seção 4 da arquitetura já citava, a função grava
`LEITURA_QR_SAIDA` em **toda** leitura e `TENTATIVA_VENDA_UNIDADE_VENCIDA` no ramo 3, conforme
a tabela de eventos da seção 5 do PRD. Justificativa: é a única função que vê a leitura inteira
e roda dentro da transação, e sem `LEITURA_QR_SAIDA` não há denominador para calcular a taxa de
acerto na primeira leitura — indicador do TCC (RF12). Inclui a leitura de código inexistente,
que grava com `unidadeId` e `produtoId` nulos.

**2. `tentativas` é derivado do `EventoLog`, não persistido.** É a contagem de
`ALERTA_FIFO_DISPARADO` do mesmo `produtoId` e mesmo `usuarioId` desde a última
`SAIDA_CONFIRMADA` daquele par. Justificativa: a seção 6.2 do PRD proíbe estado intermediário
no servidor, e o ciclo do laço é mesmo por SKU e por atendente — ela troca de frasco a cada
tentativa, então contar por unidade lida daria outro número. Descartada a alternativa de um
identificador de ciclo vindo do cliente, que mudaria a assinatura da função e colocaria parte
do controle do laço no frontend (atrito com a RNF04).

**3. A suíte entra no `npm test` padrão e fica vermelha até T07.** A definição de pronto de T07
passa a ser literalmente "esta suíte passa, sem editá-la". Toda falha carrega a mensagem
`NAO_IMPLEMENTADO_T07`, para que o vermelho seja inconfundivelmente o esperado e não uma
regressão. `npm run test:sem-banco` continua verde e sem dependência de container.

## Estado ao fim de T06

46 casos em `backend/tests/fifo/validarSaidaFifo.test.ts`, **todos falhando** com
`NAO_IMPLEMENTADO_T07` — resultado esperado, e a definição de pronto de T07. `npm test`
fecha em 66 verdes (T03–T05) e 46 vermelhos (T06). `npm run test:sem-banco` fecha em 66
verdes, sem container.

Dois casos foram acrescentados durante a escrita, fora da lista original do critério de
aceite, porque só apareceram ao montar os cenários:

- **`vendida a última não-vencida, a vencida não vira prioritária`** — fim de estoque com um
  item vencido esquecido na prateleira. É a versão mais aguda da exclusão do pool: sobrando
  só a vencida, a tentação de "promover" a única candidata restante existe, e ela venderia
  produto vencido sem passar pelo fluxo de exceção.
- **`leituras simultâneas de unidades diferentes do mesmo SKU não se bloqueiam entre si`** —
  fixa que o lock é da unidade lida, não do SKU. Travar o produto inteiro seria uma leitura
  possível da RNF02 e serializaria o balcão sem necessidade.

## Notas técnicas

- A suíte testa a **função**, não o endpoint. `POST /saidas/ler` é T08 e não deve aparecer aqui.
- Os testes chamam `validarSaidaFifo(codigoQr, usuarioId, tx)` dentro de um `prisma.$transaction`
  próprio, que é como T08 vai chamá-la.
- Datas de teste são montadas com `hojeComoData()` e aritmética de dias sobre ela, nunca com
  literais como `'2026-09-01'`: uma suíte com datas fixas passa a mentir quando o calendário
  avança, e o objeto de teste aqui é justamente a comparação com "hoje".
- `dataValidade` continua `DATE` (RNF01) — os testes conferem que a comparação de borda
  (validade igual a hoje) não escorrega por fuso.
- O caso de concorrência usa **instâncias distintas de `PrismaClient`**, uma por leitor, para
  que as transações sejam inequivocamente concorrentes no banco e não dependam do tamanho do
  pool de conexões de um cliente compartilhado.
- O que separa "tem lock" de "não tem lock" no teste de concorrência é a **forma da falha da
  perdedora**: com lock ela relê a linha já baixada e devolve `ERRO / UNIDADE_JA_BAIXADA`; sem
  lock ela chega ao `create` e estoura na restrição `@unique` de `Saida.unidadeId`. As duas
  impedem a dupla baixa — só a primeira é um veredito que a tela consegue mostrar.
- Nomes de teste em português, no estilo já usado em `tests/unidade.test.ts`.

## Fora de escopo desta tarefa

- Implementar `validarSaidaFifo` (T07) — o stub lança e é só isso.
- Endpoint `POST /saidas/ler` e o loop de revalidação na API (T08).
- Registro de saída como rota e o módulo de `EventoLog` como serviço próprio (T09).
- Os três caminhos da exceção de unidade vencida (T11) — aqui só se testa que o veredito
  `EXCECAO_VENCIDO` sai corretamente e que nada é baixado.
- Qualquer tela (T10).
