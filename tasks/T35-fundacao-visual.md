# T35 — Fundação visual: tokens, tipografia e componentes base

**Depende de:** T29 (toasts), T34 (carrinho) — para que as telas novas entrem no redesign
**Incremento:** 11 (Redesign)
**Bloqueia:** T36, T37, T38

## Objetivo

`frontend/src/estilos.css` (~1.200 linhas) cresceu tela a tela: cores, espaçamentos e
tamanhos de fonte são valores soltos repetidos, e cada tela tem variações próprias de botão,
cartão e aviso. Antes de redesenhar telas, esta tarefa estabelece a base que as outras três
tarefas do incremento usam.

## Escopo

1. **Tokens em variáveis CSS** no `:root`: paleta neutra, cor primária, e uma paleta
   **semântica** — `sucesso`, `atencao`, `perigo`, `inativo` — com par de fundo/texto que
   passe em contraste WCAG AA. Espaçamento em escala (4/8/12/16/24/32), raio, sombra,
   tipografia (família, 4–5 tamanhos, pesos).
2. **Componentes base** como classes (ou componentes React onde houver comportamento):
   - botão: `primario`, `secundario`, `perigo`, `fantasma`; estados hover/foco/desabilitado/
     carregando; alvo de toque ≥ 44 px;
   - campo de formulário: rótulo, ajuda, erro, contador (T25);
   - cartão, tabela, distintivo (*badge*) com as variantes semânticas;
   - aviso inline (sucesso/atenção/perigo) para o que não virou toast (T29);
   - estilos dos toasts (T29), do diálogo (T30), da paginação (T27) e do seletor (T28).
3. **Migrar as telas** para os tokens e componentes: nenhum valor de cor solto fora do
   `:root` ao final.
4. **Identidade mínima:** nome curto do app na barra (hoje "Controle de Estoque FIFO por
   Validade"), ícone do PWA coerente com a paleta, `theme_color` do manifest atualizado.

## Decisões a registrar em `docs/decisoes.md`

- CSS próprio com variáveis vs. framework (Tailwind etc.). Recomendação: **continuar com CSS
  próprio + variáveis** — o projeto já é assim, não há build a reconfigurar, e a troca de
  framework no meio não é o assunto do trabalho.
- Modo escuro: fora de escopo, mas os tokens nomeados por **papel** (`--cor-fundo`,
  `--cor-texto`), e não por cor (`--cinza-100`), para que ele seja possível depois.

## Critério de aceite

- [ ] Tokens definidos e documentados no topo de `estilos.css`
- [ ] Componentes base aplicados em todas as telas
- [ ] Contraste AA conferido para texto sobre cada cor semântica
- [ ] Foco visível em todos os elementos interativos
- [ ] Testes de Vitest continuam verdes (mudança de classe não deve quebrar consultas por
      papel/rótulo; se quebrar, é sinal de teste acoplado a CSS)
- [ ] Conferência no navegador com o `playwright-cli`: `screenshot` de cada tela antes e
      depois, anexado na descrição do commit ou em `docs/`

## Fora de escopo

- Layout para celular/tablet — T36.
- Textos — T37.
- Regras de destaque de vencidos, inativos e ações destrutivas — T38 (aqui só nascem as
  variantes semânticas que T38 aplica).
