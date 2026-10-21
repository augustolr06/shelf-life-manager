# T41 — Navegação por tarefa: menu lateral, barra inferior e fim da barra do topo

**Depende de:** T40 (linguagem visual)
**Incremento:** 12 (Redesign — proposta do Claude Design)
**Bloqueia:** T42, T43, T44, T45

**Fonte de verdade:** `docs/redesign/claude-design/README.md`, seção "Navegação". Mockups:
`telas/inicio.html` (menu lateral), `telas/venda-celular.html` e
`telas/descarte-celular.html` (barra inferior e abas de validade).

## Objetivo

Trocar as duas fileiras de abas e a barra verde do topo por um menu agrupado por tarefa, que
vira barra inferior no celular. Hoje, a 375 px, o menu ocupa quase metade da tela antes do
conteúdo.

## Escopo

1. **Grupos:** campo `grupo` em cada entrada de `TELAS` (`App.tsx`) — Operação, Validade,
   Gestão — e o menu renderizado por grupo, na ordem da tabela da especificação. Grupo sem
   item visível para o papel não aparece.
2. **Rótulos novos** no menu e no `<h1>` das telas: Recebimento, Catálogo, Descarte,
   Relatórios. **Rotas não mudam.**
3. **Computador (> 1024 px):** menu lateral de 232 px com a marca no topo e o rodapé do
   usuário (iniciais, nome, papel, "Minha senha", sair com `aria-label`).
4. **Tablet (600–1024 px):** menu lateral recolhido aos ícones (64 px), expansível.
5. **Celular (< 600 px):** barra inferior fixa (gestor: Venda, Consultar, Validade, Mais;
   atendente: Venda, Consultar, Mais) e folha "Mais" com o resto do menu e o rodapé do usuário.
   O conteúdo da página ganha espaço embaixo para não ficar atrás da barra.
6. **Abas de validade no celular:** seletor Descarte | Alertas no topo de `/descartes` e de
   `/alertas`, cada aba com sua contagem; trocar de aba navega entre as rotas.
7. **Distintivos:** alertas não lidos (laranja, já existe) e unidades na fila de descarte
   (vermelho), contadas como os alertas: o `total` da primeira página de
   `GET /descartes/pendentes`, buscado ao autenticar o gestor e atualizado pela própria tela de
   descarte quando ela recarrega a fila.
8. **Fim da barra do topo** (`.barra-topo`) e de `--cor-barra`.
9. **Ícones** de traço inline (SVG), `aria-hidden` quando acompanham texto.

## Decisões anteriores afetadas

- T10 / T35: navegação em abas e barra do topo com a cor da marca — substituídas.
- `App.tsx`, `rotaInicial`: **não muda nesta tarefa** (o gestor passa a cair no Início em T42).

## Critério de aceite

- [x] Menu agrupado nos três tamanhos, com os rótulos novos e as mesmas rotas
- [x] Atendente vê só Venda, Consultar, Catálogo e o rodapé do usuário
- [x] Distintivos de alertas e de descarte visíveis nos três tamanhos
- [x] Item ativo marcado com `aria-current="page"`; `/alertas` não fica ativo em
      `/alertas/configuracao` (o `end` de hoje)
- [x] Sem rolagem horizontal da página a 360 px
- [x] Foco visível e ordem de tabulação coerente no menu lateral e na folha "Mais"
- [x] Testes de Vitest verdes (testes que procuram a aba pelo rótulo antigo são atualizados para
      o rótulo novo)
- [x] `playwright-cli` em 1280×900, 768×1024 e 360×740, como gestor e como atendente; capturas
      em `docs/redesign/T41/`

## Fora de escopo

- Layout interno das telas (T42 a T45).
- A tela Início (T42).
