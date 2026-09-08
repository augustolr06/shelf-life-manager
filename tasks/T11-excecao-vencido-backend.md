# T11 — Backend da exceção de unidade vencida: os três caminhos da seção 6.1

**Depende de:** T07 (e, na prática, de T09: os três eventos desta tarefa passam pelo
módulo `evento-log`)
**Incremento:** 3 (Exceção de unidade vencida)
**Bloqueia:** T12 (tela), T13 (fila de descarte), T20 (dashboard)

## Objetivo

Dar destino à unidade que hoje o sistema apenas identifica e devolve intacta.

Desde T07 o ramo 3 de `validarSaidaFifo` responde `EXCECAO_VENCIDO` e **não toca na
unidade** — é o comportamento correto, e é também um beco sem saída: a atendente descobre
que o frasco está vencido e o sistema não oferece nenhuma ação. A unidade continua
`EM_ESTOQUE`, continua fora do pool FIFO (PRD 6.1) e continua invisível para qualquer
relatório de perda. Enquanto isso não fechar, o dado mais valioso da pesquisa — a perda
que se quer quantificar — não é coletado por nenhum caminho.

Esta tarefa implementa os três caminhos da seção 6.1 do PRD como três endpoints, e nada
além disso. Sem tela (T12), sem fila do gestor (T13).

**Não há lógica de FIFO nova.** `validarSaidaFifo` continua sendo a única a decidir o
veredito de uma leitura (RNF03); a correção de validade a reusa, e os outros dois caminhos
tratam de unidade que, por estar vencida, já está fora do pool prioritário por definição.

## Critério de aceite

### Módulo e rotas

- [x] Módulo novo `src/modules/excecao-vencido/` com `excecaoVencido.routes.ts` e
      `excecaoVencido.service.ts`. Os três caminhos são um fluxo só, de uma tela só, e
      dividem as mesmas pré-condições — separá-los por módulo (correção em `unidade`,
      descarte em `descarte`, override em `saida`) espalharia por três arquivos uma
      decisão que o PRD apresenta como uma escolha de três vias
- [x] As três rotas identificam a unidade por `unidadeId` (UUID), não por `codigoQr`: quem
      chama já tem o veredito `EXCECAO_VENCIDO` na mão, com o `id` da unidade. O código de
      QR é a entrada do balcão; aqui a entrada é uma unidade já identificada pelo servidor
- [x] Papéis conforme `docs/arquitetura.md` seção 5: `corrigir` e `override` só `GESTOR`;
      `descartar` aceita `ATENDENTE` e `GESTOR`
- [x] Registradas em `src/app.ts` junto das demais

### Pré-condições comuns aos três caminhos (dentro da transação, sob lock)

- [x] Unidade inexistente → **404** `UNIDADE_NAO_ENCONTRADA`
- [x] Unidade com `status ≠ EM_ESTOQUE` → **409** `UNIDADE_JA_BAIXADA`
- [x] Unidade **não vencida** (`dataValidade >= hoje`) → **409** `UNIDADE_NAO_VENCIDA`.
      Vale para os três, e no `override` é a trava que importa: sem ela o endpoint viraria
      um "vender sem passar pelo FIFO", que é exatamente o que o sistema existe para
      impedir. O override é escape do bloqueio de **validade**, nunca do bloqueio de FIFO
- [x] Tudo numa única transação com `SELECT ... FOR UPDATE` na unidade (RNF02), pelo mesmo
      motivo da leitura: duas pessoas resolvendo o mesmo frasco vencido ao mesmo tempo não
      podem gerar `Descarte` e `Saida` para a mesma unidade
- [x] Nenhum dos três altera o veredito de nada: a decisão de qual caminho seguir é da
      pessoa, não da tela nem do servidor. O servidor só recusa o que é impossível (RNF04
      continua valendo — a tela não afirma estado, ela pede uma ação sobre um `unidadeId`)

### Caminho 1 — correção de dado (`POST /excecao-vencido/corrigir`, GESTOR)

- [x] Corpo: `unidadeId` (uuid), `dataValidade` (`format: 'date'`, RNF01),
      `sessaoVendaId` (uuid, opcional — mesma regra de T09)
- [x] Atualiza `UnidadeProduto.dataValidade` e grava `VALIDADE_CORRIGIDA` com o valor
      **anterior** e o novo, ambos como texto `AAAA-MM-DD`
- [x] **Revalida o FIFO do zero na mesma transação**, chamando `validarSaidaFifo` com o
      `codigoQr` da unidade. A resposta carrega o veredito novo, no mesmo contrato
      `RespostaLeitura` de `/saidas/ler` — inclusive `CONFIRMAR`, e nesse caso a venda já
      aconteceu (não existe `POST /saidas/confirmar`, decidido em T09)
- [x] Nova validade **também no passado** é aceita: o erro de digitação pode ter sido de
      dia ou mês, não só de ano. A revalidação então devolve `EXCECAO_VENCIDO` de novo, que
      é a resposta honesta. Exigir data futura transformaria a correção em lavagem de
      estoque vencido
- [x] Nova validade **igual** à atual → **400** `VALIDADE_INALTERADA`. Correção que não
      corrige só produziria uma linha de log dizendo que nada mudou
- [x] Resposta 200: `{ correcao: { dataValidadeAnterior, dataValidadeNova }, revalidacao: RespostaLeitura }`

### Caminho 2 — baixa por descarte (`POST /excecao-vencido/descartar`, ATENDENTE + GESTOR)

- [x] Corpo: `unidadeId`, `motivo` (opcional, até 280 caracteres), `sessaoVendaId`
      (opcional)
- [x] Cria `Descarte` (unidade, usuário da sessão, motivo) e muda o status para
      `DESCARTADA`, na mesma transação
- [x] `motivo` ausente vira texto padrão *"Unidade vencida constatada na leitura de
      saída."* — a fricção deliberada da seção 6.1 do PRD está no override, não aqui: este
      é o caminho que se quer fácil, porque é o que produz o dado de perda
- [x] Grava `DESCARTE_REGISTRADO` com `codigoQr`, `dataValidade`, `motivo` e
      `sessaoVendaId`
- [x] Resposta **201** com a unidade (já `DESCARTADA`) e o descarte criado — um
      recurso passou a existir, como em qualquer criação do sistema (T05). O override, que
      cria uma `Saida`, responde 201 pelo mesmo motivo; só a correção, que altera unidade
      existente, responde 200
- [x] Uma leitura posterior do mesmo código devolve `ERRO / UNIDADE_JA_BAIXADA` — sem
      nenhuma linha nova em `validarSaidaFifo`

### Caminho 3 — override de venda (`POST /excecao-vencido/override`, só GESTOR)

- [x] Corpo: `unidadeId`, `justificativa` (obrigatória, 10 a 500 caracteres),
      `sessaoVendaId` (opcional)
- [x] Cria `Saida` com `vendaDeUnidadeVencida = true`, `justificativaOverride`,
      `autorizadoPorId` e `sessaoVendaId`; status → `VENDIDA`
- [x] `alertaFifoDisparado = false` e `tentativasAteAcerto = 0`: esta venda não passou pelo
      laço do FIFO, e contá-la no indicador de acerto na primeira leitura misturaria duas
      coisas diferentes (RF12)
- [x] `usuarioId` e `autorizadoPorId` recebem **o mesmo gestor** — o da sessão. O sistema
      não tem escalação de papel dentro de uma sessão de atendente (não há PIN de gerente),
      então quem autoriza é quem executa. Os dois campos continuam existindo porque o
      schema os separa desde T02 e uma escalação futura os preencheria diferente
- [x] Grava `VENDA_VENCIDA_AUTORIZADA` com `codigoQr`, `dataValidade`, `justificativa` e
      `autorizadoPorId`
- [x] **Não** chama `validarSaidaFifo`: a unidade vencida está fora do pool prioritário por
      definição (PRD 6.1), e passar por lá só devolveria `EXCECAO_VENCIDO` em laço. A
      exceção à RNF03 é aparente — não há decisão de FIFO sendo tomada aqui, há uma venda
      declaradamente fora do fluxo, registrada como tal

### EventoLog (RF12, RNF05)

- [x] Os três eventos passam por `registrarEvento` do módulo `evento-log`, dentro da mesma
      transação do fato. Nenhum `create` direto em `eventoLog`
- [x] Os três tipos já existem na união `TipoEvento` desde T09 — nada muda no módulo de
      log, e é essa a prova de que a lista veio do PRD e não do que estava implementado
- [x] `sessaoVendaId` vai no payload dos três, **sempre presente**, `null` inclusive (mesma
      regra de T09): a resolução de uma unidade vencida faz parte do atendimento em que
      aconteceu

### Testes (`backend/tests/excecao-vencido/excecaoVencido.test.ts`, PostgreSQL real)

- [x] Acesso: 401 sem sessão nos três; 403 de `ATENDENTE` em `corrigir` e `override`; 201
      de `ATENDENTE` em `descartar`
- [x] Pré-condições nos três: 404 para unidade inexistente, 409 para já baixada, 409 para
      não vencida
- [x] Correção: validade atualizada no banco; `VALIDADE_CORRIGIDA` com o valor anterior;
      revalidação devolvendo `CONFIRMAR` (vira a prioritária), `BLOQUEAR_FIFO` (existe
      outra mais antiga) e `EXCECAO_VENCIDO` (corrigida para outra data passada); 400 em
      validade inalterada
- [x] Descarte: `Descarte` criado com usuário e motivo; status `DESCARTADA`; motivo padrão
      quando ausente; leitura posterior devolve `UNIDADE_JA_BAIXADA`; a unidade some do
      pool de candidatas
- [x] Override: `Saida` com `vendaDeUnidadeVencida`, justificativa e autorizador; status
      `VENDIDA`; `tentativasAteAcerto = 0`; 400 sem justificativa e com justificativa curta
      demais; `sessaoVendaId` gravado
- [x] Concorrência: dois descartes simultâneos da mesma unidade — um vence, o outro recebe
      409, e não existem dois `Descarte` para a mesma unidade (o `@unique` de
      `Descarte.unidadeId` não deve ser o que segura isso; o lock é)
- [x] Descarte e override simultâneos da mesma unidade: um só vence
- [x] `npm run test:sem-banco` passa a excluir também `tests/excecao-vencido/**`, e entra o
      atalho `npm run test:excecao`
- [x] `npm run test:fifo` continua nos **46 de T06, sem uma linha editada**
- [x] `npm test` verde e `npm run typecheck` limpo nos dois projetos

### Documentação

- [x] `docs/arquitetura.md`: seção 2 ganha a pasta `excecao-vencido`; seção 5 detalha o
      corpo e os erros dos três endpoints; seção 4 registra que a correção de validade
      reusa `validarSaidaFifo` (é o segundo chamador da função, e continua sendo a única)
- [x] `docs/decisoes.md` e `docs/notas-para-artigo.md` com as entradas de 2026-09-08
- [x] `tasks/backlog.md` com T11 `concluída`

## Pontos validados pelo orientando antes de eu codar

As três perguntas abertas foram decididas em 2026-09-08, antes da implementação: **(1)** a
revalidação da correção é server-side, na mesma transação; **(3)** as duas extrações foram
autorizadas; **(4)** descarte fácil, override com justificativa de 10 caracteres no mínimo.
Os pontos 2 e 5 eram informativos e seguiram como escritos.

**Ponto 1 — a correção revalida no servidor, e pode efetivar a venda na mesma chamada.**
O PRD diz "revalida o FIFO do zero" sem dizer quem revalida. A alternativa seria a tela
corrigir e depois reenviar o QR para `/saidas/ler`. Estou propondo a revalidação
server-side, na mesma transação, por dois motivos: a tela não pode esquecer de fazê-la, e a
unidade fica sob o mesmo lock do início ao fim. A consequência é que uma chamada a
`/excecao-vencido/corrigir` pode terminar com a unidade vendida, se a data corrigida a
tornar a prioritária — coerente com T09 (ler já é vender), mas vale você ver isso escrito
antes. O número de eventos `LEITURA_QR_SAIDA` é o mesmo nas duas opções (dois: o da leitura
original e o da revalidação), então o denominador da RF12 não muda com a escolha.

**Ponto 2 — o override recusa unidade não vencida (409), e isso é uma trava e não uma
validação de formulário.** Se o endpoint aceitasse qualquer unidade `EM_ESTOQUE`, um gestor
poderia usá-lo para vender fora da ordem FIFO com uma justificativa qualquer — o bloqueio
reativo do RF06 viraria opcional para quem tem o papel. O override é escape de **um** dos
dois bloqueios, e só dele.

**Ponto 3 — duas extrações pequenas em código já escrito.** Nenhuma muda comportamento, e
nenhuma toca a suíte de T06:

1. O `SELECT ... FOR UPDATE` de `validarSaidaFifo` vira
   `src/modules/unidade/travarUnidade.ts`, com as duas formas de que o sistema precisa
   (por `codigoQr`, que a leitura usa, e por `id`, que os três caminhos daqui usam).
   `validarSaidaFifo.ts` perde a função privada e ganha um import — o comentário longo
   sobre por que o lock é da unidade e não do SKU migra junto, com ponteiro no lugar antigo.
2. `UnidadeNaResposta` e a montagem `unidade + produto` saem de `saida.service.ts` para
   `src/modules/unidade/unidadeNaResposta.ts`, porque as respostas de descarte e override
   precisam da mesma forma. `saida.service.ts` reexporta o tipo, então o contrato que T08 e
   T10 documentam não muda de endereço.

Se você preferir manter `validarSaidaFifo.ts` intocado por ser artefato avaliado do TCC, a
alternativa é duplicar as quatro linhas do lock no módulo novo — digo isso porque o custo
real da duplicação aqui é o comentário, não o código.

**Ponto 4 — `motivo` do descarte é opcional; `justificativa` do override não é.** A seção
6.1 do PRD pede fricção deliberada no override e ação padrão nos dois primeiros caminhos.
Exigir texto livre para descartar cada frasco vencido no balcão colocaria a fricção
exatamente onde ela atrapalha a coleta do dado de perda. O mínimo de 10 caracteres na
justificativa é meu arbítrio: o suficiente para recusar "ok" sem virar redação.

**Ponto 5 — erros de pré-condição são 4xx, e não veredito em 200 como em `/saidas/ler`.**
A assimetria é proposital. Uma leitura de QR é uma pergunta cuja resposta pode ser "não
pode" — isso é resultado, não falha (T08). Aqui a tela **afirma** uma ação sobre uma unidade
cujo estado ela julga conhecer; se o estado não é esse, o pedido não se aplica, e 409 é a
palavra certa para "o recurso não está no estado que você supôs".

## Estado ao fim de T11

`npm test` fecha em **177 verdes** (148 de T03–T09 + 29 daqui), `npm run test:sem-banco` em
70 sem container, `npm run test:fifo` nos mesmos **46 de T06, sem uma linha editada**, o
frontend segue nos 47 de T10 e `npm run typecheck` está limpo nos dois projetos. Nenhuma
migração nova: todos os campos usados existem desde T02, inclusive os três que até agora
nada preenchia (`vendaDeUnidadeVencida`, `justificativaOverride`, `autorizadoPorId`).

Código novo: `src/modules/excecao-vencido/` (rotas + serviço),
`src/modules/unidade/travarUnidade.ts` e `src/modules/unidade/unidadeNaResposta.ts`.
`validarSaidaFifo.ts` perdeu a função privada de lock e ganhou um import — o tipo
`Veredito`, a ordem dos ramos e o comportamento seguem idênticos. `saida.service.ts`
reexporta `UnidadeNaResposta` e expõe `montarRespostaDeLeitura`, que é o que faz a
revalidação da correção devolver exatamente o contrato de `/saidas/ler`.

Conferido também por `curl` no servidor real contra o banco de desenvolvimento (método do
CLAUDE.md para backend), com um atendimento inteiro sob o mesmo `sessaoVendaId`: leitura de
unidade vencida devolvendo `EXCECAO_VENCIDO`; correção para dentro do prazo revalidando em
`CONFIRMAR` (200, 48ms); descarte em 201 com o motivo padrão (20ms); override em 201 com a
justificativa e a gestora como autorizadora (17ms); e tentativa de override sobre unidade
**não** vencida recusada em 409. Todos folgados dentro da RNF06. O `EventoLog` do produto de
verificação mostra a cadeia completa e na ordem: `UNIDADE_CADASTRADA` ×4 →
`TENTATIVA_VENDA_UNIDADE_VENCIDA` → `LEITURA_QR_SAIDA` (`EXCECAO_VENCIDO`) →
`VALIDADE_CORRIGIDA` (com a data anterior) → `SAIDA_CONFIRMADA` → `LEITURA_QR_SAIDA`
(`CONFIRMAR`) → `DESCARTE_REGISTRADO` → `VENDA_VENCIDA_AUTORIZADA`, todos com o mesmo
`sessaoVendaId`.

Decisões registradas em `docs/decisoes.md` (2026-09-08): revalidação server-side na
transação da correção; a pré-condição de vencimento como trava contra o desvio do FIFO pelo
override; 4xx em vez de veredito em 200; módulo próprio para os três caminhos; a assimetria
de fricção entre descarte e override; executor e autorizador como o mesmo gestor; as duas
extrações; e o descarte restrito a unidade vencida.

Em `docs/notas-para-artigo.md` (2026-09-08), três entradas: os três caminhos separando
causas que o processo manual junta; a exceção que vira contorno de outra regra quando o
requisito é silencioso sobre seus limites; e a limitação de avaria, quebra e furto sem
caminho no sistema.

## Notas técnicas

- **A ordem das pré-condições é a mesma dos ramos 1–3 de `validarSaidaFifo`** (existe →
  em estoque → vencida). Não é coincidência nem duplicação de regra de FIFO: são as
  mesmas perguntas de estado, feitas na mesma ordem, para que a mensagem que a atendente
  vê seja coerente entre a leitura e a resolução.
- **`hojeComoData()` de `src/shared/data.ts`** para a comparação de vencimento, nos três
  caminhos. Nenhuma data literal, nenhum `new Date()` solto.
- **A revalidação da correção roda depois do `update` e dentro da mesma transação**, então
  o `FOR UPDATE` de `validarSaidaFifo` reencontra um lock que a própria transação já tem —
  é reentrante, não é espera.
- **`Descarte.unidadeId` e `Saida.unidadeId` são `@unique`.** Isso é rede de segurança, não
  o mecanismo: quem impede o descarte duplo é o lock (RNF02). O teste de concorrência
  precisa provar que a segunda transação recebe 409 por estado, não 500 por violação de
  restrição.
- **Nada de `Descarte` para unidade não vencida.** Frasco quebrado, furto e avaria não têm
  caminho neste sistema — ver "Fora de escopo" e a entrada de limitação em
  `docs/notas-para-artigo.md`.

## Fora de escopo desta tarefa

- **Qualquer tela.** Os três caminhos na interface, com o override em posição não-primária
  e restrito ao `GESTOR`, são T12.
- **`GET /descartes/pendentes`** e a fila do gestor (RF11) — T13. Aqui o descarte é criado,
  não listado.
- **Baixa por avaria, quebra ou furto.** O PRD só prevê descarte no fluxo da unidade
  vencida; um motivo genérico de baixa é funcionalidade nova, não esta tarefa.
- **Estorno de saída**, inclusive da criada por override (limitação já registrada em
  `docs/notas-para-artigo.md`, 2026-09-08).
- **Correção de validade fora do fluxo de exceção** — editar a data de uma unidade não
  vencida pelo catálogo. Seria um endpoint de manutenção com outro perfil de risco: mexe na
  ordem do pool FIFO sem que ninguém esteja no balcão com o frasco na mão.
- **Alterar `schema.prisma` ou criar migração.** Todos os campos usados aqui existem desde
  T02 — inclusive `vendaDeUnidadeVencida`, `justificativaOverride` e `autorizadoPorId`, que
  até agora nada preenchia.
- **Alterar a suíte de T06** por qualquer motivo.
