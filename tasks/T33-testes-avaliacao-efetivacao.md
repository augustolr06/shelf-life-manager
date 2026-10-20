# T33 — Casos de teste da leitura sem baixa e da confirmação da venda — escrever ANTES de T33b

**Depende de:** T09 (registro de saída), T11 (exceção de unidade vencida)
**Incremento:** 10 (Fluxo de leitura: leitura única, consulta e carrinho)
**Bloqueia:** T33b (implementação), que bloqueia T34 (carrinho)

## Por que esta tarefa existe separada

A regra do CLAUDE.md e da seção 8 do PRD vale para qualquer mudança em `validarSaidaFifo`:
os casos de teste vêm **antes** da implementação. Esta tarefa é para T33b o que T06 foi para
T07 — só testes, todos falhando (ou marcados `todo`) ao final, nenhuma linha de produção.

## O problema que motivou a mudança

Hoje ler o QR na tela de Leitura **é** vender: o ramo 5 de `validarSaidaFifo` cria a `Saida`
e muda o status para `VENDIDA` na transação da leitura. Com a câmera aberta, um segundo QR
lido sem querer vende o produto errado, e não há como desfazer.

O fluxo novo, definido pelo orientando em 2026-10-13:

1. Ler o QR **valida** — vencimento e FIFO, na hora, exatamente como hoje — e mostra o
   produto. **Não dá baixa.**
2. Barrada (vencida ou outra unidade vence antes): a tela mostra as opções de correção que já
   existem (T12 e o laço do RF06).
3. Liberada: a unidade entra num **carrinho**, de onde pode ser removida (cliente desistiu,
   frasco errado).
4. A venda só acontece quando a pessoa no balcão **confirma o carrinho**. O servidor
   revalida cada item sob lock (RNF02) e só então cria as `Saida`s.

## Decisões anteriores afetadas (alerta — não bloqueia)

- **PRD 6.2** ("não há carrinho nem validação em lote"): passa a existir carrinho, **no
  navegador**. Continuam valendo as consequências que a 6.2 protege: nenhuma entidade nova no
  schema, nenhuma reserva no servidor, lock só durante a transação de cada unidade.
- **T09** (remoção de `POST /saidas/confirmar`, por exigir partir a função em "decidir" e
  "efetivar"): é exatamente o que esta mudança faz, conscientemente. A objeção de T09 era
  não editar a suíte de T06 — a resposta é esta tarefa, que reescreve os casos afetados
  **antes** de mexer no código.
- **Suíte de T06** (`tests/fifo/validarSaidaFifo.test.ts`): os casos do ramo 5 mudam de
  significado (a leitura deixa de criar `Saida`). Editar esses casos é o objeto desta tarefa.
- **T11, correção de validade:** hoje revalida e, no `CONFIRMAR`, já vende. Passa a só
  liberar para o carrinho.
- **RF12 / seção 9 do PRD:** "acerto na primeira leitura" **mantém o significado** (a
  validação continua na leitura), mas a `Saida` passa a nascer na confirmação. Datar em
  `docs/decisoes.md`.

## Contrato proposto (o que os testes fixam)

```ts
validarSaidaFifo(codigoQr, usuarioId, tx, sessaoVendaId, {
  modo: 'AVALIAR' | 'EFETIVAR',
  noCarrinho?: string[]   // ids das unidades já liberadas neste carrinho
})
```

> **Ajuste ao escrever os testes (2026-10-20):** a proposta original punha `sessaoVendaId`
> dentro do objeto de opções. Ficou como quarto argumento, como já é hoje, para que a função
> atual ignore o quinto e os casos falhem por asserção, e não por erro do Prisma. Os dois modos
> recebem o **código**: a rota de confirmação traduz os ids do carrinho na mesma consulta que
> usa para ordenar a fila. Detalhes em `docs/decisoes.md` (T33).

- **`AVALIAR`** (leitura): os ramos 1–4 são idênticos aos de hoje, com os mesmos eventos
  (`LEITURA_QR_SAIDA`, `TENTATIVA_VENDA_UNIDADE_VENCIDA`, `ALERTA_FIFO_DISPARADO`). O ramo 5
  devolve `CONFIRMAR` (o nome fica — o payload de `LEITURA_QR_SAIDA` já guarda `veredito` e
  trocá-lo quebraria a comparabilidade), **sem** criar `Saida`, **sem** mudar status e
  **sem** `SAIDA_CONFIRMADA`.
- **`noCarrinho`**: unidades já liberadas no mesmo atendimento **saem do pool** do passo 4.
  Sem isso, a segunda unidade do mesmo produto seria bloqueada pela primeira, que ainda está
  `EM_ESTOQUE` porque só será baixada na confirmação. Não é veredito afirmado pelo cliente: o
  servidor confere que cada id existe e está `EM_ESTOQUE`, e a confirmação revalida tudo.
- **`EFETIVAR`** (confirmação do carrinho): mesmas verificações, sob lock. No ramo 5 cria a
  `Saida`, muda o status e grava `SAIDA_CONFIRMADA`, como hoje. **Não** grava
  `LEITURA_QR_SAIDA` — não houve leitura, e gravar dobraria o denominador da RF12.
- A lógica continua numa função só (RNF03). O modo é parâmetro, não uma segunda função.

## Casos de teste a escrever

### `AVALIAR`
- [x] Ramos 1–4: mesmos vereditos e mesmos eventos de hoje
- [x] Ramo 5: `CONFIRMAR`, unidade continua `EM_ESTOQUE`, nenhuma `Saida`, um único
      `LEITURA_QR_SAIDA` com `veredito: 'CONFIRMAR'`, nenhum `SAIDA_CONFIRMADA`
- [x] Duas unidades do mesmo produto e mesma validade: a segunda, com a primeira em
      `noCarrinho`, é liberada
- [x] Unidade A (jan) no carrinho e leitura de B (fev), sem outra de jan no estoque: B
      liberada, **sem** `ALERTA_FIFO_DISPARADO`
- [x] A (jan) no carrinho, C (jan) fora dele, leitura de B (fev): `BLOQUEAR_FIFO` apontando C
- [x] `noCarrinho` com id inexistente ou já baixado: ignorado (não libera nada a mais)

### `EFETIVAR`
- [x] Item liberado e estoque inalterado: `Saida` criada, `VENDIDA`, `SAIDA_CONFIRMADA`, sem
      `LEITURA_QR_SAIDA`
- [x] Unidade vendida por outra atendente entre a leitura e a confirmação: `ERRO /
      UNIDADE_JA_BAIXADA`, nada criado
- [x] Unidade que venceu entre a leitura e a confirmação (virada do dia): `EXCECAO_VENCIDO`
- [x] Entrou no estoque uma unidade de validade menor depois da leitura: `BLOQUEAR_FIFO`
- [x] `tentativasAteAcerto` da `Saida`: bloqueio na leitura, depois a certa, depois confirmar
      → 1. **Decidir e fixar no teste** a atribuição quando o carrinho tem duas unidades do
      mesmo produto e só uma delas teve bloqueio (a contagem é por par produto+usuário desde a
      última `SAIDA_CONFIRMADA`). **Fixado:** a regra não muda; com a confirmação em ordem de
      validade, o bloqueio fica com a unidade de menor validade do SKU no carrinho e as outras
      saem com 0

### Rota de confirmação (`POST /saidas/finalizar`, ver T33b)
- [x] Itens processados em ordem de validade crescente decidida no servidor; resposta na
      ordem do corpo
- [x] Resultado parcial: um item barrado não desfaz os confirmados
- [x] Código repetido → 400; lista vazia ou acima do teto → 400; sem sessão → 401
      (fixados: o corpo leva **ids**, então "código repetido" é id repetido; teto **50**; id
      desconhecido → **404 `UNIDADE_NAO_ENCONTRADA`** sem processar item algum)

### Correção de validade (T11)
- [x] `POST /excecao-vencido/corrigir` com revalidação `CONFIRMAR` **não** cria `Saida`

### Casos acrescentados ao escrever a suíte

- [x] `EFETIVAR` não grava `LEITURA_QR_SAIDA` em ramo nenhum; grava os eventos dos ramos 3 e 4
- [x] A própria unidade lida em `noCarrinho` não sai do pool (reler o que já está no carrinho
      libera, sem estourar)
- [x] Liberar para o carrinho não fecha o ciclo de tentativas (comportamento atual fixado;
      ver "Consequência registrada" em `docs/decisoes.md`)
- [x] Leituras simultâneas da mesma unidade liberam as duas, sem baixa (sem reserva, PRD 6.2)
- [x] `/saidas/ler` e `/excecao-vencido/corrigir` aceitam `noCarrinho` (uuids, teto 50)
- [x] A mensagem de `CONFIRMAR` não diz "registrada"
- [x] Dashboard: unidade liberada e não confirmada não conta como saída
- [x] Suítes de rota que usavam a leitura como venda (`lerQr`, `eventoLog`, `dashboard`)
      passam a confirmar por `/saidas/finalizar` (helper `finalizarCarrinho` em
      `tests/apoio/cenario.ts`)

## Critério de aceite

- [x] Casos acima escritos em `backend/tests/`, falhando pelo motivo certo ou como `todo`
- [x] Nenhuma mudança em `src/`
- [x] Os casos de T06 que mudam de significado reescritos, com comentário apontando esta
      tarefa
- [x] `docs/decisoes.md` com o contrato novo e as decisões afetadas listadas acima

## Fora de escopo

- Implementação — T33b. Frontend — T34.
- Override de venda vencida (`/excecao-vencido/override`) — ver T33b, Decisão 3.

## Resultado (2026-10-20)

517 casos, 468 verdes, 49 vermelhos, todos nos casos novos ou reescritos: 18 em `tests/fifo`,
21 em `tests/saida/finalizar.test.ts` (novo), 6 em `tests/saida/lerQr.test.ts`, 2 em
`tests/excecao-vencido`, 1 em `tests/dashboard`, 1 em `tests/evento-log`. Todos falham por
asserção ou por rota inexistente (404), nenhum por erro de infraestrutura.
