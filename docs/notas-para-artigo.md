# Notas para o Artigo do TCC

Este arquivo reúne pontos de decisão, descobertas técnicas e limitações relevantes para escrever o artigo — não é um changelog técnico (isso é `docs/decisoes.md`), é material bruto de "problema → solução" pra consultar na hora de redigir.

Não edite entradas antigas — só adicione novas. Se uma decisão for revista mais tarde, registre a revisão como nova entrada, referenciando a anterior.

## Formato de cada entrada

```
## <título curto>

**Contexto do problema:** o que, na prática manual (sem lotes, controle por
planilha/memória/experiência da vendedora), motiva essa decisão ou é
evidenciado por ela.

**Alternativas consideradas:** (se houver)

**Solução adotada:** o que foi implementado.

**Por que resolve o problema / trade-offs:** o que se ganha e o que se
paga por isso — inclua limitações honestamente, não só os pontos fortes.

**Tarefa relacionada:** TNN

**Data:**
```

---

## QR Code por unidade física, não por lote

**Contexto do problema:** o controle manual em lojas de pequeno porte, quando existe, costuma tratar o estoque por lote ou por SKU — a mesma granularidade que sistemas de gestão convencionais usam. Mas o comércio real de produtos pequenos e perecíveis (ex: perfumaria) recebe entregas mistas, em que unidades do MESMO produto trazem validades DIFERENTES dentro da mesma caixa. Controle por lote não resolve isso: obriga a vendedora a inferir manualmente qual unidade física pegar — exatamente o processo propenso a erro que este trabalho busca substituir.

**Alternativas consideradas:** controle por lote (uma validade por recebimento, aplicada a todas as unidades daquele lote). Mais simples de implementar, mas inválido para o cenário de entrega mista descrito acima — é o modelo que os sistemas convencionais já oferecem e que não resolve o problema.

**Solução adotada:** cada unidade física recebe um código QR único e uma `dataValidade` própria, independente das demais unidades do mesmo produto (ver `docs/arquitetura.md` seção 3, entidade `UnidadeProduto`).

**Por que resolve o problema / trade-offs:** permite que a validação FIFO opere no nível da unidade física real — o nível em que a vendedora efetivamente decide, na prática, qual frasco tirar da prateleira — em vez do nível abstrato do lote, que esconde a variação de validade que motiva o problema. O custo é operacional: cada unidade individual precisa ser fisicamente etiquetada, o que exige um fluxo próprio de geração e impressão de etiquetas (RF04) que um sistema por lote dispensaria.

**Tarefa relacionada:** T05 (cadastro por unidade), T14 (geração de QR)

**Data:** 2026-08-25

---

## Produto nunca é excluído: o histórico é o dado da pesquisa

**Contexto do problema:** no controle manual, um produto que sai de linha simplesmente some — a linha é apagada da planilha, ou o caderno vira. Junto com ele some o histórico de quantas unidades daquele item venceram na prateleira. Essa é exatamente a informação que motiva o trabalho: sem ela, a loja não consegue dizer quanto perde por vencimento, nem quais itens concentram a perda, e a decisão de compra segue baseada em impressão.

**Alternativas consideradas:** exclusão física (`DELETE` no banco), que é o comportamento que a palavra "excluir" sugere ao usuário e o padrão de um CRUD convencional. Descartada porque um produto com unidades já vendidas ou descartadas não pode ser removido sem levar junto o histórico — e o log de eventos, que é append-only por exigência de projeto, ficaria referenciando um produto que não existe mais.

**Solução adotada:** `Produto` tem um campo `ativo`, e a operação de exclusão da interface apenas o marca como `false`. O produto some das listagens operacionais por padrão, mas continua no banco, e um filtro explícito o traz de volta. A operação tem desfazer.

**Por que resolve o problema / trade-offs:** preserva a série histórica que sustenta os indicadores de perda, sem exigir que o usuário entenda a diferença entre "inativar" e "excluir" — para ele, o produto sumiu da tela. O custo é que o banco cresce monotonicamente e que o catálogo real acumula itens inativos, o que exige que toda consulta operacional futura (cadastro de unidade, leitura de QR) lembre de filtrar por `ativo`. É uma limitação a mencionar honestamente: o sistema troca simplicidade de manutenção por integridade do histórico, e essa troca só se justifica porque o histórico é o objeto do trabalho.

**Tarefa relacionada:** T04

**Data:** 2026-09-07
