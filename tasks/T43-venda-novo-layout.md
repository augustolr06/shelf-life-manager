# T43 — Venda no novo layout

**Depende de:** T41 (navegação por tarefa)
**Incremento:** 12 (Redesign — proposta do Claude Design)
**Bloqueia:** nada

**Fonte de verdade:** `docs/redesign/claude-design/README.md`, seção "Venda no celular".
Mockup: `telas/venda-celular.html`.

## Objetivo

A Venda é a tela do balcão, usada no celular. Hoje o leitor e o carrinho competem com textos
longos e cartões do mesmo peso. O novo layout põe o leitor no centro e a confirmação ao
alcance do polegar.

## Escopo

1. Cabeçalho: título, estado do atendimento com ponto verde e "Encerrar atendimento" à direita
   (só com o carrinho vazio, como hoje).
2. Área do leitor escura, da largura da tela, com moldura de mira, instrução e "Ligar câmera";
   com a câmera ligada, o vídeo de `LeitorCamera` ocupa a área.
3. Campo do código em fonte mono com o botão "Ler" ao lado (48 px).
4. Carrinho em cartão, um item por linha, com remover de 44 px e `aria-label`.
5. "Confirmar venda · N frascos" de 52 px, preso acima da barra inferior no celular.
6. Vereditos (bloqueio FIFO, vencida, erro) e o `PainelExcecaoVencido` com as cores da escala
   (T40), sem mudar ordem nem comportamento.
7. No computador, a mesma ordem numa coluna central de até 640 px.
8. O texto longo de explicação do topo da tela sai; o que ele explicava já está no próprio
   fluxo (o carrinho vazio diz que cada frasco liberado entra ali).

## Decisões anteriores afetadas

- Nenhuma de comportamento. T31, T34 e T39 continuam valendo como estão.

## Critério de aceite

- [x] Ordem visual do painel de exceção preservada: correção → descarte → override (PRD 6.1)
- [x] "Encerrar atendimento" continua só com o carrinho vazio
- [x] Botão de confirmar visível sem rolar, a 360×740, com 3 itens no carrinho
- [x] Testes de Vitest de `TelaVenda` verdes sem mudar asserções de comportamento
- [x] `playwright-cli` a 360×740 e 1280×900: carrinho vazio, com itens e veredito de vencida;
      capturas em `docs/redesign/T43/`
- [x] Verificação no celular real anotada no backlog, junto da de câmera

## Fora de escopo

- Consultar produto: recebe só tokens e menu.
- Gestos (arrastar para remover item).
