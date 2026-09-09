# T15 — Renderização e impressão de etiquetas para embalagens pequenas (RF04)

**Depende de:** T14 (o símbolo e o endpoint `GET /produtos/:id/unidades/etiquetas`), e na
prática de T05, que é de onde saem os ids do recebimento recém-cadastrado
**Incremento:** 4 (Cadastro em lote e etiquetas)
**Bloqueia:** T16 (validação física de legibilidade em loja — RNF08)

## Objetivo

Transformar o dado de etiqueta que T14 entrega pela API no **papel que a gestora recorta e
cola no frasco**.

Hoje o sistema tem o símbolo (T14) e não tem como imprimi-lo: a tela de recebimento termina
mostrando uma tabela de códigos com o aviso "a impressão de etiquetas entra em uma etapa
seguinte do projeto" — esta etapa. Sem ela, o `codigoQr` existe no banco e na tela, mas não
existe no frasco, e todo o fluxo de leitura de QR (T08, T10) fica sem entrada física.

Esta tarefa é onde a **RNF08 realmente se decide**: tamanho do símbolo em milímetros, o que
ocupa espaço ao lado dele, e quanto de embalagem pequena e curva a etiqueta exige. T14
deixou isso explicitamente em aberto — o SVG sai sem largura e sem altura justamente para
que o tamanho físico fosse decidido aqui.

O recorte com T16: **T15 produz a folha imprimível e a torna testável em vários tamanhos;
T16 é o ato de imprimir, colar em frasco real e conferir sob a luz da loja.** Nenhuma
conclusão sobre legibilidade física é tirada aqui — o que se entrega é o instrumento.

## Critério de aceite

### Frontend — serviço

- [x] `services/etiquetas.ts`, espelho de `GET /produtos/:id/unidades/etiquetas`, no mesmo
      estilo de `descartes.ts`. O tipo `Etiqueta` estende o `UnidadeLida` já existente
      (mesma `UnidadeNaResposta` do backend) com `svg: string` — não redeclara a forma da
      unidade
- [x] Aceita `unidadeIds`, `pagina` e `tamanhoPagina`, montando a query com `unidadeIds`
      repetível, exatamente como o schema da rota espera

### Frontend — tela

- [x] `pages/TelaEtiquetas.tsx`, rota `/etiquetas`, registrada em `App.tsx` na lista `TELAS`
      com `papeis: ['GESTOR']` — mesma lista de papéis da rota do backend
- [x] Dois caminhos de entrada na mesma tela (ver Decisão 1):
  - [x] **recém-recebido**: `TelaRecebimento` ganha um botão "Imprimir etiquetas destas
        unidades" no bloco de resultado, que navega para `/etiquetas` levando o produto e os
        ids das unidades cadastradas
  - [x] **reimpressão**: sem essa entrada, a tela mostra o seletor de produto (mesmo padrão
        de busca de `TelaRecebimento`) e carrega as etiquetas do estoque daquele SKU só
        quando a gestora pedir explicitamente
- [x] A folha renderiza cada etiqueta com: o símbolo QR, o `codigoQr` em texto e a validade
      formatada `DD/MM/AAAA` — nada além disso (ver Decisão 3)
- [x] Seletor de **tamanho do símbolo** com três opções em milímetros, aplicado à folha
      inteira (ver Decisão 4). A escolha aparece impressa em letra miúda no rodapé da folha,
      para que T16 saiba qual tamanho foi aprovado ou reprovado
- [x] Botão "Imprimir" que chama `window.print()`. Nenhuma geração de PDF, nenhuma
      dependência nova (ver Decisão 2)
- [x] `@media print` em `estilos.css`: some com barra de topo, abas, seletores e botões;
      sobra a folha. Fundo branco, sem sombra, sem cor de fundo de cartão — tinta gasta em
      fundo não ajuda a câmera
- [x] Cada etiqueta é indivisível na quebra de página (`break-inside: avoid`), e a grade se
      organiza por largura de etiqueta, não por número fixo de colunas: mudar o tamanho em
      milímetros muda quantas cabem por linha, sem recalcular nada na tela
- [x] Guia de corte discreta em volta de cada etiqueta (borda fina cinza), já que a loja
      imprime em papel comum e recorta — não há impressora de etiquetas dedicada
- [x] A tela imprime **a página carregada**, e diz isso: com paginação visível
      (`pagina`/`total`, padrão 100 do backend), o cabeçalho informa "imprimindo N de T
      etiquetas — página X". Nenhuma tentativa de concatenar páginas em uma folha só
- [x] Estado vazio explícito ("Nenhuma unidade em estoque para etiquetar neste produto") e
      estado de erro exibindo a `mensagem` do servidor (RNF04)
- [x] Nenhuma geração de QR, nenhum cálculo de validade e nenhuma ordenação no frontend: a
      ordem, o símbolo e a data vêm prontos do backend

### Frontend — testes (Vitest + Testing Library)

- [x] `pages/TelaEtiquetas.test.tsx`:
  - [x] renderiza uma etiqueta por unidade da resposta falsa, com código e validade
        formatada
  - [x] o `svg` que veio do servidor é inserido no documento (o elemento `<svg>` existe
        dentro da etiqueta)
  - [x] o caminho "recém-recebido" chama a API com os `unidadeIds` recebidos, e nada mais
  - [x] o caminho "reimpressão" não busca nada até a gestora escolher o produto e pedir
  - [x] trocar o tamanho muda o valor aplicado à folha (a asserção é sobre o atributo/estilo
        que carrega o milímetro, não sobre pixels renderizados — jsdom não faz layout)
  - [x] o botão "Imprimir" chama `window.print` (mockado)
  - [x] estado vazio e estado de erro com a mensagem do servidor
  - [x] paginação: segunda página refaz a busca com `pagina: 2`
- [x] Os testes existentes de `TelaRecebimento` ganham um roteador em volta (a tela passou a
      usar `useNavigate`) e nada mais; o acréscimo é um botão novo, com teste próprio de que
      ele navega levando produto e ids

### Backend

- [x] **Nenhuma alteração.** T14 entregou o endpoint completo; esta tarefa é consumidora.
      Se aparecer necessidade de mudar o contrato, isso é achado registrado, não emenda
      (precedente T12b/T14b)

### Fechamento

- [x] `npm test` e `npm run typecheck` verdes nos dois projetos
- [x] Conferência no navegador com `playwright-cli` conforme CLAUDE.md, restrita a esta
      tela: recebimento → botão → folha carregada do banco de desenvolvimento; troca de
      tamanho; `screenshot` da folha; `console error` limpo
- [x] Conferência da folha **em modo de impressão**, não só em tela: `playwright-cli` com
      emulação de mídia `print` (ou a prévia do próprio navegador), para provar que o
      `@media print` some com a navegação e a etiqueta não quebra ao meio
- [x] `docs/decisoes.md` e `docs/notas-para-artigo.md` com as entradas do dia
- [x] `docs/arquitetura.md`: a seção 5 já descreve o endpoint; o que entra é a nota de que
      o dimensionamento físico da etiqueta passou a existir e onde ele mora
- [x] `tasks/backlog.md` com T15 `concluída`, a coluna de arquivo de detalhe preenchida, e a
      linha da verificação manual de T16 atualizada — a partir daqui ela deixa de depender de
      código e vira só ato físico

## Estado ao fim de T15

As cinco decisões abaixo foram **confirmadas pelo orientando** antes da implementação, todas
na opção recomendada.

`npm test` fecha em **78 verdes no frontend** (68 herdados, mais 9 da tela nova e 1 do botão
do recebimento) e **227 no backend**, que não foi tocado. `npm run typecheck` limpo nos dois
projetos.

Código novo: `services/etiquetas.ts` e `pages/TelaEtiquetas.tsx`. `App.tsx` ganhou a rota
`/etiquetas` restrita a GESTOR; `TelaRecebimento` ganhou o botão de impressão e passou a usar
`useNavigate` (por isso os testes dela agora renderizam dentro de um `MemoryRouter` — é a
única edição em teste herdado, e nenhuma asserção mudou); `estilos.css` ganhou a folha e o
primeiro bloco `@media print` do projeto. O backend, o `simboloQr.ts` e o formato do
`codigoQr` não foram tocados.

Conferido no navegador com `playwright-cli` (método do CLAUDE.md para UI), contra o backend e
o banco de desenvolvimento, em 1280×900 — é a tela do computador da loja, não o celular do
balcão:

- recebimento de 3 unidades de PRF-001 → botão → folha com **exatamente aquelas 3**, e não
  as 4 que o SKU tem em estoque: a prova de que o filtro `unidadeIds` de T14 chegou íntegro
  à tela;
- o símbolo medido no DOM em **20,0 mm** exatos no padrão, **15,0 mm** ao trocar a opção, com
  o rodapé acompanhando;
- a folha impressa conferida em mídia `print` de verdade (`playwright-cli pdf`, que aplica o
  `@media print`): 1 página, e o texto extraído contém **só** os três códigos, as três
  validades e o rodapé — nem barra de topo, nem abas, nem seletor, nem botão;
- rasterizada, a folha mostra os três símbolos distintos, a guia de corte tracejada e o
  rodapé com o tamanho;
- caminho de reimpressão: entrando pela aba, nada é carregado até escolher o produto e pedir;
- `console error` limpo.

**Um achado corrigiu a Decisão 1 pela metade, e a favor dela.** Eu havia escrito, no código e
neste arquivo, que recarregar a tela perderia o lote. É falso: o React Router guarda o estado
no History API, e o F5 no mesmo navegador **mantém** as unidades — conferido no navegador. O
que de fato não sobrevive é levar o endereço para outra aba ou outro aparelho, e é lá que a
tela cai no seletor. O comportamento desejado (não recarregar sozinha o estoque inteiro do
SKU) continua valendo; o que estava errado era a justificativa. Comentários corrigidos em
`TelaEtiquetas.tsx` e `TelaRecebimento.tsx`.

## Pontos que precisavam da sua validação antes de eu codar (confirmados)

**Decisão 1 — uma tela `/etiquetas`, alcançada por dois caminhos, e o hand-off do
recebimento vai por estado de rota (não pela URL).** *(Confirmada. Ver a correção sobre o
recarregamento no "Estado ao fim de T15".)*
A folha precisa existir nos dois momentos: logo após cadastrar o lote (imprimir o que
acabou de chegar) e meses depois (reimprimir a etiqueta que se soltou). Uma tela só,
com o filtro `unidadeIds` que T14 construiu exatamente para o primeiro caso.

O hand-off dos ids tem duas formas possíveis. Na URL (`?unidadeIds=a&unidadeIds=b`) ela
fica recarregável e compartilhável, mas 500 UUIDs são ~18 KB de query string — grande
demais para um endereço. Por estado de rota do `react-router` é limpo, e o custo é que
recarregar a página perde a lista. Proponho estado de rota, e que recarregar **não**
carregue nada sozinho: a tela cai no seletor de produto e espera um pedido explícito.
Isso é de propósito — carregar sozinho o estoque inteiro do SKU depois de um F5 faria a
gestora imprimir segunda etiqueta para frascos já etiquetados, que é como se duplicam
identificadores no mundo físico (a preocupação que a Decisão 4 de T14 já registrou).

**Decisão 2 — impressão pelo `window.print()` do navegador + CSS `@media print`, sem PDF.**
*(Confirmada.)*
A alternativa seria gerar PDF (no servidor com uma biblioteca, ou no cliente com
`jsPDF`/`pdfmake`). Não proponho: é dependência nova de peso para resolver um problema que
o navegador já resolve, o diálogo de impressão do sistema já é o que a loja usa, e o PDF
me obrigaria a decidir por conta própria margens de página e driver de impressora. O custo
honesto do caminho escolhido: a fidelidade depende do navegador e das margens configuradas
no diálogo — dois navegadores podem imprimir o mesmo milímetro com meio ponto de diferença.
Como a RNF08 exige validação física de qualquer jeito (T16), essa variação vai ser medida
com régua no papel, e não presumida a partir do código. Registro isso como limitação.

**Decisão 3 — na etiqueta vão símbolo, código e validade. Não vai o nome do produto.**
*(Confirmada.)*
- o **símbolo** é o que a câmera lê (T10);
- o **código em texto** é o que a atendente digita quando a câmera falha — o fallback
  manual de T10 existe e fica inútil se o texto não estiver no frasco;
- a **validade** é o que um humano precisa ver na prateleira sem escanear nada, e é o dado
  em torno do qual o sistema inteiro gira.

Fica de fora o nome do produto: ele já está impresso no próprio frasco pelo fabricante, e
cada elemento a mais disputa espaço com o símbolo numa embalagem pequena — que é
literalmente o que a RF04 pede ("compatível com colagem em embalagens pequenas e
irregulares"). Se você quiser o nome, ele cabe, mas ao custo de reduzir o símbolo ou
aumentar a etiqueta; prefiro que essa troca seja sua e não minha.

**Decisão 4 — o tamanho do símbolo é escolhido na tela, entre três opções, e não fixado
por mim no código.** *(Confirmada.)*
Proponho 15 mm, 20 mm (padrão) e 25 mm de lado do símbolo. Com os 29 módulos do `viewBox`
de T14 (21 do símbolo + 4+4 de zona de silêncio), isso dá módulos de ~0,52 mm, ~0,69 mm e
~0,86 mm. A referência prática para leitura por câmera de celular fica em torno de 0,5 mm
por módulo em impressora comum, então 15 mm é o limite inferior plausível e 25 mm é o
tamanho confortável que talvez não caiba num frasco pequeno.

O motivo de ser seletor e não constante: **a RNF08 manda validar fisicamente antes de
congelar o formato da etiqueta**, e T16 é exatamente esse teste. Um valor fixo no código
obrigaria a editar e reimplantar o frontend a cada tentativa; três opções deixam a folha de
teste sair pronta. Se depois de T16 você quiser fixar o vencedor e remover o seletor, é uma
linha — e aí sim com dado físico por trás.

**Decisão 5 — o SVG do servidor é injetado com `dangerouslySetInnerHTML`.** *(Confirmada.)*
A resposta traz o SVG como string, e ele precisa virar elemento no DOM. As opções são
injetar direto ou embrulhar num `<img src="data:image/svg+xml,...">`. Proponho injetar: o
SVG é produzido por um módulo nosso (`simboloQr.ts`) a partir de um código que casa com
`PADRAO_CODIGO_QR`, não tem script, atributo de evento, `id`, `class` nem `style` (T14
garantiu isso no critério de aceite), e é o mesmo elemento que precisa herdar o tamanho em
milímetros do container. Pelo `data:` URI o conteúdo ficaria isolado do documento, o que é
mais defensivo, mas passa a ser uma imagem externa que algumas configurações de impressão
tratam diferente do resto da página. Se você preferir a versão defensiva, eu troco — é
localizado, e vale você ver escrito que estou usando a API com "dangerously" no nome de
propósito, e por quê.

## Notas técnicas

- **jsdom não faz layout.** Nenhum teste de Vitest pode provar que a etiqueta tem 20 mm nem
  que oito cabem numa linha. Os testes provam o que é verificável em unidade — que o
  tamanho escolhido chega ao DOM, que o SVG está lá, que a chamada leva os ids certos. A
  aparência é conferida no navegador (`playwright-cli`, como manda o CLAUDE.md) e a
  legibilidade real é T16. É a mesma fronteira que T14 já declarou entre "o símbolo está
  correto" e "a câmera lê".
- **A ordem da folha é a do FIFO.** O backend já devolve por validade crescente; a folha
  sai na ordem em que os frascos serão consumidos, e isso importa na prática: quem cola as
  etiquetas está com as caixas abertas na bancada, e etiquetar em ordem de validade reduz a
  chance de colar no frasco errado. Não reordenar na tela.
- **Impressão da página carregada, não do conjunto inteiro.** O teto de 500 do backend é por
  requisição; a tela usa a paginação normal e imprime o que está carregado. Concatenar
  páginas exigiria acumular estado de várias requisições para um botão de impressão, e o
  ganho — não apertar "próxima página" — não paga a confusão de imprimir algo que não está
  na tela.
- **Reimprimir continua invisível para o sistema.** Decisão 5 de T14 (imprimir não grava
  evento) permanece, e esta tela não a reabre. A consequência já está declarada como
  limitação em `docs/notas-para-artigo.md`.
- **Etiqueta em papel comum, recortada à mão.** É o que a loja tem. A guia de corte e a
  folha em grade existem por isso; nada aqui pressupõe papel adesivo pré-cortado, e adotar
  um formato de folha adesiva específica (Pimaco et al.) amarraria o projeto a um produto de
  papelaria que o PRD não menciona.

## Fora de escopo desta tarefa

- **Qualquer alteração no backend**, no `simboloQr.ts`, no formato do `codigoQr` ou no
  schema. Se T16 reprovar o símbolo, a mudança acontece lá.
- **A validação física em si** (colar em frasco curvo, ler sob a luz da loja) — é T16
  inteira, e é ela que fecha a RNF08.
- **Geração de PDF, impressora de etiquetas dedicada (Zebra/Brother, ZPL/EPL) e formatos de
  folha adesiva de papelaria** — Decisão 2 e Notas técnicas.
- **Etiqueta com preço, código de barras EAN ou nome do produto** — Decisão 3 e o mesmo
  fora-de-escopo que T14 já declarou.
- **Registrar que uma etiqueta foi impressa ou reimpressa** — Decisão 5 de T14, limitação já
  declarada.
- **Impressão a partir da fila de descarte (T13) ou do catálogo (T04)** — a etiqueta serve
  ao frasco que acabou de chegar; entrar por outras telas é superfície nova sem caso de uso
  correspondente no PRD.
- **Imprimir várias páginas de uma vez, ou "imprimir tudo do estoque"** — Notas técnicas.
