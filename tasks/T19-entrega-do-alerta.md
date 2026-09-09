# T19 — Entrega do alerta proativo ao gestor (RF08)

**Depende de:** T18 (a varredura, que cria as linhas de `Alerta` que esta tarefa exibe) e,
por tabela, T17 (a janela) e T05 (as unidades)
**Incremento:** 5 (Alertas proativos)
**Bloqueia:** nada diretamente. T20 (RF13) vai contar alertas emitidos pelo `EventoLog`, não
por esta tela

## Objetivo

Fazer o alerta **chegar a alguém**.

Hoje a jornada J3 do PRD está pela metade: a gestora configura a janela (T17), a varredura
cruza a janela com o estoque e emite um `Alerta` por unidade (T18) — e a linha fica no banco
sem mudar o comportamento de ninguém na loja. Está registrado em
`docs/notas-para-artigo.md` como limitação declarada de T18: *"o alerta existe no banco e não
é aviso; o valor medido pelo piloto só começa a existir quando a notificação chega"*.

Esta tarefa é a chegada: uma tela que lista o que está para vencer, um contador do que ainda
não foi visto, e a marcação de lido que fecha o ciclo (`Alerta.lidoEm`, a única coluna do
schema de T02 que nunca foi escrita por ninguém).

É a última fatia do incremento 5. Depois dela, a RF08 está inteira — com a ressalva do canal
`PUSH`, que é o assunto da Decisão 1.

## Critério de aceite

### Backend — a listagem (`GET /alertas`)

- [x] Rota nova em `src/modules/alerta/alerta.routes.ts` + `alerta.service.ts`, ao lado do
      `configuracaoAlerta.*` e da `varreduraAlertas.ts`: configuração, emissão e entrega são
      três coisas diferentes no mesmo módulo, como T18 já organizou
- [x] **Só GESTOR** — Decisão 2
- [x] Resposta no formato das outras listagens paginadas
      (`GET /descartes/pendentes`, `GET /produtos`):

```json
{
  "alertas": [{
    "id": "...", "geradoEm": "2026-09-09T12:00:00.000Z", "lidoEm": null,
    "diasParaVencer": 12, "situacao": "NA_JANELA",
    "janela": { "configuracaoId": "...", "diasAntecedencia": 30, "canal": "IN_APP" },
    "unidade": { "...UnidadeNaResposta": "..." }
  }],
  "total": 8, "naoLidos": 3, "pagina": 1, "tamanhoPagina": 20
}
```

- [x] `unidade` é o `UnidadeNaResposta` de sempre (`comProdutoJaLido`), sem uma segunda forma
      de unidade na API
- [x] `diasParaVencer` é calculado no **servidor**, contra o mesmo `hojeComoData()` do FIFO,
      da fila de descarte e da varredura — pelo mesmo motivo de `diasVencida` em T13: comparar
      data no navegador depende do fuso do aparelho (RNF01)
- [x] A lista traz os alertas cuja unidade ainda está `EM_ESTOQUE` — **inclusive as que já
      venceram** desde a emissão, marcadas como tais — e omite as que saíram do estoque
      (`VENDIDA`, `DESCARTADA`) — Decisão 3
- [x] `situacao` é `NA_JANELA` ou `VENCIDA`, decidido no **servidor**: é o que permite a tela
      marcar o alerta perdido sem comparar data no navegador (RNF01, RNF04). `diasParaVencer`
      fica **negativo** na unidade vencida, e a tela exibe o texto a partir de `situacao`, não
      do sinal do número
- [x] Ordem por urgência: `dataValidade` crescente, desempate por `codigoQr` (único), que é a
      mesma ordem da fila de T13 e das etiquetas de T14, e é o que torna a paginação estável
- [x] Paginação `pagina`/`tamanhoPagina`, padrão 20, máximo 100 — os mesmos números de
      `/descartes/pendentes`
- [x] `apenasNaoLidos` (booleano, padrão `false`) na query: é o filtro que a tela usa para
      mostrar "o que ainda não vi" sem perder o histórico recente
- [x] `naoLidos` conta **a lista inteira**, não a página, e ignora o filtro `apenasNaoLidos`:
      é o número do contador da navegação, e ele não pode depender de onde a gestora está
- [x] Lista vazia é 200 com `alertas: []` — como a fila de T13, é o estado desejado
- [x] A rota **não grava `EventoLog`**: consultar não é ato operacional (mesma regra de
      `/descartes/pendentes` e das rotas de T17)

### Backend — marcar como lido (`POST /alertas/:id/lido`)

- [x] **Só GESTOR.** 200 com `{ alerta }` no mesmo formato do item da lista
- [x] Grava `lidoEm = now()` — a primeira escrita nessa coluna desde T02
- [x] **Idempotente**: alerta já lido mantém o `lidoEm` original, sem sobrescrever. Duas
      abas abertas não devem mudar o instante que a pesquisa vai ler
- [x] Id inexistente → 404 `ALERTA_NAO_ENCONTRADO`, no formato de erro da seção 5.1
- [x] Marcar como lido **não** apaga nem esconde nada: a linha continua na listagem sem
      filtro, com o estado visível — Decisão 4
- [x] Grava `ALERTA_LIDO` no `EventoLog` — **décimo tipo de evento**, acrescentado
      conscientemente à lista fechada de `eventoLog.service.ts` (Decisão 5) —, na **mesma
      transação** da escrita de `lidoEm`, pelo `registrarEvento` de sempre
- [x] O evento leva `unidadeId` e `produtoId` da unidade alertada, `usuarioId` do **gestor que
      leu** (não a conta de sistema: aqui há quem, ao contrário da varredura) e payload com
      `alertaId`, `configuracaoId`, `diasAntecedencia`, `dataValidade` (texto `AAAA-MM-DD`,
      por `dataParaPayload`), `diasParaVencer` e `geradoEm`
- [x] **Um evento por alerta lido, uma vez só**: a segunda chamada não grava um segundo
      `ALERTA_LIDO`, pelo mesmo motivo da idempotência acima — dois eventos inflariam a
      contagem da pesquisa descrevendo um reconhecimento que aconteceu uma vez
- [x] Sem lock: `lidoEm` não decide baixa de estoque e não disputa nada (a RNF02 é sobre a
      baixa da unidade, como em T18)
- [x] Nenhuma alteração de schema, nenhuma migração: a coluna existe desde T02
- [x] Nenhuma alteração em `validarSaidaFifo`, na varredura, no agendador ou nas quatro rotas
      de T17

### Backend — testes (Vitest contra PostgreSQL real, `tests/alerta/entregaDeAlertas.test.ts`)

- [x] Alerta de unidade dentro da janela aparece na lista, com `unidade`, `janela` e
      `diasParaVencer` corretos
- [x] `diasParaVencer` bate com o posicionamento de `criarUnidade({ diasAteVencer })`,
      inclusive na unidade que vence **hoje** (0)
- [x] **Some da lista** o alerta cuja unidade foi `VENDIDA` ou `DESCARTADA` — um teste cada
- [x] **Continua na lista** o alerta cuja unidade **venceu** desde a emissão, com
      `situacao: 'VENCIDA'` e `diasParaVencer` negativo (Decisão 3); a unidade que vence hoje
      ainda é `NA_JANELA`, que é a borda
- [x] Ordem por validade crescente, com duas unidades de datas diferentes
- [x] Paginação: `total` é a lista inteira e não a página; `tamanhoPagina` acima do máximo é
      recusado pelo schema (400 `CORPO_INVALIDO`, como as demais)
- [x] `apenasNaoLidos=true` esconde os lidos; sem o filtro, os dois aparecem
- [x] `naoLidos` não muda com `apenasNaoLidos` e cai em 1 depois de marcar um como lido
- [x] `POST /alertas/:id/lido` grava `lidoEm`; a segunda chamada devolve **o mesmo instante**
- [x] Id inexistente é 404 `ALERTA_NAO_ENCONTRADO`
- [x] ATENDENTE recebe 403 nas duas rotas; sem sessão, 401
- [x] **Listar não grava evento** (a contagem antes e depois é a mesma)
- [x] Marcar como lido grava **um** `ALERTA_LIDO`, com `unidadeId`, `produtoId`, o
      `usuarioId` do gestor da sessão e o payload completo; `dataValidade` é texto
      `AAAA-MM-DD` e não instante ISO
- [x] A **segunda** chamada não grava um segundo `ALERTA_LIDO`
- [x] As suítes existentes continuam passando sem edição

### Frontend

- [x] `src/services/alertas.ts`, espelhando o backend sem regra própria, como os demais
      serviços (`listarAlertas`, `marcarAlertaComoLido`)
- [x] `src/pages/TelaAlertas.tsx`, rota `/alertas`, GESTOR, no molde da `TelaDescartesPendentes`:
      cabeçalho, subtítulo, estado de carregamento, erro, lista, paginação
- [x] Cada item mostra produto (nome, marca, código interno), etiqueta (`codigoQr`), validade
      formatada, `diasParaVencer` **como veio do servidor**, a janela que gerou o alerta
      ("avisado 30 dias antes") e o estado lido/não lido
- [x] O alerta de unidade **já vencida** aparece marcado (`situacao: 'VENCIDA'`), com o
      encaminhamento explícito para a fila de descarte — é onde a unidade se resolve (T13),
      não aqui
- [x] Botão **Marcar como lido** por alerta; o alerta lido continua na lista, marcado, e o
      botão sai
- [x] Alternador **"Mostrar só os não lidos"**, que chama a rota com `apenasNaoLidos`
- [x] Estado vazio explícito: "Nenhuma unidade dentro da janela de alerta" — é o estado
      desejado, não falha
- [x] **Contador de não lidos na navegação**, ao lado do rótulo "Alertas" — Decisão 6
- [x] A navegação do `App` passa a ter duas entradas de alerta: `/alertas` ("Alertas", com o
      contador) e `/alertas/configuracao` ("Configurar alertas"). O rótulo atual "Alertas"
      aponta hoje para a configuração, e deixá-lo assim mandaria a gestora ao formulário
      quando ela quer ver o aviso
- [x] O aviso da `TelaConfiguracaoAlerta` é **atualizado outra vez** (T18 o reescreveu para
      dizer que a entrega não existia): passa a apontar a lista, e a dizer o que vale sobre o
      canal `PUSH` conforme a Decisão 1. O teste correspondente acompanha o texto
- [x] Nenhum julgamento na tela (RNF04): o que está na janela, a ordem, os dias que faltam e
      o que sumiu da lista vêm todos do servidor
- [x] Testes em `src/pages/TelaAlertas.test.tsx` com Vitest + Testing Library, `respostaFalsa`
      como nos demais: lista carregada, estado vazio, erro de carregamento, marcar como lido
      (a linha muda de estado e o contador cai), filtro de não lidos, paginação

### Fechamento

- [x] `npm test` e `npm run typecheck` verdes nos dois projetos
- [x] `npm run test:sem-banco` continua verde
- [x] Conferência no navegador com `playwright-cli` (método do CLAUDE.md), restrita ao que
      mudou: a tela `/alertas` como GESTOR com os alertas que T18 deixou no banco de
      desenvolvimento, o "marcar como lido", o contador da navegação e o aviso novo na tela de
      configuração. `console error` limpo
- [x] `docs/arquitetura.md`: as duas rotas na tabela da seção 5, com o parágrafo de contrato;
      nota na seção 5.3 dizendo que a entrega existe
- [x] `docs/decisoes.md` e `docs/notas-para-artigo.md` com as entradas do dia — em especial
      a limitação de push, se a Decisão 1 for confirmada
- [x] `tasks/backlog.md` com T19 `concluída` e a linha do arquivo de detalhe

## Estado ao fim de T19

`npm test` fecha em **287 verdes no backend** (268 herdados de T18, mais 19 da entrega) e
**100 no frontend** (89 de T18, mais 9 da tela nova e 2 do `App`; um teste de
`TelaConfiguracaoAlerta` foi reescrito para o texto novo do aviso). `npm run typecheck` limpo
nos dois projetos, e `npm run test:sem-banco` continua em 96 verdes.

Código novo: `modules/alerta/alerta.service.ts` e `alerta.routes.ts` no backend;
`services/alertas.ts`, `pages/TelaAlertas.tsx` e o bloco de estilos correspondente no
frontend. `app.ts` registra as duas rotas; `eventoLog.service.ts` ganhou o décimo tipo
(`ALERTA_LIDO`); `App.tsx` ganhou a rota `/alertas`, o distintivo de não lidos e o rótulo
"Configurar alertas" para a tela de T17. **Nenhuma migração** — `lidoEm` existe desde T02 —,
e nem a varredura, nem o agendador, nem `validarSaidaFifo`, nem as rotas de T17 foram
tocados.

**Conferência no navegador** (`playwright-cli`, método do CLAUDE.md), sobre os dois alertas
que a conferência de T18 deixou no banco de desenvolvimento:

- a navegação como GESTOR mostra **"Alertas" com o distintivo `2`** e "Configurar alertas"
  como entrada separada, apontando para `/alertas` e `/alertas/configuracao`;
- `/alertas` lista os dois com produto, etiqueta, validade 24/09/2026, "Vence em 15 dias" e
  "avisado 30 dias antes";
- **Marcar como lido** troca o botão por "Lido" **sem tirar a linha da lista**, e o distintivo
  cai para `1`; com "Mostrar só os não lidos" ligado, a lista passa a mostrar um só;
- a tela de configuração exibe o aviso novo — a varredura roda, os alertas aparecem na aba
  Alertas, push ainda não está implantado;
- `console error` sem nenhum erro novo: os dois 401 de `/auth/me` são os da abertura da
  página antes do login, os mesmos de T18.

**No banco de desenvolvimento**, depois dessa conferência: um dos dois alertas com `lidoEm`
preenchido, e **um** `ALERTA_LIDO` com `unidadeId`, `produtoId`, assinado por
`gestor@estoque.local / GESTOR`, payload
`{ alertaId, configuracaoId, diasAntecedencia: 30, dataValidade: '2026-09-24', diasParaVencer: 15, geradoEm }`
— a validade como texto, não instante.

O alerta lido e o não lido ficam no banco de desenvolvimento como dado de demonstração.

## Decisões, confirmadas pelo orientando antes da implementação

As Decisões 3 e 5 foram **alteradas** em relação à proposta inicial; as demais foram
confirmadas como escritas.

**Decisão 1 — entregar in-app agora e deixar o push declarado como não implementado.**
A RF08 fala em "alerta in-app **e/ou** notificação push", e o canal de T17 já aceita `PUSH` e
`AMBOS`. Push de verdade (Web Push) custa: dependência `web-push`, par de chaves VAPID em
variável de ambiente, **uma tabela nova** de inscrições por dispositivo (com migração), troca
do service worker gerado pelo `vite-plugin-pwa` por um `injectManifest` com handler de `push`,
fluxo de permissão do navegador — e nada disso é verificável nesta máquina: exige HTTPS e
aparelho real, que é justamente o teste de campo que ainda está pendente na sua lista de
verificações manuais.

Proponho: **T19 entrega in-app**, e o push vira uma tarefa própria no backlog (T19b), honesta
sobre o que exige. Enquanto isso, alerta com canal `PUSH` ou `AMBOS` **aparece na lista
in-app assim mesmo**, e a tela de configuração diz isso em uma linha — a alternativa seria um
alerta configurado como `PUSH` que não chega a lugar nenhum, que é pior do que a promessa
parcial. Se você preferir o push dentro de T19, é uma tarefa bem maior e eu redesenho o
arquivo antes de começar.

**Decisão 2 — quem recebe o alerta é o GESTOR.**
A jornada J3 termina em "decisão comercial (promoção, destaque na vitrine)", que não é ato de
balcão. A configuração da janela já é GESTOR-only (T17) e a fila de descarte também (T13);
alerta para a atendente seria informação sobre a qual ela não pode agir, no meio do
atendimento. A consequência a registrar: **numa loja onde a gestora não abre o sistema, o
alerta não chega a ninguém** — e é uma limitação de processo, não de código.

**Decisão 3 — a unidade vendida ou descartada sai da lista; a que venceu continua, marcada.**
*(Decidido por você, contra a minha proposta inicial de omitir as vencidas.)*
T18 deixou isto explicitamente em aberto ("o que deve deixar de aparecer na tela é decisão de
T19"). O critério é **ainda haver o que fazer com o frasco**: vendido ou descartado, não há;
vencido, há — e o que há é encarar que o aviso não funcionou.

O alerta cuja unidade venceu **fica visível, marcado como vencida**, com encaminhamento para
a fila de descarte. Assume-se de propósito a duplicidade que T18 recusou para a *emissão*: a
mesma unidade aparece na tela de alertas e na fila de T13 ao mesmo tempo. A razão é que os
dois lugares dizem coisas diferentes — a fila diz "resolva este frasco", e o alerta vencido
diz "você foi avisado sobre este frasco e ele venceu assim mesmo". Some-lo seria apagar da
tela justamente o caso que mede se a RF08 funciona.

O que separa os dois casos no servidor é `situacao`, e não o sinal de `diasParaVencer`: a
tela não classifica nada por conta própria (RNF04).

A linha de `Alerta` **continua no banco** nos três casos — ela é o registro do que foi
emitido, e é dela e do `EventoLog` que a RF13 vai contar "a unidade alertada foi vendida
antes de vencer?".

**Decisão 4 — "lido" é da loja, não de cada gestor, e não tem desfazer.**
`Alerta.lidoEm` é uma coluna só (schema de T02, seção 5 do PRD): não há leitura por usuário.
Com dois gestores, o que um marcar some do contador do outro. Trocar isso exigiria tabela de
leitura por usuário e migração, e para uma perfumaria de pequeno porte com um ou dois
gestores é complexidade sem cliente. Também não proponho "marcar como não lido": a marcação
é reconhecimento ("vi este frasco"), e desfazer reconhecimento não é operação que a loja
precise. A lista sem filtro continua mostrando o alerta lido, que é o desfazer suficiente —
ele não some de vista.

**Decisão 5 — marcar como lido grava `ALERTA_LIDO`, décimo tipo de evento.**
*(Decidido por você, contra a minha proposta inicial de não gravar nada.)*
A lista de tipos do `eventoLog.service.ts` estava fechada nos nove do PRD (seção 5) desde T09,
e o comentário do módulo diz que acrescentar um depois do piloto começado quebra a
comparabilidade — por isso este acréscimo é **ato consciente, com data em `docs/decisoes.md`**,
e acontece **antes** do piloto, que é o momento em que ainda é barato.

O que ele compra: o intervalo entre `ALERTA_PROATIVO_EMITIDO` e `ALERTA_LIDO` da mesma
unidade, na mesma trilha, sem `JOIN` com formato diferente — quanto tempo a loja leva para
reagir a um aviso. É indicador de processo, e não de estoque, e é o tipo de coisa que o
artigo pode reportar.

Duas travas acompanham: o evento é assinado pelo **gestor que leu** (a conta de sistema
assina só o que não tem autor humano), e é gravado **uma vez** — a idempotência do `lidoEm`
vale também para o log, senão dois cliques viram dois reconhecimentos no dado da pesquisa.

**Decisão 6 — o contador vem da própria listagem, sem endpoint de contagem e sem polling.**
`naoLidos` já viaja na resposta de `GET /alertas`. O `App` busca uma vez ao autenticar (com
`tamanhoPagina=1`, só pelo número) e atualiza quando a tela de alertas informa um valor novo.
Sem `setInterval` batendo no servidor: o alerta é diário, e um contador que atrasa alguns
minutos não muda decisão nenhuma — enquanto um polling constante custaria bateria de celular
no balcão para nada.

## Notas técnicas

- **Nenhuma regra de janela é reimplementada aqui.** Quem decide o que entra na janela é a
  varredura (T18); esta tarefa lê o que ela escreveu. O filtro da Decisão 3 é sobre o *estado
  atual da unidade*, não sobre a janela — e usa o mesmo `hojeComoData()`, para não criar a
  terceira noção de "hoje" do sistema.
- **`geradoEm` é instante e `dataValidade` é data.** O primeiro descreve quando o job rodou; a
  segunda é data de calendário e vai como `AAAA-MM-DD` no JSON, como em toda a API (RNF01).
- **A consulta é `Alerta` com `include: { unidade: { include: { produto: true } } }` e
  `configuracao`**, numa ida só ao banco. Buscar produto por alerta seria N+1 numa lista que
  pode ter dezenas de linhas — o mesmo cuidado de T13.
- **`naoLidos` é uma segunda consulta (`count`)**, em paralelo com a listagem, porque a
  paginação impede derivá-lo da página carregada.
- **A tela de alertas não resolve unidade.** Não há `PainelExcecaoVencido` aqui: a unidade
  alertada não está vencida (por construção), então nenhum dos três caminhos da seção 6.1 se
  aplica. A ação que o alerta pede é comercial (promoção, vitrine) e acontece fora do sistema.

## Fora de escopo desta tarefa

- **Notificação push de verdade** — VAPID, tabela de inscrições, service worker com handler de
  `push`, permissão do navegador: Decisão 1. Entra no backlog como **T19b**, dependendo de
  T19.
- **Alerta para ATENDENTE**, e qualquer notificação no fluxo de balcão — Decisão 2.
- **Leitura por usuário** (quem leu, e não só quando) — Decisão 4.
- **Contagem, taxa ou relatório de alertas** ("quantos alertados foram vendidos antes de
  vencer") — é RF13, T20/T21, e lê o `EventoLog`, não esta tela.
- **Reemitir ou lembrar** — política de lembrete, recusada na Decisão 2 de T18.
- **Agregação por produto** ("este SKU tem 12 unidades na janela"): a RF08 fala de unidades, e
  agregar é dashboard.
- **Alterar a varredura, o agendador, `validarSaidaFifo` ou as rotas de T17.**
- **Qualquer migração de banco.** Se algo aqui pedir schema novo, é sinal de que saiu do
  escopo.
