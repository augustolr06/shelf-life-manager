# T05 — Cadastro de UnidadeProduto (individual e em lote)

**Depende de:** T04
**Incremento:** 1 (Fundação)

## Objetivo
Implementar o registro de unidades físicas vinculadas a um `Produto`, com validade obrigatória, suportando lote com validades diferentes por unidade na mesma sessão de recebimento (RF03).

## Critério de aceite
- [ ] `POST /produtos/:id/unidades` (GESTOR) — aceita array de unidades, cada uma com sua própria `dataValidade`
- [ ] Cada unidade recebe um `codigoQr` único gerado no servidor (formato a definir — sugestão: UUID curto ou prefixo do produto + sequencial; registrar a escolha em `docs/decisoes.md`)
- [ ] `dataValidade` validada como data futura ou presente no momento do cadastro (aviso, não bloqueio — cadastro de unidade já vencida pode ser legítimo em cenários de correção)
- [ ] Status inicial sempre `EM_ESTOQUE`
- [ ] `registradoPorId` preenchido com o usuário autenticado
- [ ] Testes: cadastro de lote com validades distintas, cadastro de unidade única, erro em `produtoId` inexistente
- [ ] Frontend: tela de recebimento — seleciona/cadastra o `Produto`, adiciona N unidades com validade cada, envia o lote

## Notas técnicas
- Esta tarefa NÃO inclui geração de etiqueta QR imprimível (isso é RF04 / T14) — aqui só se gera o código, não a etiqueta física.
- O `codigoQr` gerado aqui é o mesmo que será validado no fluxo de saída (T07/T08) — manter formato estável entre as duas tarefas.

## Fora de escopo desta tarefa
Geração de etiquetas imprimíveis (T14), leitura de QR no ponto de venda (T08).
