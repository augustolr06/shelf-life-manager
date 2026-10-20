# T36 — Responsividade para celular e tablet

**Depende de:** T35 (fundação visual)
**Incremento:** 11 (Redesign)
**Bloqueia:** nada

## Objetivo

O dispositivo-alvo do balcão é o celular (RF05, PWA da RNF07), e o da gestora tende a ser
tablet ou notebook. Hoje a navegação é uma fileira de abas que transborda no celular, e as
tabelas (catálogo, contas, histórico de saídas, alertas, descartes) exigem rolagem horizontal.

## Escopo

- **Pontos de quebra:** celular (< 600 px), tablet (600–1024 px), desktop (> 1024 px).
  Conferir em 360, 768 e 1280 px.
- **Navegação:**
  - celular: barra inferior fixa com as telas da atendente (Venda, Consultar) e um menu
    "Mais" para o restante; para o GESTOR, o menu contém as telas de gestão;
  - tablet/desktop: barra lateral ou abas, conforme couber.
  - O distintivo de alertas não lidos (T19) continua visível em todos os tamanhos.
- **Tabelas → cartões** em tela estreita (catálogo, contas, alertas, descartes, histórico do
  dashboard), mantendo as ações de cada linha.
- **Venda e consulta** priorizadas no celular: câmera ocupando a largura, botões de ação ao
  alcance do polegar, carrinho recolhível.
- **Formulários** em uma coluna no celular; campos de data e número com o teclado certo
  (`inputMode`).
- **Etiquetas:** a folha de impressão (T15) **não muda** — `@media print` continua mandando;
  só a tela de escolha se adapta.
- Sem rolagem horizontal da página em nenhum tamanho.

## Critério de aceite

- [ ] Todas as telas utilizáveis em 360 px sem rolagem horizontal
- [ ] Navegação adaptada nos três tamanhos
- [ ] Alvos de toque ≥ 44 px
- [ ] Impressão de etiquetas idêntica à de antes (conferir o PDF gerado)
- [ ] Testes de Vitest verdes
- [ ] Conferência no navegador com o `playwright-cli` (`resize` em 360×740 e 768×1024),
      `screenshot` das telas principais — Venda, Consultar, Catálogo, Recebimento, Dashboard
- [ ] Verificação manual no celular real anotada no backlog, junto das de câmera e PWA

## Fora de escopo

- Gestos (arrastar para remover item do carrinho etc.).
- Layout paisagem específico para celular.
