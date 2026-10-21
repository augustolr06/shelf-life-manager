# T42 — Tela Início do gestor

**Depende de:** T41 (navegação por tarefa)
**Incremento:** 12 (Redesign — proposta do Claude Design)
**Bloqueia:** nada

**Fonte de verdade:** `docs/redesign/claude-design/README.md`, seção "Início do gestor".
Mockup: `telas/inicio.html`.

## Objetivo

Hoje o gestor cai no Catálogo, e o que é urgente (vencidas em estoque, alertas, o próximo
vencimento) fica espalhado entre Dashboard, Alertas e Descarte. A tela Início mostra primeiro
o que precisa de ação.

## Escopo

### Backend

1. `GET /dashboard` ganha, no bloco `estoque`, o **próximo vencimento**: a unidade em estoque,
   ainda não vencida, de `dataValidade` mais próxima — produto (nome, marca), `codigoQr`,
   `dataValidade`, `diasParaVencer` e `faixa` — ou `null` quando não houver. Calculado com a
   mesma noção de "hoje" das faixas.
2. `GET /dashboard` passa a devolver **a data de hoje** do servidor (`hoje`, `AAAA-MM-DD`), para
   a saudação.

### Frontend

3. Rota `/inicio` (GESTOR), primeira do menu, sem grupo.
4. `rotaInicial` manda o gestor para `/inicio`; a atendente continua em `/venda`.
5. Layout da especificação: cabeçalho com data, saudação, busca e "Nova venda"; os três cartões
   de atenção; estoque por validade (barra empilhada + legenda); últimos 30 dias.
6. **Busca:** texto começando por `PRF-` abre `/consulta` com o código; o resto abre
   `/produtos` com a busca preenchida. As duas telas passam a aceitar o valor inicial pela URL
   (`?codigo=` e `?busca=`).
7. **Barra empilhada** como componente próprio, com `role="img"` e `aria-label` que lista as
   cinco faixas; nunca renderizada sem a legenda.

## Decisões anteriores afetadas

- `App.tsx`, `rotaInicial` (gestor em `/produtos`, T10): o gestor passa a começar no Início.
- `services/dashboard.ts`: tipo `Dashboard` ganha os dois campos novos.

## Critério de aceite

- [x] Teste de backend do próximo vencimento: sem unidades, só vencidas, empate de validade e
      unidade de produto inativo (decidir e registrar se entra) — entra
      (`docs/decisoes.md`, T42, decisão 1)
- [x] Nenhuma data comparada no navegador: dias, faixa e a data de hoje vêm do servidor
- [x] Gestor cai em `/inicio` depois do login; atendente cai em `/venda`
- [x] Os três cartões levam às telas certas; a busca leva à Consulta ou ao Catálogo preenchidos
- [x] Testes de Vitest da tela (estados: carregando, erro, sem próximo vencimento)
- [x] `playwright-cli` a 1280×900 e 360×740; capturas em `docs/redesign/T42/`

## Fora de escopo

- Mudar o Dashboard (Relatórios), que continua como está.
- Período configurável no Início: ele mostra sempre os últimos 30 dias que o servidor devolve
  por padrão.
