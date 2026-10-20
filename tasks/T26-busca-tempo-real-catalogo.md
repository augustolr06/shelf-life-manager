# T26 — Busca em tempo real no Catálogo de produtos

**Depende de:** T04 (tela de Catálogo)
**Incremento:** 9 (Ajustes de uso em formulários e listas)
**Bloqueia:** T28 (reaproveita o atraso de busca)

## Objetivo

Em `frontend/src/pages/TelaProdutos.tsx` a busca só dispara ao clicar em **Buscar**
(`termoDigitado` → `busca` no submit do formulário). Dois problemas de uso:

1. Quem digita espera ver a lista reagir, e não ver nada até achar o botão.
2. Apagar o texto do campo **não** volta a mostrar todos os produtos — a lista continua
   filtrada pelo último termo até um novo clique em Buscar.

A lista passa a filtrar enquanto se digita, e campo vazio volta à lista completa.

## Decisões que esta tarefa toma (registrar em `docs/decisoes.md`)

1. **A busca continua no servidor.** `GET /produtos?busca=` já filtra e pagina; com ~700 SKUs
   (RNF10) e paginação de 20, filtrar no navegador exigiria baixar o catálogo inteiro.
2. **Atraso de ~300 ms após a última tecla**, num hook reaproveitável
   (`frontend/src/hooks/useValorComAtraso.ts`). Sem ele, cada tecla é uma requisição.
3. **Resposta fora de ordem é descartada.** Se "per" responder depois de "perfume", a tela
   mostraria o resultado errado. Cancelar com `AbortController` (ou ignorar a resposta cujo
   termo não é mais o atual).
4. **Mudar o termo volta para a página 1**, como já acontece no submit.

## Critério de aceite

- [x] Botão **Buscar** removido; a lista reage à digitação após o atraso
- [x] Campo vazio volta a mostrar todos os produtos (respeitando "Mostrar produtos inativos")
- [x] Enter no campo não recarrega a página nem dispara busca duplicada
- [x] Indicação discreta de carregamento durante a busca, sem apagar a lista anterior (a
      tabela não "pisca" a cada tecla)
- [x] Resposta antiga que chega depois da nova é ignorada
- [x] Hook com teste próprio (timers falsos do Vitest); testes de `TelaProdutos.test.tsx`
      atualizados
- [x] Conferência no navegador com o `playwright-cli`: digitar, apagar, ver a lista completa

## Notas técnicas

- O `GET /produtos` não tem rate limit (só `/auth/login` tem, desde T23), então o atraso é
  questão de economia de rede no celular, não de bloqueio.
- Um botão "limpar" (×) no campo é bem-vindo, mas opcional. (Implementado, por decisão do
  orientando — ver `docs/decisoes.md`, 2026-10-20.)

## Fora de escopo

- Busca por marca ou categoria (o backend busca por nome e código).
- Busca em tempo real nas outras telas: Recebimento e Etiquetas ganham o seletor de T28.
