# T08 — Endpoint de leitura de QR + laço de revalidação

**Depende de:** T07
**Incremento:** 2 (Núcleo: saída com validação FIFO + EventoLog)
**Bloqueia:** T09, T10, T11

## Objetivo

Expor `validarSaidaFifo` pela API: `POST /saidas/ler` recebe um código lido no balcão,
abre a transação exigida pela RNF02, chama a função e devolve o veredito serializado
(RF05, RF06).

É a primeira vez que o núcleo do sistema fica alcançável de fora do backend. A tarefa
tem, portanto, duas metades: a rota em si, e a demonstração de que o **laço de
revalidação** do RF06 funciona pela API — ler a unidade errada, receber o bloqueio, ler
de novo, até confirmar — sem que o servidor guarde nada entre uma leitura e outra
(PRD 6.2).

Nada de lógica de FIFO nova: a rota não decide, não reordena, não interpreta. Ela
traduz `Veredito` em JSON (RNF03, RNF04).

## Critério de aceite

### A rota

- [x] `POST /saidas/ler`, papéis `ATENDENTE` e `GESTOR` (`docs/arquitetura.md` seção 5)
- [x] Corpo `{ codigoQr: string }`, `additionalProperties: false` — o cliente não propõe
      `usuarioId` nem nada mais; o usuário vem da sessão, como em T05
- [x] A transação é aberta **aqui** (`prisma.$transaction`), e `validarSaidaFifo` recebe
      o `tx`. A função continua sem abrir transação própria
- [x] Nenhum arquivo de `src/modules/saida/validarSaidaFifo.ts` é editado nesta tarefa,
      e o tipo `Veredito` não muda — ele é o contrato que T10 e T11 vão consumir

### O contrato de resposta

- [x] **Toda leitura processada responde 200**, qualquer que seja o veredito — inclusive
      `QR_NAO_ENCONTRADO` e `BLOQUEAR_FIFO`. Ver "Decisão 1" abaixo
- [x] O corpo é o veredito serializado, discriminado por `veredito`:
      `ERRO` (com `motivo`), `EXCECAO_VENCIDO`, `BLOQUEAR_FIFO` (com `unidadeLida`,
      `unidadeCorreta` e `tentativas`), `CONFIRMAR`
- [x] Toda unidade na resposta vem com o produto embutido (`nome`, `marca`,
      `codigoInterno`), buscado **fora** da transação. Ver "Decisão 3"
- [x] Cada veredito carrega uma `mensagem` pronta para exibição, escrita no servidor.
      O frontend não monta texto a partir do código do veredito (RNF04)
- [x] `dataValidade` sai como texto `AAAA-MM-DD`, nunca instante ISO — mesma regra já
      adotada no `payload` do EventoLog em T07 (RNF01)
- [x] Fora de 200 ficam apenas as situações que não são leitura: 400 (corpo malformado),
      401 (sem sessão), 403 (papel), 500 (falha inesperada)

### Entrada manual (fallback do RF05)

- [x] O código recebido é normalizado antes da consulta: maiúsculas, espaços aparados, e
      as confusões que o alfabeto Crockford prevê (`I`/`L` → `1`, `O` → `0`)
- [x] A normalização vive em `src/modules/unidade/codigoQr.ts`, junto do gerador — o
      formato é provisório até a RNF08 (T16) e continua tendo um único dono
- [x] Código que não bate com `PADRAO_CODIGO_QR` **não** é recusado pelo JSON Schema:
      ele segue para a função e volta como `QR_NAO_ENCONTRADO`, com evento
      `LEITURA_QR_SAIDA` gravado. Recusar antes apagaria do log a leitura de uma
      etiqueta danificada, que é dado da pesquisa (RF12)

### O laço (RF06)

Provado por teste, não por código novo — o laço é a ausência de estado:

- [x] Ler a unidade errada, depois a certa, pela API: a primeira devolve `BLOQUEAR_FIFO`
      com `tentativas: 1`, a segunda devolve `CONFIRMAR`
- [x] Bloqueios sucessivos incrementam `tentativas` entre requisições distintas
- [x] A `Saida` criada na confirmação registra `tentativasAteAcerto` com o total do ciclo
      e `alertaFifoDisparado = true`
- [x] Ciclo abandonado (bloqueia e nunca confirma) não deixa nada para limpar: nenhuma
      linha de reserva, nenhum contador em `UnidadeProduto` (PRD 6.2)
- [x] Reler uma unidade já confirmada devolve `UNIDADE_JA_BAIXADA`

### Testes

- [x] Suíte nova em `backend/tests/saida/lerQr.test.ts`, contra PostgreSQL real — mesma
      razão de T06/T07: o lock e a comparação de `DATE` não existem fora do banco
- [x] Cobre: os quatro vereditos pela API, o laço acima, 401 sem cookie, 400 com corpo
      sem código, atribuição da leitura ao usuário da sessão, e normalização de código
      digitado em minúsculas
- [x] `npm run test:sem-banco` passa a excluir também `tests/saida/**`
- [x] `npm test` verde, `npm run typecheck` limpo nos dois projetos

## Pontos que precisam da sua validação antes de eu codar

**Decisão 1 — 200 para todo veredito, inclusive bloqueio e QR desconhecido.**
A alternativa seria mapear vereditos em status HTTP (404 para QR desconhecido, 409 para
bloqueio FIFO). Estou propondo não fazer isso: o bloqueio FIFO não é erro, é o
funcionamento normal e o objeto do trabalho; e se o veredito vier codificado no status, o
frontend passa a decidir a tela lendo o status em vez de ler o veredito — que é
exatamente a porta que a RNF04 fecha. Com 200 uniforme, existe um único campo a
interpretar, e ele vem do servidor.

**Decisão 2 — `POST /saidas/ler` já efetiva a baixa.**
Isto não é escolha minha, é consequência da seção 4 da arquitetura: o ramo 5 de
`validarSaidaFifo` cria a `Saida` e muda o status para `VENDIDA` dentro da mesma
transação. Logo, quando `/saidas/ler` responde `CONFIRMAR`, a venda **já aconteceu** — a
resposta é aviso de fato consumado, não convite a confirmar.

Isso deixa `POST /saidas/confirmar` (T09, RF07) sem baixa para executar. É uma tensão
real entre a seção 4 e a seção 5 do mesmo documento, e ela precisa ser resolvida — mas em
T09, que é a tarefa dona daquele endpoint, e não aqui. Em T08 eu só registro a tensão em
`docs/decisoes.md`. Se você preferir resolver antes, o caminho seria separar decisão de
efeito na função — o que reabre T07 e a suíte de T06, e por isso não faço por conta
própria.

**Decisão 3 — a resposta é enriquecida na rota, depois do commit.** *(revisada)*

O `Veredito` carrega um `UnidadeProduto` sem a relação `Produto`, e o ramo `BLOQUEAR_FIFO`
carrega só a unidade **correta** — não a que a atendente acabou de ler. Uma tela que diz
"guarde este e pegue o PRF-K3M9QT", sem nome de perfume e sem a validade do frasco que
está na mão, é pobre demais para o balcão.

A resposta é montada com duas consultas extras, **fora da transação**, depois do commit:
a unidade lida (por `codigoQr`) e o produto (por chave primária — é o mesmo SKU nos dois
lados do bloqueio, então uma consulta serve para as duas unidades). Isso não toca em
`validarSaidaFifo`, não muda o tipo `Veredito` e não alonga o lock. O custo fica fora do
caminho crítico e folgado dentro dos 500ms da RNF06.

A alternativa descartada era carregar o produto dentro do próprio `Veredito`, o que
reabriria T07 e mudaria o contrato que T10 e T11 consomem.

## Estado ao fim de T08

`npm test` fecha em **133 verdes** (112 de T03–T07 + 17 do endpoint + 4 de normalização),
`npm run test:sem-banco` em 70 sem container, `npm run test:fifo` nos mesmos **46 de T06,
sem uma linha editada**, e `npm run typecheck` limpo nos dois projetos.
`src/modules/saida/validarSaidaFifo.ts` não foi tocado.

Conferido também por `curl` no servidor real, contra o banco de desenvolvimento (método do
CLAUDE.md para backend): `QR_NAO_ENCONTRADO`, `EXCECAO_VENCIDO` e `BLOQUEAR_FIFO` em 200,
entre 8ms e 38ms — folgado dentro da RNF06 —, com `tentativas` subindo de 1 para 2 entre
duas requisições independentes. É o laço do RF06 visível sem estado no servidor.
`CONFIRMAR` ficou de fora do `curl` de propósito: consumiria uma unidade do banco de
desenvolvimento e já tem três casos automatizados contra banco real.

Duas descobertas durante a implementação, ambas em `docs/decisoes.md` (2026-09-08):

- **`additionalProperties: false` não recusa, descarta.** O ajv do Fastify remove o campo
  extra e segue (é o `removeAdditional`, comportamento que já valia em T04/T05). Um
  `usuarioId` proposto pelo corpo não vira 400 — ele simplesmente nunca é lido. O teste
  passou a afirmar a garantia que importa (a saída fica atribuída ao usuário da sessão),
  em vez do código de recusa.
- **Duas suítes com banco real não podem rodar em paralelo.** `tests/fifo` e `tests/saida`
  dividem o mesmo `estoque_fifo_test` e truncam os dados uma da outra: 18 falhas que somem
  em sequência. Resolvido com `fileParallelism: false` no `vitest.config.ts`, sem custo de
  tempo — o gargalo é o banco, não a CPU.

Registrado em `docs/notas-para-artigo.md` (2026-09-08): o status HTTP do bloqueio como
decisão de projeto (e não de estilo), e a incoerência entre as seções 4 e 5 da arquitetura,
que só apareceu quando uma parte do sistema precisou consumir a outra.

## Notas técnicas

- **A transação é curta de propósito.** Ela cobre a leitura e a baixa, nada mais. Nenhuma
  chamada externa, nenhuma espera pela atendente dentro dela: a janela de concorrência é
  o tempo da decisão, não o tempo de caminhar até a prateleira (PRD 6.2). Isso também é o
  que sustenta a RNF06 (<500ms).
- **Leituras simultâneas da mesma unidade.** Já resolvido em T07: a perdedora espera no
  `FOR UPDATE` e relê a linha baixada, devolvendo `UNIDADE_JA_BAIXADA`. Pela API, isso
  significa que a segunda requisição responde 200 com `ERRO`, não 500.
- **A suíte precisa que o app fale com o banco de teste.** `src/db/prisma.ts` é um client
  único que lê `DATABASE_URL` do ambiente; o padrão já usado em T03–T05
  (`vi.mock('../src/db/prisma.js', ...)`) serve aqui devolvendo o client de
  `criarClienteDeTeste()` em vez de um duplo — o mock troca o destino, não o
  comportamento.
- **Cookie de sessão nos testes.** Criar o usuário no banco e assinar o token com
  `app.jwt.sign` é mais direto do que passar por `/auth/login` (que exigiria hash real de
  senha no cenário). Helper novo em `tests/apoio/`, junto dos outros construtores.
- O `/health` continua sendo liveness puro, sem tocar no banco (decisão de 2026-09-07).
  A tela de T10 usa os dois sinais separadamente; não é assunto desta tarefa.

## Fora de escopo desta tarefa

- `POST /saidas/confirmar` e o módulo de EventoLog como serviço próprio (T09).
- Qualquer tela: câmera, entrada manual, PWA, detecção de offline (T10). Aqui a
  "entrada manual" aparece só como normalização do texto que chega na API.
- Os três caminhos da unidade vencida (T11). `EXCECAO_VENCIDO` é devolvido como veredito
  e a unidade permanece intacta.
- Endpoint de consulta de unidade por código, listagem de saídas, dashboard (T20).
- Alterar `validarSaidaFifo`, o tipo `Veredito` ou a suíte de T06.
