# T20 — Endpoints agregados de dashboard (RF13)

**Depende de:** T09 (a `Saida`, com `tentativasAteAcerto` e `alertaFifoDisparado`) e T13 (a
fila do que venceu). Na prática também lê o que T11 (override, descarte) e T18 (alertas
emitidos) gravaram
**Incremento:** 6 (Dashboard e relatórios)
**Bloqueia:** T21 (a tela do dashboard)

## Objetivo

Transformar em números o que o `EventoLog` e as tabelas operacionais já registram — porque
é dessa consolidação que sai o resultado do TCC, não só um painel bonito.

Hoje cada dado da pesquisa existe, mas espalhado: quantas unidades estão em estoque só se
sabe contando `UnidadeProduto`; quantas vezes o FIFO bloqueou está em `ALERTA_FIFO_DISPARADO`;
quantas dessas viraram substituição efetiva está em `Saida.alertaFifoDisparado`; a perda está
em `Descarte`; o override está em `Saida.vendaDeUnidadeVencida`. Para responder "o sistema
reduziu a perda por vencimento?" alguém precisaria abrir o `psql`. A RF13 é o que fecha o
ciclo que a RF12 abriu: o log é o instrumento de coleta, o dashboard é a leitura do
instrumento.

Esta tarefa é **só o servidor**. A tela é T21. O que se entrega aqui é o contrato que ela vai
consumir, e ele nasce com o mesmo compromisso das outras rotas: **quem calcula é o servidor**
(RNF04) — nenhuma faixa de vencimento, nenhuma taxa e nenhuma comparação de data é derivada
no navegador.

## Critério de aceite

### Backend — `GET /dashboard`

- [x] Módulo novo `src/modules/dashboard/`, com `dashboard.routes.ts` e
      `dashboard.service.ts`, registrado em `app.ts`. Não entra em `saida/` nem em
      `descarte/`: aqueles módulos **produzem** o fato, este só o **conta**
- [x] Rota `GET /dashboard`, papel `GESTOR` (contrato já fixado em `docs/arquitetura.md`
      seção 5). É painel de gestão e dado de pesquisa, nunca fluxo de balcão
- [x] Recorte de período por `de` e `ate` (`AAAA-MM-DD`, ambos opcionais). Padrão: os
      **últimos 30 dias**, inclusive hoje (`de = hoje - 29`, `ate = hoje`). O período volta
      **ecoado** na resposta, para que a tela mostre de que intervalo está falando sem
      recalcular nada
- [x] `de > ate` é 400 `PERIODO_INVALIDO`, escrito na rota como as demais recusas de negócio
      (seção 5.1). Data em formato inválido cai no `CORPO_INVALIDO` do `errorHandler` de T12b,
      pelo `pattern` do JSON Schema
- [x] Resposta única, com os seis itens da RF13:

```json
{
  "periodo": { "de": "2026-08-11", "ate": "2026-09-09" },
  "estoque": {
    "unidadesEmEstoque": 812,
    "porFaixaDeVencimento": [
      { "faixa": "VENCIDA", "unidades": 12 },
      { "faixa": "ATE_7_DIAS", "unidades": 30 },
      { "faixa": "DE_8_A_30_DIAS", "unidades": 94 },
      { "faixa": "DE_31_A_90_DIAS", "unidades": 210 },
      { "faixa": "ACIMA_DE_90_DIAS", "unidades": 466 }
    ]
  },
  "saidas": {
    "total": 143,
    "naPrimeiraLeitura": 121,
    "taxaAcertoPrimeiraLeitura": 0.8462
  },
  "fifo": { "alertasDisparados": 31, "substituicoesEfetivas": 22 },
  "perdas": { "descartes": 9, "unidadesVencidasEmEstoque": 12 },
  "overrides": { "total": 2 }
}
```

- [x] **Snapshot × período, explicitamente separados.** `estoque` e
      `perdas.unidadesVencidasEmEstoque` descrevem o **agora** e ignoram `de`/`ate`; `saidas`,
      `fifo`, `perdas.descartes` e `overrides` são do **período**. A mistura silenciosa dos
      dois é o defeito clássico deste tipo de painel — ver Decisão 3
- [x] As cinco faixas saem sempre, na mesma ordem, **inclusive com `unidades: 0`**: faixa que
      some da resposta vira buraco no gráfico da T21 e sugere dado ausente onde há zero
- [x] A faixa `VENCIDA` usa o mesmo `hojeComoData()` e a mesma cláusula (`dataValidade < hoje`)
      da fila de T13, e `perdas.unidadesVencidasEmEstoque` é **o mesmo número**, repetido no
      recorte de perdas por ser lá que ele é lido como prejuízo iminente. Nenhuma segunda
      definição de "vencido"
- [x] `ATE_7_DIAS` **inclui a unidade que vence hoje** (`>= hoje`), pela mesma borda que a
      mantém no pool prioritário do FIFO. As faixas são contíguas e não se sobrepõem: toda
      unidade `EM_ESTOQUE` cai em exatamente uma, e a soma das cinco é `unidadesEmEstoque`
- [x] `saidas.total` conta `Saida` no período; `naPrimeiraLeitura` é
      `tentativasAteAcerto = 0`; `taxaAcertoPrimeiraLeitura` é a razão entre os dois,
      arredondada a 4 casas, e é **`null` quando `total = 0`** — ver Decisão 4
- [x] `fifo.alertasDisparados` conta `ALERTA_FIFO_DISPARADO` no `EventoLog` por `ocorridoEm`;
      `fifo.substituicoesEfetivas` conta `Saida` com `alertaFifoDisparado = true`. É o "vs."
      literal da RF13: quantas vezes o sistema bloqueou, e quantas vezes o bloqueio terminou
      em venda da unidade certa
- [x] `perdas.descartes` conta `Descarte` por `dataHora` no período; `overrides.total` conta
      `Saida` com `vendaDeUnidadeVencida = true` no período
- [x] Contagens por `count`/`groupBy` no banco, nunca carregando linhas para contar em
      JavaScript, e disparadas em paralelo (`Promise.all`). O painel é uma requisição só e a
      RNF06 (<500ms) vale para ela
- [x] Nenhum `EventoLog` gravado. Consultar o painel não é ato operacional — e um evento aqui
      sujaria justamente a tabela de onde o painel lê
- [x] Nenhuma alteração em `validarSaidaFifo`, nos módulos que produzem os fatos, nem no
      schema Prisma

### Backend — `GET /dashboard/saidas` (histórico de saídas)

- [x] Mesma rota-mãe, mesmo módulo, papel `GESTOR`. É o item "histórico de saídas" da RF13,
      que é **lista** e não cabe no agregado — ver Decisão 1
- [x] Mesmo recorte de período (`de`/`ate`, mesmos padrões e mesma recusa) e paginação no
      formato de `/descartes/pendentes` (`pagina`, `tamanhoPagina`, padrão 20, máximo 100),
      respondendo `{ saidas, total, pagina, tamanhoPagina, periodo }`
- [x] Ordenação por `dataHora` **decrescente** (a mais recente primeiro — é histórico, não
      fila de urgência), com desempate por `id` para a paginação ser estável
- [x] Filtro `apenasOverrides` (booleano, padrão `false`): é o que dá corpo ao item "overrides
      autorizados" da RF13, que sem isso seria um número sem como olhar quais foram
- [x] Cada item traz a unidade no `UnidadeNaResposta` de sempre, mais `dataHora`,
      `tentativasAteAcerto`, `alertaFifoDisparado`, `vendaDeUnidadeVencida`,
      `justificativaOverride`, `sessaoVendaId`, `usuario` (`{ id, nome }`) e `autorizadoPor`
      (`{ id, nome }` ou `null`)
- [x] `include` de unidade, produto e usuários numa consulta só, sem N+1
- [x] Histórico vazio é 200 com lista vazia, nunca 404

### Backend — testes (Vitest, contra PostgreSQL real)

- [x] `backend/tests/dashboard/dashboard.test.ts` e
      `backend/tests/dashboard/historicoSaidas.test.ts`, reusando `tests/apoio/cenario.ts`.
      Script `test:dashboard` no `package.json`, como os demais módulos
- [x] **Faixas:** unidades posicionadas em -1, 0, +7, +8, +30, +31, +90 e +91 dias caem cada
      uma na faixa esperada (as sete bordas), e a soma das faixas bate com
      `unidadesEmEstoque`
- [x] Unidade `VENDIDA` e `DESCARTADA` **não** contam em `estoque`; unidade de produto
      inativo **conta** (o frasco continua na prateleira, como na fila de T13)
- [x] `VENDIDA`/`DESCARTADA` fora do estoque, mas a saída e o descarte **dentro** dos números
      de período: é o mesmo frasco visto pelos dois recortes, e é o teste que prova que
      snapshot e período não se contaminam
- [x] **Período:** fato do dia anterior a `de` e fato do dia seguinte a `ate` ficam fora; fato
      **no próprio dia de `de`** e **no próprio dia de `ate`** ficam dentro (bordas inclusivas
      nas duas pontas, no fuso do servidor — ver Notas técnicas)
- [x] Período padrão: sem `de`/`ate`, o intervalo devolvido é `hoje-29 .. hoje` e uma saída de
      40 dias atrás fica de fora
- [x] `de > ate` responde 400 `PERIODO_INVALIDO`; `de` malformado responde 400
      `CORPO_INVALIDO`
- [x] **`fifo`:** cenário de ponta a ponta pelo endpoint real (`POST /saidas/ler`) — duas
      leituras erradas seguidas da certa produzem `alertasDisparados: 2` e
      `substituicoesEfetivas: 1`, com `taxaAcertoPrimeiraLeitura` refletindo a saída que
      precisou de tentativa. É a prova de que o painel lê o que o núcleo grava, e não uma
      segunda contagem escrita à mão
- [x] `taxaAcertoPrimeiraLeitura` é `null` em período sem nenhuma saída, e `1` quando todas
      acertaram de primeira
- [x] **Override** feito por `POST /excecao-vencido/override` aparece em `overrides.total`,
      **não** infla `fifo.substituicoesEfetivas` (não passou pelo laço) e conta em
      `saidas.total`; descarte por `POST /excecao-vencido/descartar` aparece em
      `perdas.descartes` e tira a unidade do estoque
- [x] **Histórico:** ordem decrescente com paginação estável (segunda página não repete nem
      pula), `total` conta o período inteiro e não a página, `apenasOverrides` traz só o
      override e com `justificativaOverride` e `autorizadoPor` preenchidos, e uma saída comum
      traz `autorizadoPor: null`
- [x] Papel nas duas rotas: `ATENDENTE` recebe 403 `PAPEL_INSUFICIENTE`; sem cookie, 401
- [x] Banco vazio responde 200 com tudo zerado e as cinco faixas presentes — nunca 404 nem
      divisão por zero

### Fechamento

- [x] `npm test` e `npm run typecheck` verdes no backend; a suíte do frontend continua
      passando **sem edição** (esta tarefa não toca em `frontend/`)
- [x] Conferência por `curl` nas duas rotas contra o banco de desenvolvimento, incluindo o
      403 da atendente. **Sem navegador:** é tarefa de backend, e o CLAUDE.md restringe o
      `playwright-cli` a alterações de UI
- [x] `docs/arquitetura.md`: seção 5 ganha a forma das duas respostas e a linha de
      `/dashboard/saidas`; seção 2 registra o módulo `dashboard`
- [x] `docs/decisoes.md` e `docs/notas-para-artigo.md` com as entradas do dia
- [x] `tasks/backlog.md` com T20 `concluída`

## Estado ao fim de T20

As cinco decisões abaixo foram **confirmadas pelo orientando** antes da implementação, sem
alteração.

`npm test` fecha em **365 verdes no backend** (324 herdados, sem uma linha editada, mais 41
desta tarefa: 27 dos agregados e 14 do histórico). `npm run typecheck` limpo, e a suíte do
frontend segue em 111 verdes — esta tarefa não tocou em `frontend/`.

Código novo: `modules/dashboard/` (serviço e rota), registrado em `app.ts`, e o par
`inicioDoDia`/`inicioDoDiaSeguinte` mais `textoDeData` em `shared/data.ts`. `package.json`
ganhou `test:dashboard`. Nenhuma alteração em `validarSaidaFifo`, nos módulos que produzem os
fatos, no schema Prisma ou em migração.

Conferido por `curl` contra o servidor e o banco de desenvolvimento (método do CLAUDE.md para
backend — sem navegador):

- `GET /dashboard` devolvendo o estado real acumulado pelas conferências anteriores: 13
  unidades em estoque distribuídas nas cinco faixas, 5 bloqueios de FIFO com 0 substituições
  efetivas, 4 descartes, 1 override;
- `GET /dashboard/saidas` com o override trazendo justificativa e `autorizadoPor`, e a saída
  comum com `autorizadoPor: null`; `apenasOverrides=true` isolando a primeira;
- 403 `PAPEL_INSUFICIENTE` para a atendente nas duas rotas, 401 sem cookie;
- 400 `PERIODO_INVALIDO` no intervalo invertido, e 400 `CORPO_INVALIDO` tanto em `de=ontem`
  quanto em `de=2026-02-31` — o `format: 'date'` recusa o dia que não existe, como previsto;
- latência de 7 a 15 ms em ambas, folgada dentro da RNF06 (<500ms). Nenhum índice novo foi
  necessário.

Um achado apareceu na conferência, e está registrado como limitação em
`docs/notas-para-artigo.md`: o banco de desenvolvimento devolveu `taxaAcertoPrimeiraLeitura: 1`
com `saidas.total: 2`, sendo **uma delas um override** — que grava `tentativasAteAcerto = 0`
sem ter passado pelo laço do FIFO e por isso conta como acerto de primeira. É a distorção
prevista na Decisão 5, vista em dado real. Corrigi-la mudaria o significado de um indicador já
contratado, então fica como decisão sua.

## Pontos que precisavam da sua validação antes de eu codar (confirmados)

**Decisão 1 — duas rotas, não uma.** `docs/arquitetura.md` fixou só `GET /dashboard`, mas
cinco dos seis itens da RF13 são números e o sexto ("histórico de saídas") é uma lista longa
e paginada. Enfiá-la no agregado faria toda abertura do painel carregar linhas que a tela
mostra num canto, e paginar dentro de um objeto de indicadores é contrato torto. Proponho
`GET /dashboard/saidas`, no mesmo módulo e mesmo papel — o painel é o contexto, e é o mesmo
padrão de `/descartes/pendentes`. A alternativa seria `GET /saidas`, que eu evito porque
partiria o prefixo `/saidas` entre dois módulos: quem for procurar acharia `saida.routes.ts`,
onde ela não estaria.

**Decisão 2 — as faixas de vencimento são fixas no código, não vêm de `ConfiguracaoAlerta`.**
Seria tentador derivá-las das janelas que a gestora configurou em T17 (30 e 7 dias), e há
elegância nisso. Recuso por dois motivos: o painel é instrumento de pesquisa, e um gráfico
cujas faixas mudam quando alguém edita uma configuração deixa de ser comparável entre dois
momentos do piloto; e a janela de alerta responde "sobre o que me avisam?", enquanto a faixa
responde "como está distribuído o estoque?" — perguntas diferentes que só por acaso usam a
mesma unidade de medida. Fixo: vencida, até 7, 8–30, 31–90, acima de 90.

**Decisão 3 — o painel mistura dois tempos, e isso vai na resposta em vez de ficar
implícito.** Estoque é fotografia do agora; perda, saída e override são do período escolhido.
Não dá para uniformizar: "unidades em estoque no período" não significa nada (o estoque de
qual dia?), e "perdas agora" seria o total histórico. A resposta separa os dois em objetos
distintos e ecoa o período, para que a T21 consiga rotular cada bloco. Se você preferir que a
distinção apareça de forma ainda mais explícita (um campo `escopo: 'AGORA' | 'PERIODO'` por
bloco), é barato mudar agora e caro depois que a tela existir.

**Decisão 4 — `taxaAcertoPrimeiraLeitura` é `null`, não `0`, quando não houve saída.** Zero
por cento de acerto e "nenhuma venda ainda" são fatos opostos, e um painel que mostra 0% num
dia parado sugere um sistema que não funciona. `null` obriga a tela a dizer "sem dados no
período", que é a verdade. O custo é a T21 tratar o caso.

**Decisão 5 — o denominador da taxa é a saída, não a leitura.** `docs/arquitetura.md` (seção
4) observa que o `LEITURA_QR_SAIDA` existe para dar denominador à "taxa de acerto na primeira
leitura". Há duas leituras possíveis desse indicador: *por venda* (das saídas concluídas,
quantas foram na primeira tentativa) e *por leitura* (das leituras de QR, quantas
confirmaram). Proponho a primeira, porque é ela que responde "com que frequência a atendente
pega o frasco certo de primeira" sem contaminar o número com leitura de QR inexistente,
unidade já baixada ou tentativa de venda de unidade vencida — casos que não são erro de FIFO.
O dado bruto para a segunda leitura continua no log, intacto, e ela pode virar um indicador a
mais em T21 ou na análise. Se você preferir a segunda desde já, é onde eu mudaria.

## Notas técnicas

- **A borda do período é o dia local, não a meia-noite UTC.** `dataValidade` é `DATE`
  (RNF01), mas `Saida.dataHora` e `Descarte.dataHora` são instantes. Converter `de`/`ate` com
  o `dataDeString()` atual ancoraria o corte na meia-noite **UTC**, e em BRT (UTC-3) uma venda
  das 22h cairia no dia seguinte do relatório — a mesma classe de erro que a RNF01 existe para
  evitar, entrando pela porta do recorte. Entra em `shared/data.ts` um par
  `inicioDoDia`/`fimDoDia` que monta o instante a partir dos componentes **locais**, coerente
  com o `hojeComoData()` que já lê a hora local do servidor. É decisão de arquitetura e vai
  para `docs/decisoes.md`.
- **`fifo.alertasDisparados` vem do `EventoLog`; `substituicoesEfetivas`, da `Saida`.** São
  tabelas diferentes de propósito: um bloqueio pode não terminar em venda (a atendente
  desiste, o cliente vai embora), e é exatamente essa diferença que a RF13 pede para ver. Se
  os dois números viessem da mesma tabela, o "vs." não teria conteúdo.
- **A conta de sistema aparece no log e não na `Saida`.** `ALERTA_PROATIVO_EMITIDO` é
  assinado por `sistema@estoque.local` (T18), mas nenhum dos números desta tarefa conta
  eventos assinados por ela — `alertasDisparados` é `ALERTA_FIFO_DISPARADO`, que só a leitura
  humana gera. Nada a filtrar aqui; a observação fica registrada para quando o painel ganhar
  contagem de alertas proativos.
- **Sem índice novo.** A contagem por faixa varre `UnidadeProduto` por `status` e
  `dataValidade`, e o índice existente é `[produtoId, status, dataValidade]`, que não a
  atende. Na escala do piloto (~700 SKUs) isso é irrelevante, e uma migração só para o painel
  encareceria toda escrita de unidade em troca de nada. Se a conferência por `curl` mostrar
  latência fora da RNF06, registro o achado e vira tarefa própria — como T12 fez com o
  `errorHandler`.
- **Zero é resposta, não ausência.** Todo número desta tarefa nasce zerado num banco vazio, e
  nenhuma rota devolve 404 por não ter o que contar. Um painel que some quando não há dado é
  pior do que um painel de zeros: some justamente no começo do piloto.

## Fora de escopo desta tarefa

- **Toda a tela** — gráficos, filtros, seleção de período na interface: é T21.
- **Exportação (CSV, PDF) dos números.** A análise do TCC sai do banco com `psql`; exportação
  é conveniência, e não requisito da RF13.
- **Séries temporais** ("perdas por semana", curva de acerto ao longo do piloto). A RF13 pede
  os números do período, não a evolução dentro dele. É o candidato natural a trabalho futuro,
  e vai declarado como tal.
- **Comparação entre dois períodos** ("este mês vs. o anterior"), que é o formato em que a
  pergunta do TCC vai ser respondida — mas fora do sistema, na análise.
- **Contagem de alertas proativos emitidos e lidos** (RF08). Está no `EventoLog` e responde
  uma pergunta legítima, mas não é item da RF13.
- **Valor financeiro da perda.** `Produto` não tem preço, e inventar um campo aqui é mudança
  de modelo de dados fora de qualquer requisito.
- **Qualquer alteração em `validarSaidaFifo`, nos módulos que gravam os fatos, ou no schema.**
