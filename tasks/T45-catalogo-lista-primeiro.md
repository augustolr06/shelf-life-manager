# T45 — Catálogo com a lista primeiro

**Depende de:** T41 (navegação por tarefa)
**Incremento:** 12 (Redesign — proposta do Claude Design)
**Bloqueia:** nada

**Fonte de verdade:** `docs/redesign/claude-design/README.md`, seção "Catálogo". Mockup:
`telas/catalogo.html`.

## Objetivo

Hoje o formulário de cadastro e a importação ficam sempre abertos acima da lista, e a lista de
produtos começa abaixo da dobra. Com o catálogo real (~700 SKUs), o uso mais comum é procurar,
não cadastrar.

## Escopo

### Backend

1. `GET /produtos` aceita `categoria` (igualdade exata), combinável com `busca`,
   `incluirInativos` e `pagina`.
2. Lista das categorias existentes (distintas, em ordem alfabética), numa rota própria ou na
   resposta de `GET /produtos` — decidir e registrar.

### Frontend

3. Cabeçalho com título, contagem e, só para GESTOR, "Importar planilha" e "Novo produto".
4. Cartão da lista: busca (T26), pílulas de categoria ("Todas" + as do servidor), tabela
   (Código, Produto com marca, Categoria, Situação, menu "…"), "Mostrar inativos" e paginação
   (T27) no rodapé.
5. Painel "Novo produto" ao lado da lista no computador, tela cheia no celular, fechado por
   padrão; campo Categoria com as categorias existentes e opção de digitar uma nova. Contador
   de T25 continua.
6. Importação (`ImportacaoProdutos`) no mesmo painel.
7. Menu "…" da linha com Inativar (`perigo` + confirmação de T39) ou Reativar.
8. Valor inicial da busca pela URL (`?busca=`), usado pela busca do Início (T42).

## Decisões anteriores afetadas

- T04 e T24: cadastro e importação deixam de ficar sempre visíveis.
- T26: a busca passa a ser combinada com o filtro de categoria.

## Critério de aceite

- [ ] Testes de backend do filtro por categoria (com busca, com inativos, categoria inexistente)
- [ ] Atendente vê a lista sem os botões de escrita (regra de T04 mantida, e o 403 do backend
      continua sendo quem recusa)
- [ ] Cadastro, importação, inativação e reativação funcionam como antes
- [ ] A 360 px a tabela rola dentro do cartão e a página não rola na horizontal
- [ ] Testes de Vitest de `TelaProdutos` e `ImportacaoProdutos` verdes
- [ ] `playwright-cli` a 1280×900 e 360×740: lista, filtro, painel aberto; capturas em
      `docs/redesign/T45/`

## Fora de escopo

- Edição de produto (não existe hoje).
- Ordenação por coluna.
