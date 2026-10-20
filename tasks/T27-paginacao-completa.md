# T27 — Componente de paginação completo, compartilhado pelas telas paginadas

**Depende de:** nada pendente (as cinco telas paginadas já existem)
**Incremento:** 9 (Ajustes de uso em formulários e listas)
**Bloqueia:** nada

## Objetivo

Cinco telas repetem o mesmo bloco `.paginacao` com só **Anterior** e **Próxima**:
`TelaProdutos`, `TelaAlertas`, `TelaDescartesPendentes`, `TelaEtiquetas` e o histórico de
saídas de `TelaDashboard`. Com 700 SKUs em páginas de 20, chegar à página 30 do catálogo são
29 cliques.

Esta tarefa cria **um** componente `frontend/src/components/Paginacao.tsx` com os controles
usuais e o aplica nas cinco telas.

## Comportamento

```
« Primeira   ‹ Anterior   1 … 4 5 [6] 7 8 … 35   Próxima ›   Última »
                                        Página 6 de 35 · 692 produtos
```

- Primeira / anterior / próxima / última, desabilitados nas pontas.
- Números de página em janela em torno da atual (ex.: 2 de cada lado), sempre com a primeira
  e a última, e reticências nos saltos.
- Página atual marcada com `aria-current="page"`; os botões com rótulo acessível
  ("Ir para a página 7").
- Em tela estreita, só ‹ [6 / 35] › — o layout fino fica para T36, mas o componente já
  precisa caber em 360 px sem rolagem horizontal.
- Não renderiza nada quando há uma página só (comportamento atual).

## Critério de aceite

- [ ] `Paginacao` com props `{ pagina, totalPaginas, aoMudar }` (e `total`/rótulo opcionais)
- [ ] Função pura `paginasVisiveis(pagina, totalPaginas)` testada à parte: pontas, janela,
      reticências, poucas páginas
- [ ] As cinco telas usam o componente; nenhum bloco `.paginacao` duplicado sobra
- [ ] Mudar de página rola a lista para o topo
- [ ] Testes de componente; testes das cinco telas continuam verdes
- [ ] Conferência no navegador com o `playwright-cli` no Catálogo (o caso com mais páginas)

## Decisões a registrar em `docs/decisoes.md`

- Campo "ir para a página N": **não** incluir agora. Com primeira/última e janela de números,
  qualquer página está a no máximo ~3 cliques; o campo só pesa na tela do celular.
  Reavaliar se a gestora pedir.

## Fora de escopo

- Mudar o tamanho da página ou deixá-lo configurável.
- Rolagem infinita.
- Mudanças nos endpoints: todos já devolvem `total`, `pagina` e `tamanhoPagina`.
