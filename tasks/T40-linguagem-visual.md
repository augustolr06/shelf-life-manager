# T40 — Linguagem visual: tokens, escala de validade, fontes e manifest

**Depende de:** T35 (fundação visual)
**Incremento:** 12 (Redesign — proposta do Claude Design)
**Bloqueia:** T41, T42, T43, T44, T45

**Fonte de verdade:** `docs/redesign/claude-design/README.md`, seções "Decisões fixadas por esta
proposta" e "Linguagem visual". Mockups em `docs/redesign/claude-design/telas/`.

## Objetivo

Trocar os **valores** da fundação de T35 pelos da especificação, sem mexer em layout nem em
navegação: depois desta tarefa, todas as telas atuais aparecem com as cores, a fonte e a forma
novas, ainda na estrutura de abas de hoje.

## Escopo

1. **Tokens de cor** no `:root` de `estilos.css` com os valores da tabela "Cores base",
   incluindo o novo `--cor-texto-menu` e `--cor-borda-campo` `#66726E`.
2. **Escala de validade** como tokens (cinco faixas: texto, fundo e cor de barra) e como
   classes de faixa (por exemplo `faixa-vencida`, `faixa-ate-7`, `faixa-8-30`, `faixa-31-90`,
   `faixa-acima-90`), que definem `--tom-fundo`, `--tom-texto` e `--tom-forte` como os tons de
   T35.
3. **Tons semânticos alinhados à escala:** `perigo` = faixa vencida, `atencao` = faixa 8 a 30,
   `sucesso` = faixa 31 a 90. `tom-vencido` e as classes de domínio dele (`pendente`,
   `alerta.vencido`, `resultado-vencido`…) passam a usar a faixa vencida; os tokens roxos
   `--cor-vencido-*` saem.
4. **Botão `perigo`** com texto branco sobre `#A8231A`.
5. **Fontes** Manrope (400–800) e JetBrains Mono (500) com `@fontsource/manrope` e
   `@fontsource/jetbrains-mono`, importadas em `main.tsx`; `--fonte-base` e `--fonte-mono`
   apontando para elas, com a fonte do sistema como reserva.
6. **Forma:** raio de 14 px em `cartao`, 10 px em botões e campos; cartões sem sombra, com
   borda `--cor-borda`; códigos de etiqueta e código interno sempre em `--fonte-mono`.
7. **Tipografia:** tamanhos da tabela "Tipografia" como tokens, aplicados aos títulos de tela,
   de seção, ao corpo e aos distintivos.
8. **Manifest e meta:** `theme_color` e `background_color` em `#F6F7F5` (`vite.config.ts`) e
   `<meta name="theme-color">` em `index.html` igual.
9. **Tabela de contraste** do topo de `estilos.css` refeita com os valores novos (os números
   estão na especificação).

## Decisões anteriores afetadas

- T35, decisão 4 (tom `vencido` roxo): revertida, vencida passa a vermelho.
- T35, decisão 12 (barra na cor da marca e `theme_color` dela): o `theme_color` muda aqui; a
  barra em si sai em T41.
- T35, fonte do sistema: substituída por Manrope e JetBrains Mono empacotadas.

## Critério de aceite

- [ ] Nenhuma cor solta fora do `:root` (regra de T35 mantida)
- [ ] Nenhum token roxo restante; `tom-vencido` resolve para a faixa vencida
- [ ] Tabela de contraste atualizada, todos os pares de texto ≥ 4,5:1
- [ ] Fontes servidas do próprio build: com a rede desligada (`network-state-set offline`)
      depois do primeiro carregamento, o texto continua em Manrope
- [ ] Testes de Vitest verdes sem mudar consulta por papel ou rótulo
- [ ] `playwright-cli` a 1280×900: captura de Venda, Catálogo, Descarte e Relatórios,
      guardada em `docs/redesign/T40/`

## Fora de escopo

- Menu, barra do topo e layout de qualquer tela (T41 em diante).
- Textos e rótulos (os rótulos novos do menu entram em T41).
