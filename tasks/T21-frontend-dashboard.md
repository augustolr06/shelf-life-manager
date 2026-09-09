# T21 — Frontend do dashboard (RF13)

**Depende de:** T20 (as duas rotas agregadas). Reusa o `UnidadeNaResposta` de T05/T08, a
paginação de T13 e a moldura de rota/papel de T10
**Incremento:** 6 (Dashboard e relatórios)
**Bloqueia:** — (é a última tarefa de código do backlog)

## Objetivo

Dar rosto aos números que T20 já calcula. Hoje a RF13 está inteira no servidor e só é
legível por `curl`: a gestora não tem como abrir o resultado do piloto, e o dado que
sustenta o TCC continua acessível só para quem sabe montar a URL.

Esta tarefa é **só a tela**. Nenhum número novo é calculado aqui — nem faixa, nem taxa, nem
comparação de data. O painel exibe o que `GET /dashboard` e `GET /dashboard/saidas`
devolveram, com a mesma disciplina do veredito do balcão (RNF04): a tela reflete, não decide.
A única coisa que a interface acrescenta é a **pergunta** — qual período olhar — e ela vai
para o servidor como parâmetro, não como conta feita no navegador.

O que a tela precisa comunicar, além dos números, é a distinção que a resposta já carrega na
forma: `estoque` é fotografia do **agora**; `saídas`, `fifo`, `descartes` e `overrides` são do
**período escolhido**. Um painel que empilha os dois sem rótulo transforma o número certo em
interpretação errada — foi o motivo de T20 separá-los em objetos distintos, e aqui é onde
essa separação ou vira legível, ou se perde.

## Critério de aceite

### Serviço — `frontend/src/services/dashboard.ts`

- [x] Módulo novo, no padrão dos demais serviços: só tipos espelhando a resposta do backend e
      as duas funções de chamada, via `requisitarApi`. Nenhuma regra, nenhum cálculo derivado
- [x] Tipos `Faixa`, `ContagemDaFaixa`, `Periodo`, `Dashboard`, `SaidaNoHistorico` e
      `HistoricoDeSaidas`, iguais aos exportados por `dashboard.service.ts` (inclusive
      `taxaAcertoPrimeiraLeitura: number | null` e `autorizadoPor: … | null`)
- [x] `buscarDashboard(periodo?)` e `listarHistoricoDeSaidas(filtros?)`. Parâmetro no padrão é
      **omitido** da URL, como em `listarProdutos`, `listarDescartesPendentes` e
      `listarAlertas`: sem período escolhido, a URL é `/dashboard` puro e quem decide o
      recorte padrão continua sendo o servidor
- [x] `apenasOverrides` e `pagina` só entram na querystring quando saem do padrão

### Tela — `frontend/src/pages/TelaDashboard.tsx`, rota `/dashboard`

- [x] Aba nova em `App.tsx`, `papeis: ['GESTOR']` — mesma lista das duas rotas no backend.
      Esconder a aba é conveniência; quem recusa de fato é o 403 (RNF04)
- [x] A rota inicial do GESTOR **continua sendo `/produtos`**. Trocá-la é decisão sua (ver
      Ponto 4), e não entra sem sua palavra
- [x] **Seletor de período**: dois campos `date` (`de`, `ate`) e um botão de aplicar. Vazios,
      não vão na URL e o servidor aplica os últimos 30 dias; o intervalo **ecoado** na resposta
      é o que a tela exibe e o que preenche os campos depois da primeira carga — a tela nunca
      calcula "hoje − 29"
- [x] `de > ate` chega como 400 `PERIODO_INVALIDO` e é exibido com a mensagem do backend, sem
      validação de intervalo escrita no navegador (RNF04). O `type="date"` já impede a data
      malformada de sair da tela
- [x] **Bloco "Estoque agora"**, rotulado como fotografia do momento e explicitamente fora do
      período: `unidadesEmEstoque` em destaque e as cinco faixas
- [x] As faixas aparecem como **barras horizontais em CSS** (largura proporcional ao maior
      valor), com o número ao lado de cada uma. As cinco saem sempre, inclusive zeradas — é o
      que o backend garante, e some-las na tela recriaria o buraco que ele evita
- [x] O gráfico é acessível: cada faixa é um item de lista com rótulo e valor em texto: a
      barra é decoração (`aria-hidden`), não a informação. Nenhuma biblioteca de gráfico (ver
      Ponto 1)
- [x] **Bloco "No período"**, com o intervalo ecoado no título: saídas (`total`,
      `naPrimeiraLeitura`, taxa em %), FIFO (`alertasDisparados` **vs.**
      `substituicoesEfetivas`, lado a lado — é o "vs." literal da RF13), perdas
      (`descartes`) e `overrides.total`
- [x] `taxaAcertoPrimeiraLeitura: null` vira **"sem saídas no período"**, nunca "0%" — é o
      caso que a Decisão 4 de T20 criou para a tela tratar
- [x] A taxa é formatada como percentual com uma casa (`0.8462` → `84,6%`). É formatação de
      exibição, não cálculo de indicador
- [x] `perdas.unidadesVencidasEmEstoque` aparece no bloco do **agora**, junto do estoque, e
      não no bloco do período — é o mesmo número da faixa `VENCIDA`, e o backend o repete por
      ser lido ali como prejuízo iminente. Com link para a fila de descarte (`/descartes`),
      que é onde ele se resolve
- [x] **Bloco "Histórico de saídas"**: lista paginada no padrão de T13/T19 (Anterior/Próxima,
      "página X de Y"), ordem já vem do servidor, cada linha com produto, etiqueta, validade,
      data/hora da saída, quem vendeu, tentativas até o acerto e as marcas de
      `alertaFifoDisparado` / `vendaDeUnidadeVencida`
- [x] Override na lista mostra **justificativa e quem autorizou**; saída comum não mostra
      campo vazio nenhum
- [x] Filtro `apenasOverrides` como caixa de seleção, no padrão do `apenasNaoLidos` de T19.
      Trocar o filtro volta para a página 1
- [x] O período do seletor vale para os **dois** blocos numa aplicada só: o histórico é
      recarregado com o mesmo `de`/`ate` do agregado
- [x] Estados de carregamento, erro (`ErroApi`, mensagem do backend) e vazio, como nas demais
      telas. Período sem movimento é 200 com zeros — mostra os zeros, não "erro"
- [x] `dataHora` da saída é **instante**: exibida com data e hora (`toLocaleString`), não pelo
      `formatarData` de calendário. `dataValidade` continua no `formatarData`, que fatia o
      texto sem passar por fuso (RNF01)
- [x] Estilos em `estilos.css`, no padrão enxuto do arquivo (`.tela-dashboard`, `.indicador`,
      `.grafico-faixas`, `.historico-saidas`)

### Testes (Vitest + Testing Library) — `TelaDashboard.test.tsx`

- [x] `fetch` dublado com `respostaFalsa`, como nas demais telas. Sem tocar em backend
- [x] Carga inicial: as duas rotas são chamadas **sem** `de`/`ate` na URL, e o período exibido
      é o que a resposta ecoou
- [x] As cinco faixas aparecem em ordem e com rótulo legível, **inclusive a de valor zero**
- [x] Aplicar um período manda `de` e `ate` nas duas requisições, e o título do bloco do
      período passa a mostrar o novo intervalo
- [x] 400 `PERIODO_INVALIDO` exibe a mensagem do backend e não quebra a tela
- [x] `taxaAcertoPrimeiraLeitura: null` exibe "sem saídas no período" e **não** exibe "0%"
- [x] `taxaAcertoPrimeiraLeitura: 0` (houve saída, nenhuma de primeira) exibe "0,0%" — é o par
      do teste anterior, e o que prova que os dois casos não foram colapsados
- [x] `alertasDisparados` e `substituicoesEfetivas` aparecem como dois números distintos
- [x] Histórico: override mostra justificativa e autorizador; saída comum não mostra nenhum
      dos dois; marcar `apenasOverrides` refaz a chamada com o filtro e volta à página 1
- [x] Paginação chama a rota com `pagina=2` e não altera o agregado (uma requisição só,
      não duas)
- [x] Banco vazio: zeros nos indicadores, cinco faixas presentes, histórico com mensagem de
      lista vazia — nunca tela em branco
- [x] A suíte do backend continua passando **sem edição**: esta tarefa não toca em `backend/`

### Fechamento

- [x] `npm test` e `npm run typecheck` verdes no frontend; backend intocado
- [x] Conferência no navegador com `playwright-cli`, **só o caminho alterado** (CLAUDE.md):
      abrir `/dashboard` como gestora, conferir os blocos e o gráfico por `snapshot`, aplicar
      um período, paginar o histórico, e `console error` limpo
- [x] `docs/arquitetura.md`: seção 5 registra a tela como consumidora das duas rotas (a seção 2
      não enumera telas, e a estrutura de pastas não mudou)
- [x] `docs/decisoes.md` e `docs/notas-para-artigo.md` com as entradas do dia
- [x] `tasks/backlog.md` com T21 `concluída`

## Estado ao fim de T21

Os cinco pontos abaixo foram **confirmados pelo orientando** antes da implementação, sem
alteração.

`npm test` fecha em **127 verdes no frontend** (111 herdados, sem uma linha editada, mais 16
desta tarefa). `npm run typecheck` limpo. O backend segue em **365 verdes sem edição** — esta
tarefa não tocou em `backend/`.

Código novo: `services/dashboard.ts`, `pages/TelaDashboard.tsx` e seu teste, mais
`formatarInstante` em `services/datas.ts`, a aba `/dashboard` em `App.tsx` e o bloco de
estilos do painel em `estilos.css`. Nenhuma dependência nova.

Conferido no navegador com o `playwright-cli` (método do CLAUDE.md para UI), autenticado como
gestora, contra o banco de desenvolvimento:

- `/dashboard` com o estado real acumulado pelas conferências anteriores: 13 unidades em
  estoque nas cinco faixas (1 vencida, 0, 2, 3, 7), 2 saídas, 5 bloqueios de FIFO contra 0
  substituições efetivas, 4 descartes e 1 override;
- período aplicado (`08/09/2026 a 08/09/2026`) chegando ecoado no título do bloco, e as duas
  rotas recebendo o mesmo recorte;
- intervalo invertido devolvendo a mensagem do backend nos dois blocos, com o 400
  `PERIODO_INVALIDO` visível na rede — a recusa é do servidor, não da tela;
- `apenasOverrides` reduzindo o histórico de 2 para 1 saída, com justificativa e autorizadora;
- `console error` sem nenhum erro de runtime: os cinco registrados são os dois 401 de
  `/auth/me` antes do login e os três 400 do período invertido provocado de propósito.

Dois ajustes vieram da conferência visual, ambos no que já estava escrito no critério:

- **faixa zerada não desenha barra.** O `min-width: 2px` que mantinha visível a barra de uma
  unidade desenhava um traço idêntico na faixa de zero — o gráfico dizia "quase nada" onde o
  número dizia "nada". Passou a `max(2px, …)` só para valor diferente de zero;
- o rótulo do filtro do histórico ganhou o mesmo alvo de toque de 2,75 rem do filtro da tela
  de alertas, que ele não tinha herdado.

**O que a conferência no navegador não alcançou:** a paginação do histórico. O banco de
desenvolvimento tem 2 saídas e o tamanho de página é 20, então os botões não chegam a
aparecer. O caminho está coberto por dois testes de Vitest (`pagina=2` na URL e o agregado
**não** recarregado ao paginar), e forçá-lo no navegador exigiria fabricar saídas — escrita
operacional que uma conferência de tela não deve produzir.

## Pontos que precisavam da sua validação antes de eu codar (confirmados)

**Ponto 1 — gráfico em CSS, sem biblioteca.** A RF13 pede "unidades por faixa de vencimento",
e são cinco barras. Proponho desenhá-las com `div` de largura proporcional em CSS, com o
rótulo e o número em texto ao lado. A alternativa seria uma dependência de gráficos
(`recharts` e afins): traz eixos e tooltips prontos, mas acrescenta ~500 kB a um PWA que
precisa carregar em celular de loja (RNF07), e o projeto até aqui não instalou nenhuma
dependência de conveniência. Se você quiser gráfico "de verdade" na defesa, é a hora de dizer.

**Ponto 2 — um período para a tela inteira, não um por bloco.** Os dois endpoints aceitam
`de`/`ate` independentes. Proponho um seletor só, aplicado aos dois: dois seletores na mesma
tela produziriam um painel em que o agregado fala de agosto e a lista de setembro, e ninguém
percebe. O custo é não dar para "ver o total do mês com o histórico da semana".

**Ponto 3 — o histórico mora no dashboard, não em tela própria.** É o sexto item da RF13 e o
único que é lista. Poderia virar `/saidas` no menu. Proponho mantê-lo como bloco de
`/dashboard` porque o número ("2 overrides") e a lista ("quais foram") são a mesma pergunta em
duas resoluções, e separá-los obrigaria a repetir o seletor de período. Se a lista crescer a
ponto de incomodar no piloto, virar tela própria é barato.

**Ponto 4 — a rota inicial do GESTOR continua `/produtos`.** Um painel é candidato natural a
tela de entrada, e `rotaInicial()` em `App.tsx` é uma linha. Não mudo por conta própria: é
decisão de produto, não de implementação. Diga se quer que o gestor caia no dashboard.

**Ponto 5 — o que a tela faz com a distorção da taxa.** T20 registrou que o override entra no
denominador como acerto de primeira. Proponho **exibir a nota na tela**, curta, junto da taxa
("inclui N venda(s) autorizada(s) de unidade vencida"), usando o `overrides.total` que já vem
na mesma resposta — sem recalcular a taxa, que continua sendo a do servidor. É a forma de a
limitação não depender de quem leu o `docs/notas-para-artigo.md`. Se preferir o número limpo,
tiro.

## Notas técnicas

- **Nenhuma conta de negócio no navegador.** A única aritmética permitida aqui é de
  *apresentação*: largura da barra (proporção do maior valor), percentual formatado a partir
  da taxa que o servidor já calculou, e `Math.ceil(total / tamanhoPagina)` da paginação — a
  mesma que T13 e T19 já fazem. Faixa, taxa, período padrão e o que é "vencido" chegam
  prontos.
- **Duas requisições, não uma.** São duas rotas, e o agregado não deve ser recarregado quando
  só a página do histórico muda. O seletor de período é o único gatilho que dispara as duas.
- **`dataHora` é instante e `dataValidade` é `DATE`** — e a tela precisa tratar os dois
  diferente. `formatarData` existe justamente porque `new Date('2027-03-01')` volta um dia
  atrás em fuso negativo; aplicá-lo a um instante ISO com hora jogaria fora a hora, e usar
  `toLocaleDateString` na validade reintroduziria o bug que a RNF01 evita.
- **Offline (RNF07).** O dashboard não é fluxo de balcão e não precisa do bloqueio explícito
  da tela de leitura: sem rede, `requisitarApi` devolve `SEM_RESPOSTA` e a tela mostra o erro
  de carregamento como qualquer outra. Não há veredito em jogo.
- **Sem `setInterval`.** Mesma razão do contador de alertas em `App.tsx`: o painel é consultado
  deliberadamente, e polling custaria bateria no balcão para atualizar número que ninguém está
  olhando. Recarrega quem clicar em aplicar.

## Fora de escopo desta tarefa

- **Qualquer alteração no backend.** Se a tela precisar de um número que a resposta não tem, a
  resposta certa é registrar o achado e abrir tarefa — como T12 fez com o `errorHandler`.
- **Exportação (CSV, PDF)** dos números ou do histórico. A análise do TCC sai do banco.
- **Séries temporais e comparação entre dois períodos** — fora do escopo desde T20, e
  declarados como trabalho futuro em `docs/notas-para-artigo.md`.
- **Filtro do histórico por produto, atendente ou `sessaoVendaId`.** O backend só oferece
  `apenasOverrides`; inventar filtro no cliente significaria filtrar a página, não o período,
  que é pior do que não ter.
- **Gráfico de evolução, medidor, cor por severidade além do já usado no projeto.** O painel é
  instrumento de leitura, não peça de marketing.
- **Contagem de alertas proativos (RF08) no painel.** Não é item da RF13.
