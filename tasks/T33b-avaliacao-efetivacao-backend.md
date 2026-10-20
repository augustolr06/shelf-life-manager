# T33b — Backend: leitura sem baixa e confirmação da venda

**Depende de:** T33 (casos de teste escritos antes)
**Incremento:** 10 (Fluxo de leitura: leitura única, consulta e carrinho)
**Bloqueia:** T34

## Objetivo

Fazer passar os testes de T33: a leitura passa a **validar sem dar baixa**, e uma rota nova
**confirma** o carrinho, revalidando e baixando cada unidade. O contrato, os casos e as
decisões anteriores afetadas estão em `tasks/T33-testes-avaliacao-efetivacao.md`.

## Mudanças

1. **`validarSaidaFifo`** ganha o modo `AVALIAR | EFETIVAR` e a lista `noCarrinho`, conforme
   o contrato de T33. Continua sendo a única função que decide o veredito (RNF03).
2. **`POST /saidas/ler`** chama em modo `AVALIAR`, aceitando `noCarrinho` (ids, teto igual ao
   da confirmação). O formato da resposta não muda; muda o sentido de `CONFIRMAR`: "pode
   ser vendida", não "vendida". A `mensagem` do servidor no ramo 5 muda junto.
3. **`POST /saidas/finalizar`** (`ATENDENTE`, `GESTOR`):
   ```json
   { "unidadeIds": ["..."], "sessaoVendaId": "uuid opcional" }
   → 200 { "itens": [ { "unidadeId": "...", "veredito": "CONFIRMAR", ... }, ... ] }
   ```
   - Ordem de processamento por `dataValidade` crescente (desempate por `codigoQr`),
     decidida no servidor, para que unidades do mesmo carrinho não bloqueiem umas às outras.
     Ordenar a fila não é decidir veredito — registrar por que isso não viola a RNF03.
   - Cada item em **sua própria transação** com lock (RNF02), chamando `validarSaidaFifo`
     em modo `EFETIVAR`. Sem tudo-ou-nada: um item barrado não desfaz os outros (mesma
     semântica de "cada item é um ciclo independente" da 6.2).
   - Recebe ids (que a leitura devolveu), não códigos: o carrinho guarda o que o servidor
     identificou. **Fixado em T33:** a rota traduz os ids em códigos na mesma consulta que usa
     para ordenar a fila, e a função continua travando por código nos dois modos. Id
     desconhecido → 404 `UNIDADE_NAO_ENCONTRADA`, sem processar item algum.
   - Teto de itens no schema: **50** (fixado em T33), ids `uuid` e `uniqueItems`.
4. **`POST /excecao-vencido/corrigir`** revalida em modo `AVALIAR`: com a data corrigida e
   `CONFIRMAR`, a unidade vai para o carrinho, e não é vendida. Aceita `noCarrinho`, como a
   leitura (acrescentado em T33).
5. **Contrato da função** como fixado em T33:
   `validarSaidaFifo(codigoQr, usuarioId, tx, sessaoVendaId, { modo, noCarrinho? })`. Em
   `EFETIVAR`, os ramos 3 e 4 gravam os mesmos eventos da leitura, e nenhum ramo grava
   `LEITURA_QR_SAIDA`. A própria unidade lida não sai do pool por estar em `noCarrinho`.

## Decisões que esta tarefa toma (registrar em `docs/decisoes.md`)

1. **O carrinho não existe no servidor.** Nenhuma tabela, nenhuma reserva, nenhum timeout
   (6.2). Se a atendente abandonar o carrinho, não há nada a limpar.
2. **Desistência não grava evento.** Uma leitura com `veredito: 'CONFIRMAR'` sem
   `SAIDA_CONFIRMADA` posterior já é a desistência, derivável do log. Registrar em
   `docs/notas-para-artigo.md`: o carrinho cria um dado novo para a pesquisa (quantas
   unidades liberadas não foram vendidas), sem tipo de evento novo.
3. **Override de venda vencida (PRD 6.1).** Hoje vende na hora. Ele já **é** uma confirmação
   explícita (GESTOR, justificativa obrigatória), então a proposta é **mantê-lo imediato**,
   fora do carrinho. Alternativa: autorizar e colocar no carrinho, efetivando na
   confirmação — exige carregar justificativa e autorizador até `/saidas/finalizar`.
   Escolher e registrar; alertar o orientando de que a escolha afeta a T11.
4. **`tentativasAteAcerto`** segue a regra fixada no teste de T33.

## Critério de aceite

- [ ] Todos os testes de T33 verdes, sem editá-los (se algum caso se mostrar errado, voltar a
      T33, corrigir lá e registrar — como foi feito entre T06 e T07)
- [ ] Demais suítes verdes; `npm run typecheck` limpo
- [ ] Conferência por `curl`: leitura que libera sem baixar (conferir o status no banco), e
      confirmação que baixa
- [ ] `docs/arquitetura.md`: seção 4 (contrato novo da função, eventos por modo) e seção 5
      (`/saidas/ler` com o sentido novo, `/saidas/finalizar`, e a nota "Não existe
      `POST /saidas/confirmar`" reescrita)
- [ ] `docs/decisoes.md` e `docs/notas-para-artigo.md`

## Fora de escopo

- Estorno de venda já confirmada.
- Frontend — T34. **Atenção:** entre T33b e T34, a tela atual mostra "Saída registrada" para
  uma leitura que não baixou nada. Fazer as duas em sequência, ou ajustar só o título da tela
  em T33b.
