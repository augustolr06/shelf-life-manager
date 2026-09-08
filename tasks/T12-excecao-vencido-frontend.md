# T12 — Tela da exceção de unidade vencida: os três caminhos, override restrito ao GESTOR

**Depende de:** T11 (os três endpoints) e T10 (a tela de leitura, onde a exceção nasce)
**Incremento:** 3 (Exceção de unidade vencida)
**Bloqueia:** T13 (fila de descarte, que reusa os mesmos caminhos fora do balcão)

## Objetivo

Fechar, na interface, o beco sem saída que T10 deixou explícito e T11 resolveu só no
servidor. Hoje a atendente lê um frasco vencido, recebe `EXCECAO_VENCIDO` e lê na tela
*"Separe esta unidade e avise o gestor. Os caminhos de correção, descarte e autorização
entram em uma etapa seguinte do projeto."* — os três endpoints existem desde T11 e nenhum
tem chamador.

Enquanto isso não fechar, o dado mais valioso da pesquisa continua não sendo coletado por
ninguém: o descarte só existe por `curl`. A unidade vencida segue `EM_ESTOQUE`, fora do
pool FIFO e invisível para qualquer relatório de perda — exatamente o estado que T11
descreveu como beco sem saída, agora movido uma camada acima.

Esta tarefa é **só interface**. Nenhum arquivo de `backend/` é tocado, nenhum endpoint
novo, nenhuma regra nova. A tela ganha três botões, dois formulários e um layout de
resolução; as três decisões continuam sendo do servidor (RNF03, RNF04).

## Critério de aceite

### O serviço (`frontend/src/services/excecaoVencido.ts`)

- [x] Módulo novo, espelhando campo a campo o que `excecaoVencido.service.ts` devolve —
      pelo mesmo motivo de `saidas.ts` em T10: espelhar é tudo o que a camada de serviço
      do frontend faz
- [x] `corrigirValidade(unidadeId, dataValidade, sessaoVendaId)` → `{ correcao, revalidacao }`,
      onde `revalidacao` é o tipo `RespostaLeitura` **importado de `saidas.ts`**, não uma
      segunda declaração da mesma forma. É o mesmo contrato de `/saidas/ler`, e o ponto de
      T11 ao exportar `montarRespostaDeLeitura` foi justamente que a tela não aprendesse
      forma nova
- [x] `descartarUnidade(unidadeId, motivo, sessaoVendaId)` → `ResultadoDescarte`
- [x] `autorizarVendaVencida(unidadeId, justificativa, sessaoVendaId)` → `ResultadoOverride`
- [x] `UnidadeLida` continua sendo o tipo de `saidas.ts` (é o `UnidadeNaResposta` do
      backend); as respostas de descarte e override o reusam
- [x] Campos opcionais omitidos, nunca enviados vazios — mesma regra de `lerCodigoQr`: o
      backend valida `format: 'uuid'` e `minLength: 1`, e recusaria a requisição inteira
      por causa de um campo acessório
- [x] Nenhuma comparação de validade, status ou ordem em nenhum arquivo de frontend. A
      busca por `dataValidade <` continua sem resultado no `frontend/src`

### O painel (`frontend/src/components/PainelExcecaoVencido.tsx`)

- [x] Renderizado **dentro** do layout `EXCECAO_VENCIDO` da tela de leitura, no lugar do
      parágrafo que hoje diz "entram em uma etapa seguinte do projeto". Ver Decisão 1
- [x] Recebe a unidade vencida, o papel do usuário, o `sessaoVendaId` do atendimento em
      curso, e dois retornos: um para a revalidação da correção (que devolve um veredito
      novo, e a tela de leitura é quem sabe exibi-lo) e um para a resolução terminal
      (descarte ou override)
- [x] **Ordem de proeminência da seção 6.1 do PRD**, de cima para baixo: correção de dado,
      baixa por descarte, override. O override é o último elemento da tela, atrás de um
      passo a mais, e não é o botão primário — restrição de design explícita do PRD, não
      preferência estética
- [x] **Descarte é o caminho de menor atrito**: um botão, `motivo` opcional num campo que
      não bloqueia o envio. Sem motivo, o servidor grava o texto padrão — a fricção
      deliberada mora no override, e o descarte é o que produz o dado de perda
- [x] **Correção** abre um `<input type="date">` (que já entrega `AAAA-MM-DD` nativamente,
      sem conversão de fuso no cliente — RNF01) com a validade atual pré-preenchida
- [x] **Override** exige dois atos: revelar o formulário e então enviar a justificativa. O
      texto de aviso diz o que o registro significa — venda de produto com validade
      expirada, autorização permanente no log imutável
- [x] O mínimo de 10 caracteres da justificativa é espelhado na tela (botão desabilitado,
      contagem à vista) e o `maxLength` dos dois campos livres também — Decisão 3. A tela
      **não** compara a data digitada com a validade atual: `VALIDADE_INALTERADA` vem do
      servidor e é exibida como veio
- [x] Papel: correção e override só aparecem para `GESTOR`; descarte aparece para os dois.
      Mesma lista de papéis das três rotas do backend. Ver Decisão 2 para o que a
      ATENDENTE vê no lugar
- [x] Uma ação em voo desabilita as três: são três caminhos mutuamente exclusivos sobre a
      mesma unidade, e o servidor recusaria a segunda com 409 de todo jeito
- [x] Erro de qualquer um dos três exibe `mensagem` **como o backend escreveu**, sem
      reescrita na tela (mesma regra dos vereditos, RNF04)
- [x] `UNIDADE_JA_BAIXADA` (409) é o caso especial: alguém resolveu esta unidade enquanto o
      frasco estava na mão. A tela mostra a mensagem do servidor e **descarta o veredito**,
      voltando ao estado de nova leitura — pelo mesmo motivo que T10 descarta o veredito na
      queda de conexão: ele valia para o estoque de um instante que passou

### A tela de leitura (`frontend/src/pages/TelaLeituraQr.tsx`)

- [x] Passa a receber `usuario` como prop, vinda do `App` — é o que decide se o override
      aparece. `TelaProdutos` já recebe assim desde T04
- [x] Layout `EXCECAO_VENCIDO` monta o painel; os outros três não mudam **em nada**
- [x] Correção bem-sucedida substitui o resultado em tela pelo veredito de `revalidacao`,
      reentrando no mesmo componente `Resultado` — os quatro layouts valem sem uma linha
      nova. Uma correção pode, portanto, terminar em "Saída registrada" (a venda já
      aconteceu, T09/T11), em bloqueio de FIFO, ou de novo em unidade vencida
- [x] Descarte e override bem-sucedidos mostram um layout de resolução com a `mensagem` do
      servidor e "Ler outra unidade" — a unidade saiu do estoque, o atendimento continua
- [x] O `sessaoVendaId` do atendimento em curso acompanha os três, como acompanha as
      leituras (RF13). "Encerrar atendimento" limpa a resolução junto com o resto
- [x] A resolução exibida é descartada quando a conexão cai, junto com o veredito, pela
      razão já registrada em T10

### Testes (Vitest + Testing Library)

- [x] O teste de T10 que afirma *"informa a unidade vencida sem oferecer ação — os três
      caminhos são T11"* é **substituído**, não removido: vira o teste de que os três
      caminhos aparecem. É a única asserção de T10 que esta tarefa invalida
- [x] Os testes existentes passam a montar `<TelaLeituraQr usuario={...} />`. Adaptação de
      assinatura, como T10 fez ao envolver os testes em `MemoryRouter` — nenhum caso
      reescrito
- [x] Correção: envia `unidadeId` e a data do campo; a revalidação em `CONFIRMAR` troca a
      tela para "Saída registrada"; a revalidação em `EXCECAO_VENCIDO` volta a oferecer os
      três caminhos (data corrigida para outro dia também no passado)
- [x] Descarte: envia sem `motivo` quando o campo está vazio (o padrão é do servidor);
      envia o motivo quando preenchido; a tela mostra a `mensagem` do servidor
- [x] Override: invisível para `ATENDENTE`, visível para `GESTOR`; exige o passo de revelar
      antes do formulário; envia a justificativa; a tela mostra a `mensagem` de
      autorização
- [x] Espelho da Decisão 3: justificativa curta mantém o botão desabilitado **sem ida à
      rede**, e a tela não compara datas — corrigir para a mesma validade chega ao servidor
      e a mensagem de `VALIDADE_INALTERADA` é exibida como veio dele
- [x] `sessaoVendaId`: o mesmo da leitura que originou a exceção vai nos três — prova de
      que a resolução pertence ao atendimento em que aconteceu
- [x] 409 `UNIDADE_JA_BAIXADA` no descarte: mostra a mensagem do servidor e volta ao estado
      de nova leitura
- [x] Offline: com o portão fechado não há painel — ele vive dentro do resultado, que é
      descartado. Um teste cobre a queda **durante** a resolução (`ErroApi` status 0)
- [x] `npm test` verde e `npm run typecheck` limpo nos dois projetos; o backend segue nos
      **177 de T11, sem uma linha editada**
- [x] Conferência no navegador com `playwright-cli` conforme CLAUDE.md, restrita ao que
      esta tarefa mexe: uma unidade vencida real do banco de desenvolvimento, o caminho do
      descarte até a resolução, e a ausência do override numa sessão de ATENDENTE.
      `console error` limpo

### Documentação

- [x] `docs/decisoes.md` e `docs/notas-para-artigo.md` com as entradas do dia
- [x] `tasks/backlog.md` com T12 `concluída`
- [x] `docs/arquitetura.md` só se alguma decisão daqui mudar contrato — não é esperado

## Pontos que precisam da sua validação antes de eu codar

**Decisão 1 — os três caminhos ficam na própria tela de leitura, não em rota nova.**
O backlog chama T12 de "tela de exceção", e a alternativa seria uma rota `/excecao/:id`
para onde o veredito `EXCECAO_VENCIDO` navegaria. Estou propondo o painel embutido no
resultado da leitura, por três motivos: a seção 6.1 do PRD descreve "ao detectar unidade
vencida, **a interface apresenta** três caminhos", como continuação da leitura; uma rota
própria precisaria carregar a unidade por estado de navegação (ou refazer a leitura, o que
gravaria um segundo `LEITURA_QR_SAIDA` e inflaria o denominador da RF12); e a atendente está
com o frasco na mão, num fluxo de balcão que T10 desenhou para não perder o contexto entre
uma leitura e a próxima. Se você preferir rota própria — por exemplo, porque T13 vai levar
o gestor à mesma tela vindo da fila de descarte —, digo agora, porque muda a estrutura do
componente.

**Decisão 2 — a ATENDENTE só vê o descarte, e a tela diz por que os outros dois não estão
lá.** O backend é quem manda: `corrigir` e `override` são `GESTOR`-only desde T11. A tela
esconde os dois e mostra uma linha dizendo que correção de validade e autorização de venda
são do gestor. A alternativa seria mostrar os três desabilitados; T10 já registrou a
posição contrária ("botão inerte no balcão costuma ser pior que ausência"), e mantenho.
Esconder continua sendo conveniência de interface — quem recusa de fato é o 403 (RNF04).
Consequência a registrar: no balcão, a resolução completa de um frasco vencido cujo dado
está errado exige o gestor assumir a sessão, que é a mesma consequência já aceita em T11
para o override.

**Decisão 3 — a tela espelha o mínimo da justificativa, e não compara datas** (decidida
pelo orientando em 2026-09-08, depois de discussão; a proposta inicial era não espelhar
nenhum dos dois).

O critério que separa os dois casos: **a tela pode antecipar o que ela mesma sabe por
inteiro; não pode antecipar o que é cópia de estado do servidor.**

- O mínimo de 10 caracteres é propriedade do texto que o gestor acabou de digitar. A tela
  tem esse dado inteiro, ele não envelhece, e não há como discordar do servidor a não ser
  que a constante mude de um lado só. **Espelhado**: botão desabilitado com contagem à
  vista enquanto o texto for curto, e `maxLength` nos dois campos livres (500 na
  justificativa, 280 no motivo), que impede digitar além em vez de recusar depois.
- `VALIDADE_INALTERADA` é propriedade do estado do servidor — a validade hoje gravada. A
  tela só tem uma cópia, lida quando o QR foi lido. **Não espelhado**: se outro gestor
  corrigiu aquela unidade nesse meio tempo, a tela bloquearia uma correção legítima
  dizendo "não há o que corrigir" para uma data que de fato mudou. Falso bloqueio
  silencioso é pior que uma ida à rede, e a recusa do servidor já vem redigida em
  português, sob o lock, onde a informação é atual.

Dois fatos levantados na discussão sustentam a escolha:

1. **Sem o espelho, a tela mostraria texto interno do Fastify.** `backend/src/app.ts` não
   tem `setErrorHandler`, então uma violação de JSON Schema devolve o formato padrão, e
   `services/api.ts` cai no campo `message`. Reproduzido com o schema exato da rota:
   `body/justificativa must NOT have fewer than 10 characters` — em inglês, no balcão, no
   fluxo que o PRD descreve como o mais deliberado do sistema. Não vale para
   `VALIDADE_INALTERADA`, que tem 400 artesanal com `erro` e `mensagem` desde T11.
2. **O projeto já espelha restrição de formulário.** `TelaRecebimento` tem `min={1}
   max={200}` no campo de quantidade, espelhando o schema de `unidade.routes.ts`, e
   `saidas.ts` espelha à mão o contrato inteiro da resposta. Não espelhar aqui seria a
   exceção, não a regra.

O espelho é conveniência, nunca autoridade: se o servidor discordar, a mensagem exibida
continua sendo a dele. A constante mora uma vez só, em `services/excecaoVencido.ts`, ao
lado do espelho dos tipos e com ponteiro para a rota.

**Registrado como observação, fora do escopo desta tarefa:** o `errorHandler` genérico é um
buraco real — qualquer violação de schema em qualquer rota exibe texto do Fastify ao
usuário. A correção seria traduzir `FST_ERR_VALIDATION` para o formato `{erro, mensagem}`
do projeto, e é tarefa de backend. Mesmo feita, não substituiria o espelho: uma mensagem
genérica de "confira os campos" é pior que desabilitar o botão com a contagem à vista.

**Decisão 4 — correção que resulta em `CONFIRMAR` mostra a venda como fato consumado.**
A tela não pergunta "deseja confirmar a saída?" depois da correção. Ela não pode: quando o
servidor responde `CONFIRMAR`, a `Saida` já existe (T09, T11). O layout é o mesmo de uma
leitura confirmada, com a mensagem do servidor. Vale você ver isso escrito porque é o
momento em que a consequência da revalidação server-side, decidida em T11, aparece para o
usuário: um gestor que corrige uma data pode terminar a interação com o produto vendido.

## Estado ao fim de T12

`npm test` fecha em **59 verdes** no frontend (47 herdados de T10, adaptados à prop
`usuario`, mais 12 dos três caminhos) e nos mesmos **177 do backend, sem uma linha
editada** — nenhum arquivo de `backend/` foi tocado, como o escopo previa. `npm run
typecheck` limpo nos dois projetos.

Código novo: `services/excecaoVencido.ts` (espelho dos três endpoints e dos limites de
texto) e `components/PainelExcecaoVencido.tsx` (os três caminhos). `TelaLeituraQr.tsx`
passou a receber `usuario`, monta o painel dentro do layout `EXCECAO_VENCIDO` e ganhou o
estado de resolução terminal; `App.tsx` passa o usuário para a rota `/leitura`. Os outros
três layouts de veredito não mudaram.

Conferido no navegador com `playwright-cli` (método do CLAUDE.md para UI), contra backend e
banco de desenvolvimento, em viewport de celular (390×844):

- como GESTOR, `PRF-JC95FJ` (validade 01/01/2020) exibindo os três caminhos na ordem do
  PRD, com o override em botão secundário, por último e atrás do passo de revelar;
- o espelho do mínimo funcionando sem ida à rede: "ok" na justificativa mantém "Autorizar
  venda" desabilitado e mostra "Faltam 8 caracteres para a justificativa";
- descarte real em 201, com o layout de resolução e a mensagem do servidor. No banco: a
  unidade em `DESCARTADA`, o `Descarte` com a gestora e o motivo padrão, e o `EventoLog`
  com `LEITURA_QR_SAIDA` → `DESCARTE_REGISTRADO` **sob o mesmo `sessaoVendaId`**, que é a
  prova de ponta a ponta de que a resolução pertence ao atendimento;
- como ATENDENTE, `PRF-6KJXCQ` exibindo só o descarte, mais a linha dizendo que corrigir
  validade e autorizar venda são ações do gestor;
- console sem nenhum erro.

Um defeito de layout apareceu na conferência e foi corrigido: `.campo` cresce por padrão
(`flex: 1 1 10rem`), o que dentro de um caminho em coluna esticava o campo de motivo e
abria um vão até o botão de descartar. `.caminho .campo` passou a fixar `flex: 0 0 auto`.

O override não foi exercitado até o fim no navegador, de propósito: consumiria uma das
unidades vencidas do banco de desenvolvimento numa venda que não tem estorno, e o caminho
inteiro já tem caso automatizado. O que a conferência cobriu dele foi o que só se vê na
tela — a posição não-primária, o passo de revelar e o espelho do mínimo.

Decisões registradas em `docs/decisoes.md` (2026-09-08): o painel embutido na tela de
leitura em vez de rota própria; a ATENDENTE com um caminho só; o espelho do mínimo da
justificativa junto com a recusa de comparar datas, e o critério que separa os dois; a
correção que revalida em `CONFIRMAR` como fato consumado; o 409 devolvendo a tela ao estado
de nova leitura; e a observação sobre o `errorHandler` ausente no backend, que ficou fora
desta tarefa.

Em `docs/notas-para-artigo.md` (2026-09-08): uma entrada nova sobre a fronteira entre
ergonomia de formulário e regra de negócio, com o critério "o que a tela possui por inteiro
vs. o que é cópia de estado do servidor"; e um acréscimo à entrada de offline de T10, com
os dois desfechos concretos de um cache local do estoque (beco sem saída e venda dupla),
a partir da pergunta do orientando sobre IndexedDB.

## Notas técnicas

- **O painel não conhece `EXCECAO_VENCIDO`.** Ele recebe uma unidade e devolve o que o
  servidor respondeu; quem sabe que aquilo é uma exceção de vencimento é a tela de leitura,
  que já escolhe layout por veredito. É o que permite T13 reusá-lo a partir da fila de
  descarte, onde não houve leitura de QR nenhuma.
- **`<input type="date">` no celular abre o seletor nativo** e entrega `AAAA-MM-DD` cru, que
  é exatamente o `format: 'date'` do backend. Nenhum `new Date()` no caminho — o mesmo
  cuidado que `services/datas.ts` documenta desde T05.
- **A validade atual pré-preenchida no campo de correção** é conveniência e não sugestão: a
  correção típica é de dígito (ano ou mês trocado), e começar do valor errado é o que torna
  o erro visível. O servidor recusa a data inalterada de qualquer forma.
- **Três ações, um estado de "em voo" só.** Não há caminho legítimo em que duas ações sobre
  a mesma unidade estejam no ar ao mesmo tempo, e o lock da RNF02 já garante que a segunda
  perderia.
- A tela continua operável com uma mão só, com o frasco na outra: os alvos de toque e a
  legibilidade de relance valem para os três botões novos como já valem para o resto.

## Fora de escopo desta tarefa

- **`GET /descartes/pendentes` e a fila do gestor (RF11)** — T13. Aqui a unidade vencida
  chega pela leitura de QR, nunca por uma lista.
- **Qualquer alteração de backend**, inclusive mensagem de erro que pareça melhorável. Se
  alguma mensagem se mostrar ruim na conferência do navegador, registro a observação e ela
  vira decisão de outra tarefa.
- **Estorno** de saída ou de descarte, inclusive do override (limitação já registrada em
  `docs/notas-para-artigo.md`, 2026-09-08).
- **Correção de validade fora do fluxo de exceção**, pelo catálogo (fora de escopo desde
  T11, e continua).
- **Baixa por avaria, quebra ou furto** — limitação declarada, não lacuna.
- **Dashboard, relatório por `sessaoVendaId` e contagem de overrides** — T20/T21.
- **Alterar `validarSaidaFifo`, a suíte de T06 ou qualquer teste de backend.**
