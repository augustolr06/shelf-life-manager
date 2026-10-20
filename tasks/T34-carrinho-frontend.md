# T34 — Frontend: carrinho na tela de venda

**Depende de:** T31 (leitura única), T33b (leitura sem baixa e `POST /saidas/finalizar`)
**Incremento:** 10 (Fluxo de leitura: leitura única, consulta e carrinho)
**Bloqueia:** T35 (o redesign inclui a tela nova)

## Objetivo

Transformar a tela de Leitura em uma tela de **venda com carrinho**. Ler um frasco valida e
mostra o produto; o que pode ser vendido entra no carrinho; a venda só acontece quando a
pessoa no balcão confirma. O contexto e o contrato do backend estão em
`tasks/T33-testes-avaliacao-efetivacao.md` e `tasks/T33b-avaliacao-efetivacao-backend.md`.

## Fluxo

1. A atendente liga a câmera (ou digita o código). A câmera lê **um** código e desliga (T31).
2. A tela envia a leitura a `POST /saidas/ler` com os ids do carrinho em `noCarrinho`, e
   mostra o produto lido com o veredito:
   - **`CONFIRMAR`** → a unidade **entra no carrinho** e o cartão mostra produto, validade e
     código, com **Remover** ali mesmo (caso tenha sido o frasco errado);
   - **`BLOQUEAR_FIFO`** → não entra no carrinho; mostra a unidade correta, como hoje
     (laço do RF06);
   - **`EXCECAO_VENCIDO`** → não entra no carrinho; mostra o `PainelExcecaoVencido` com os
     três caminhos (T12). Correção que revalida para `CONFIRMAR` coloca a unidade no
     carrinho. Override segue a decisão de T33b;
   - **`ERRO`** → mensagem do servidor.
3. **Ler próximo** religa a câmera.
4. O carrinho lista os itens (produto, validade, código) com **Remover** em cada um. O mesmo
   código não entra duas vezes (aviso "já está no carrinho", sem chamar o servidor).
5. **Confirmar venda** abre uma confirmação com a lista e a quantidade, e então envia os ids
   para `POST /saidas/finalizar`. Resultado por item:
   - `CONFIRMAR` → vendido, sai do carrinho;
   - qualquer outro → fica no carrinho marcado com a mensagem do servidor (o estoque mudou
     entre a leitura e a confirmação). `BLOQUEAR_FIFO` mostra a unidade correta;
     `EXCECAO_VENCIDO` abre o painel daquele item.
6. Quando o carrinho esvazia por confirmação, o atendimento termina: novo `sessaoVendaId`.
7. **Esvaziar carrinho** pede confirmação e não vende nada.

## Decisões anteriores afetadas (alerta — não bloqueia)

- **T10:** "um veredito vale um instante" e por isso era apagado na queda de conexão. O
  carrinho **não** é apagado offline (decisão 2 abaixo), porque a confirmação revalida tudo.
- **T10:** a tela "Leitura de QR" vira "Venda".

## Decisões que esta tarefa toma (registrar em `docs/decisoes.md`)

1. **O carrinho vive na memória da tela.** Recarregar a página o perde, e nada fica pendente
   no servidor. `sessionStorage` é a alternativa, se a perda incomodar no uso.
2. **Queda de conexão não apaga o carrinho**, mas o portão de offline (RNF07) bloqueia ler e
   confirmar até a conexão voltar.
3. **Rota:** `/leitura` vira `/venda` com redirecionamento, ou fica como está — escolher e
   registrar.

## Critério de aceite

- [ ] Nenhuma venda antes de **Confirmar venda** (conferir no banco durante a verificação)
- [ ] Unidade liberada entra no carrinho; barrada mostra as opções de correção existentes
- [ ] Remover item, esvaziar com confirmação, código repetido ignorado
- [ ] `noCarrinho` enviado em toda leitura; segunda unidade do mesmo produto não é bloqueada
      pela primeira
- [ ] Resultado parcial da confirmação apresentado item a item
- [ ] Nenhuma comparação de data, status ou ordem no frontend (RNF04)
- [ ] Testes de componente: os quatro vereditos na leitura, remover, repetido, esvaziar,
      confirmação total e parcial, offline com carrinho cheio
- [ ] Conferência no navegador com o `playwright-cli` (entrada manual): carrinho com três
      itens, remover um, confirmar, e conferir que só então as unidades saíram do estoque
- [ ] `docs/notas-para-artigo.md`: a leitura que vendia sozinha como risco descoberto no uso
      real (leitura acidental de outro QR), e o carrinho como resposta

## Fora de escopo

- Estorno de venda confirmada.
- Preço, total, forma de pagamento — o sistema não é PDV.
- Persistir o carrinho entre recarregamentos.
