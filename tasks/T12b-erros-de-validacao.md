# T12b — Tradução dos erros de validação de schema (`errorHandler` do Fastify)

**Depende de:** nada pendente (o `app.ts` existe desde T01; as rotas com schema, desde T03)
**Incremento:** 3, como correção transversal — descoberta durante T12, não planejada
**Bloqueia:** nada formalmente. Recomendado **antes de T13**, que traz formulários novos e
herdaria o mesmo defeito

## Objetivo

Fazer o backend recusar em português.

`backend/src/app.ts` não registra `setErrorHandler`, então toda violação de JSON Schema sai
no formato padrão do Fastify. Reproduzido em T12 com o schema exato da rota de override:

```json
{"statusCode":400,"code":"FST_ERR_VALIDATION","error":"Bad Request",
 "message":"body/justificativa must NOT have fewer than 10 characters"}
```

E `frontend/src/services/api.ts` exibe `corpo?.mensagem ?? corpo?.message ?? …` — como não
há `mensagem`, o que aparece na tela do balcão é a segunda opção: o texto interno do
framework, em inglês, citando o caminho do campo no corpo da requisição.

Não é um caso isolado do override. Vale para toda rota com schema: quantidade acima do
máximo no recebimento (T05), nome de produto longo demais (T04), `sessaoVendaId` fora do
formato UUID (T09), data inexistente no calendário (RNF01). O que segurou o problema até
agora foi as telas espelharem as restrições nos campos — o que é ergonomia, não garantia.

**O que esta tarefa não é.** Ela não substitui o espelho de restrição decidido em T12
(Decisão 3): mesmo com mensagem em português, "confira os campos" continua sendo pior que
um botão desabilitado com a contagem à vista. O handler é a rede embaixo, para quando a
tela não antecipou — e para os clientes que não são a tela.

## Critério de aceite

- [ ] `setErrorHandler` registrado **uma vez**, em `app.ts`, junto do resto da montagem da
      instância. Nenhuma rota trata erro de schema por conta própria
- [ ] Violação de schema (`FST_ERR_VALIDATION`) responde **400** no formato de erro que o
      projeto já usa nas recusas escritas à mão: `{ erro, mensagem }`, com
      `erro: 'CORPO_INVALIDO'`
- [ ] O status **não muda**: o que era 400 continua 400. Esta tarefa troca o corpo da
      resposta, nada mais
- [ ] As recusas redigidas pelas rotas (`UNIDADE_NAO_VENCIDA`, `VALIDADE_INALTERADA`,
      `PAPEL_INSUFICIENTE` e as demais) **não passam pelo handler** — elas já saem prontas
      via `reply.code().send()`, e o handler só vê o que o Fastify gerou
- [ ] Campos recusados vão num array `campos` na resposta, para diagnóstico. O texto
      exibido ao usuário continua sendo `mensagem`, e só ele — ver Decisão 1
- [ ] Erro não tratado responde **500** `{ erro: 'ERRO_INTERNO', mensagem }` sem repassar o
      texto da exceção, com o erro completo no log do servidor — ver Decisão 2
- [ ] Rota inexistente responde 404 no mesmo formato (`setNotFoundHandler`), para que o
      cliente não precise distinguir dois formatos de erro conforme o que deu errado
- [ ] Testes novos em `backend/tests/erros.test.ts`: corpo inválido devolvendo
      `CORPO_INVALIDO` com os campos; nenhuma resposta de erro contendo `must NOT` ou
      `Bad Request`; rota inexistente no formato do projeto; e erro interno não vazando a
      mensagem da exceção
- [ ] **Os 177 testes atuais continuam verdes sem edição.** Foi conferido antes de abrir a
      tarefa: as asserções existentes de 400 olham só `statusCode` — a única que lê o corpo
      (`erro: 'VALIDADE_INALTERADA'`, em `excecaoVencido.test.ts`) é recusa de rota, que não
      passa pelo handler
- [ ] `npm run typecheck` limpo. Nenhuma mudança no frontend: `ErroApi` já lê `erro` e
      `mensagem`, e passará a encontrá-los onde hoje encontra `message`
- [ ] `docs/arquitetura.md` seção 5 registra o formato uniforme de erro da API
- [ ] `docs/decisoes.md` com a entrada do dia

## Pontos que precisam da sua validação antes de eu codar

**Decisão 1 — mensagem genérica com os campos ao lado, não tradução campo a campo.**
Traduzir fielmente cada erro do ajv (formato, mínimo, máximo, tipo, propriedade
desconhecida, aninhamento em `unidades[2].dataValidade`) é um poço sem fundo, e o resultado
seria uma segunda declaração das restrições — as mesmas que o schema já declara e que as
telas já espelham. Proponho uma mensagem única e honesta ("Alguns campos do formulário não
foram aceitos. Confira os dados e tente de novo.") mais `campos: ['justificativa']` para
quem estiver depurando. A alternativa, se você preferir, é citar os campos dentro da
mensagem exibida ("Confira: justificativa") — dá um passo a mais ao usuário e mantém o
custo baixo, mas expõe o nome técnico do campo, que nem sempre é o rótulo da tela.

**Decisão 2 — o 500 entra junto, e é a metade mais importante para a LGPD (RNF09).**
Hoje uma exceção não tratada sai com a mensagem original: um erro do Prisma chega ao
navegador com nome de tabela, de coluna e, dependendo do caso, com o valor que causou a
violação. Não é hipotético — é o comportamento padrão do Fastify para erro sem `statusCode`.
Proponho responder texto fixo e registrar o erro completo no log do servidor. Se você achar
que isso extrapola o título da tarefa, tiro; mas é o mesmo handler, e deixar de fora
significa manter aberto o vazamento maior dos dois.

## Notas técnicas

- **O handler enxerga `error.validation`** quando o erro veio do schema, e é por aí que os
  campos recusados são extraídos — não por *parsing* da mensagem em inglês.
- **Ordem de registro não importa** para o `setErrorHandler`, mas ele precisa estar na
  instância que os testes constroem (`buildApp()`), não no `server.ts` — senão os testes
  com `app.inject()` testariam um app diferente do que roda em produção.
- **`FST_ERR_VALIDATION` cobre corpo, query, params e headers.** A resposta não precisa
  distinguir qual das quatro partes falhou; `campos` já diz o suficiente.
- O log de erro do Fastify já existe (`logger: true`): o que muda é que a mensagem completa
  passa a viver **só** lá.

## Fora de escopo desta tarefa

- **Mudar qualquer schema existente**, inclusive limites que pareçam mal escolhidos.
- **Traduzir as mensagens de negócio das rotas** — já estão em português e são melhores que
  qualquer coisa genérica; é justamente por isso que elas não passam pelo handler.
- **Qualquer alteração no frontend.** O espelho de restrição de T12 continua como está, e
  `ErroApi` já lê o formato do projeto.
- **Internacionalização.** O sistema é de uma loja, em português.
- **Padronizar códigos de erro entre módulos** (por exemplo, unificar nomes de `erro` já
  existentes): é refatoração de contrato e mexeria em testes de T03–T11.
