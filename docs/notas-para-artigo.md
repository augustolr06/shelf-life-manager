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

---

## Unidade vencida pode ser cadastrada: o sistema precisa aceitar o estoque como ele está

**Contexto do problema:** o controle manual não tem um momento de "cadastro". O estoque simplesmente existe na prateleira, e a loja descobre o que tem quando olha. Ao informatizar, aparece uma tentação natural: exigir que todo item entrando no sistema esteja válido, porque um item vencido "não deveria estar lá". O problema é que ele está — e é justamente o item que a loja mais precisa que o sistema conheça. Um frasco vencido esquecido no fundo da prateleira é a perda que o trabalho quer medir, e o risco que quer evitar que chegue ao cliente.

**Alternativas consideradas:** recusar o cadastro de unidade com validade passada, obrigando a loja a descartar o item antes de registrá-lo. Descartada porque inverte a ordem real dos fatos: o descarte é uma decisão que precisa ser registrada, com autor e motivo (seção 6.1 do PRD), e exigi-lo *antes* do cadastro significa que ele acontece fora do sistema — sem registro, sem responsável, sem entrar na conta de perdas. O sistema ficaria sabendo apenas do estoque que já estava certo.

**Solução adotada:** o cadastro aceita qualquer validade e devolve um aviso quando a unidade entra já vencida, dizendo quantas unidades e de qual validade. A unidade entra em estoque normalmente, com código próprio, e será barrada na venda pelo fluxo de exceção previsto para unidade vencida.

**Por que resolve o problema / trade-offs:** separa duas decisões que o processo manual mistura — "este item existe" e "este item pode ser vendido". A primeira é um fato e o sistema apenas registra; a segunda é um julgamento, e tem um fluxo próprio com autor e justificativa. O custo é que o estoque do sistema passa a conter itens que não podem ser vendidos, e a interface precisa deixar isso visível para não parecer erro. É também o que torna possível a migração inicial: a loja pode cadastrar a prateleira como ela está hoje, sem precisar limpá-la antes.

**Tarefa relacionada:** T05 (cadastro), T11 (exceção de unidade vencida)

**Data:** 2026-09-07

---

## Quantidade por validade: o formulário reproduz o gesto da conferência

**Contexto do problema:** o modelo do sistema é a unidade física — cada frasco é uma linha no banco, com código próprio (ver a nota sobre QR por unidade). Mas o gesto real do recebimento não é unidade a unidade: a gestora abre a caixa, lê **uma** validade impressa e conta quantos frascos vieram com ela. Um formulário fiel ao modelo de dados pediria doze linhas idênticas para doze frascos da mesma validade, e obrigaria a redigitar a data doze vezes — no campo que é o objeto inteiro do trabalho.

**Alternativas consideradas:** manter uma linha por unidade, o que é a tradução literal do modelo. Descartada por multiplicar a chance de erro de digitação exatamente onde ele custa mais caro: uma validade digitada errada não é detectável depois — o sistema vai ordenar a saída FIFO por um dado falso e continuar parecendo correto.

**Solução adotada:** cada linha do recebimento é um par (validade, quantidade), e o servidor expande a linha em N unidades independentes, cada uma com seu próprio código. O modelo de dados não muda: quem olha o banco vê N unidades separadas, como se tivessem sido cadastradas uma a uma.

**Por que resolve o problema / trade-offs:** é um caso em que a interface deve reproduzir o gesto do operador e não o formato do banco, e a tradução entre os dois é responsabilidade do servidor. O trade-off honesto é que a contagem passa a depender do operador — se ele digitar 12 e a caixa tiver 11, o sistema acredita nele, e a divergência só aparece quando faltar um frasco na leitura de QR. Um controle manual tem exatamente o mesmo furo; o sistema não o resolve, apenas não o piora.

**Tarefa relacionada:** T05

**Data:** 2026-09-07

---

## Data de validade é calendário, não instante — e o fuso é uma armadilha silenciosa

**Contexto do problema:** "vence em 01/03/2027" é um fato de calendário: não tem hora, e não muda conforme quem está olhando. A representação usual de data em sistemas, porém, é um instante no tempo, ancorado num fuso. A consequência aparece nas duas pontas: uma validade digitada como 01/03 pode ser gravada como 28/02, e a pergunta "esta unidade está vencida hoje?" pode mudar de resposta às 21h, quando o dia vira em UTC mas ainda é ontem na loja.

**Alternativas consideradas:** guardar a validade como instante com hora zero no fuso local, que é o comportamento padrão da maioria dos ORMs quando se converte uma data. Descartada porque o erro é silencioso — não gera exceção, não aparece em teste que rode na mesma máquina do banco, e só se manifesta como um item ordenado errado na fila FIFO ou como um vencimento que antecipa um dia.

**Solução adotada:** a coluna é do tipo `DATE`, sem hora, e a conversão entre o texto `AAAA-MM-DD` que trafega na API e o valor gravado passa por um único par de funções. "Hoje" é sempre derivado do calendário local de quem opera a loja, e só então normalizado; a validade é montada a partir de ano, mês e dia explícitos, nunca interpretada a partir de texto solto.

**Por que resolve o problema / trade-offs:** é a diferença entre o sistema estar certo e o sistema *parecer* certo na máquina de quem o desenvolveu. A verificação que dá confiança não é o teste unitário — é conferir o valor gravado direto no banco, com o servidor num fuso e o relógio local em outro, que foi o que se fez aqui. A limitação a mencionar: a solução assume uma loja num único fuso horário, o que é verdade para o caso estudado e deixaria de ser numa rede com filiais distantes.

**Tarefa relacionada:** T05 (cadastro), T07 (validação FIFO, que compara validade com "hoje")

**Data:** 2026-09-07
