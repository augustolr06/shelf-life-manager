# T18 — Job de verificação periódica + geração de `Alerta` (RF08)

**Depende de:** T17 (a janela de antecedência, que este job lê) e T05 (as unidades com
validade, que ele varre). Na prática também de T09, que estabeleceu quem pode escrever no
`EventoLog`
**Incremento:** 5 (Alertas proativos)
**Bloqueia:** T19 (a entrega do aviso, que consome as linhas de `Alerta` que este job cria)

## Objetivo

Fazer o sistema **olhar o estoque sozinho**.

Tudo o que existe até aqui depende de alguém agir primeiro: o FIFO decide quando uma
atendente lê um QR (T07–T10), a fila de descarte (T13) só mostra o que **já** virou perda, e
a janela de antecedência (T17) é um número guardado que ninguém lê. A jornada J3 do PRD pede
o contrário disso — "verificação periódica de unidades dentro da janela → alerta →
decisão comercial **antes** da perda".

Esta tarefa é a varredura: cruzar cada configuração ativa com as unidades em estoque e
materializar uma linha de `Alerta` para cada unidade que entrou na janela daquela
configuração. Nada é exibido a ninguém — a entrega do aviso (in-app, push, marcar como lido)
é T19. É a mesma fatia fina que T14 fez ao gerar o símbolo do QR antes de T15 imprimi-lo.

## Critério de aceite

### Backend — a varredura (`modules/alerta/`)

- [x] `src/modules/alerta/varreduraAlertas.ts`, com uma função exportada
      `varrerEstoqueParaAlertas()`. Nome de arquivo com prefixo próprio, ao lado do
      `configuracaoAlerta.*` que já existe: configuração e varredura são coisas diferentes,
      e T19 vai acrescentar uma terceira (a entrega)
- [x] A varredura lê as configurações **ativas** (`ativo = true`). Configuração inativa é
      ignorada: é o que `DELETE /configuracao-alerta/:id` significa desde T17
- [x] Para cada configuração, a janela é `hoje <= dataValidade <= hoje + diasAntecedencia`,
      com `hoje` vindo de `hojeComoData()` — a mesma função do FIFO e da fila de descarte.
      Nenhuma segunda noção de "hoje" no sistema
- [x] **A unidade já vencida não entra** (`dataValidade < hoje`). Ela é assunto da fila de
      T13, e alertar sobre perda consumada seria a terceira listagem da mesma coisa — ver
      Decisão 4
- [x] Só `status = EM_ESTOQUE`. Unidade `VENDIDA` ou `DESCARTADA` saiu do estoque e não tem
      vencimento a prevenir
- [x] Unidade de **produto inativo entra**, pelo mesmo motivo de T13: inativar o SKU não
      tira o frasco da prateleira
- [x] **Um `Alerta` por par (unidade, configuração), uma vez só** — ver Decisão 2. Rodar a
      varredura duas vezes no mesmo dia, ou dez vezes, não cria uma segunda linha
- [x] Duas configurações ativas (30 e 7 dias) geram **dois** alertas para a mesma unidade,
      um por configuração, em momentos diferentes do calendário. É o uso previsto em T17
      (janela larga para decisão comercial, estreita para última chamada)
- [x] Cada `Alerta` criado grava um `ALERTA_PROATIVO_EMITIDO` no `EventoLog`, pelo
      `eventoLog.service.ts` (único autorizado a escrever lá), **na mesma transação** da
      criação do alerta. Um por alerta, não um por varredura — ver Decisão 5
- [x] O evento leva `unidadeId`, `produtoId` e payload com `configuracaoId`,
      `diasAntecedencia`, `canal`, `dataValidade` (texto `AAAA-MM-DD`, por `dataParaPayload`)
      e `diasParaVencer`
- [x] `usuarioId` do evento é o **usuário de sistema** — ver Decisão 3
- [x] A escrita segue o padrão de lote de T05: ids pré-gerados e
      `prisma.$transaction([...criacoes, ...eventos])` na forma de array, uma transação por
      configuração. Sem `SELECT ... FOR UPDATE`: nada de estoque muda aqui, e a RNF02 é
      sobre a baixa da unidade
- [x] A função devolve um resumo `{ configuracoesAvaliadas, unidadesNaJanela, alertasEmitidos }`
      para que o agendador registre no log o que aconteceu
- [x] Nenhuma alteração em `validarSaidaFifo`, nos módulos existentes ou nas quatro rotas de
      T17. Nenhuma rota HTTP nova — ver Decisão 1

### Backend — o usuário de sistema

- [x] `src/modules/alerta/usuarioDoSistema.ts` (ou equivalente): resolve o usuário que
      assina os eventos emitidos por varredura, idempotente (cria se não existir)
- [x] `senhaHash` impossível de casar por `bcrypt.compare`, papel `ATENDENTE` (menor
      privilégio — ver Decisão 3), e-mail `sistema@estoque.local`
- [x] O `seed.ts` também o cria, para que ele exista no banco de demonstração antes da
      primeira varredura

### Backend — o agendador

- [x] `src/modules/alerta/agendador.ts`, com `iniciarAgendadorDeAlertas()` recebendo a
      função de varredura por parâmetro (é o que torna o agendador testável sem banco)
- [x] Iniciado em `server.ts`, **nunca** em `buildApp()`: as suítes montam o app com
      `app.inject()` e não devem herdar um `setInterval` rodando
- [x] Roda uma vez ao subir e depois a cada `ALERTA_INTERVALO_HORAS` (novo em
      `shared/env.ts`, padrão 24) — ver Decisão 7
- [x] Nunca deixa duas varreduras se sobreporem: se a anterior ainda não terminou, o tique
      é ignorado e registrado no log
- [x] Falha de varredura é capturada e logada, e **não derruba o servidor** nem interrompe o
      agendamento. O balcão precisa continuar vendendo se o job quebrar
- [x] `unref()` no timer, para que ele não segure o processo vivo
- [x] Script `npm run alertas:varrer` (`src/modules/alerta/varredura.cli.ts`), que roda uma
      varredura e sai — é o que permite demonstrar o job sem esperar 24 horas

### Backend — schema e migração

- [x] `@@unique([unidadeId, configuracaoId])` em `Alerta`, com migração própria — ver
      Decisão 2. É a única alteração de schema desta tarefa
- [x] `docs/arquitetura.md` seção 3 atualizada com o índice

### Backend — testes (Vitest contra PostgreSQL real, `tests/alerta/`)

- [x] `tests/alerta/varreduraAlertas.test.ts`, com os apoios de `tests/apoio/cenario.ts`
      (`criarUnidade` já posiciona a unidade por `diasAteVencer`)
- [x] Unidade dentro da janela gera um `Alerta` apontando para a unidade e para a
      configuração certas
- [x] **Bordas da janela**, que são o coração desta tarefa: com janela de 30 dias, a unidade
      que vence em 30 dias **entra**, a que vence em 31 **não**, a que vence **hoje** entra,
      e a que venceu **ontem não entra** (é da fila de T13)
- [x] `VENDIDA` e `DESCARTADA` ficam de fora; unidade de produto inativo entra
- [x] Configuração inativa não gera nada
- [x] **Idempotência**: rodar a varredura duas vezes seguidas não cria a segunda linha, e o
      `EventoLog` também não ganha um segundo evento. É a propriedade que sustenta o
      agendamento por intervalo
- [x] Uma unidade cadastrada **depois** da primeira varredura é alertada na seguinte
- [x] Duas configurações ativas (30 e 7 dias) sobre a mesma unidade que vence em 5 dias
      geram dois alertas, um por configuração
- [x] Um `ALERTA_PROATIVO_EMITIDO` por alerta, com `unidadeId`, `produtoId` e o payload
      completo; `dataValidade` no payload é texto `AAAA-MM-DD` e não instante ISO
- [x] Banco sem nenhuma configuração ativa: varredura é no-op, resumo zerado, sem erro
- [x] Banco sem nenhuma unidade na janela: idem
- [x] O resumo devolvido bate com o que foi gravado
- [x] O usuário de sistema é criado uma vez só (duas varreduras não criam dois usuários) e
      **não autentica**: `POST /auth/login` com o e-mail dele e qualquer senha é 401
- [x] `tests/agendadorDeAlertas.test.ts`, **sem banco** (varredura injetada como duplo,
      timers falsos do Vitest): roda ao iniciar; roda de novo depois do intervalo; não
      sobrepõe execuções quando a anterior demora mais que o intervalo; erro na varredura
      não impede o tique seguinte. Fica solto em `tests/` e não em `tests/alerta/`, que é a
      pasta das suítes de banco — é a regra de T14b, e o arquivo de detalhe dizia
      `tests/alerta/` por engano
- [x] As suítes existentes continuam passando sem edição

### Frontend — a única mudança

- [x] O aviso "a verificação periódica do estoque ainda não está implantada" em
      `TelaConfiguracaoAlerta.tsx` é **substituído**, não removido: passa a dizer que a
      varredura roda periodicamente e que a entrega do aviso ainda não existe (T19). Ver
      Decisão 6
- [x] O teste correspondente em `TelaConfiguracaoAlerta.test.tsx` acompanha o novo texto
- [x] Nenhuma outra alteração no frontend. Listar alertas, badge, notificação: T19

### Fechamento

- [x] `npm test` e `npm run typecheck` verdes nos dois projetos
- [x] Varredura conferida contra o banco de desenvolvimento por `npm run alertas:varrer`,
      com consulta direta às linhas de `Alerta` e `EventoLog` geradas. **Sem navegador para
      isso** — é backend, e o CLAUDE.md restringe o `playwright-cli` a UI
- [x] Conferência no navegador com `playwright-cli` restrita ao texto do aviso na tela de
      configuração de alerta, que é a única mudança de UI. `console error` limpo
- [x] `docs/decisoes.md` e `docs/notas-para-artigo.md` com as entradas do dia
- [x] `docs/arquitetura.md`: seção 3 com o índice único de `Alerta`; seção 2 com o
      agendador; seção nova (ou parágrafo na 5) descrevendo a varredura, já que ela não é
      endpoint e não caberia na tabela de rotas
- [x] `tasks/backlog.md` com T18 `concluída` e a linha do arquivo de detalhe

## Pontos que precisavam da sua validação antes de eu codar (confirmados)

**Decisão 1 — o job é um agendador no próprio processo do servidor, não cron do sistema nem
rota HTTP.**
Três opções existiam: (a) `setInterval` dentro do processo do Fastify; (b) um script
chamado por `cron`/systemd; (c) uma rota `POST /alertas/varredura` que alguém (ou um cron
externo) chama. Proponho (a), com o script de (b) disponível como `npm run alertas:varrer`
para demonstração e para quem preferir agendar por fora.

O motivo de recusar (c): uma rota de "rodar o job" é uma porta autenticada que executa
escrita em massa, e ou ela fica aberta ao GESTOR — e aí um clique repetido vira o problema
que a idempotência precisa segurar sozinha — ou fica sem autenticação, que é pior. O motivo
de preferir (a) a (b): o alvo é uma perfumaria de pequeno porte, e o TCC não deve exigir
configuração de cron no servidor da loja para que um requisito funcional aconteça. A
contrapartida honesta, que vai para `notas-para-artigo.md`: **se o processo do backend não
estiver no ar, a varredura não roda** — e como o alerta é diário e a janela tem dias de
folga, isso é tolerável aqui, mas não seria num sistema de escala maior. Se você preferir o
cron do sistema como caminho principal, é trocar quem chama a mesma função.

**Decisão 2 — um `Alerta` por par (unidade, configuração), garantido por índice único no
banco.**
A varredura roda repetidamente sobre o mesmo estoque, então "já alertei sobre esta unidade
nesta janela?" é a pergunta central da tarefa. Proponho que a resposta seja permanente: uma
unidade entra na janela de 30 dias **uma vez**, e o alerta é a notícia dessa entrada, não um
lembrete diário. A janela de 7 dias emite o dela depois, porque é outra configuração.

E proponho que a garantia vá para o banco como `@@unique([unidadeId, configuracaoId])`, com
migração — **diferente** da escolha que fizemos em T17 (onde a unicidade de antecedência
ficou na aplicação). A diferença que justifica: lá quem escreve é uma gestora mexendo em
configuração de vez em quando; aqui quem escreve é um job automático, repetidamente, sem
ninguém olhando, e a contagem de alertas emitidos é dado da pesquisa (RF13). Além disso o
índice aqui é total, não parcial — cabe no Prisma sem SQL cru, que era a razão de T17 não o
ter feito.

Uma consequência que vale você ver escrita: se a validade de uma unidade for corrigida (T11)
para uma data distante e depois voltar a entrar na janela, **ela não alerta de novo**. Acho
o silêncio preferível ao ruído, mas é escolha sua.

**Decisão 3 — o evento do job é assinado por um usuário de sistema.**
`EventoLog.usuarioId` é FK obrigatória (schema de T02, seção 5 do PRD), e a varredura não
tem usuário: ninguém pediu, ninguém clicou. As saídas eram três: (a) criar um usuário
`sistema@estoque.local` que assina os eventos automáticos; (b) tornar `usuarioId` nullable,
mexendo no schema do log de todos os nove tipos de evento; (c) não gravar
`ALERTA_PROATIVO_EMITIDO` e deixar a própria tabela `Alerta` (que tem `geradoEm`) ser o
registro.

Proponho (a). A (b) enfraquece a garantia de todos os outros eventos por causa de um; a (c)
tira do `EventoLog` um dos nove tipos que o PRD declara, e quebra a propriedade que faz dele
instrumento de pesquisa — poder ler a linha do tempo inteira de uma unidade em uma tabela só
("alertado no dia X, vendido no dia X+4" vira um `JOIN` entre tabelas de formatos
diferentes). O usuário de sistema tem papel `ATENDENTE` (menor privilégio: se o hash algum
dia virasse válido, a conta não gerenciaria nada) e `senhaHash` que nenhuma senha casa.
Registro em `notas-para-artigo.md` que a análise precisa saber excluí-lo ao contar ações
humanas.

**Decisão 4 — a unidade já vencida não gera alerta.**
A janela é `[hoje, hoje + N]`, fechada dos dois lados. O que venceu ontem já está na fila de
descarte de T13, e alertar sobre ele seria a terceira apresentação do mesmo fato (fila,
alerta e — quando alguém ler o QR — o `EXCECAO_VENCIDO` do balcão). O alerta proativo existe
para o tempo em que ainda cabe decisão comercial; depois do vencimento, não cabe mais. A
borda inferior é a mesma do pool do FIFO (`>= hoje`), pelo motivo de sempre: se as cláusulas
divergirem, aparece uma faixa de unidades invisível dos dois lados.

**Decisão 5 — um evento por alerta, não um por varredura.**
`EventoLog.unidadeId` é singular, e é essa granularidade que permite cruzar o alerta com a
saída posterior da mesma unidade (RF12) — que é justamente o indicador que interessa: **a
unidade alertada foi vendida antes de vencer?** Um evento por varredura ("emiti 43 alertas")
não responde isso. O custo é volume: a primeira varredura de um estoque real emite uma
rajada de eventos de uma vez. É aceitável porque só acontece uma vez por unidade e por
janela (Decisão 2).

**Decisão 6 — a tela de T17 troca o aviso, em vez de perdê-lo.**
T17 registrou que o aviso "ainda não há verificação periódica" sai quando este job entrar.
Removê-lo por completo deixaria a tela sugerindo que configurar uma janela produz um aviso
visível — e não produz até T19. Proponho substituir por um texto que diga as duas coisas: a
varredura roda, o aviso ainda não chega a ninguém. É uma linha de texto, e é a única
mudança de UI da tarefa.

**Decisão 7 — intervalo de 24 horas por padrão, configurável por variável de ambiente, com
uma varredura ao subir.**
A janela é medida em dias, então varrer com mais frequência que uma vez por dia não muda
nada (a segunda passada do dia é no-op, por construção). Varrer ao subir evita que reiniciar
o servidor adie o alerta em um dia inteiro, e é seguro justamente porque a operação é
idempotente. `ALERTA_INTERVALO_HORAS` fica em `shared/env.ts` com padrão 24, para que a
demonstração possa usar um valor curto sem alterar código.

## Estado ao fim de T18

As sete decisões abaixo foram **confirmadas pelo orientando** antes da implementação, sem
alteração.

`npm test` fecha em **268 verdes no backend** (247 herdados de T17, mais 14 da varredura e 7
do agendador) e **89 no frontend** (os mesmos de T17: nenhum teste novo, um reescrito para o
texto novo do aviso). `npm run typecheck` limpo nos dois projetos. `npm run test:sem-banco`
sobe de 89 para 96 verdes e foi reexecutado com `.env.test` movido de lado, para confirmar
que a suíte do agendador de fato não toca o banco.

Código novo, todo em `modules/alerta/`: `varreduraAlertas.ts` (a varredura), `agendador.ts`
(o relógio), `usuarioDoSistema.ts` (a conta que assina os eventos) e `varredura.cli.ts` (o
`npm run alertas:varrer`). `server.ts` inicia o agendador; `shared/env.ts` ganhou
`ALERTA_INTERVALO_HORAS`; `seed.ts` cria a conta de sistema a partir da mesma constante que a
varredura usa. Migração
`20260909003208_alerta_unico_por_unidade_e_configuracao` acrescenta o índice único de
`Alerta` — única alteração de schema. `validarSaidaFifo`, as quatro rotas de T17 e os demais
módulos não foram tocados.

**Conferência da varredura contra o banco de desenvolvimento** (backend, portanto sem
navegador — o CLAUDE.md restringe o `playwright-cli` a UI):

- ao subir o servidor, o agendador varreu na inicialização e logou
  `{ motivo: 'inicialização', configuracoesAvaliadas: 1, unidadesNaJanela: 0, alertasEmitidos: 0 }`
  — **1** e não 2, porque a janela de 10 dias que T17 deixou inativa no banco foi ignorada;
- o banco não tinha nenhuma unidade dentro da janela de 30 dias (a mais próxima vence em
  18/10, nove dias além do limite, e a de 2020 já é da fila de descarte), então foram
  cadastradas duas unidades pela API (`POST /produtos/:id/unidades`, validade em 15 dias) —
  cadastro real, com o `UNIDADE_CADASTRADA` que ele produz, e não escrita direta no banco;
- `npm run alertas:varrer` emitiu **2 alertas**; a segunda passagem, imediatamente depois,
  emitiu **0** com as mesmas 2 unidades na janela. É a idempotência do índice único
  observada fora do teste;
- no banco: dois `Alerta` com `lidoEm` nulo apontando para a janela de 30 dias, e dois
  `ALERTA_PROATIVO_EMITIDO` com `unidadeId`, `produtoId`, payload
  `{ configuracaoId, diasAntecedencia: 30, canal: 'IN_APP', dataValidade: '2026-09-24', diasParaVencer: 15 }`
  — a validade como texto, não instante — assinados por `sistema@estoque.local / ATENDENTE`,
  com **uma** conta de sistema no banco depois de duas varreduras.

**Conferência no navegador** (`playwright-cli`, método do CLAUDE.md), restrita à única
mudança de UI: a tela `/alertas/configuracao` como GESTOR exibindo o aviso novo — a varredura
roda, a entrega ainda não existe — no lugar do texto de T17. `console error` limpo, sem
nenhum erro (nem os 401 de `/auth/me`, porque a sessão já estava aberta).

As duas unidades de demonstração cadastradas na conferência e os dois alertas ficam no banco
de desenvolvimento. São dado de demonstração e ajudam T19, que precisa de alerta para exibir.

Um desvio do arquivo de detalhe, decidido durante a implementação e registrado em
`docs/decisoes.md`: a suíte do agendador foi para `tests/agendadorDeAlertas.test.ts`, e não
para `tests/alerta/agendador.test.ts` como este arquivo previa. A pasta `tests/alerta/` é
lida por `test:sem-banco` como suíte de banco (regra de T14b), e a do agendador não usa
banco — deixá-la lá a excluiria da execução que ela deveria integrar.

## Notas técnicas

- **A idempotência é a propriedade central desta tarefa, não um detalhe de implementação.**
  Ela é o que permite escolher o agendamento por intervalo simples (Decisão 7) em vez de
  "rodar às 3h da manhã e nunca duas vezes", que exigiria estado de última execução e
  falharia no primeiro reinício de servidor. Por isso ela é testada tanto pelo lado do
  `Alerta` quanto pelo lado do `EventoLog`: um alerta não duplicado com evento duplicado
  inflaria a contagem da pesquisa sem aparecer em tela nenhuma.
- **Um lock de estoque aqui seria errado.** A RNF02 protege a decisão de baixa de uma
  unidade contra duas atendentes simultâneas. A varredura não decide baixa nem muda status:
  ela só constata que uma data está próxima. Segurar `FOR UPDATE` sobre centenas de unidades
  atrasaria o balcão para proteger uma escrita que não disputa nada.
- **A varredura lê o estoque inteiro, e é a primeira consulta do sistema que faz isso.** Com
  ~700 SKUs e algumas unidades cada, é uma consulta indexada por
  `[produtoId, status, dataValidade]` — o índice de T02 cobre `status` e `dataValidade` só
  parcialmente, porque a varredura não filtra por produto. Se a consulta se mostrar lenta na
  conferência, o registro da observação vale mais que um índice novo especulativo, e vira
  decisão própria.
- **`canal` continua sem consumidor.** O job grava o canal no payload do evento e nada mais:
  quem entrega in-app ou push é T19. Aceitar `PUSH` desde T17 e não honrá-lo é a ordem do
  backlog, e continua sendo preferível a inventar um subconjunto provisório.
- **O agendador recebe a varredura por parâmetro** para que a suíte dele não precise de
  banco: o que se testa ali é o comportamento do relógio (roda ao iniciar, repete, não
  sobrepõe, sobrevive a erro), não a consulta SQL. É a mesma separação que permitiu testar
  `simboloQr.ts` sem o resto da etiqueta em T14.

## Fora de escopo desta tarefa

- **Exibir o alerta a alguém** — lista de notificações, badge, ícone, marcação de lido
  (`Alerta.lidoEm`), service worker de push, VAPID, permissão do navegador: tudo T19.
- **Qualquer alteração nas quatro rotas de `/configuracao-alerta`** (T17) ou no
  `validarSaidaFifo`.
- **Rota HTTP para disparar a varredura** — Decisão 1.
- **Contagem ou relatório de alertas emitidos** — RF13, T20/T21.
- **Reemitir alerta para unidade que continua parada** ("já avisei há 20 dias e ninguém fez
  nada"). É uma política de lembrete, diferente da notícia de entrada na janela — Decisão 2.
- **Alerta por produto ou por categoria**, e qualquer agregação do tipo "este SKU tem 12
  unidades vencendo": a RF08 fala de unidades dentro da janela, e agregar é dashboard.
- **Retirar o alerta quando a unidade é vendida ou descartada.** A linha de `Alerta` é
  registro histórico do que foi emitido (é o que sustenta a RF13); o que deve deixar de
  aparecer na tela é decisão de T19, com o estado atual da unidade em mãos.
