# T14 — Geração de QR codes únicos por unidade (RF04)

**Depende de:** T05 (que já gera o `codigoQr` textual de cada unidade)
**Incremento:** 4 (Cadastro em lote e etiquetas)
**Bloqueia:** T15 (renderização/impressão das etiquetas), e por consequência T16 (validação
física da RNF08)

## Objetivo

Transformar o `codigoQr` que hoje só existe como texto no banco (`PRF-XXXXXX`, T05) no
**símbolo QR legível por câmera** que vai colado no frasco, e expor esse símbolo pela API no
endpoint que `docs/arquitetura.md` seção 5 já reservou: `GET /produtos/:id/unidades/etiquetas`.

Sem esta tarefa o sistema tem um identificador por unidade física que nenhuma câmera
consegue ler: T05 gera o código, T08/T10 sabem ler um código decodificado, e no meio falta
quem produza a imagem. Este é o elo.

O recorte entre esta tarefa e a seguinte: **T14 produz o símbolo e o dado da etiqueta**
(servidor); **T15 diagrama a etiqueta física** — tamanho em milímetros, folha de impressão,
o que cabe ao lado do símbolo numa embalagem pequena e irregular. Nada de layout de
impressão entra aqui.

## Critério de aceite

### Backend — módulo do símbolo

- [x] Módulo novo `src/modules/unidade/simboloQr.ts`, vizinho de `codigoQr.ts`: um é dono do
      **formato** do código, o outro do **símbolo** que o carrega. Nenhuma rota, serviço ou
      teste monta SVG de QR por conta própria
- [x] O conteúdo codificado é **o próprio `codigoQr`**, texto puro, sem URL e sem prefixo —
      ver Decisão 2
- [x] Nível de correção de erro **H** (o mais alto) e símbolo de **versão 1** (21×21
      módulos) — ver Decisão 3. O módulo falha alto (lança) se a biblioteca produzir versão
      diferente de 1: seria sinal de que o formato do `codigoQr` mudou e a etiqueta cresceu
      sem ninguém perceber
- [x] Saída é **SVG string** com `viewBox` e sem largura/altura em pixels: quem dimensiona é
      a etiqueta (T15), em milímetros. Zona de silêncio (quiet zone) de 4 módulos incluída no
      `viewBox`, como manda a especificação do QR — recortá-la é a causa clássica de etiqueta
      que não lê
- [x] Sem `id`, `class` ou `style` no SVG: ele será embutido N vezes na mesma página de
      impressão (T15) e atributos repetidos colidiriam

### Backend — `GET /produtos/:id/unidades/etiquetas`

- [x] Rota registrada em `unidade.routes.ts` (é rota de unidade sob `/produtos/:id`, como o
      cadastro em lote), com serviço próprio em `src/modules/unidade/etiqueta.service.ts`
- [x] Papel `GESTOR`, como já fixado em `docs/arquitetura.md` seção 5. Etiquetar é
      recebimento de mercadoria, não fluxo de balcão
- [x] Devolve apenas unidades `EM_ESTOQUE` do produto. Unidade `VENDIDA` ou `DESCARTADA` não
      tem frasco na prateleira para receber etiqueta
- [x] Filtro opcional `unidadeIds` (repetível na query, UUIDs): imprime exatamente as
      unidades de um recebimento recém-cadastrado, sem varrer o estoque inteiro do SKU — ver
      Decisão 4. Id que não pertence ao produto ou não está `EM_ESTOQUE` é simplesmente
      ignorado, não é erro
- [x] Ordenação por `dataValidade` crescente com desempate por `codigoQr`, a mesma da fila de
      T13: a folha impressa sai na ordem em que os frascos serão consumidos
- [x] Paginação `pagina`/`tamanhoPagina`, padrão **100** e máximo **500** — teto igual ao do
      lote de T05, para que um recebimento inteiro caiba em uma impressão. Resposta
      `{ etiquetas, total, pagina, tamanhoPagina }`
- [x] Cada item é o `UnidadeNaResposta` de `unidadeNaResposta.ts` (mesma forma do resto da
      API) acrescido de `svg: string`. A validade vai como `AAAA-MM-DD`, e quem formata para
      humanos é a tela
- [x] Produto inexistente é 404 `PRODUTO_NAO_ENCONTRADO`, reusando a recusa que
      `unidade.routes.ts` já declara
- [x] Produto **inativo entra** — mesma razão da fila de T13: inativar o SKU não devolve o
      frasco da prateleira, e reimprimir a etiqueta rasgada dele é legítimo
- [x] Produto sem unidades a etiquetar é 200 com lista vazia, nunca 404
- [x] Nenhum `EventoLog` gravado por esta rota — ver Notas técnicas
- [x] Nenhuma alteração em `codigoQr.ts`, `validarSaidaFifo`, no schema Prisma ou em
      qualquer módulo de saída

### Backend — testes (Vitest)

- [x] `backend/tests/simboloQr.test.ts`, unitário e sem banco, junto de `codigoQr.test.ts`:
  - [x] o símbolo de um código válido sai em versão 1 e nível H, com 21×21 módulos
  - [x] o SVG tem `viewBox` e não tem `width`/`height` fixos
  - [x] a zona de silêncio de 4 módulos está no `viewBox` (29 unidades de lado)
  - [x] dois códigos diferentes produzem SVGs diferentes, e o mesmo código produz sempre o
        mesmo SVG (determinismo — a etiqueta reimpressa é idêntica à original)
  - [x] um código fora do `PADRAO_CODIGO_QR` que estoure a versão 1 faz o módulo lançar,
        e não devolver um símbolo maior em silêncio
- [x] `backend/tests/etiquetas/etiquetas.test.ts`, contra PostgreSQL real, reusando
      `tests/apoio/cenario.ts` (padrão de T13):
  - [x] traz só as `EM_ESTOQUE`: vendida fora, descartada fora
  - [x] traz também unidade **vencida** que ainda está em estoque (o frasco existe e precisa
        de etiqueta; quem decide o destino dele é a seção 6.1, não a impressão)
  - [x] cada etiqueta traz o `codigoQr` da unidade e um `svg` correspondente àquele código
  - [x] ordem por validade crescente
  - [x] `unidadeIds` restringe ao subconjunto pedido; id de outro produto é ignorado sem erro
  - [x] paginação: `total` conta o conjunto inteiro e não a página
  - [x] papel: `ATENDENTE` recebe 403; sem cookie, 401
  - [x] produto inexistente 404; produto sem unidades em estoque 200 com lista vazia
  - [x] produto inativo devolve etiquetas normalmente
  - [x] ponta a ponta com T05: cadastrar um lote de 3 unidades e pedir as etiquetas devolve
        exatamente aqueles 3 códigos

### Fechamento

- [x] `npm test` e `npm run typecheck` verdes no backend; frontend intocado e ainda verde
- [x] **Sem conferência de navegador**: esta tarefa não altera nada em `frontend/src`. Pelo
      CLAUDE.md, backend se verifica por Vitest, `typecheck` e `curl` — o `playwright-cli`
      entra em T15, que é a tela
- [x] Conferência por `curl` do endpoint contra o banco de desenvolvimento, com um SVG salvo
      em arquivo e aberto para inspeção visual (é a única forma de ver que o símbolo saiu
      íntegro antes de existir tela)
- [x] `docs/decisoes.md` e `docs/notas-para-artigo.md` com as entradas do dia
- [x] `docs/arquitetura.md`: seção 5 ganha o contrato de resposta de
      `/produtos/:id/unidades/etiquetas`, e a seção 1 registra a dependência nova
- [x] `tasks/backlog.md` com T14 `concluída` e a coluna de arquivo de detalhe no incremento 4

## Estado ao fim de T14

As duas escolhas em aberto (biblioteca e nível de correção) foram **confirmadas pelo
orientando** antes da implementação, ambas na opção recomendada.

`npm test` fecha em **224 verdes no backend** (199 herdados, mais 11 do símbolo e 17 da
rota) e **68 no frontend**, que não foi tocado. `npm run typecheck` limpo.

Código novo: `modules/unidade/simboloQr.ts` e `modules/unidade/etiqueta.service.ts`, mais a
rota `GET /produtos/:id/unidades/etiquetas` em `unidade.routes.ts`. `codigoQr.ts`,
`validarSaidaFifo`, o schema e o frontend não foram tocados. `package.json` ganhou a
dependência `qrcode` (+ `@types/qrcode`) e o script `test:etiquetas`.

Conferido por `curl` contra o backend e o banco de desenvolvimento, com a gestora do seed:

- as 6 unidades em estoque do produto de T05 devolvidas em ordem de validade crescente, a
  vencida de 2020 incluída, cada uma com o seu `svg` (~900 bytes);
- `?unidadeIds=` restringindo a folha a uma unidade;
- `ATENDENTE` recusada com 403 `PAPEL_INSUFICIENTE`.

**Um achado mudou a forma de conferir o símbolo.** O plano era salvar um SVG e olhar. A
máquina não tem librsvg, e o rasterizador interno do ImageMagick desenha os módulos como
traços finos — a imagem gerada não prova nada sobre o arquivo, nem a favor nem contra. Em
vez de instalar rasterizador (o CLAUDE.md proíbe instalar por conta própria) ou de abrir o
navegador (que o CLAUDE.md reserva para mudança de UI), reconstruí a matriz de módulos a
partir dos comandos do `path` do SVG e comparei com a matriz da própria biblioteca: idênticas.
A conferência virou teste permanente — `tests/simboloQr.test.ts` agora confere os três
padrões de localização e a linha de sincronismo lidos de volta do SVG, o que é prova mais
forte do que a inspeção visual planejada. Segue valendo que nada disso prova que uma câmera
lê a etiqueta colada no frasco: isso é T16 (RNF08).

**Segundo achado, registrado e não corrigido:** `tests/descarte`, de T13, ficou fora da
lista de exclusões de `test:sem-banco`, o que faz esse script falhar em máquina sem banco. A
suíte nova entrou na lista; a de T13 continua fora, porque corrigi-la é fechar tarefa alheia.
Está no backlog, no formato do `errorHandler` de T12 que virou T12b.

## Pontos que precisavam da sua validação antes de eu codar (confirmados)

**Decisão 1 — biblioteca de geração de QR: `qrcode` (node-qrcode) no backend.**
Escrever um codificador QR à mão está fora de questão (Reed–Solomon, máscaras, tabelas de
versão — é semanas de trabalho para reimplementar uma norma ISO). A escolha é entre
bibliotecas, e proponho `qrcode` + `@types/qrcode`: é a implementação mais usada do
ecossistema Node, gera SVG sem depender de canvas, e expõe metadados do símbolo (versão,
nível de correção, matriz de módulos) — que é o que permite os testes acima serem sobre o
símbolo e não sobre uma string opaca. Custo: mais uma dependência de produção no backend,
onde hoje só há Fastify, Prisma, JWT e bcrypt.

Alternativa se você preferir superfície menor: `qrcode-generator`, minúscula e sem
dependências, mas devolve a matriz crua — eu escreveria o SVG à mão e perderia os metadados
que os testes usam. Prefiro a primeira; a segunda é defensável se a banca valorizar
enxutez de dependências.

**Decisão 2 — o QR carrega o código puro (`PRF-XXXXXX`), não uma URL.**
A alternativa comum seria codificar algo como `https://loja.exemplo/u/PRF-XXXXXX`, que
abriria o sistema ao ser lido por qualquer app de câmera. Não quero, por três razões: (i)
amarraria cada etiqueta física a um domínio de implantação que este TCC não tem, e trocar o
domínio inutilizaria etiquetas já coladas em frascos; (ii) a URL tem ~35 caracteres contra
10, o que empurra o símbolo de versão 1 para versão 3+ — mais módulos no mesmo espaço de
etiqueta, exatamente o oposto do que a RNF08 pede em embalagem pequena e curva; (iii) o
leitor do sistema (T10) já envia o texto decodificado ao `/saidas/ler`, e o fallback manual
digita esse mesmo texto — código puro mantém as duas entradas idênticas.

**Decisão 3 — nível de correção H, e o símbolo cabe em versão 1 (21×21).**
A capacidade de um QR versão 1 nível H em modo alfanumérico é de **exatamente 10
caracteres**, e `PRF-` + 6 caracteres são exatamente 10 — o hífen e o alfabeto Crockford
maiúsculo estão todos no conjunto alfanumérico do QR. Ou seja: dá para usar a correção de
erro **mais alta que a norma oferece** (recupera ~30% do símbolo danificado) sem pagar um
único módulo a mais de tamanho. Para etiqueta em frasco curvo, plástico brilhante e sujeita
a atrito, isso é o melhor negócio possível — e é uma validação do formato que T05 escolheu
por outro motivo (legibilidade na digitação manual).

O que peço que você veja escrito: isso torna o formato do `codigoQr` **mais caro de mudar**
do que T05 previu. Um sétimo caractere derruba o símbolo para versão 2 em H. A margem
some, e a RNF08 (T16) ainda pode pedir mudança de formato. Aceito e registro; se preferir
margem, o caminho é nível Q, que aceita 16 caracteres em versão 1 e deixa espaço para
crescer, ao custo de menos tolerância a dano físico. Recomendo H.

**Decisão 4 — o filtro é `unidadeIds`, e não "lote" ou data de recebimento.**
Não existe entidade `Lote` no modelo (decisão de T05: o recebimento é reconstruído pelos
eventos `UNIDADE_CADASTRADA`), então "imprimir as etiquetas do que acabou de chegar" só tem
uma expressão honesta: a tela de recebimento já recebe as unidades criadas na resposta do
`POST`, e devolve esses ids. Sem o filtro, a única opção seria imprimir todas as unidades
em estoque do SKU — e reimprimir etiqueta de frasco que já está etiquetado é como se
duplicam identificadores no mundo físico.

**Decisão 5 — imprimir etiqueta não grava evento.**
Sigo o que T13 estabeleceu para a fila: consultar não é ato operacional. Vale registrar a
contrapartida honesta: uma **reimpressão** é interessante para a pesquisa, porque quase
sempre significa etiqueta que não leu ou se soltou — que é o fenômeno da RNF08. Se você
quiser medir isso, é evento em rota própria e tarefa própria, não um `GET` que grava. Vou
registrar a limitação em `docs/notas-para-artigo.md`.

## Notas técnicas

- **O símbolo não é verificado por decodificação nos testes automatizados.** Os testes
  provam versão, nível, contagem de módulos e determinismo — não que uma câmera lê. Uma
  decodificação real exigiria rasterizar o SVG e rodar um decodificador, e ainda assim
  provaria só o caminho digital. A prova que importa é física e já está no backlog: T16
  (RNF08) e o teste de câmera em celular real listado nas verificações do orientando.
- **`test:sem-banco`.** A suíte nova de banco (`tests/etiquetas`) entra na lista de exclusões
  do script. Notei que `tests/descarte`, de T13, ficou fora dessa lista — é um deslize de uma
  linha, e **não** vou corrigir junto sem você mandar: mistura tarefas, e o precedente aqui é
  T12b (achado vira tarefa própria).
- **Por que o endpoint é por produto, e não global.** É o contrato que a arquitetura já
  fixou, e casa com o fluxo real: quem etiqueta acabou de receber caixas de um SKU. Uma
  varredura "todas as unidades sem etiqueta do estoque" não é expressável — o sistema não
  sabe o que já foi impresso, e a Decisão 5 é justamente não passar a saber.
- **O SVG vai na resposta JSON, não como imagem separada.** Uma alternativa seria
  `GET /unidades/:id/qr.svg`, uma requisição por etiqueta; para um recebimento de 50
  unidades seriam 50 requisições para montar uma folha. Aqui a folha inteira vem numa
  resposta só, que é o que T15 precisa para imprimir de uma vez.
- **Tamanho da resposta.** Um QR 21×21 em SVG de caminhos fica na casa de 1–2 KB; 500
  etiquetas ficam abaixo de 1 MB. Aceitável para uma requisição de gestão feita no
  computador da loja, e é por isso que o teto de página é 500 e não ilimitado.

## Fora de escopo desta tarefa

- **Toda a renderização física da etiqueta** — dimensões em milímetros, folha A4, margens,
  o que aparece impresso ao lado do símbolo, CSS de impressão, prévia na tela. É T15
  inteira, e é onde a RNF08 realmente se decide.
- **Qualquer tela.** `frontend/src` não é tocado nesta tarefa; o botão "imprimir etiquetas"
  na tela de recebimento é T15.
- **Mudança no formato do `codigoQr`** (`codigoQr.ts` continua como está). Se a validação
  física de T16 pedir outro formato, a mudança acontece lá, com esta tarefa já provando que
  o formato atual cabe em versão 1 nível H.
- **Reimpressão rastreada, contador de etiquetas impressas, evento de impressão** —
  Decisão 5.
- **Etiqueta com preço, nome longo do produto ou código de barras EAN** — o PRD não pede, e
  cada elemento a mais disputa espaço com o símbolo numa embalagem pequena.
- **Impressora de etiquetas dedicada (Zebra/Brother, ZPL/EPL)** — a loja imprime em
  impressora comum, e o PRD não menciona hardware dedicado.
