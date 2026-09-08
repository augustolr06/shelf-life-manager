# T05 — Cadastro de UnidadeProduto (individual e em lote)

**Depende de:** T04
**Incremento:** 1 (Fundação)

## Objetivo
Implementar o registro de unidades físicas vinculadas a um `Produto`, com validade obrigatória, suportando lote com validades diferentes por unidade na mesma sessão de recebimento (RF03).

## Critério de aceite
- [x] `POST /produtos/:id/unidades` (GESTOR) — aceita array de unidades, cada uma com sua própria `dataValidade`
- [x] Cada unidade recebe um `codigoQr` único gerado no servidor no formato `PRF-XXXXXX` (Crockford Base32, sem I/L/O/U). Decidido em `docs/decisoes.md` (2026-09-07)
- [x] A geração vive num único módulo (`src/modules/unidade/codigoQr.ts`): o formato é **provisório** até o teste físico da RNF08 (T16) e precisa ser barato de trocar
- [x] `dataValidade` validada como data futura ou presente no momento do cadastro (aviso, não bloqueio — cadastro de unidade já vencida pode ser legítimo em cenários de correção)
- [x] Status inicial sempre `EM_ESTOQUE`
- [x] `registradoPorId` preenchido com o usuário autenticado
- [x] Testes: cadastro de lote com validades distintas, cadastro de unidade única, erro em `produtoId` inexistente
- [x] Frontend: tela de recebimento — seleciona/cadastra o `Produto`, adiciona N unidades com validade cada, envia o lote. O cadastro de produto novo continua na aba Catálogo (T04); esta tela só seleciona

## Ajustes de escopo feitos durante a implementação
Registrados também em `docs/decisoes.md` (2026-09-07, seção T05):

- Cada linha do lote aceita `quantidade` (padrão 1), em vez de exigir uma linha por unidade física. Não muda o modelo — cada unidade continua sendo uma linha própria com código próprio no banco.
- Receber unidade de produto inativo é recusado com 409 `PRODUTO_INATIVO`.
- Navegação entre as duas telas por estado no `App` (abas), sem biblioteca de roteamento — mantém a decisão de T03b.

## Notas técnicas
- Esta tarefa NÃO inclui geração de etiqueta QR imprimível (isso é RF04 / T14) — aqui só se gera o código, não a etiqueta física.
- O `codigoQr` gerado aqui é o mesmo que será validado no fluxo de saída (T07/T08) — manter formato estável entre as duas tarefas.

## Fora de escopo desta tarefa
Geração de etiquetas imprimíveis (T14), leitura de QR no ponto de venda (T08).
