# T49 — Consulta por produto: nome, marca e código de barras, com o estoque do produto

**Depende de:** T32 (consulta de unidade), T47 (leitura de código de barras pela câmera)
**Incremento:** 13 (Cadastro assistido por código de barras)
**Bloqueia:** nada

## Objetivo

A tela **Consultar produto** (`/consulta`, T32) só responde "o que é este frasco?": ela aceita o
código da etiqueta da unidade, lido pela câmera ou digitado. Para a pergunta "quantos frascos
deste produto tenho, e de que validades?", a atendente precisa da etiqueta de um deles. Pedido do
orientando (2026-11-12): a busca da Consulta passa a aceitar também **nome, marca e código de
barras** e mostra o **produto, os detalhes dele e as unidades em estoque**. A câmera lê também o
código de barras da embalagem.

## Escopo

### Backend (módulo novo `modules/consulta/`, papéis ATENDENTE e GESTOR)

1. `GET /consulta/busca?termo=…`. O servidor decide o que o termo é, porque o formato do código de
   etiqueta é dele (`codigoQr.ts`, T08):
   - **código de etiqueta** (depois de `normalizarCodigoQr`, casa com `PADRAO_CODIGO_QR`) e a
     unidade existe → `{ tipo: 'UNIDADE', consulta }`, a mesma consulta de T32;
   - **código interno exato** (código de barras ou `SEMCOD-…`, normalizado como no cadastro) →
     `{ tipo: 'PRODUTOS', produtos: [esse], total: 1 }`;
   - senão, **nome, marca ou código interno contendo o termo**, sem diferença de caixa, inativos
     inclusive (a unidade em estoque de produto inativo ainda é vendida, T39), em ordem de nome,
     até 20 → `{ tipo: 'PRODUTOS', produtos, total }`. Lista vazia é resposta normal.
   - Cada produto vem com `emEstoque`, o número de unidades `EM_ESTOQUE`.
2. `GET /consulta/produtos/:id` → `{ produto, unidades }`: as unidades `EM_ESTOQUE` em ordem de
   validade, cada uma com `diasParaVencer`, `situacao` e `faixa` calculados no servidor (RNF01,
   RNF04), com a mesma conta da consulta de T32 e as faixas do dashboard (T20). 404
   `PRODUTO_NAO_ENCONTRADO`.
3. Nada grava `EventoLog`, pelo mesmo motivo de T32 (decisão 1).

### Frontend (`TelaConsulta`)

4. Um campo só: "Busque por nome, marca, código de barras ou código da etiqueta". A busca sai pelo
   botão ou pelo Enter, e não a cada tecla: um código de etiqueta pela metade buscaria produtos.
5. Resultado:
   - **unidade**: o cartão de T32, mais o botão "Ver estoque do produto";
   - **um produto só**: abre direto o produto;
   - **vários**: a lista (nome, marca, código, unidades em estoque, inativo) e, ao escolher, o
     produto, com "Voltar à lista";
   - **nenhum**: nota curta "Nada encontrado para “…”".
6. Produto: nome, marca, categoria, código interno, inativo se for o caso, o total em estoque e a
   lista das unidades (código da etiqueta, validade e distintivo da faixa com "vencida há N dias",
   "vence hoje" ou "vence em N dias").
7. A câmera contínua lê o QR da etiqueta **e** o código de barras da embalagem: um modo novo do
   `LeitorCamera`, `leitura="qr-e-codigo-de-barras"`.
8. `?codigo=` vindo do Início continua funcionando, agora pela busca nova.

## Decisões tomadas nesta tarefa

- **O servidor decide se o termo é código de etiqueta.** O formato é provisório (T16) e só
  `codigoQr.ts` o conhece; o frontend não repete o padrão.
- **A lista de unidades não diz qual é a próxima a sair.** Ela vem em ordem de validade porque
  é a ordem natural de leitura, mas sem destaque de "próxima": isso é veredito FIFO, e a RNF03 o
  prende a `validarSaidaFifo` (T32, decisão 2).
- **Rotas num módulo próprio (`/consulta/...`)**, e não em `/produtos`: a pergunta é de balcão
  (atendente e gestor) e mistura unidade e produto; `GET /unidades/consulta/:codigoQr` continua
  existindo.

## Critério de aceite

- [ ] Testes com banco real das duas rotas:
      - código de etiqueta, inclusive digitado com `I`/`O`;
      - código de barras exato que não traz os produtos que só o contêm;
      - nome, marca e inativo;
      - `emEstoque` só com as unidades `EM_ESTOQUE`;
      - unidades em ordem com dias, situação e faixa;
      - 404, 401, e nenhuma linha em `EventoLog`.
- [ ] Testes de Vitest da tela:
      - os quatro resultados;
      - "Ver estoque do produto" e "Voltar à lista";
      - câmera contínua no modo novo;
      - offline, e `?codigo=`.
- [ ] `npm run typecheck` limpo nos dois lados
- [ ] `playwright-cli` a 1280×900 e 360×740 pela digitação, com capturas em `docs/redesign/T49/`
- [ ] `docs/arquitetura.md` (rotas novas), `docs/decisoes.md`, verificação manual da câmera no
      backlog

## Fora de escopo

- Busca a cada tecla, e paginação além dos 20 primeiros produtos.
- Marcar a unidade que o FIFO venderia primeiro.
- Unidades vendidas e descartadas na lista do produto (a consulta pela etiqueta continua
  mostrando o status de qualquer unidade).
- Mudar a busca do Catálogo (que continua por nome e código) e a do Início.
