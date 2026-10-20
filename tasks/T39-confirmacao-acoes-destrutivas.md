# T39 — Confirmação em diálogo antes de ação destrutiva

**Depende de:** T30 (componente `Dialogo`)
**Incremento:** 9 (Ajustes de uso em formulários e listas)
**Bloqueia:** T34 (o carrinho usa a mesma confirmação), T38 (o destaque visual parte das
confirmações já existentes)

## Objetivo

Hoje nenhuma ação do app pede confirmação. Descartar uma unidade, inativar um produto,
desativar uma conta e trocar o papel de uma conta acontecem no primeiro clique — no caso do
papel, no `onChange` do `<select>`. Um toque errado na tabela (fácil no celular, com as linhas
próximas) produz um efeito que a pessoa não pediu, e o descarte não tem volta: a `Saida` e o
`EventoLog` (RNF05) ficam gravados.

Esta tarefa coloca um diálogo de confirmação, com o mesmo comportamento em todas as telas,
antes de cada ação destrutiva ou irreversível. O destaque visual dessas ações (variante
`perigo` do botão) continua em T38.

## Ações cobertas

| Ação | Onde | Texto da consequência (rascunho — T37 revisa) | Botão de confirmar |
|---|---|---|---|
| Registrar descarte | `PainelExcecaoVencido.tsx` (leitura e fila de descarte) | "A unidade {código} de {produto} sai do estoque como descarte. Isso não pode ser desfeito." | Descartar |
| Autorizar venda vencida (override, GESTOR) | `PainelExcecaoVencido.tsx`, ao enviar o formulário com a justificativa | "A unidade {código} vencida será vendida. A autorização fica registrada com seu nome e não pode ser desfeita." | Autorizar venda |
| Inativar produto | `TelaProdutos.tsx` | "{produto} deixa de aparecer no recebimento e nas etiquetas. As unidades já em estoque não mudam. Você pode reativá-lo depois." | Inativar |
| Desativar conta | `TelaUsuarios.tsx` | "{nome} não poderá mais entrar no sistema. Você pode reativar a conta depois." | Desativar conta |
| Trocar papel de conta | `TelaUsuarios.tsx` | "{nome} passa de {papel atual} para {papel novo}." + o que muda no acesso | Trocar papel |

Os textos acima são ponto de partida: quem implementa confere o que cada ação faz de fato no
backend (por exemplo, se o produto inativo some mesmo do recebimento) antes de escrever a
consequência. O diálogo **descreve** a ação; não pode afirmar algo que o servidor não faz.

**Não pedem confirmação:** reativar produto ou conta (desfaz uma ação anterior, sem perda),
redefinir senha (já é um formulário próprio, com campo e botão), remover item do carrinho
(basta ler o frasco de novo).

## Decisões que esta tarefa toma (registrar em `docs/decisoes.md`)

1. **Confirmação como função que devolve promessa.** Um provedor no `App` monta um único
   `DialogoConfirmacao` (sobre o `Dialogo` de T30) e expõe `useConfirmacao()`, que devolve
   `confirmar({ titulo, consequencia, rotuloConfirmar }): Promise<boolean>`. Na tela, a ação
   vira `if (!(await confirmar({...}))) return` antes da chamada à API — o fluxo da tela
   continua legível de cima para baixo, sem estado de "diálogo aberto" espalhado em cada
   componente.
2. **Foco inicial em Cancelar.** Esc e clique fora do diálogo também cancelam. O caminho
   rápido (Enter, toque duplo) nunca executa a ação destrutiva.
3. **O botão repete o verbo da ação** ("Descartar", "Inativar"), nunca "OK" ou "Sim". O texto
   da consequência cita o dado concreto (código da unidade, nome do produto, nome da conta),
   para a pessoa perceber se clicou na linha errada.
4. **Trocar papel deixa de salvar no `onChange`.** Escolher outro papel no `<select>` abre a
   confirmação; cancelar devolve o `<select>` ao papel atual.
5. **O override ganha o diálogo depois da justificativa.** O formulário com o aviso legal
   continua no lugar; o diálogo é o último passo antes de enviar. A seção 6.1 do PRD pede
   fricção deliberada para o override, e esta é a ação mais grave do sistema.
6. **A confirmação é só de interface.** O diálogo não decide nada: a autorização (papel), a
   validação e o veredito continuam no servidor (RNF04). Confirmar apenas libera a mesma
   chamada que hoje sai no clique.

## Critério de aceite

- [x] `DialogoConfirmacao` + `useConfirmacao()` em `frontend/src/components/`, montados uma
      vez no `App`
- [x] As cinco ações da tabela passam pela confirmação; as da lista "não pedem" continuam
      diretas
- [x] Troca de papel: cancelar devolve o `<select>` ao valor anterior, sem chamada à API
- [x] Foco em Cancelar ao abrir; Esc e clique fora cancelam
- [x] Testes de componente: para cada ação, o diálogo aparece com o texto da consequência;
      cancelar **não** chama a API; confirmar chama uma vez
- [x] Testes existentes das telas afetadas atualizados (hoje clicam e esperam a chamada direta)
- [x] Conferência no navegador com o `playwright-cli`: inativar produto no catálogo
      (cancelar e confirmar) e trocar papel de uma conta (cancelar)
- [x] `docs/decisoes.md` com as decisões acima

## Decisões anteriores afetadas (alerta — não bloqueia)

- **T38** listava a confirmação junto com o destaque visual das ações destrutivas. A
  confirmação vem para cá porque corrige um risco de uso que já existe em produção e não
  depende do redesign. T38 fica com a variante `perigo` dos botões.
- **T34** previa "uma confirmação" para Confirmar venda e Esvaziar carrinho sem dizer qual
  componente. Passa a usar `useConfirmacao()` desta tarefa.

## Fora de escopo

- Estilo de perigo nos botões e no diálogo — T38.
- Desfazer ações destrutivas (estorno de venda, "desfazer descarte").
- Confirmações do carrinho — T34, usando o componente desta tarefa.
- Confirmação na leitura de QR — o risco de vender ao ler é resolvido por T31 e T34.
