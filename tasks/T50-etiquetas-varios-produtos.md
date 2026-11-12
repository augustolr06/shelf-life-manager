# T50 — Etiquetas de vários produtos num só PDF

**Depende de:** T15 (tela de etiquetas), T14 (símbolo QR e rota de etiquetas)
**Incremento:** 14 (Etiquetas de vários produtos)
**Bloqueia:** nada

## Objetivo

A tela **Etiquetas** (`/etiquetas`, T15) gera a folha de **um produto por vez**. Três situações
reais pedem mais que isso:

- a **entrega mista**, com vários SKUs chegando juntos;
- a **etiquetagem do estoque que já existe**, na implantação do sistema ou numa reetiquetagem;
- a **reimpressão avulsa** de etiquetas soltas de produtos diferentes.

Pedido do orientando (2026-11-12): a gestora escolhe vários produtos, ou "todos", manda gerar e
recebe **um PDF** com um cabeçalho por produto.

## Escopo

### Backend

1. `POST /unidades/etiquetas` (GESTOR). O corpo é `{ produtoIds: uuid[] }` (de 1 a 1000) **ou**
   `{ todos: true }`, mais `pagina` e `tamanhoPagina` (padrão 100, teto 500, como a rota GET).
2. A resposta é a mesma `FolhaDeEtiquetas` da rota GET de T14. Cada etiqueta já traz o produto
   (`UnidadeNaResposta`), e é dele que o frontend tira o agrupamento.
3. Só entram unidades `EM_ESTOQUE`. Produto inativo também entra, pelo mesmo motivo da rota GET,
   e id inexistente é ignorado.
4. A ordem é marca, nome, id do produto, validade e `codigoQr`. Os grupos ficam contíguos e a
   paginação é estável.
5. A rota `GET /produtos/:id/unidades/etiquetas` não muda.

### Frontend (só a tela de Etiquetas)

6. **Escolha dos produtos.** O `SeletorProduto` acrescenta cada produto escolhido a uma lista de
   chips removíveis, sem repetir nenhum. A caixa "Todos os produtos com estoque" substitui a
   lista. Nada é carregado antes do pedido explícito (Decisão 1 de T15).
7. **Caminho do recebimento.** O estado de rota com `unidadeIds` continua funcionando. O lote
   vem pela rota GET já existente, e a saída é o mesmo PDF.
8. **Botão "Gerar PDF".** Busca todas as páginas em sequência e mostra o progresso. Depois agrupa
   por produto e monta o PDF **no navegador** (`jspdf` + `svg2pdf.js`, carregados por `import()`
   dinâmico), que é baixado.
9. **O que vai no PDF:**
   - A4 retrato, um cabeçalho por produto ("Marca — Nome · código · N etiquetas"), repetido com
     "(continuação)" quando o grupo atravessa a página e nunca sozinho no pé da página;
   - a etiqueta igual à de T15 (símbolo, código, "Val DD/MM/AAAA" e guia de corte);
   - um rodapé por página com o tamanho do símbolo e a numeração.
10. **Tamanho do símbolo.** O seletor de 15/20/25 mm continua.
11. **Depois de gerar:**
    - o resumo por produto;
    - o aviso dos produtos escolhidos que não tinham estoque;
    - a orientação de imprimir em tamanho real (100%).
12. **O que sai da tela:** a folha HTML, a paginação, o `window.print()` e o `@media print` das
    etiquetas.

## Decisões tomadas nesta tarefa (confirmadas pelo orientando)

- **Nada de fila de impressão ou de coluna de "etiqueta impressa".** O Recebimento continua
  igual, e a gestora pode imprimir depois, pela tela de Etiquetas. A Decisão 5 de T14
  (imprimir não grava evento) continua valendo.
- **A granularidade é o produto inteiro.** Escolher um produto traz todas as unidades em estoque
  dele.
- **Os grupos são separados por cabeçalho de produto, fora da etiqueta.** A Decisão 3 de T15 se
  mantém.
- **O PDF é gerado no navegador.** Isso inverte a Decisão 2 de T15.
- **"Todos" quer dizer os produtos com estoque, em ordem de marca e nome.**

## Decisões técnicas (minhas, registradas em `docs/decisoes.md`)

- **POST para uma leitura.** 700 UUIDs na query string dariam cerca de 25 KB.
- **A rota nova é paginada e o frontend junta as páginas.** A Vercel limita a resposta a
  ~4,5 MB, e "todos" pode passar de 3 mil etiquetas.
- **A folha HTML e o `@media print` saem da tela.** Com o PDF, seriam um segundo mecanismo de
  saída.

## Critério de aceite

- [ ] Testes de backend da rota nova:
      - ordem marca → nome → validade;
      - `todos` só com `EM_ESTOQUE`;
      - inativo entra e id inexistente é ignorado;
      - paginação estável;
      - 400 (corpo vazio, os dois campos juntos, UUID inválido), 403 e 401.
- [ ] Testes de Vitest das funções puras do PDF:
      - agrupamento;
      - colunas por tamanho;
      - quebra de página;
      - "(continuação)";
      - cabeçalho nunca sozinho no pé;
      - rodapé.
- [ ] Testes de Vitest da tela:
      - nada carrega antes do pedido;
      - chips sem duplicar;
      - "todos";
      - várias páginas;
      - o gerador recebe os grupos e o tamanho;
      - produto sem estoque;
      - erro do servidor;
      - caminho do recebimento.
- [ ] `npm test` e `npm run typecheck` verdes nos dois projetos
- [ ] `curl` na rota nova e `playwright-cli` na tela, com o PDF baixado conferido por
      `pdftotext`/`pdftoppm`
- [ ] `docs/arquitetura.md`, `docs/decisoes.md` e `docs/notas-para-artigo.md`

## Fora de escopo

- Qualquer mudança no Recebimento, no schema ou no `EventoLog`.
- Escolher unidades individuais dentro de um produto.
- Impressora de etiquetas dedicada ou folha adesiva pré-cortada (o mesmo fora de escopo de T15).
- Nome do produto dentro da etiqueta.
