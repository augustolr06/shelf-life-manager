# Log de Decisões de Design

Formato: cada entrada tem data, decisão e justificativa. Nunca editar entradas antigas — só adicionar novas. Se uma decisão for revertida, registre a reversão como nova entrada, não apague a anterior.

## 2026-08-25 — Decisões herdadas do PRD (congeladas antes do início da implementação)

**Unidade vencida no momento da venda (PRD seção 6.1).** O sistema permite a saída de unidade vencida mediante confirmação explícita registrada (correção de dado, descarte, ou override restrito ao GESTOR com justificativa obrigatória) — não bloqueia em definitivo. Justificativa: dar ao gestor uma via de decisão comercial consciente, mas com fricção deliberada e registro imutável, coerente com a legislação de defesa do consumidor.

**Venda multi-item (PRD seção 6.2).** Cada item é um ciclo de validação FIFO independente e sequencial. Sem entidade de carrinho, sem estado intermediário no servidor. Justificativa: elimina uma classe inteira de bugs de estado e minimiza a janela de concorrência do lock.

**Status derivado, não persistido.** "Vencida" é um predicado (`dataValidade < hoje`), não um valor de `status`. Justificativa: evita depender de um job diário cuja falha corromperia os dados da pesquisa.

## 2026-08-25 — Stack técnica

**Backend: Node.js + TypeScript + Fastify.** Escolhido por validação de schema nativa (JSON Schema), adequada ao contrato rígido do veredito FIFO, e por baixo overhead (ajuda RNF06).

**ORM: Prisma sobre PostgreSQL.** Prisma pela DX e migrações versionadas; PostgreSQL por suportar `SELECT ... FOR UPDATE` nativamente (RNF02) e tipo `DATE` (RNF01).

**Frontend: React + Vite, PWA via `vite-plugin-pwa`.** SPA leve, plugin de PWA maduro, boa integração com bibliotecas de leitura de QR via câmera.

**Autenticação: JWT em cookie httpOnly + bcrypt.** Simplicidade — sem estado de sessão a gerenciar no servidor, atende RF01 e RNF09.

**Testes: Vitest.** Mesma toolchain do Vite, TypeScript nativo, rápido.

## 2026-09-07 — Decisões de setup (T01)

**Raiz do repositório movida para a raiz do diretório do projeto.** `CLAUDE.md`, `docs/` e `tasks/` estavam aninhados em `estoque-fifo-context/context/`; foram movidos para a raiz, onde `backend/` e `frontend/` também foram criados. Justificativa: alinha o repositório ao diagrama da seção 2 de `docs/arquitetura.md`, que trata `/backend`, `/frontend`, `/docs` e `/tasks` como irmãos na raiz.

**PostgreSQL de desenvolvimento provisionado via Docker Compose, na porta 5434.** `docker-compose.yml` na raiz sobe um `postgres:16-alpine`. Justificativa: reprodutibilidade do ambiente para a banca e para qualquer máquina, sem depender de instalação nativa nem de privilégios de superusuário no banco. A porta 5434 foi escolhida porque 5432 e 5433 já estavam ocupadas na máquina de desenvolvimento; o `DATABASE_URL` é configurável, então quem já tiver um PostgreSQL 15+ local pode apontar para ele e ignorar o container.

**Schema Prisma em `backend/src/db/schema.prisma`, fora do caminho padrão.** O caminho é declarado em `backend/prisma.config.ts` (`defineConfig({ schema })`), e não pela chave `prisma` do `package.json`, que está depreciada no Prisma 6 e removida no 7. Justificativa: `docs/arquitetura.md` seção 2 posiciona o schema em `src/db/`. Consequência prática: as migrações de T02 serão geradas em `backend/src/db/migrations/`.

**`/health` é liveness puro, sem checar o banco.** Retorna 200 com `status` e `uptime`, sem tocar no PostgreSQL. Justificativa: T01 exige apenas que o endpoint responda 200, e o endpoint precisa continuar respondendo mesmo com o banco fora do ar para que o frontend distinga "backend inalcançável" (RNF07, `docs/arquitetura.md` seção 6) de "backend de pé, banco com problema". Se o fluxo de leitura de QR precisar de um sinal de prontidão do banco, isso entra como endpoint separado em T08/T10.

**Testes do frontend com Vitest + Testing Library em ambiente jsdom.** Justificativa: `docs/arquitetura.md` fixa Vitest, mas não o ambiente de renderização; jsdom + `@testing-library/react` é o par padrão para testar componentes React sob Vitest, e evita rediscussão quando as telas chegarem em T10.

## 2026-09-07 — Verificação de alterações de UI

**Alterações de interface são conferidas no navegador com `playwright-cli`, restrito ao caminho afetado.** A instrução operacional está em `CLAUDE.md`, seção "Verificação de alterações de UI". Vale só para componentes e páginas do frontend, `index.html`, estilos e manifest do PWA; backend, schema, migrações e configuração continuam verificados por Vitest, `typecheck` e chamadas diretas ao endpoint. Justificativa: parte do comportamento exigido pelo PRD só se manifesta no navegador real — leitura de QR pela câmera (RF05) e bloqueio do fluxo de saída quando offline (RNF07) — e o jsdom não cobre nenhum dos dois. A restrição de escopo é deliberada: a conferência no navegador é manual e não versionada, então ela complementa os testes automatizados sem substituí-los, e os testes que entram no commit seguem sendo Vitest + Testing Library.

## 2026-09-07 — Decisões de modelo de dados (T02)

**Seed em `backend/src/db/seed.ts`, não em `prisma/seed.ts`.** O arquivo de tarefa T02 sugeria `prisma/seed.ts`, mas o projeto não tem diretório `prisma/` — o schema e as migrações moram em `src/db/` (decisão de T01). O comando de seed é declarado em `prisma.config.ts` (`migrations.seed`), pelo mesmo motivo que o schema: a chave `prisma` do `package.json` está depreciada no Prisma 6 e removida no 7. Justificativa: manter todos os artefatos de banco sob um único diretório, coerente com a seção 2 de `docs/arquitetura.md`.

**Hash de senha do seed com `bcryptjs`, custo 10.** `docs/arquitetura.md` seção 1 especifica bcrypt como algoritmo, sem fixar a biblioteca. `bcryptjs` é implementação pura em JavaScript, gera hashes no mesmo formato do `bcrypt` nativo e dispensa toolchain de compilação nativa. Justificativa: o seed precisa gravar `senhaHash` já em T02, antes de T03 existir, e evitar dependência nativa reduz o atrito de rodar o projeto na máquina da banca. T03 deve usar a mesma biblioteca e o mesmo custo — trocar depois invalidaria os hashes do seed.

**Seed idempotente via `upsert` com `update: {}`.** Rodar o seed novamente não duplica usuários nem sobrescreve uma senha que tenha sido alterada manualmente durante testes. Justificativa: o seed será reexecutado várias vezes ao longo dos incrementos seguintes, e um seed destrutivo atrapalharia testes manuais em andamento.

**`UnidadeProduto.registradoPorId` e `Alerta.unidadeId` permanecem escalares, sem `@relation`.** A seção 3 de `docs/arquitetura.md` declara os dois como campos de id sem relação Prisma, e o schema foi transcrito fielmente — logo, o Postgres não cria chave estrangeira para eles. Justificativa: T02 instrui a copiar o modelo da arquitetura, não redesenhá-lo, e adicionar as relações exigiria campos de volta em `Usuario` e `UnidadeProduto` que a seção 3 não prevê. Fica registrado como ponto em aberto: se a integridade referencial desses dois campos for considerada necessária, a mudança deve ser feita na seção 3 primeiro e depois refletida numa nova migração.

## 2026-09-07 — Decisões de autenticação (T03)

**JWT implementado com `@fastify/jwt`; CORS com `@fastify/cors`.** `docs/arquitetura.md` seção 1 fixa "JWT em cookie httpOnly + bcrypt" como mecanismo, sem nomear biblioteca. `@fastify/jwt` foi escolhido por ler o token direto do cookie (opção `cookie.cookieName`) e por expor `request.jwtVerify()` como preHandler, dispensando código de extração manual de header/cookie. Justificativa: menos superfície própria para errar num ponto de segurança, e integração nativa com o ciclo de vida do Fastify. Consequência: `@fastify/cookie` precisa ser registrado antes de `@fastify/jwt`, e essa ordem está comentada em `src/buildApp.ts` (era `src/app.ts` até 2026-09-21).

**Cookie de sessão chamado `sessao`, `SameSite=Lax`, validade de 8 horas.** `httpOnly` sempre; `secure` apenas quando `NODE_ENV=production`, para o login continuar funcionando em `http://localhost` no desenvolvimento. Justificativa da duração: 8 horas cobre uma jornada de trabalho, então o atendente não é deslogado no meio do expediente — e o PRD não pede refresh token. Justificativa do `SameSite=Lax`: em desenvolvimento frontend (5173) e backend (3333) são o mesmo site (a porta não entra na definição de site), então `Lax` basta; se em produção os dois forem para domínios distintos, isto vira `None` + `secure` obrigatório. As opções ficam num único lugar (`src/modules/auth/cookie.ts`) e são reusadas no logout, porque o navegador só substitui um cookie por outro de nome, path e domínio idênticos.

**`JWT_SECRET` é variável de ambiente obrigatória, sem valor padrão.** O servidor lança erro na inicialização se ela não existir, em vez de cair para um segredo embutido. Justificativa: um padrão adivinhável em código versionado permitiria forjar sessão de GESTOR, o que quebraria o override da seção 6.1 do PRD, que é restrito a esse papel. `.env.example` traz o comando para gerar um valor aleatório.

**CORS habilitado com `credentials: true`, restrito a `FRONTEND_ORIGIN`.** Sem isso o navegador não envia o cookie httpOnly do frontend para o backend, e o login simplesmente não funcionaria fora do `curl`. A variável já existia em `.env.example` desde T01 marcada como "usada a partir de T03".

**Login não distingue "e-mail inexistente" de "senha incorreta" — nem no corpo, nem no tempo de resposta.** Os dois casos respondem 401 com `CREDENCIAL_INVALIDA` e a mesma mensagem, e quando o e-mail não existe o serviço ainda executa um `bcrypt.compare` contra um hash descartável. Justificativa: evitar que a diferença de tempo de resposta permita enumerar quais e-mails estão cadastrados.

**401 e 403 são respostas distintas.** Sessão ausente/expirada devolve 401 `NAO_AUTENTICADO`; sessão válida com papel insuficiente devolve 403 `PAPEL_INSUFICIENTE`. Justificativa: o frontend precisa distinguir "reabra a tela de login" de "peça a um gestor" — sobretudo no override da seção 6.1, onde o atendente autenticado legitimamente não pode prosseguir sozinho. Coerente com a RNF04: o backend é quem decide, o frontend só reflete o código recebido.

**Autorização por papel como fábrica de preHandler (`exigirPapel(...papeis)`), encadeada depois de `autenticar`.** Uso: `preHandler: [autenticar, exigirPapel(Papel.GESTOR)]`. `exigirPapel` também responde 401 se `request.usuario` não estiver preenchido, para que um encadeamento errado falhe fechado em vez de liberar a rota. Justificativa: as rotas restritas a GESTOR (T04, T05, T11, T13, T17, T20) devem declarar o papel exigido na própria definição da rota, sem `if` espalhado nos handlers.

**Testes de T03 rodam com o Prisma Client mockado, sem PostgreSQL.** `tests/auth.test.ts` substitui `src/db/prisma.ts` por um duplo de teste. Justificativa: o que T03 precisa provar é a decisão sobre credencial e papel, não a persistência — e manter a suíte sem dependência de banco a torna executável na máquina da banca sem subir o container. Os testes que exigem banco real chegam em T06/T07, onde o objeto de teste é justamente o lock `SELECT ... FOR UPDATE` (RNF02), que nenhum mock reproduz. A rota `/apenas-gestor` usada para exercitar `exigirPapel` existe só dentro do arquivo de teste, e não no código de produção, já que a primeira rota real restrita a GESTOR só aparece em T04.

## 2026-09-07 — Revisão do modelo de dados antes de T04

Quatro decisões tomadas pelo orientando em resposta a pontos levantados no fechamento de T03. As duas primeiras alteram a seção 3 de `docs/arquitetura.md` e geraram migração.

**Exclusão de produto passa a ser inativação (`Produto.ativo`), nunca remoção física.** `DELETE /produtos/:id` marca `ativo = false`. Justificativa: um produto com unidades vendidas ou descartadas não pode ser removido sem levar junto o histórico que sustenta a pesquisa — e o `EventoLog`, que é append-only por RNF05, ficaria referenciando um `produtoId` órfão. Escolhido `ativo Boolean` em vez de `deletedAt DateTime?`: o schema já usa `ativo` em `ConfiguracaoAlerta`, e o *quando* da inativação, se for necessário, é justamente o que o `EventoLog` registra. Consequência para T04: `GET /produtos` precisa decidir se lista inativos por padrão — a recomendação é ocultar por padrão e expor um filtro explícito.

**Chaves estrangeiras adicionadas em `UnidadeProduto.registradoPorId`, `Saida.autorizadoPorId` e `Alerta.unidadeId`.** Isto reverte o ponto em aberto registrado em T02. Motivo determinante: a seção 5 do PRD já marcava os três como FK — quem divergiu foi a seção 3 da arquitetura, não o requisito. `Usuario` passa a ter duas relações distintas com `Saida` (`SaidaExecutadaPor` e `SaidaAutorizadaPor`), o que exige relações nomeadas no Prisma.

**`Saida.autorizadoPor` usa `onDelete: Restrict`, não o `SET NULL` padrão do Prisma.** Para relação opcional o Prisma gera `ON DELETE SET NULL`, o que apagaria silenciosamente *quem* autorizou a venda de uma unidade vencida. Esse é o registro com peso legal do caminho 3 da seção 6.1 do PRD. `Restrict` faz a exclusão do usuário falhar em vez de corromper o histórico.

**`EventoLog.unidadeId` e `EventoLog.produtoId` permanecem sem FK, agora deliberadamente.** A seção 5 do PRD os declara nullable e sem chave, ao contrário dos outros campos de id. Justificativa: um log de auditoria não deve ter seu ciclo de vida amarrado ao das entidades que descreve.

**Formato do `codigoQr`: `PRF-XXXXXX` — provisório até a validação física (RNF08).** Prefixo fixo `PRF` + hífen + 6 caracteres do alfabeto Crockford Base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, que omite I, L, O e U para não confundir na leitura humana). Espaço de 32^6 ≈ 1,07 bilhão de códigos, muito acima da escala da RNF10; a unicidade real é garantida pelo `@unique` da coluna, com nova tentativa em caso de colisão. Justificativa da escolha por código curto em vez de UUID: 10 caracteres geram um QR bem menos denso que 36, e a RNF08 exige leitura confiável em frasco curvo e embalagem pequena. **Esta decisão não está fechada** — o teste físico em loja (T16) pode reabri-la, e por isso a geração do código deve viver num único módulo (`backend/src/modules/unidade/codigoQr.ts`), sem o formato espalhado por validações de rota ou testes.

**Testes que exigem banco real (T06/T07) usarão um banco separado no mesmo container.** Não reaproveitar `estoque_fifo`, para que rodar a suíte não destrua os dados de teste manual. Justificativa: o lock `SELECT ... FOR UPDATE` da RNF02 e o caso de concorrência da seção 7 da arquitetura não são reproduzíveis com mock.

**Verificações manuais que ficam a cargo do orientando, registradas para não se perderem.** (a) T16 / RNF08 — leitura física do QR em frasco curvo, plástico brilhante e embalagem pequena, sob a luz da loja; pode reabrir o formato do `codigoQr`. (b) T10 / RF05 — teste da câmera em celular real, já que `getUserMedia` exige HTTPS ou `localhost` e o `playwright-cli` não lê QR de câmera física; **avisar o orientando quando T10 for implementada**. (c) Dados reais do catálogo da perfumaria entram quando coletados; até lá o seed usa dados inventados.

## 2026-09-07 — Tela de login e sessão no frontend (T03b)

**Criada a tarefa T03b, fora do backlog original.** T03 entregou apenas o lado servidor da RF01, e nenhuma tarefa seguinte previa a tela de login que T04 e T10 pressupõem. Como o cookie de sessão é `httpOnly`, o JavaScript do frontend não consegue autenticar por conta própria: sem tela de login, qualquer tela protegida responde 401 e é inutilizável no navegador. Escolhido criar tarefa própria em vez de embutir o login em T04, para manter a rastreabilidade tarefa-a-tarefa que `CLAUDE.md` exige. T04 passa a depender de T03b.

**`App` é o guardião de sessão, com três situações explícitas (`verificando`, `anonimo`, `autenticado`).** O estado `verificando` existe para que a tela de login não apareça antes de `GET /auth/me` responder — sem ele, quem já tem sessão veria o formulário piscar a cada abertura do app. Justificativa de não usar biblioteca de roteamento: o sistema ainda tem uma tela só; se o roteamento virar necessário em T10, entra como decisão daquela tarefa.

**Nenhum dado de sessão em `localStorage`/`sessionStorage`.** A fonte da verdade é o cookie `httpOnly` mais o `GET /auth/me`. Justificativa: papel persistido no cliente convida o frontend a decidir autorização, o que a RNF04 proíbe — e seria um dado que o usuário pode editar. O papel exibido na barra de topo é informativo; toda recusa continua vindo do 403 do backend. Há teste garantindo que os dois armazenamentos ficam vazios após o login.

**Toda chamada ao backend passa por `frontend/src/services/api.ts`.** É o único lugar que define `credentials: 'include'` — sem essa opção o navegador não envia o cookie de sessão e toda rota protegida responde 401. O módulo converte resposta de erro em `ErroApi`, que carrega o status HTTP e o campo `erro` da resposta, para que a interface distinga os casos que o backend já distingue (401 `NAO_AUTENTICADO` vs. 403 `PAPEL_INSUFICIENTE`) sem julgamento próprio. A mensagem exibida ao usuário é a que o backend escreveu.

**Falha de rede é distinguida de "não está logado".** `fetch` só rejeita por rede/CORS; isso vira `ErroApi` com status 0 e código `SEM_RESPOSTA`. `buscarSessaoAtual` devolve `null` apenas no 401 e propaga o resto, para que "backend fora do ar" leve à tela de login com aviso explícito em vez de se disfarçar de sessão expirada. Pelo mesmo motivo, um logout que não chega ao servidor mantém a sessão aberta na interface: o cookie continua válido, e fingir o contrário deixaria a tela mentindo sobre o estado real. Isto antecipa em pequena escala a distinção que a RNF07 vai exigir em T10.

**URL do backend em `VITE_API_URL`, com `http://localhost:3333` como padrão.** `frontend/.env.example` foi criado. Justificativa: frontend (5173) e backend (3333) são origens distintas, e o valor precisa mudar em produção sem recompilar por edição de código.

**Conferência no navegador de T03b não foi executada.** O `playwright-cli` está instalado na máquina, mas sem navegador compatível: espera `chrome` em `/opt/google/chrome` e `firefox-1542`, e o cache tem `firefox-1522`. `CLAUDE.md` proíbe instalar dependências por conta própria, então a verificação ficou com Vitest + Testing Library (9 testes) e com uma checagem por `curl` dos três contratos que o frontend consome (`/auth/login` válido e inválido, `/auth/me` com e sem cookie, `/auth/logout`), todos batendo com o formato assumido pelo cliente. Registrado no backlog como pendência do orientando, porque afeta todas as tarefas de UI seguintes.

## 2026-09-07 — CRUD de Produto (T04)

**`codigoInterno` é normalizado para maiúsculas e sem espaços nas pontas, na criação e na edição.** O código é digitado à mão pela gestora; sem normalizar, `prf-001` e `PRF-001` seriam dois SKUs distintos para o Postgres, e a restrição `@unique` não pegaria a duplicata. Consequência: a busca por código funciona independentemente de como o operador digita. `nome`, `marca` e `categoria` recebem só o `trim`, porque neles a caixa é conteúdo, não identificador.

**Duplicata de `codigoInterno` é detectada pela restrição do banco (P2002), não por um `findUnique` prévio.** Uma consulta antes do `create` deixaria uma janela entre a checagem e a escrita em que dois cadastros simultâneos passariam. O serviço captura `PrismaClientKnownRequestError` com código `P2002` e devolve `CODIGO_INTERNO_EM_USO`; `P2025` (registro inexistente) vira `PRODUTO_NAO_ENCONTRADO`. Mesmo raciocínio da RNF02, em escala menor: a integridade é do banco, não de uma sequência de queries da aplicação.

**`PATCH /produtos/:id` aceita `ativo`, o que torna a reativação possível.** Sem isso, uma inativação por engano não teria desfazer pela API, e o único caminho seria `UPDATE` manual no banco. `DELETE` continua sendo o único jeito de inativar, e é idempotente: inativar duas vezes devolve o mesmo produto, sem erro.

**`GET /produtos`: oculta inativos por padrão, ordena por nome, pagina com `pagina`/`tamanhoPagina` (padrão 20, máximo 100) e responde `{ produtos, total, pagina, tamanhoPagina }`.** Ocultar inativos por padrão segue a recomendação registrada na revisão de modelo de dados: o uso corrente do catálogo é operacional (cadastrar unidade, vender), e produto inativo não participa disso. O teto de 100 por página existe para que um cliente não peça o catálogo inteiro numa requisição. A busca usa `contains` com `mode: 'insensitive'` sobre `nome` e `codigoInterno` — não é busca full-text, e não tolera erro de digitação; para ~700 SKUs (RNF10) isso basta, e um índice de texto entra só se a escala mudar.

**A tela esconde o formulário de cadastro e os botões de ação do ATENDENTE — isso é conveniência de interface, não autorização.** A recusa real continua sendo o 403 do backend (T03), e há teste de rota provando que o ATENDENTE é bloqueado em `POST`, `PATCH` e `DELETE`. A distinção importa por causa da RNF04: se a condição da tela estiver errada, o sistema ainda recusa a operação; a interface nunca é a última linha de defesa.

**Serviço devolve resultado discriminado (`{ ok: true, produto } | { ok: false, motivo }`) em vez de lançar exceção de domínio.** Segue a convenção que T03 já usava (`autenticarCredenciais` devolve `null`): o serviço descreve o que aconteceu, e a rota escolhe o status HTTP. Justificativa: evita criar uma hierarquia de erros e um `setErrorHandler` global agora, o que mudaria o tratamento das rotas de auth já entregues.

**Testes de T04 seguem com o Prisma mockado, e a verificação contra o banco real foi feita por `curl`.** O que T04 precisa provar é o contrato das rotas — papel, validação de corpo, tradução de erro do Prisma em status HTTP. A checagem manual incluiu um `SELECT` direto no container depois do `DELETE`, mostrando a linha ainda presente com `ativo = f`. A conferência no navegador continua pendente pelo mesmo motivo de T03b (nenhum navegador compatível com o `playwright-cli` instalado).

## 2026-09-07 — CORS recusava PATCH e DELETE (achado da conferência no navegador, T04)

**`app.register(cors, ...)` passa a declarar `methods: ['GET', 'POST', 'PATCH', 'DELETE']` explicitamente.** O padrão do `@fastify/cors` responde ao preflight com `Access-Control-Allow-Methods: GET,HEAD,POST` — apenas os métodos safelisted do CORS. Com isso, os botões Inativar e Reativar da tela de produtos falhavam no navegador com `blocked by CORS policy`, embora `PATCH` e `DELETE` funcionassem perfeitamente pela API.

**Por que nenhuma verificação anterior pegou.** Os testes de rota usam `app.inject()`, que entra no Fastify sem passar por navegador e portanto sem preflight. As conferências manuais usaram `curl`, que também não faz preflight — uma requisição `DELETE` avulsa devolvia 200 normalmente. O erro só existe na etapa `OPTIONS` que o navegador dispara sozinho antes de um método não-safelisted, e portanto só aparece quando há um navegador de verdade no circuito.

**Regressão coberta por `backend/tests/cors.test.ts`**, que dispara o `OPTIONS` de preflight para os quatro métodos usados e confere `Access-Control-Allow-Methods` e `Access-Control-Allow-Credentials`. Isso mantém o achado testado sem depender do navegador em toda execução da suíte.

**Consequência para o roteiro de trabalho.** É a primeira evidência concreta, dentro deste projeto, de que a conferência no navegador exigida pelo `CLAUDE.md` não é redundante com Vitest e `curl`: ela cobre uma camada — o que o navegador exige antes de deixar a requisição sair — que nenhuma das outras duas alcança. Vale lembrar disso em T10, onde `getUserMedia` e o comportamento offline da RNF07 têm a mesma natureza.

## 2026-09-07 — Cadastro de UnidadeProduto (T05)

**Cada linha do lote carrega `quantidade` (padrão 1), e não uma linha por unidade física.** O corpo de `POST /produtos/:id/unidades` é `{ unidades: [{ dataValidade, quantidade? }] }`. O critério de aceite de T05 pedia "array de unidades, cada uma com sua própria `dataValidade`"; o array continua sendo isso, mas uma entrega de doze frascos com a mesma validade agora é uma linha, não doze. Justificativa: no recebimento real a gestora confere a caixa e lê uma validade por vez — obrigá-la a repetir a data é convite a erro de digitação, justamente no campo que o sistema inteiro existe para proteger. **Isto não muda o modelo de dados**: o servidor expande a linha em N `UnidadeProduto` independentes, cada uma com seu `codigoQr` próprio, exatamente como se tivessem sido enviadas separadas. `quantidade` é ergonomia de entrada, não uma volta ao controle por lote.

**Tetos do lote: 50 linhas, 200 unidades por linha, 500 unidades por requisição.** Os dois primeiros são JSON Schema; o total não é expressável em schema (depende da soma) e é conferido na rota, devolvendo 400 `LOTE_MUITO_GRANDE`. Justificativa: um recebimento da perfumaria tem dezenas de unidades (RNF10), e um zero a mais na quantidade geraria centenas de etiquetas inúteis e uma transação longa demais.

**Receber unidade de produto inativo é recusado com 409 `PRODUTO_INATIVO`.** Segue a decisão de T04 de que o uso operacional do catálogo (cadastrar unidade, vender) não inclui produto inativo. A mensagem indica o caminho de saída — reativar pelo catálogo —, e a tela só oferece produtos ativos no seletor, para que o 409 seja o segundo obstáculo e não o primeiro.

**Validade já vencida gera aviso, nunca recusa.** A resposta 201 traz `avisos: [{ codigo: 'UNIDADE_JA_VENCIDA', dataValidade, quantidade, mensagem }]` ao lado das unidades criadas. Justificativa: cadastrar unidade vencida é legítimo e previsível — é o que acontece quando a loja acha na prateleira um frasco que nunca foi registrado, e é exatamente o item que mais precisa entrar no sistema. Quem decide o destino dele é o fluxo de exceção da seção 6.1 do PRD (T11), não o cadastro. Recusar aqui empurraria o item de volta para o controle manual, que é o problema que o trabalho ataca.

**O lote inteiro é gravado numa única `prisma.$transaction`.** Um recebimento é um evento único; gravar metade das unidades deixaria a gestora sem saber quais frascos já têm etiqueta e quais não têm, e sem forma de descobrir isso a não ser conferindo um a um. Não confundir com a RNF02, que é sobre lock na saída — aqui não há leitura-antes-de-escrita a proteger, só atomicidade do conjunto.

**Colisão de `codigoQr` é resolvida por retry do lote inteiro, até 3 tentativas, e não por consulta prévia.** A detecção é a violação `P2002` do `@unique`, como em T04: consultar antes de inserir deixaria a mesma janela de corrida. Com 32^6 códigos a colisão é remotíssima; o retry existe para que ela seja invisível em vez de virar erro na tela. Esgotadas as tentativas, responde 503 `CODIGO_QR_INDISPONIVEL` — 503 e não 500 porque repetir a requisição tende a funcionar. `gerarCodigosQr` também garante que os códigos de um mesmo lote sejam distintos entre si, que é a colisão de longe mais provável.

**Datas de calendário passam por `backend/src/shared/data.ts`, ancoradas em meia-noite UTC.** `dataDeString('2027-03-01')` monta a data por componentes (`Date.UTC`), nunca por `new Date` sobre texto solto, e `hojeComoData()` toma os componentes da hora **local** do servidor antes de ancorar em UTC. Justificativa: em BRT (UTC-3) as duas armadilhas são simétricas — ancorar em meia-noite local grava 03:00 UTC e pode escorregar o dia na coluna `DATE`; ler a data em UTC faz o sistema "virar o dia" às 21h, o que estaria errado para a loja e para a definição de vencido. A meia-noite UTC é também exatamente o valor que o Prisma devolve ao ler uma coluna `DATE`, o que permite comparar valor convertido com valor lido do banco sem deslocamento — é isso que `validarSaidaFifo` (T07) vai fazer a cada leitura de QR. Verificado contra o banco real: o container está em UTC, o relógio local em BRT, e as validades gravadas conferem com o que foi digitado (`pg_typeof` = `date`, RNF01).

**Navegação entre as telas por estado no `App` (abas), ainda sem biblioteca de roteamento.** Mantém a decisão de T03b: o roteamento entra quando for necessário, e com duas telas ainda não é — o custo (URL por tela, histórico) só se paga a partir do fluxo de leitura de QR, em T10, e entra como decisão daquela tarefa. A aba de recebimento só aparece para GESTOR, o que é conveniência de interface: quem recusa continua sendo o 403 do backend, com teste de rota provando.

**O formato do `codigoQr` ficou confinado em `backend/src/modules/unidade/codigoQr.ts`, inclusive nos testes.** O módulo exporta `PADRAO_CODIGO_QR`, e os testes validam contra ele em vez de repetir a expressão literal. Justificativa: a decisão de formato é explicitamente provisória até o teste físico da RNF08 (T16); se ela cair, trocar o formato precisa ser editar um arquivo, não caçar `PRF-` pelo repositório. A escolha do alfabeto Crockford Base32 ganhou um segundo motivo durante a implementação, além do já registrado: sem I, L, O e U, o código também é seguro de **digitar** — o que importa para o fallback manual do RF05, quando o QR estiver danificado ou a câmera falhar.

**`status` inicial não é escrito pela aplicação: vem do default `EM_ESTOQUE` do schema.** O corpo da requisição usa `additionalProperties: false`, e o ajv do Fastify (com `removeAdditional`) descarta `status` e `codigoQr` se o cliente os enviar, em vez de recusar a requisição. O teste prova a garantia que importa — o que o cliente mandou não chega ao banco —, e não o código de status da recusa.

**A conferência no navegador de T05 foi executada.** Diferente de T03b e T04, o `playwright-cli` encontrou um Chrome utilizável nesta máquina (`/opt/google/chrome`). Percorrido o caminho alterado: login como GESTOR, troca para a aba de recebimento, seleção do produto, duas linhas de validade (uma futura, uma vencida, com quantidade 3), envio, e conferência da tabela de códigos gerados e do aviso de unidade vencida. Nenhum erro novo no console — os dois presentes são os 401 de `GET /auth/me` antes do login, que são o comportamento esperado. **As pendências de conferência de T03b e T04 continuam abertas**, já que aquelas telas não foram reexercitadas aqui.

## 2026-09-07 — Casos de teste de `validarSaidaFifo` (T06)

**`validarSaidaFifo` grava os quatro eventos da leitura, não só os dois da seção 4 da arquitetura.** Além de `ALERTA_FIFO_DISPARADO` (ramo 4) e `SAIDA_CONFIRMADA` (ramo 5), a função passa a gravar `LEITURA_QR_SAIDA` em **toda** leitura — inclusive a de código não cadastrado, com `unidadeId` e `produtoId` nulos e o código no `payload` — e `TENTATIVA_VENDA_UNIDADE_VENCIDA` no ramo 3. A tabela de eventos da seção 5 do PRD já previa os quatro, mas não dizia quem os grava. Justificativa: é a única função que vê a leitura inteira e roda dentro da transação, então gravar fora dela abriria a chance de o evento divergir do veredito. E sem `LEITURA_QR_SAIDA` não existe denominador para o indicador central do TCC — a taxa de acerto na primeira leitura —, porque os eventos de veredito sozinhos só contam os casos que deram errado. A seção 4 de `docs/arquitetura.md` continua descrevendo apenas os dois; esta entrada é o complemento.

**`ALERTA_FIFO_DISPARADO` tem `unidadeId` = unidade LIDA, e a correta vai no `payload` como `unidadeCorretaId`.** O evento descreve uma leitura, e o que foi lido é o frasco errado. A unidade correta entra no payload porque o indicador da RF13 ("alertas FIFO disparados vs. substituições efetivas") precisa cruzar as duas pontas — sem o alvo registrado, não há como saber se o alerta levou à substituição.

**`tentativas` é derivado do `EventoLog`, não persistido em lugar nenhum.** É a contagem de `ALERTA_FIFO_DISPARADO` do mesmo `produtoId` e mesmo `usuarioId` desde a última `SAIDA_CONFIRMADA` daquele par, e inclui o bloqueio da chamada corrente (o primeiro bloqueio devolve `tentativas: 1`). Justificativa: a seção 6.2 do PRD proíbe estado intermediário no servidor, e `UnidadeProduto` não tem campo de contador — as duas coisas juntas deixam o log como único lugar onde o número pode viver. O escopo é o par (SKU, atendente) porque o ciclo do laço é um atendimento: a atendente troca de frasco a cada tentativa, então contar por unidade lida daria outro número, e somar as tentativas de uma colega inflaria o indicador. Descartada a alternativa de um identificador de ciclo gerado no cliente: mudaria a assinatura da função e colocaria parte do controle do laço no frontend, em atrito com a RNF04.

**A suíte de T06 entra no `npm test` padrão e fica vermelha até T07.** 46 casos falhando com `NAO_IMPLEMENTADO_T07`. Justificativa: a seção 8 do PRD exige os testes antes da implementação, e a forma mais honesta de cumprir isso é a definição de pronto de T07 ser literalmente "esta suíte passa, sem editá-la". A mensagem única em toda falha existe para que o vermelho seja inconfundivelmente o esperado e não uma regressão. Descartadas as alternativas de script separado e `describe.skip`, ambas por deixarem a suíte fácil de esquecer.

**Testes com banco real: banco `estoque_fifo_test`, criado e migrado pela própria suíte.** Executa a decisão já registrada na revisão de modelo de dados. `backend/tests/apoio/bancoDeTeste.ts` lê a URL **exclusivamente** de `.env.test` — nunca do `.env` nem do ambiente do processo — cria o banco se não existir, roda `prisma migrate deploy` e trunca as tabelas entre os testes. Duas travas: a URL é recusada se o nome do banco não terminar em `_test` (a suíte apaga tudo o que encontra, e apontar para `estoque_fifo` por engano de configuração destruiria o seed e os dados da conferência manual), e a falha de conexão vira uma mensagem dizendo para subir o `docker compose`, em vez do `P1001` cru do Prisma. O `TRUNCATE` alcança o `EventoLog`, o que não contraria a RNF05: aquela regra proíbe `UPDATE`/`DELETE` na tabela **pela aplicação**, e nenhum código de produção passa por este módulo.

**`npm run test:sem-banco` preserva a execução sem container.** T03 registrou que manter a suíte livre de PostgreSQL a tornava executável na máquina da banca; T06 quebra isso por necessidade, então a garantia vira um script próprio, que roda as 66 asserções mockadas de T03–T05. Também entrou `npm run test:fifo`, para T07 iterar sem esperar a suíte inteira.

**`npm run typecheck` passa a checar `tests/` também, via `tsconfig.tests.json`.** As suítes ficam fora do `tsconfig.json` porque não são compiladas para `dist/`, e até T05 ninguém as checava — o Vitest transpila sem verificar tipos. A partir de T06 isso deixa de ser aceitável: o tipo `Veredito` é o contrato que T07 tem que respeitar, e um contrato que ninguém verifica não é contrato.

**`.gitignore` ganhou `!.env.test.example`.** O padrão `.env.*` engolia o arquivo de exemplo, e só `.env.example` estava excetuado.

**Dois casos de teste nasceram durante a escrita, fora da lista do critério de aceite.** (a) *Vendida a última unidade não-vencida, a vencida não vira prioritária* — a exclusão do pool da seção 6.1 é mais frágil no fim do estoque, quando a vencida é a única candidata restante. (b) *Leituras simultâneas de unidades diferentes do mesmo SKU não se bloqueiam entre si* — fixa que o lock da RNF02 é da unidade lida, não do SKU; travar o produto inteiro é uma leitura possível do requisito e serializaria o balcão sem necessidade.

**Não se testa ordem entre eventos do `EventoLog`.** `ocorridoEm` usa o default `CURRENT_TIMESTAMP` do Postgres, que é constante dentro de uma transação — os quatro eventos de uma leitura saem com o mesmo instante. Consequência para o TCC: a ordem relativa de eventos da mesma leitura não é recuperável do log, só a ordem entre leituras diferentes. Isso é suficiente para os indicadores previstos (contagens e taxas), mas precisa ser levado em conta se alguma análise futura depender de sequência intra-leitura.

**Datas dos testes são derivadas de `hojeComoData()`, nunca literais.** O objeto de teste é justamente a comparação com "hoje": uma suíte com datas fixas passa a mentir assim que o calendário avança do dia em que foi escrita, e o caso de borda `dataValidade == hoje` deixaria de existir.

## 2026-09-08 — Implementação de `validarSaidaFifo` (T07)

**O lock da RNF02 é tomado por `$queryRaw` e a unidade é relida pelo client tipado, na mesma transação.** `SELECT "id" FROM "UnidadeProduto" WHERE "codigoQr" = $1 FOR UPDATE`, seguido de um `findUniqueOrThrow` pelo id devolvido. São duas viagens ao banco onde uma bastaria. Justificativa: um `SELECT *` cru devolve linha destipada — `dataValidade` e `status` chegariam como valores brutos e precisariam de conversão à mão —, e o `Veredito` carrega essa unidade até a tela, então ela precisa ser um `UnidadeProduto` de verdade. A releitura também acontece **depois** do lock, o que é o que faz a transação perdedora enxergar a baixa já comitada da vencedora. O custo é irrelevante frente à RNF06 (<500ms): as duas queries são por chave primária/única, na mesma conexão. Descartado o mapeamento manual da linha crua, que economizaria um round-trip e duplicaria em código a conversão de tipos que o Prisma já faz.

**Verificação de que o lock é carga-de-trabalho, não decoração.** Removido o `FOR UPDATE` e reexecutada a suíte: os três casos de concorrência falham, e falham exatamente na forma que T06 previu — `Unique constraint failed on the fields: (unidadeId)`, ou seja, a perdedora chega ao `create` da `Saida` em vez de reler a linha baixada. Restaurado em seguida. Registrado aqui porque é o que separa "o teste passa" de "o teste prova alguma coisa": os 43 casos restantes passam com ou sem lock.

**A fronteira do ciclo de tentativas usa `>` estrito sobre `ocorridoEm`.** A contagem de `ALERTA_FIFO_DISPARADO` do par (SKU, atendente) considera apenas eventos estritamente posteriores à última `SAIDA_CONFIRMADA` do mesmo par. `ocorridoEm` é `timestamp(3)`, e T06 já registrou que ele é constante dentro de uma transação: dois eventos de transações diferentes podem, em tese, cair no mesmo milissegundo. O `>` resolve esse empate a favor de **fechar** o ciclo, isto é, subconta em vez de inflar. Escolha deliberada: o indicador do TCC é "quantas vezes a atendente errou", e um número inflado por artefato de relógio corromperia o resultado da pesquisa de um jeito que um número conservador não corrompe. A contagem da chamada corrente não vem do banco — é somada em memória (`contagem + 1`), o que torna o primeiro bloqueio de um ciclo imune ao empate.

**A consulta do pool prioritário desempata por `dataEntrada` e depois por `id`, sem que isso vire ordem total.** O veredito continua comparando **valores** de `dataValidade` (decisão de T06): qualquer unidade da menor validade confirma. O `orderBy` secundário existe só para que a unidade **sugerida** no `BLOQUEAR_FIFO` seja a mesma entre duas leituras iguais, em vez de variar conforme a ordem que o Postgres devolver. Sem ele, a tela poderia apontar frascos diferentes a cada tentativa dentro do mesmo laço — indistinguíveis entre si, mas confusos de ler. Sugerir o de entrada mais antiga é, além disso, o que aproxima o desempate do FIFO de entrada.

**`LEITURA_QR_SAIDA` é gravado depois da decisão, com o veredito no `payload`.** A alternativa natural seria gravá-lo primeiro, já que ele descreve a leitura. Gravando por último, o evento carrega `veredito` (e `motivo`, nos ramos de erro), o que permite calcular a taxa de acerto na primeira leitura a partir de um único tipo de evento, sem juntar com os outros três. Como todos os eventos da leitura compartilham o mesmo `ocorridoEm` dentro da transação (ver T06), gravar por último não perde informação de ordem — não havia ordem a perder. A gravação num ponto único da função também é o que garante estruturalmente "uma leitura registrada por chamada", em vez de depender de cada ramo lembrar de fazê-lo.

**Datas dentro do `payload` são texto `AAAA-MM-DD`, não instante.** `dataValidade` vem de coluna `DATE` ancorada na meia-noite UTC (RNF01); serializada como instante no JSON, ela voltaria da análise sujeita a escorregar um dia por fuso — exatamente o defeito silencioso que a decisão de T05 sobre datas existe para evitar. A conversão é local ao módulo: `src/shared/data.ts` continua com o par `dataDeString`/`hojeComoData`, sem ganhar função nova por conta de um detalhe de log.

**Nenhum outro arquivo do backend mudou.** A função não abre transação, não conhece rota e não sabe o que é HTTP. O endpoint que a chama é T08.

## 2026-09-08 — Endpoint de leitura de QR (T08)

**Toda leitura processada responde HTTP 200, qualquer que seja o veredito.** Inclui `QR_NAO_ENCONTRADO` e `BLOQUEAR_FIFO`. Não-200 fica reservado ao que não chegou a ser leitura: 400 (corpo sem código), 401 (sem sessão), 403 (papel), 500 (falha inesperada). Descartado o mapeamento de veredito em status (404 para código desconhecido, 409 para bloqueio) por quatro razões. (a) A RNF04: com o veredito no status, o cliente passa a ter duas fontes de verdade, e o jeito natural de escrever cliente HTTP é ramificar em `res.ok` primeiro — a tela de bloqueio FIFO seria alcançada pelo caminho de erro, que atrai tratamento genérico ("algo deu errado"), a mensagem errada para o comportamento central do sistema. (b) Semântica: 404 diz que o recurso endereçado não existe, e o recurso endereçado é `/saidas/ler`, que existe; o código desconhecido é conteúdo da requisição. (c) Instrumentação: em T10 a tela é um PWA com service worker, e retry automático sobre não-2xx geraria uma segunda chamada e um segundo `LEITURA_QR_SAIDA`, inflando o denominador da taxa de acerto na primeira leitura (RF12). (d) Operação: se a interação mais comum do balcão emitir 4xx o dia inteiro, a taxa de erro do serviço deixa de distinguir "FIFO funcionando" de "backend degradado".

**A resposta é enriquecida na rota, depois do commit, sem tocar em `validarSaidaFifo`.** O `Veredito` carrega `UnidadeProduto` sem a relação `Produto`, e o ramo `BLOQUEAR_FIFO` traz só a unidade correta. `saida.service.ts` busca, **fora** da transação, o produto (uma consulta: é o mesmo SKU nos dois lados do bloqueio) e a unidade lida, e devolve `unidadeLida` e `unidadeCorreta` já com `produto` embutido. Justificativa: a tela de T10 diria "devolva este e pegue o PRF-XXXXXX" sem nomear o perfume nem mostrar a validade do frasco na mão. Descartadas as duas alternativas: carregar o produto dentro do `Veredito` (reabriria T07 e mudaria o contrato que T10 e T11 consomem) e deixar a tela buscar o produto numa segunda chamada (mais uma ida à rede no meio do atendimento). As consultas ficam fora da transação de propósito — são de apresentação, e prendê-las ao lock atrasaria a próxima leitura do mesmo frasco sem motivo.

**A mensagem exibida no balcão é escrita no servidor e vai junto do veredito.** Cada ramo devolve `mensagem` pronta. É a leitura estrita da RNF04: se o frontend montasse o texto a partir do código do veredito, ele estaria interpretando o veredito, não refletindo-o. Consequência para T10: a tela escolhe *layout* pelo campo `veredito` e exibe `mensagem` como veio. Dentro da mensagem a data aparece como `DD/MM/AAAA` (texto para humanos), enquanto o campo `dataValidade` da resposta continua `AAAA-MM-DD` (RNF01).

**A resposta de `CONFIRMAR` é redigida como fato consumado.** "Saída registrada: …", nunca "confirme a saída". O ramo 5 de `validarSaidaFifo` cria a `Saida` e muda o status dentro da transação da leitura, então quando a resposta chega ao balcão a venda já aconteceu.

**Tensão registrada, não resolvida: `POST /saidas/confirmar` (seção 5 da arquitetura) não tem o que fazer.** A seção 4 do mesmo documento define que o ramo `CONFIRMAR` já cria a `Saida` e baixa a unidade; a seção 5 lista um endpoint separado de confirmação para o RF07. As duas não podem valer ao mesmo tempo. Um modelo de dois passos honesto exigiria revalidar o FIFO inteiro na segunda chamada (aceitar o veredito afirmado pelo cliente violaria a RNF04) ou manter reserva no servidor (proibido pela seção 6.2 do PRD) — e a primeira opção quebraria `validarSaidaFifo` em "decidir" e "efetivar", invalidando a suíte de T06, que a seção 8 do PRD manda escrever antes e não editar depois. Decidido deixar a escolha para T09, que é a tarefa dona daquele endpoint e do RF07. Caminhos plausíveis para lá: `/saidas/confirmar` assumir outra função (carregar o `sessaoVendaId`, ou confirmar o fluxo de exceção de vencido de T11), ou sair da tabela de endpoints, com o RF07 atendido por `/saidas/ler`. **Requer decisão do orientando antes de T09.**

**A normalização do código digitado vive em `codigoQr.ts`, junto do gerador.** `normalizarCodigoQr` aplica maiúsculas, remove espaços e desfaz as confusões que o próprio alfabeto Crockford antecipa (`I` e `L` → `1`, `O` → `0`). Como o gerador nunca emite essas três letras, o mapeamento não pode colidir com código válido, e o prefixo `PRF` não as contém. Justificativa do lugar: o formato é provisório até a RNF08 (T16) e continua tendo um dono só — normalizar na rota espalharia conhecimento do formato. A função não julga: código que continua fora do `PADRAO_CODIGO_QR` depois de normalizado segue para a consulta e volta como `QR_NAO_ENCONTRADO`, com evento gravado. Recusar por schema apagaria do log a leitura de etiqueta danificada, que é dado da pesquisa (RF12).

**A rota lista `ATENDENTE` e `GESTOR` explicitamente, mesmo cobrindo todos os papéis de hoje.** `exigirPapel(Papel.ATENDENTE, Papel.GESTOR)` em vez de só `autenticar`. Um papel novo no enum não deve ganhar acesso ao fluxo de saída por omissão.

**Arquivos de teste passam a rodar em sequência (`fileParallelism: false`).** Com a segunda suíte de banco real (`tests/saida`, além de `tests/fifo`), as duas passaram a dividir o mesmo `estoque_fifo_test` em paralelo e a truncar os dados uma da outra no meio da execução — 18 falhas que somem ao rodar em sequência. Descartada a alternativa de um banco por worker: mais complexidade na trava do sufixo `_test` sem ganho nesta escala. O custo é nulo na prática: a suíte inteira leva o mesmo tempo (≈15s), porque o gargalo é o banco, não a CPU. `npm run test:sem-banco` passou a excluir também `tests/saida/**`, e entrou `npm run test:saida`.

**O Prisma Client do app é redirecionado para o banco de teste por `vi.mock`, não substituído por um duplo.** `tests/saida/lerQr.test.ts` troca `src/db/prisma.js` pelo client memoizado de `bancoDeTeste.ts`. Diferente de T03–T05, onde o mock substituía o comportamento, aqui ele muda só o destino: continua sendo Prisma de verdade contra Postgres de verdade, no banco descartável. Sem isso o app falaria com o `estoque_fifo` de desenvolvimento, que a suíte truncaria.

**Conferência por `curl` no servidor real** (método do CLAUDE.md para mudanças de backend), contra o banco de desenvolvimento: `QR_NAO_ENCONTRADO`, `EXCECAO_VENCIDO` e `BLOQUEAR_FIFO` respondendo 200 entre 8ms e 38ms — folgado dentro da RNF06 (<500ms) —, com `tentativas` subindo de 1 para 2 entre duas requisições independentes, que é o laço do RF06 visível sem estado no servidor. O código digitado ` prf-pw9vdk ` levou ao mesmo veredito do código lido. `CONFIRMAR` não foi exercitado por `curl` de propósito: ele consumiria uma unidade do banco de desenvolvimento, e já tem três casos automatizados contra banco real.

## 2026-09-08 — Registro de saída + EventoLog append-only (T09)

**`POST /saidas/confirmar` deixa de existir; o RF07 é atendido por `/saidas/ler`.** A
tensão registrada em T08 entre as seções 4 e 5 da arquitetura foi resolvida a favor da
seção 4, que é também o que a seção 7 do PRD já descrevia: o ramo 5 de `validarSaidaFifo`
cria a `Saida` e muda o status dentro da transação da leitura. O modelo de dois passos foi
descartado porque nenhuma de suas duas formas honestas cabe: revalidar o FIFO inteiro na
segunda chamada é a única alternativa a aceitar o veredito afirmado pelo cliente (o que a
RNF04 proíbe), e manter reserva no servidor entre as duas chamadas é proibido pela seção
6.2 do PRD. Qualquer das duas exigiria quebrar `validarSaidaFifo` em "decidir" e
"efetivar", invalidando a suíte que a seção 8 do PRD manda escrever antes e não editar
depois. A seção 5 da arquitetura foi corrigida, e a linha de bloqueio saiu do backlog.

**A imutabilidade do `EventoLog` virou trigger de banco, não disciplina de código.**
`BEFORE UPDATE OR DELETE ... RAISE EXCEPTION`, na migração
`20260908120000_append_only_evento_log`. Descartada a alternativa mais leve, uma extensão
do Prisma Client que lançasse em `update`/`delete`: ela protege só o caminho da aplicação,
e o risco realista da RNF05 não é o backend chamar `update` por engano — é alguém abrir o
Prisma Studio ou o `psql` durante o piloto na loja para "corrigir" uma linha que parece
errada. Como o log é instrumento de coleta do TCC, uma correção manual bem-intencionada
falseia o resultado da pesquisa sem deixar rastro. O trigger alcança todos os caminhos.
Deliberadamente **não** cobre `TRUNCATE` (trigger de linha não dispara nessa operação), o
que mantém o reset das suítes funcionando — a RNF05 proíbe alterar o histórico, e zerar um
banco descartável não é isso.

**A mensagem do trigger explica em vez de só recusar.** Cita a RNF05, a operação recusada,
e diz o que fazer no lugar ("um evento gravado não se corrige, se complementa com um evento
novo"). Quem vai esbarrar nela é um desenvolvedor ou o próprio orientando no meio do
piloto, e um `permission denied` seco convidaria a desabilitar o trigger em vez de
entender por que ele existe. Custo: a mensagem é ASCII sem acentos, porque vem de dentro do
`plpgsql`.

**O `EventoLog` ganhou módulo próprio e união fechada de tipos.**
`src/modules/evento-log/eventoLog.service.ts` é o único ponto que insere na tabela;
`validarSaidaFifo` perdeu sua função privada e passou a chamá-lo por um adaptador fino que
só extrai os identificadores da unidade lida. `TipoEvento` é uma união dos nove tipos da
seção 5 do PRD, declarada inteira desde já — inclusive os que só serão gravados em T11 e
T18 —, porque a lista vem do PRD e não do que já foi implementado. A seção 9 do PRD avisa
que mexer no schema do log quebra a comparabilidade dos dados coletados antes e depois; uma
união fechada faz de qualquer acréscimo um ato deliberado, com data aqui, em vez de uma
string nova aparecendo no meio de um `create`.

**`registrarEvento` devolve a `PrismaPromise` crua, não uma `Promise` comum.** É o que
permite ao mesmo módulo servir os dois chamadores sem duplicação: `validarSaidaFifo` a
aguarda dentro de um `$transaction` de callback, e o cadastro em lote a compõe na forma de
array. Nos dois casos continua sendo uma transação só, que é o requisito de fato — evento
gravado fora da transação sobreviveria a um rollback e passaria a descrever algo que não
aconteceu.

**`dataParaPayload` vive no módulo `evento-log`, e não em `src/shared/data.ts`.** T07 havia
deixado essa conversão local a `validarSaidaFifo`, com o argumento de que era detalhe de
log com um dono só. Agora há dois donos (a saída e o cadastro de unidades), mas os dois
escrevem *payload de log* — então o dono passou a ser o módulo do log, não o módulo de
datas. `shared/data.ts` continua sendo a fronteira entre a API e a coluna `DATE`, com o par
`dataDeString`/`hojeComoData` intacto.

**`UNIDADE_CADASTRADA` entrou em T09, embora o cadastro seja de T05.** Era o único evento da
tabela da seção 5 do PRD que descrevia funcionalidade já implementada e não tinha quem o
gravasse: T14/T15 são sobre etiquetas, não sobre o log, e sem dono ele passaria batido até o
dashboard (T20) precisar dele — quando o dado do período intermediário já estaria perdido.
Um evento **por unidade**, não por lote: `EventoLog.unidadeId` é singular, e é essa
granularidade que permite cruzar o cadastro com as leituras posteriores da mesma unidade. O
recebimento é reconstruído por `unidadesNoLote` no payload, sem a entidade `Lote` que o PRD
não previu.

**Os ids das unidades do lote passaram a ser gerados explicitamente com `randomUUID()`.**
O evento precisa do id da unidade dentro da mesma transação, e o log não tem FK para
`UnidadeProduto` (seção 3 da arquitetura) que o Prisma pudesse resolver por relação. Isso
mantém `cadastrarUnidades` na forma de array do `$transaction` — trocar para a forma de
callback obrigaria a reescrever o duplo de `tests/unidade.test.ts` sem ganho. Não muda nada
de fato: o `@default(uuid())` do Prisma também é gerado no client, não no banco.

**`sessaoVendaId` malformado responde 400, ao contrário do `codigoQr`.** T08 decidiu
deliberadamente não recusar código de QR fora do padrão, porque a leitura de uma etiqueta
danificada é dado da pesquisa e recusá-la por schema a apagaria do log. A assimetria é
proposital e vale a pena registrar: `codigoQr` é digitado por uma pessoa no balcão e chega
torto pelo mundo físico; `sessaoVendaId` é gerado por `crypto.randomUUID()` no próprio
cliente e só chega torto se o cliente estiver quebrado. Aceitá-lo em silêncio produziria
relatório de atendimento errado sem nenhum sinal. O custo — uma leitura legítima perdida
quando o frontend erra — virou verificação manual no backlog para T10.

**A chave `sessaoVendaId` está sempre presente no payload de `LEITURA_QR_SAIDA`, com
`null` quando não veio.** Chave que às vezes falta no JSON é armadilha na análise: a
consulta que a procura não distingue "não havia agrupador" de "o campo mudou de nome entre
uma versão e outra". O valor entra também nas leituras **bloqueadas**, e não só na
confirmada — sem isso, o indicador "quantos atendimentos esbarraram no FIFO" (RF13) teria
numerador sem denominador.

**Conferência por `curl` no servidor real** (método do CLAUDE.md para mudanças de backend),
contra o banco de desenvolvimento: leitura com agrupador válido devolvendo `BLOQUEAR_FIFO`
em 200 e 21ms — folgado dentro da RNF06 —, com o `sessaoVendaId` aparecendo no payload do
`LEITURA_QR_SAIDA`; agrupador malformado em 400; `UPDATE` e `DELETE` no `EventoLog` pelo
`psql` recusados pelo trigger, com a mensagem legível; e um recebimento de 2 unidades pela
API gerando 2 `UNIDADE_CADASTRADA`, cada um com o `unidadeId` casando com a unidade real.
`CONFIRMAR` ficou de fora do `curl` pelo mesmo motivo de T08 — consumiria uma unidade do
banco de desenvolvimento, e já tem casos automatizados contra banco real.

## 2026-09-08 — Tela de leitura de QR, roteamento e offline (T10)

**Entra biblioteca de roteamento (`react-router-dom`), decidido pelo orientando.** T03b e
T05 adiaram o roteamento duas vezes, registrando que a decisão seria de T10. A proposta
inicial desta tarefa era manter as abas por estado; o orientando decidiu separar as telas
por rota, e é o que está implementado: `/login`, `/leitura`, `/produtos`, `/recebimento`,
com `/` e qualquer URL desconhecida redirecionando para a tela inicial do papel. O `App`
continua sendo o guardião de sessão — o que mudou é que ele decide *rota* em vez de ramo
de render, e as três situações de T03b (`verificando`, `anonimo`, `autenticado`)
permanecem. Consequência operacional a lembrar na publicação: URL própria por tela exige
que o host estático devolva o app shell em caminho fundo; no `vite dev` isso já vale, e no
app instalado quem resolve é o `navigateFallback` do service worker.

**A tela inicial depende do papel: ATENDENTE cai em `/leitura`, GESTOR em `/produtos`.**
Ler QR é a única coisa que a atendente faz no sistema, e um passo de navegação a cada
atendimento é custo repetido no balcão. Esconder rota por papel continua sendo
conveniência de interface — quem recusa de fato é o 403 do backend (RNF04); uma URL
digitada à mão para uma tela fora do papel cai na tela inicial em vez de renderizar.

**Não existe leitura offline, e não há fila de leituras para enviar depois.** O portão da
tela usa dois sinais (`navigator.onLine`, depois `GET /health`) e bloqueia o fluxo com
mensagem explícita quando qualquer um falha (RNF07, arquitetura seção 6). Descartada a
fila: um QR lido sem rede só teria valor se alguém desse o veredito na hora, e o veredito
depende do estoque inteiro do SKU naquele instante, que mora no servidor (RNF03).
Enfileirar significaria vender sem veredito ou entregar um veredito que pode estar errado
quando enfim chegar. O PWA continua útil offline como app instalado: abre, mostra a tela e
explica o bloqueio, em vez do erro de rede do navegador.

**O veredito na tela é descartado quando a conexão cai.** Achado da conferência no
navegador: ao voltar de offline, o resultado da última leitura reaparecia intacto. Um
veredito vale para o estoque de um instante — enquanto a conexão esteve fora, outra
atendente pode ter vendido a unidade que a tela ainda aponta. Reexibi-lo seria apresentar
como atual um dado que ninguém revalidou.

**`/saidas/ler` e `/health` em `NetworkOnly` no service worker, sem retry automático.**
Servir veredito de cache seria servir uma decisão vencida. E repetição automática pelo
service worker gravaria um segundo `LEITURA_QR_SAIDA`, inflando o denominador da taxa de
acerto na primeira leitura, que é o indicador do TCC (RF12) — é a mesma razão **(c)** já
registrada em T08 para não codificar veredito em status HTTP.

**A câmera fica isolada em `components/LeitorCamera.tsx`, substituída por dublê nos
testes.** `html5-qrcode` (fixada na arquitetura desde o início) depende de `getUserMedia` e
de decodificação de imagem, e jsdom não tem nenhum dos dois; o `playwright-cli` também não
aponta câmera para um frasco. Com a integração inteira num arquivo que só pede a câmera e
emite o texto lido, todo o resto da tela fica coberto por teste automatizado, e o que sobra
sem cobertura é exatamente o que precisa de celular real — verificação já reservada ao
orientando no backlog. A biblioteca entra por import dinâmico: só é baixada quando a
atendente liga a câmera, e não no carregamento do app.

**A tela não normaliza o código digitado.** `codigoQr.ts` no backend é o dono único do
formato desde T08, que segue provisório até a RNF08 (T16). Normalizar também no cliente
criaria um segundo dono e mascararia divergência entre os dois. Conferido no navegador:
`prf-vjrj6k` digitado em minúsculas chega cru à API e volta como `EXCECAO_VENCIDO` da
unidade certa.

**`sessaoVendaId` é omitido do corpo quando o navegador não tem `crypto.randomUUID`.**
Contexto não-seguro (HTTP em IP de rede local) não oferece nem `randomUUID` nem
`getUserMedia`. Enviar string vazia bateria na validação de formato UUID decidida em T09 e
derrubaria a requisição inteira: perder uma venda por causa de um campo de relatório é o
pior desfecho possível. A tela avisa que o agrupamento está indisponível e segue lendo.

**`formatarData` saiu de `services/unidades.ts` para `services/datas.ts`.** T05 a criou
junto do serviço de unidades porque era o único consumidor; a tela de leitura virou o
segundo. Nenhuma mudança de comportamento — segue convertendo por fatia de texto, sem
passar por `Date`, porque `dataValidade` é `DATE` (RNF01) e `new Date('2027-03-01')`
voltaria um dia atrás em fuso negativo.

**Conferência no navegador com `playwright-cli`** (método do CLAUDE.md para mudanças de
UI), contra backend e banco de desenvolvimento: login como ATENDENTE caindo direto em
`/leitura`; `BLOQUEAR_FIFO` real de `PRF-PW9VDK` apontando `PRF-474MZJ` com as duas
validades lado a lado; `EXCECAO_VENCIDO` sem botão de ação; `network-state-set offline`
fechando o portão e `online` reabrindo; nenhum erro de console além dos dois 401 de
`/auth/me` anteriores ao login. Conferido também em viewport de celular (390×844): o título
do veredito e o código a buscar cabem sem rolagem. `CONFIRMAR` ficou de fora pelo mesmo
motivo de T08 e T09 — consumiria uma unidade do banco de desenvolvimento, e já tem casos
automatizados.

## 2026-09-08 — Exceção de unidade vencida: os três caminhos (T11)

**A correção de validade revalida o FIFO no servidor, na mesma transação — e pode terminar
com a unidade vendida.** O PRD (6.1) diz "revalida o FIFO do zero" sem dizer quem revalida.
A alternativa era a tela corrigir e depois reenviar o QR para `/saidas/ler`. Escolhida a
revalidação server-side, validada pelo orientando: a tela não pode esquecer de fazê-la, e a
unidade fica sob o mesmo lock do início ao fim, sem instante em que outra atendente veja o
estoque pela metade. A consequência é coerente com T09 — como não existe
`POST /saidas/confirmar`, um veredito `CONFIRMAR` na revalidação é a venda já feita. O
número de `LEITURA_QR_SAIDA` seria o mesmo nas duas opções (dois eventos: leitura original
e revalidação), então a escolha não mexe no denominador da RF12.

**A pré-condição "está vencida" é o que impede o override de furar o FIFO.** Se
`/excecao-vencido/override` aceitasse qualquer unidade `EM_ESTOQUE`, um gestor poderia usá-lo
para vender fora de ordem com uma justificativa qualquer, e o bloqueio reativo do RF06
viraria opcional para quem tem o papel. Vale para os três caminhos, mas é neste que ela
deixa de ser validação de formulário e vira trava: o override é escape do bloqueio de
**validade**, e só dele. Unidade que vence hoje não está vencida — a fronteira é a mesma
comparação do ramo 3 de `validarSaidaFifo` (`dataValidade < hoje`, RNF01).

**Falha de pré-condição é 4xx, ao contrário do veredito em 200 de `/saidas/ler`.** T08
decidiu que todo veredito de leitura responde 200 porque a leitura é uma pergunta cuja
resposta pode ser "não pode" — resultado, não falha de protocolo. Aqui a assimetria é
proposital: a tela **afirma** uma ação sobre uma unidade cujo estado ela julga conhecer, e
409 é a palavra exata para "o recurso não está no estado que você supôs". 404 para unidade
inexistente, 409 para já baixada e para não vencida, 400 para correção que não muda nada.

**Módulo próprio `excecao-vencido`, e não os três caminhos espalhados pelos módulos
existentes.** Correção em `unidade`, descarte em `descarte` e override em `saida` seria a
divisão por entidade tocada; a divisão adotada é por decisão tomada. Os três são uma escolha
de três vias, de uma tela só (T12), com as mesmas pré-condições — e é isso que o leitor
precisa encontrar junto. `modules/descarte` continua reservado para a fila do gestor (RF11,
T13), que é leitura e não criação.

**`motivo` do descarte é opcional; `justificativa` do override é obrigatória (10 a 500
caracteres).** A seção 6.1 do PRD pede fricção deliberada no override e ação padrão nos dois
primeiros caminhos. Exigir texto livre a cada frasco vencido no balcão colocaria o atrito
exatamente onde ele reduz a coleta do dado de perda — que é o dado que a pesquisa quer. Sem
`motivo`, grava-se "Unidade vencida constatada na leitura de saída.". O mínimo de 10
caracteres recusa "ok" sem virar redação.

**Quem executa e quem autoriza o override são o mesmo gestor.** O sistema não tem escalação
de papel dentro da sessão de uma atendente (não há PIN de gerente): o endpoint é
`GESTOR`-only, e `Saida.usuarioId` e `Saida.autorizadoPorId` recebem o mesmo id. Os dois
campos continuam separados no schema porque uma escalação futura os preencheria diferente —
fundi-los agora seria perder a pergunta. Na prática, a gestora assume a sessão para
autorizar.

**Duas extrações em código de T07/T08, sem mudança de comportamento** (validadas pelo
orientando): o `SELECT ... FOR UPDATE` saiu de `validarSaidaFifo.ts` para
`src/modules/unidade/travarUnidade.ts`, agora nas duas chaves (`codigoQr` e `id`); e
`UnidadeNaResposta` mais a montagem unidade+produto saíram de `saida.service.ts` para
`src/modules/unidade/unidadeNaResposta.ts`, porque descarte e override devolvem a mesma
forma. `saida.service.ts` reexporta o tipo, e `montarResposta` virou
`montarRespostaDeLeitura` exportada, para que a revalidação da correção devolva o veredito
no contrato idêntico ao de `/saidas/ler`. A suíte de T06 seguiu nos 46, sem uma linha
editada.

**Descarte só para unidade vencida.** Frasco quebrado, avaria e furto não têm caminho no
sistema: o PRD só prevê descarte dentro do fluxo da unidade vencida, e um motivo genérico de
baixa é funcionalidade nova. Registrado como limitação em `docs/notas-para-artigo.md`.

## 2026-09-08 — Tela da exceção de unidade vencida (T12)

**Os três caminhos ficam na própria tela de leitura, não em rota nova.** A alternativa era
`/excecao/:id`, para onde o veredito `EXCECAO_VENCIDO` navegaria. Descartada por três
motivos: a seção 6.1 do PRD descreve a interface apresentando os caminhos como continuação
da leitura; uma rota própria precisaria carregar a unidade por estado de navegação ou
refazer a leitura, e refazer gravaria um segundo `LEITURA_QR_SAIDA`, inflando o denominador
da taxa de acerto na primeira leitura (RF12); e a atendente está com o frasco na mão, num
fluxo que T10 desenhou para não perder contexto entre uma leitura e a próxima. O painel
(`components/PainelExcecaoVencido.tsx`) não conhece o veredito que o originou — recebe uma
unidade e devolve o que o servidor respondeu —, o que permite T13 reusá-lo a partir da fila
de descarte, onde não houve leitura de QR nenhuma.

**A ATENDENTE vê só o descarte; os outros dois são anunciados como ações do gestor.** O
backend já decide: `corrigir` e `override` são `GESTOR`-only desde T11. Mostrar os três
desabilitados foi descartado pela mesma razão registrada em T10 — botão inerte no balcão é
pior que ausência. Esconder continua sendo conveniência de interface; quem recusa é o 403
(RNF04). Consequência aceita: resolver um frasco cujo dado está errado exige o gestor
assumir a sessão, que é a mesma consequência já aceita em T11 para o override.

**A tela espelha o mínimo da justificativa, e não compara datas** (decidido pelo orientando
depois de discussão; a proposta inicial era não espelhar nenhum dos dois). O critério que
separa os dois casos: *a tela pode antecipar o que ela mesma sabe por inteiro; não pode
antecipar o que é cópia de estado do servidor.* O mínimo de 10 caracteres é propriedade do
texto que o gestor acabou de digitar — não envelhece, e a tela o tem completo; fica
espelhado, com botão desabilitado e contagem à vista. `VALIDADE_INALTERADA` é propriedade
da validade gravada, de que a tela só tem uma cópia lida na leitura do QR: se outro gestor
corrigiu a unidade nesse meio tempo, comparar no cliente bloquearia uma correção legítima
com a mensagem errada. Falso bloqueio silencioso é pior que uma ida à rede. Dois fatos
sustentaram a escolha: sem o espelho, a recusa do backend chegaria à tela como
`body/justificativa must NOT have fewer than 10 characters` (o formato padrão do Fastify,
que `services/api.ts` lê pelo campo `message`), enquanto `VALIDADE_INALTERADA` tem 400
artesanal em português desde T11; e o projeto já espelha restrição de formulário
(`TelaRecebimento` tem `min`/`max` de quantidade vindos do schema de `unidade.routes.ts`).
O espelho é conveniência, nunca autoridade: discordando, a mensagem exibida é a do servidor.

**Correção que revalida em `CONFIRMAR` é apresentada como fato consumado.** A tela não
pergunta se deve confirmar a saída depois de corrigir a data — não pode, porque a `Saida` já
existe quando a resposta chega (T09, T11). É o momento em que a consequência da revalidação
server-side, decidida em T11, aparece ao usuário: um gestor que corrige uma validade pode
terminar a interação com o produto vendido.

**Resposta 409 `UNIDADE_JA_BAIXADA` devolve a tela ao estado de nova leitura**, em vez de
manter os caminhos abertos com o erro ao lado. Alguém resolveu aquela unidade enquanto o
frasco estava na mão: o veredito em tela valia para o estoque de um instante que passou, e é
a mesma razão pela qual T10 descarta o veredito quando a conexão cai.

**Observação registrada, sem correção nesta tarefa: o backend não tem `errorHandler`.**
Qualquer violação de JSON Schema, em qualquer rota, chega ao usuário como texto interno do
Fastify em inglês. Traduzir `FST_ERR_VALIDATION` para o formato `{erro, mensagem}` do
projeto é tarefa de backend e não entrou aqui. Mesmo feita, não substituiria o espelho da
Decisão 3: mensagem genérica de "confira os campos" é pior que desabilitar o botão com a
contagem à vista.

## 2026-09-08 — Formato uniforme de erro da API (T12b)

**Mensagem genérica com os campos ao lado, e não tradução regra a regra do ajv** (validado
pelo orientando antes da implementação). Traduzir fielmente cada erro do ajv — formato,
mínimo, máximo, tipo, aninhamento em `unidades[2].dataValidade` — produziria uma segunda
declaração das mesmas restrições que o schema já declara e que as telas já espelham, com o
custo permanente de manter as duas em sincronia. A resposta traz uma `mensagem` única
("Alguns campos do formulário não foram aceitos...") mais `campos: ['justificativa']`, fora
da mensagem: nome de campo do JSON é diagnóstico, não necessariamente o rótulo que o
usuário vê na tela. Isso **não afrouxa** a Decisão 3 de T12 — quem orienta o usuário
continua sendo o formulário, com botão desabilitado e contagem à vista; o handler é a rede
embaixo, para quando a tela não antecipou e para os clientes que não são a tela.

**O 500 entrou na mesma tarefa, e é a metade mais importante.** Sem `setErrorHandler`, o
padrão do Fastify devolve ao navegador a mensagem original de qualquer exceção sem
`statusCode` — e `produto.service.ts` e `unidade.service.ts` relançam o erro do Prisma nos
casos que não tratam a mão. Um erro do Prisma carrega nome de tabela, de coluna e, na
violação de unicidade, o valor que colidiu, que pode ser dado de negócio (RNF09). Passa a
responder texto fixo, com o erro completo só no log do servidor. Ficou na mesma tarefa
porque é o mesmo handler: deixar de fora significaria fechar o vazamento menor e manter
aberto o maior.

**O handler troca o corpo da resposta, nunca o status.** Erro de cliente que o Fastify já
classificou (JSON malformado, content-type não suportado) preserva o status original e sai
como `REQUISICAO_INVALIDA`. Isso é o que permitiu os 177 testes anteriores continuarem
verdes sem edição: as asserções de 400 existentes olham só `statusCode`.

**As recusas de negócio continuam nas rotas, e de propósito.** Elas saem por
`reply.code().send()` e nunca chegam ao handler, que só vê o que o Fastify gerou.
`UNIDADE_NAO_VENCIDA` explica o caso; nenhuma mensagem genérica explicaria. Padronizar
esses códigos entre módulos seria refatoração de contrato e mexeria em testes de T03–T11 —
fora de escopo.

**Descoberto ao escrever os testes: dois padrões do ajv no Fastify limitam o que `campos`
pode prometer.** `allErrors: false` faz a validação parar na primeira falha, então `campos`
traz um campo por vez, não a lista completa do formulário. E `removeAdditional` faz
`additionalProperties: false` **apagar** a propriedade desconhecida antes de validar, em vez
de recusá-la — um corpo com campo a mais passa pelo schema (segue e para na autenticação),
e por isso `campos` nunca cita campo fora do schema. Nenhum dos dois padrões foi alterado:
mudar a configuração do ajv afetaria a validação de todas as rotas já testadas, o que
excede uma tarefa de formato de resposta. Ambos estão documentados em `arquitetura.md`
seção 5.1 e cobertos por teste que descreve o comportamento real.

## 2026-09-08 — Fila de descarte pendente (T13)

**A fila não oferece o override, e é a única diferença entre o painel do balcão e o da
fila** (validado pelo orientando antes da implementação). Os três caminhos da seção 6.1 do
PRD são reusados sem reimplementação — `PainelExcecaoVencido` ganhou uma prop
`permitirOverride`, com padrão `true` para que a tela de leitura não mudasse. O motivo é que
o override é a autorização de uma **venda** de produto vencido, com cliente diante do
balcão; é assim que o PRD o descreve, e é o que justifica a fricção deliberada. Numa
varredura de estoque não há venda: o mesmo botão registraria `Saida` de unidades que
ninguém pediu, em lote, longe do ato que o registro documenta — e esse registro é
permanente (RNF05) e tem peso legal. Esconder é conveniência de interface, como sempre: o
endpoint continua aberto ao GESTOR, e quem autoriza de fato é o servidor (RNF04).

**A cláusula da fila é a negação exata do filtro do pool prioritário, com `hojeComoData()`
compartilhada.** Se as duas noções de "vencido" divergirem — inclusive na borda do dia
corrente — aparece uma faixa de unidades que não sai pelo FIFO nem consta da fila,
invisível dos dois lados. A unidade que vence *hoje* fica fora da fila e dentro do pool, e
há teste para essa borda especificamente.

**`diasVencida` é calculado no servidor.** A tela precisa mostrar urgência, e derivá-la de
`dataValidade` no navegador seria a primeira comparação de datas do `frontend/src` —
sujeita ao fuso do aparelho, que não é necessariamente o da loja (RNF01). Custo aceito: um
campo derivado que envelhece se a página ficar aberta virando o dia. A fila envelhece de
qualquer forma, porque outra pessoa pode resolver uma unidade a qualquer momento.

**A resolução pela fila vai sem `sessaoVendaId`.** O agrupador existe para amarrar as saídas
de um mesmo cliente no balcão (T09); inventar um para uma varredura de estoque poluiria o
relatório com atendimentos que nunca existiram. A consequência é boa para a pesquisa: um
`DESCARTE_REGISTRADO` sem agrupador e sem `LEITURA_QR_SAIDA` antes é, por si só, a marca de
que a perda foi descoberta ativamente e não no balcão.

**Correção recarrega a fila; descarte remove a linha direto.** O descarte é terminal — a
unidade saiu do estoque, e a tela sabe disso pela resposta. A correção pode terminar em
três estados diferentes (fora da fila, ainda na fila com contagem nova, ou vendida na
revalidação), e quem sabe qual deles é o servidor: a fila é relida em vez de a tela
adivinhar.

**Achado da conferência no navegador: desfecho bom não tinha cor no projeto.** `.erro` e
`.aviso` são ambos vermelhos, e o descarte concluído — que é o desfecho desejado da fila —
aparecia como se tivesse falhado. Entrou `.nota-sucesso`, e a tela escolhe o tom pelo mesmo
critério com que a tela de leitura escolhe layout: pelo que o servidor respondeu. Correção
que revalida em `CONFIRMAR` é sucesso; bloqueio de FIFO e unidade já baixada por outra
pessoa não são.

**Observação registrada, sem correção nesta tarefa: o motivo padrão de descarte assume o
balcão.** `MOTIVO_PADRAO_DE_DESCARTE` é "Unidade vencida constatada na leitura de saída." —
texto que fica errado quando o descarte vem da fila, onde não houve leitura nenhuma. O
motivo é o registro da perda, que é o dado da pesquisa, então isso importa. Corrigir exige
mexer no contrato de `/excecao-vencido/descartar` (T11), fora do escopo declarado desta
tarefa; a tela já permite digitar um motivo, e a conferência foi feita com um. Fica como
candidato a tarefa própria, no mesmo formato do `errorHandler` de T12 que virou T12b.

---

## 2026-09-08 — Geração do símbolo QR da etiqueta (T14)

**Biblioteca `qrcode` (node-qrcode) no backend, escolhida entre bibliotecas e não contra
implementação própria.** Codificar QR à mão é reimplementar uma norma ISO — Reed–Solomon,
máscaras, tabelas de versão — e nada disso é objeto deste TCC. Entre as bibliotecas, a
escolhida gera SVG sem depender de `canvas` (nenhuma dependência nativa a compilar) e expõe
os metadados do símbolo (versão, nível de correção, matriz de módulos), que é o que permite
os testes serem sobre o símbolo e não sobre uma string opaca. Custo aceito: mais uma
dependência de produção num backend que só tinha Fastify, Prisma, JWT e bcrypt. Confirmado
pelo orientando antes da implementação.

**Nível de correção H, e o símbolo cabe em versão 1 (21×21).** Um QR versão 1 alfanumérico
comporta exatamente 10 caracteres no nível H, e `PRF-` mais os 6 do Crockford Base32 são
exatamente 10 — todos no conjunto alfanumérico do QR, hífen incluído. Ou seja: dá para usar
a correção de erro mais alta da norma (~30% do símbolo recuperável) sem gastar um módulo a
mais do que o menor símbolo possível, o que é o melhor negócio disponível para etiqueta em
frasco curvo, brilhante e sujeito a atrito (RNF08). O contrapeso, registrado aqui porque é
uma consequência que T05 não previu: o formato do `codigoQr` ficou **mais caro de mudar**.
Um sétimo caractere derruba o símbolo para versão 2 em H. `simboloQr.ts` verifica a versão a
cada geração e lança se ela mudar, para que o crescimento do formato apareça como falha e
não como etiqueta silenciosamente mais densa do que a validação física aprovou.

**O QR carrega o código puro (`PRF-XXXXXX`), nunca uma URL.** Codificar
`https://.../u/PRF-XXXXXX` amarraria cada etiqueta já colada num frasco a um endereço de
implantação — trocar o domínio inutilizaria o estoque etiquetado — e os ~35 caracteres
empurrariam o símbolo para versão 3 ou mais, mais denso no mesmo espaço físico, contra a
RNF08. Como efeito colateral bom, o texto que a câmera lê (T10) e o que a atendente digita
no fallback manual passam a ser exatamente o mesmo.

**O símbolo vive em `simboloQr.ts`, vizinho de `codigoQr.ts`.** Um é dono do **formato** do
identificador, o outro do **símbolo** que o carrega. Mesma razão pela qual o formato tem um
dono só desde T05: ele é provisório até a validação física de T16, e trocá-lo tem que ser
editar um arquivo.

**O SVG sai sem largura, altura, `id`, `class` ou `style`.** Só `viewBox`. O tamanho físico
da etiqueta é decisão de impressão (T15), em milímetros, e fixá-lo aqui seria tomar essa
decisão no lugar errado; os atributos de identificação ficam de fora porque a folha embute
dezenas de símbolos na mesma página, e atributo repetido colidiria. A zona de silêncio de 4
módulos vai **dentro** do `viewBox`: recortá-la é a causa clássica de etiqueta que não lê, e
a tentação de recortar aparece justamente quando o espaço na embalagem é pouco.

**A folha inteira vem numa resposta só, com o SVG embutido no JSON.** A alternativa seria
`GET /unidades/:id/qr.svg`, uma requisição por etiqueta — 50 requisições para montar a folha
de um recebimento. O teto de página é 500, o mesmo `MAXIMO_UNIDADES` do lote de T05, para
que um recebimento inteiro caiba numa impressão; a ~1 KB por símbolo, a resposta máxima fica
abaixo de 1 MB, aceitável para uma operação de gestão feita no computador da loja.

**O filtro é `unidadeIds`, e não "lote" nem data de recebimento.** Não existe entidade
`Lote` no modelo (decisão de T05: o recebimento é reconstruído pelos eventos
`UNIDADE_CADASTRADA`), então "imprimir o que acabou de chegar" só tem uma expressão honesta —
a tela já recebe os ids na resposta do `POST` e os devolve. Id que não pertence ao produto ou
que já saiu do estoque é **ignorado**, não recusado: a lista vem de uma tela que pode estar
desatualizada, e derrubar a folha inteira por causa de um frasco vendido no meio-tempo faria
a gestora perder as outras etiquetas.

**Produto inativo devolve etiquetas; unidade fora do estoque, não.** Mesma leitura que T13
faz do produto inativo: inativar o SKU no catálogo não devolve à fábrica o frasco que está
na prateleira, e reimprimir a etiqueta rasgada dele é legítimo. Já a unidade `VENDIDA` ou
`DESCARTADA` não tem frasco para etiquetar. A unidade **vencida** entra normalmente — o
frasco existe e precisa ser legível para que os três caminhos da seção 6.1 possam agir sobre
ele.

**Imprimir etiqueta não grava evento.** Mesma regra que T13 aplicou à fila: consultar não é
ato operacional. A contrapartida honesta é que o sistema não sabe quantas vezes uma etiqueta
foi reimpressa — dado que interessaria à RNF08, porque reimpressão quase sempre significa
etiqueta que se soltou ou não leu. Registrado como limitação em `docs/notas-para-artigo.md`;
medir isso é rota própria e tarefa própria, não um `GET` que escreve.

**O teste lê a matriz de volta do SVG.** Além de versão, margem e determinismo, a suíte
reconstrói a matriz de módulos a partir dos comandos do `path` e confere os três padrões de
localização e a linha de sincronismo. Isso surgiu na conferência manual: o rasterizador
interno do ImageMagick (a máquina não tem librsvg) desenha traços finos em vez de módulos
cheios, e a imagem gerada por ele não serve como prova de nada. Reler a matriz prova que o
arquivo entregue **é** o símbolo — o que uma inspeção visual de raster ruim não provaria.
Continua sem provar que uma câmera lê a etiqueta colada num frasco: isso é físico e continua
sendo T16 (RNF08).

**`tests/descarte` não entrou na lista de exclusões de `test:sem-banco` em T13.** Achado
desta tarefa, **não corrigido aqui**: a suíte nova (`tests/etiquetas`) entrou na lista, e a
de T13 continua fora, o que faz `npm run test:sem-banco` falhar sem banco. É um deslize de
uma linha, mas mexer nele é fechar tarefa alheia — fica registrado no backlog, no mesmo
formato do `errorHandler` de T12 que virou T12b.

## 2026-09-08 — `test:sem-banco` passa a excluir por pasta, não por lista (T14b)

**A exclusão vira uma só: `--exclude "tests/*/**"`.** Fecha o achado de T14 — `tests/descarte`
(T13) nunca entrou na lista de cinco exclusões, e `npm run test:sem-banco` falhava na máquina
sem container, que é exatamente a máquina para a qual o script existe desde T06. Reproduzido
antes de corrigir, movendo `backend/.env.test` de lado: script antigo com
`tests/descarte/descartesPendentes.test.ts` vermelho, script novo com as mesmas 89 asserções
verdes. Corrigir a lista resolveria o caso; trocar o critério resolve a classe. A opção foi
confirmada pelo orientando antes da implementação.

**O critério é a convenção que as suítes já seguiam sem ninguém ter escrito.** Seis de seis
suítes de banco moram em subpasta de `tests/`; oito de oito suítes sem banco são arquivos
soltos em `tests/`. A separação nasceu em T06, quando as suítes de banco passaram a precisar
do `vi.mock` do cliente compartilhado e foram agrupadas por assunto. O script agora lê essa
convenção em vez de repetir a lista, e a sétima suíte de banco já nasce excluída.

**A troca honesta: o modo de errar muda de lado.** Com a lista, uma suíte de banco esquecida
fazia o script *falhar* — barulhento, e foi assim que T14 encontrou o problema. Com a regra
por pasta, uma suíte **sem** banco criada dentro de uma subpasta seria *pulada em silêncio*,
e a contagem de verdes cairia sem explicação. Falha silenciosa é pior que falha barulhenta.
O que sustenta a escolha é que a convenção é forte (14 de 14 arquivos) e agora está **escrita**
no `README.md`, enquanto a lista antiga não estava documentada em lugar nenhum — dependia de
alguém lembrar de editar uma linha de `package.json`, memória que falhou uma vez em cinco
oportunidades.

**Entrou `npm run test:descarte`.** As outras cinco suítes de banco têm atalho próprio desde
as suas tarefas; a de T13 era a única sem, mesmo deslize e mesma origem do outro.

**Correção de um número, não de código: a suíte fecha em 227, não em 224.** T14 registrou
"224 verdes" em prosa, mas a própria decomposição dela (199 herdados + 11 do símbolo + 17 da
rota) soma 227, que é o que a suíte devolve hoje. Nenhum teste foi tocado nesta tarefa — só o
número escrito estava errado. Fica aqui para o número não continuar se propagando.

## 2026-09-08 — A etiqueta vira papel: dimensionamento, impressão e o que ocupa espaço (T15)

**A impressão é do navegador (`window.print()` + `@media print`), sem geração de PDF.** A
alternativa seria uma biblioteca de PDF no servidor ou no cliente; seria dependência de peso
para resolver o que o navegador já resolve, e me obrigaria a decidir margens de página no
lugar do driver da impressora — que é quem conhece o papel. O custo honesto: a fidelidade
depende do navegador e das margens configuradas no diálogo, e dois navegadores podem
imprimir o mesmo milímetro com meio ponto de diferença. Como a RNF08 exige medição física de
qualquer forma (T16), essa variação será medida com régua no papel em vez de presumida a
partir do código.

**O tamanho do símbolo é escolhido na tela, entre 15, 20 e 25 mm, e não fixado no código.**
Com os 29 módulos do `viewBox` de T14 (21 do símbolo mais 4+4 da zona de silêncio), dão
módulos de ~0,52, ~0,69 e ~0,86 mm; a referência prática para câmera de celular com
impressora comum fica em torno de 0,5 mm por módulo, o que faz de 15 mm o limite inferior
plausível. O motivo de ser seletor: a RNF08 manda validar fisicamente **antes** de congelar o
formato da etiqueta, e um valor fixo obrigaria a editar e reimplantar o frontend a cada
tentativa de T16. O tamanho escolhido sai impresso no rodapé da folha, para que a validação
física saiba de qual folha está falando. Depois de T16, fixar o vencedor é uma linha — e aí
com dado físico por trás.

**Na etiqueta vão símbolo, código e validade; o nome do produto fica de fora.** O símbolo é
o que a câmera lê (T10); o código em texto é o que a atendente digita quando a câmera falha,
e o fallback manual de T10 fica inútil se esse texto não estiver no frasco; a validade é o
que um humano precisa ver na prateleira sem escanear nada. O nome do produto já vem impresso
no frasco pelo fabricante, e cada elemento a mais disputa espaço com o símbolo numa embalagem
pequena — que é literalmente o que a RF04 pede.

**Uma tela para os dois momentos, com o lote viajando por estado de rota.** Imprimir o que
acabou de chegar e reimprimir a etiqueta que se soltou são a mesma folha, e o filtro
`unidadeIds` de T14 existe para o primeiro caso. Os ids vão por estado do `react-router` e
não pela URL: 500 UUIDs seriam cerca de 18 KB de query string. Entrar na tela **sem** esse
estado não carrega nada — a gestora precisa escolher o produto e pedir. Carregar sozinha o
estoque inteiro do SKU faria imprimir uma segunda etiqueta para frascos já etiquetados, que é
como se duplicam identificadores no mundo físico.

**Correção de uma afirmação minha, encontrada na conferência.** Eu havia registrado, no
código e no arquivo da tarefa, que recarregar a página perderia o lote. É falso: o React
Router guarda o estado no History API e o F5 no mesmo navegador mantém as unidades. O que não
sobrevive é levar o endereço para outra aba ou outro aparelho — e é aí que a tela cai no
seletor. A regra de não carregar sozinha continua valendo; a justificativa é que estava
errada.

**O SVG do servidor é injetado com `dangerouslySetInnerHTML`.** Ele é produzido por
`simboloQr.ts` a partir de um código que casa com `PADRAO_CODIGO_QR`, e T14 garantiu no
critério de aceite que sai sem script, evento, `id`, `class` ou `style`. A alternativa
defensiva seria um `data:` URI dentro de `<img>`, que isolaria o conteúdo do documento — mas
o transformaria em imagem externa, tratada de forma diferente por algumas configurações de
impressão, e ele precisa ser elemento de verdade para herdar o tamanho em milímetros da
folha. Fica registrado que a API com "dangerously" no nome foi usada de propósito, e por quê.

**Imprime-se a página carregada, não o conjunto inteiro.** O teto de 500 do backend é por
requisição; a tela usa a paginação normal e diz na cara que imprime uma página por vez.
Concatenar páginas exigiria acumular várias requisições para um botão de impressão, e
imprimiria o que não está na tela.

**A folha impressa foi conferida em mídia `print`, não só em tela.** `playwright-cli pdf`
aplica o `@media print`, e o texto extraído do PDF resultante contém apenas os códigos, as
validades e o rodapé — nenhuma barra de topo, aba, seletor ou botão. É o equivalente, para
uma folha de papel, do que T14 fez ao reler a matriz de módulos de volta do SVG: verificar o
artefato entregue, e não a intenção do código.

---

## 2026-09-08 — Configuração da janela de antecedência dos alertas (T17)

**A configuração é uma coleção, não um valor único, e as quatro operações são CRUD
completo** (validado pelo orientando antes da implementação). A seção 5 da arquitetura
previa `GET/POST /configuracao-alerta`; entraram também `PATCH` e `DELETE` em
`/configuracao-alerta/:id`. O nome singular da rota ficou como estava, pelo mesmo motivo que
`/descartes/pendentes` ficou em T13: é o nome que o documento fixou, e trocá-lo por
elegância criaria divergência entre a arquitetura e o código. O que justifica a coleção é o
uso: uma janela larga (30 dias) serve para decisão comercial e uma estreita (7 dias) para
última chamada, com canais possivelmente distintos — e o modelo de T02 já é uma tabela com
`id` e 1:N para `Alerta`, não uma linha de parâmetro.

**`DELETE` inativa (`ativo = false`), nunca exclui.** É o precedente do catálogo de produtos
(T04), com uma razão a mais e mais forte: `Alerta.configuracaoId` é FK obrigatória, então
apagar uma configuração que já emitiu alertas ou quebra a integridade referencial ou leva
junto o histórico de alertas emitidos — que é dado da pesquisa (RF12/RF13). Inativar preserva
a leitura "este alerta foi emitido sob a janela de 30 dias que hoje não existe mais".
Reativar é `PATCH { ativo: true }`, como no catálogo. A listagem devolve ativas e inativas
juntas: uma configuração invisível não teria como ser reativada pela interface.

**`canal` é conjunto fechado de três valores (`IN_APP`, `PUSH`, `AMBOS`) numa coluna
`String`.** O `AMBOS` existe porque a RF08 fala em "alerta in-app **e/ou** notificação push"
num campo só — o valor precisa conseguir dizer "os dois", e a alternativa seria obrigar a
gestora a manter duas configurações espelhadas para a mesma janela. O fechamento do conjunto
não é opcional (canal livre é dado que T19 teria de adivinhar como entregar), mas mora no
`enum` do JSON Schema e na constante do serviço, não num `enum` do Prisma: a seção 3 da
arquitetura declara `canal String`, e um `enum` no banco custaria uma migração numa tarefa
que o schema de T02 já atende. A trava é mais fraca do que seria no banco, e isso fica
registrado: uma escrita direta por `psql` passa.

**Duas configurações ativas não podem ter a mesma antecedência, e a garantia é de
aplicação.** Duas janelas de 30 dias fariam o job de T18 gerar dois `Alerta` para a mesma
unidade no mesmo dia, inflando a contagem de alertas emitidos que a RF13 vai reportar — é
número da pesquisa, não duplicata de tela. A verificação acontece dentro de um
`prisma.$transaction`, e não como índice único no banco, porque "único entre as ativas" é
índice parcial e exigiria SQL cru na migração. É deliberadamente o oposto da escolha da
RNF02: lá o dado em disputa é o estoque, com dois atendimentos simultâneos sobre o mesmo
frasco; aqui é uma gestora mexendo em configuração. A colisão é avaliada sobre o **estado
resultante**, não sobre o corpo recebido — reativar uma janela de 30 dias é recusado se
outra de 30 dias tiver surgido enquanto ela estava inativa, mesmo que o `PATCH` só traga
`ativo`.

**`diasAntecedencia` vai de 1 a 365.** O 0 significaria "avise no dia em que vence", e esse
dia a unidade ainda está no pool do FIFO e ainda é vendável (a borda que T13 testou); no dia
seguinte ela já aparece na fila de descarte. O 0 duplicaria por notificação, com um dia de
diferença, o que a fila já mostra por varredura. O teto de 365 é arbitrário e existe para
que um erro de digitação (3650) não vire uma janela que inclui o estoque inteiro e
transforme o alerta em ruído constante.

**Nenhuma rota desta tarefa grava `EventoLog`.** Os nove tipos do PRD são lista fechada, e
`eventoLog.service.ts` registra por escrito que acrescentar um tipo depois do piloto começar
quebra a comparabilidade dos dados coletados antes e depois. Nenhum dos nove descreve
mudança de configuração, e inventar o décimo para uma tela de parâmetro seria o tipo de
acréscimo que aquele comentário existe para impedir. A consequência foi aceita
conscientemente e está declarada em `docs/notas-para-artigo.md`: alterar a janela no meio do
piloto não deixa rastro.

**O seed passa a criar uma janela de 30 dias / `IN_APP`.** É o exemplo da jornada J3 do PRD.
Sem nenhuma configuração, o job de T18 sobe com nada a fazer e a tela abre vazia na
demonstração — o que parece defeito e não é. A idempotência é por "já existe alguma
configuração?", e não por chave natural, porque a tabela não tem `unique`: rodar o seed de
novo não sobrescreve a janela que a gestora ajustou.

**A tela diz que a verificação periódica ainda não existe.** Entre T17 e T18, configurar uma
janela não produz alerta nenhum. O aviso é uma linha de texto e sai quando o job entrar; sem
ele, a ausência de alerta se lê como defeito. Ele usa classe própria (`.nota-informativa`) e
não `.aviso`, que é vermelho como o `.erro` — o mesmo achado que T13 registrou ao criar
`.nota-sucesso`: informação neutra e falha não podem ter a mesma cor.

## 2026-09-09 — Varredura periódica de alertas proativos (T18)

**O job é um `setInterval` no processo do backend, não `cron` do sistema nem rota HTTP.**
Das três formas possíveis, a rota foi recusada primeiro: "rodar o job" exposto como endpoint
é uma porta autenticada que dispara escrita em massa — ou fica aberta ao GESTOR, e um clique
repetido passa a ser problema da idempotência sozinha, ou fica sem autenticação, que é pior.
Entre o agendador interno e o `cron` do sistema, o interno venceu porque o alvo é uma
perfumaria de pequeno porte: exigir configuração de cron no servidor da loja para que um
requisito funcional aconteça é transferir ao usuário uma responsabilidade que o software pode
assumir. O script `npm run alertas:varrer` existe como saída — chama exatamente a mesma
função, então as duas formas não podem divergir — e serve à demonstração. A contrapartida
está declarada em `docs/notas-para-artigo.md`: **backend fora do ar, varredura não roda**.

**Um `Alerta` por par (unidade, configuração), para sempre, com índice único no banco.** O
alerta é a notícia de que a unidade **entrou** na janela daquela configuração, não um
lembrete diário — a janela de 7 dias emite o dela depois porque é outra configuração, não
porque a primeira se repete. Esta é a decisão que sustenta todo o resto do desenho: por ser
idempotente, a varredura pode ser agendada por intervalo tosco, sem guardar "última execução"
(estado que se perderia no primeiro reinício) e sem acertar horário fixo.

A garantia vai para o banco (`@@unique([unidadeId, configuracaoId])`), **ao contrário** da
unicidade de `ConfiguracaoAlerta.diasAntecedencia` decidida em T17, que ficou na aplicação.
A diferença que justifica: lá quem escreve é uma gestora mexendo em configuração de vez em
quando; aqui quem escreve é um job automático, repetidamente, sem ninguém olhando, e a
contagem de alertas emitidos é dado da pesquisa (RF13). Além disso este índice é total, e não
parcial — cabe no Prisma sem SQL cru, que era a razão prática de T17 não o ter feito.
Consequência aceita: unidade cuja validade for corrigida (T11) para uma data distante e
depois voltar à janela **não alerta de novo**. Silêncio é preferível a ruído aqui.

**O evento da varredura é assinado por uma conta de sistema.** `EventoLog.usuarioId` é FK
obrigatória (PRD seção 5), e a varredura não tem usuário: ninguém pediu, ninguém clicou. As
alternativas eram tornar a coluna nullable — enfraquecendo a garantia dos nove tipos de
evento por causa de um — ou não gravar o `ALERTA_PROATIVO_EMITIDO`, o que tiraria do
`EventoLog` um tipo que o PRD declara e quebraria a propriedade que faz dele instrumento de
pesquisa: ler a linha do tempo inteira de uma unidade em **uma** tabela ("alertada no dia X,
vendida no dia X+4"), sem `JOIN` entre formatos diferentes. Escolhida a conta
`sistema@estoque.local`, papel `ATENDENTE` (menor privilégio disponível) e `senhaHash` que
nenhuma senha casa, criada tanto pelo seed quanto pela própria varredura. A análise precisa
saber excluí-la ao contar ações humanas — registrado em `docs/notas-para-artigo.md`.

**A unidade já vencida não gera alerta; a janela é `[hoje, hoje + N]`, fechada dos dois
lados.** A borda inferior é a mesma do pool prioritário do FIFO, pela razão de sempre: se as
cláusulas divergirem, aparece uma faixa de unidades invisível dos dois lados. O que venceu já
está na fila de descarte de T13, e o alerta proativo existe para o tempo em que ainda cabe
decisão comercial. A borda superior é fechada porque "avise 30 dias antes" inclui o
trigésimo dia.

**Um evento por alerta, não um por varredura.** `EventoLog.unidadeId` é singular, e é essa
granularidade que permite responder o indicador que interessa — a unidade alertada foi
vendida antes de vencer? (RF12). Um evento agregado ("emiti 43 alertas") não responde. O
custo é volume numa primeira varredura de estoque real, e ele é pago uma vez por unidade e
por janela.

**Intervalo de 24h por padrão, configurável, com uma passagem ao subir.** A janela é medida
em dias, então varrer mais de uma vez por dia não muda nada — a segunda passagem é no-op por
construção. Varrer na inicialização evita que reiniciar o servidor adie o alerta em um dia
inteiro. `ALERTA_INTERVALO_HORAS` (padrão 24) fica em `shared/env.ts` para que a demonstração
use um valor curto sem alterar código. O agendador ignora o tique se a passagem anterior
ainda não terminou (duas passagens simultâneas competiriam pelas mesmas unidades, e o índice
único recusaria a segunda com um erro que descreveria uma situação que não é falha), e
engole a exceção de uma varredura que falhe: o balcão precisa continuar vendendo se o job
quebrar.

**A suíte do agendador fica solta em `tests/`, não em `tests/alerta/`.** Ela injeta a
varredura e usa timers falsos — não precisa de banco, e a regra de T14b é justamente essa: a
pasta separa quem exige PostgreSQL de quem roda em qualquer máquina. `test:sem-banco` foi
reexecutado com `.env.test` removido para confirmar (96 verdes).

**A tela de T17 troca o aviso em vez de perdê-lo.** T17 registrou que ele sairia quando o job
entrasse; removê-lo por completo deixaria a tela sugerindo que configurar uma janela produz
um aviso visível, o que só passa a ser verdade em T19. O texto novo diz as duas coisas: a
varredura roda, a entrega ainda não existe.

## 2026-09-09 — Entrega do alerta proativo ao gestor (T19)

**Só GESTOR recebe o alerta.** A jornada J3 do PRD termina em decisão comercial — promoção,
destaque na vitrine —, que não é ato de balcão. As duas rotas novas (`GET /alertas` e
`POST /alertas/:id/lido`) têm a mesma restrição da configuração de T17 e da fila de T13.
Alerta para a atendente seria informação sobre a qual ela não pode agir, no meio do
atendimento. A consequência é de processo e não de código, e está registrada em
`docs/notas-para-artigo.md`: **numa loja onde a gestora não abre o sistema, o alerta não
chega a ninguém**.

**Push fica fora de T19; a entrega in-app entra completa.** Decisão do orientando. Web Push
custa dependência nova, chaves VAPID, uma tabela de inscrições por dispositivo com migração,
troca do service worker gerado pelo `vite-plugin-pwa` por um `injectManifest` com handler de
`push`, e fluxo de permissão do navegador — nada disso verificável sem HTTPS e aparelho real,
que é justamente o teste de campo ainda pendente. Vira **T19b** no backlog. Enquanto isso,
alerta de janela com canal `PUSH` ou `AMBOS` **aparece na lista in-app assim mesmo**, e a
tela de configuração diz isso em uma linha: a alternativa seria uma janela configurada como
push cujo aviso não chega a lugar nenhum.

**A unidade vendida ou descartada some da lista; a que venceu continua, marcada.** Decisão do
orientando, contra a proposta inicial de omitir também as vencidas. O critério é **ainda
haver o que fazer com o frasco**: vendido ou descartado, não há; vencido, há — e o que há é
encarar que o aviso não funcionou. Assume-se de propósito a duplicidade que T18 recusou para
a *emissão*: a mesma unidade aparece na tela de alertas e na fila de descarte de T13 ao mesmo
tempo, porque os dois lugares dizem coisas diferentes — a fila diz "resolva este frasco", o
alerta vencido diz "você foi avisado e ele venceu assim mesmo". Omiti-lo apagaria da tela
justamente o caso que mede se a RF08 funciona.

O que separa os dois casos é o campo **`situacao` (`NA_JANELA` | `VENCIDA`), decidido no
servidor** — e não o sinal de `diasParaVencer` interpretado pela tela. É a mesma regra de
sempre: o frontend não compara validade em lugar nenhum (RNF01, RNF04). A linha de `Alerta`
continua no banco nos três casos: ela é o registro do que foi emitido, e é dela e do
`EventoLog` que a RF13 vai contar.

**A janela inativada depois não esconde o alerta já emitido.** Inativar (T17) diz "não emita
mais", não "desfaça o que foi emitido".

**`ALERTA_LIDO` é o décimo tipo de evento** — o único fora da lista da seção 5 do PRD.
Decisão do orientando, contra a proposta inicial de não gravar nada. O comentário de
`eventoLog.service.ts` desde T09 diz que acrescentar um tipo depois do piloto começado quebra
a comparabilidade dos dados; por isso este acréscimo é ato consciente e acontece **antes** do
piloto, que é quando ainda é barato. O que ele compra: o intervalo entre
`ALERTA_PROATIVO_EMITIDO` e `ALERTA_LIDO` da mesma unidade, na mesma trilha, sem `JOIN` entre
formatos diferentes — quanto tempo a loja leva para reagir a um aviso. O evento é assinado
pelo **gestor que leu** (a conta de sistema de T18 assina só o que não tem autor humano) e
gravado **uma vez**: a idempotência do `lidoEm` vale também para o log, senão dois cliques
viram dois reconhecimentos no dado da pesquisa.

**"Lido" é da loja, não de cada gestor, e não tem desfazer.** `Alerta.lidoEm` é uma coluna só
(schema de T02, PRD seção 5): não há leitura por usuário. Com dois gestores, o que um marcar
sai do contador do outro. Leitura por usuário exigiria tabela nova e migração, e para uma
perfumaria com um ou dois gestores é complexidade sem cliente. Também não há "marcar como não
lido": a marcação é reconhecimento, e a lista sem filtro continua mostrando o alerta lido —
que é o desfazer suficiente, porque ele não some de vista.

**A corrida entre dois cliques é resolvida por `updateMany` condicionado a `lidoEm: null`,
não por lock.** A RNF02 protege a baixa da unidade, que aqui não acontece: marcar como lido
não muda estoque e não disputa nada. O `updateMany` é atômico — só um dos dois encontra a
linha por marcar, e só ele grava o evento.

**O contador da navegação vem da própria listagem, sem endpoint de contagem e sem polling.**
`naoLidos` já viaja na resposta de `GET /alertas` (e **ignora** o filtro `apenasNaoLidos`, que
é o que o torna um número estável independente de onde a gestora está olhando). O `App` o
busca uma vez ao autenticar, com `tamanhoPagina=1`, e a tela de alertas o atualiza depois.
Sem `setInterval`: o alerta é diário, e um contador alguns minutos atrasado não muda decisão
nenhuma, enquanto um polling constante custaria bateria de celular no balcão para nada. Falha
nessa busca é silenciosa de propósito — o distintivo é conveniência, e o erro de verdade
aparece quando a gestora abre a lista.

**A aba "Alertas" passou a ser a lista; o formulário de T17 virou "Configurar alertas".** O
rótulo antigo levava ao formulário, e mantê-lo assim mandaria a gestora configurar quando ela
quer ver o aviso.

## 2026-09-09 — Notificação push do alerta proativo (T19b)

**Os handlers de push entram por `importScripts` no service worker gerado, e não por
`injectManifest`.** Decisão do orientando, contra o que a Decisão 1 de T19 tinha suposto. O
service worker de hoje carrega três regras da RNF07 escritas em T10 — `navigateFallback`,
`NetworkOnly` em `/saidas/ler` e `/health`, precache do app shell —, e `injectManifest`
obriga a reescrever todas à mão, em código que nenhum teste do projeto cobre. Um erro ali não
quebraria a tela de alertas: quebraria o comportamento offline do balcão. Com
`workbox.importScripts: ['sw-push.js']`, tudo que T10 decidiu continua gerado pelo plugin e o
arquivo novo só acrescenta `push` e `notificationclick`. A contrapartida declarada: ele vive
em `public/`, fora do build do Vite — sem TypeScript, sem Vitest, sem `typecheck` —, e por
isso é curto e não tem regra de negócio.

**Uma notificação por passagem da varredura e por aparelho, agregada; nunca uma por unidade.**
Decisão do orientando. O `Alerta` continua sendo por unidade no banco, porque é dele que a
RF13 conta; a *entrega* não pode seguir a mesma granularidade. Um recebimento de 40 frascos
entrando na janela dispararia 40 notificações no mesmo segundo, e o efeito prático de 40
notificações é o de zero — a gestora desliga o aviso, e a RF08 morre no aparelho dela. O
texto diz quantas unidades e em quais janelas, conta **unidades distintas** (a mesma unidade
pode entrar em duas janelas na mesma passagem) e o toque abre `/alertas`. Não nomeia produto:
notificação aparece em tela bloqueada, e com dezenas de unidades o nome de uma só seria
arbitrário.

**Nenhum décimo-primeiro tipo de evento.** Decisão do orientando. T19 acrescentou
`ALERTA_LIDO` como ato consciente, e o comentário de `eventoLog.service.ts` diz desde T09 que
cada acréscimo custa comparabilidade. O envio do push não é ato humano, não muda estoque, e o
indicador de reação já sai do par `ALERTA_PROATIVO_EMITIDO` → `ALERTA_LIDO`. O que se perde
está declarado em `docs/notas-para-artigo.md`: **o log não distingue "leu porque o push
chegou" de "leu porque abriu o app"** — o dado não isola o efeito do push. A alternativa
recusada seria `NOTIFICACAO_PUSH_ENVIADA` assinado pela conta de sistema; a pergunta
continua respondível fora do log, porque a data de implantação do push separa os dois
períodos do piloto.

**As chaves VAPID são opcionais no ambiente, e não entram em `shared/env.ts`.** `JWT_SECRET` é
obrigatória porque sem ela o sistema não tem sessão; push é diferente — uma máquina de
desenvolvimento, a suíte de testes e uma loja que não queira notificação precisam subir o
servidor sem chave nenhuma. É a **única exceção** à regra de que toda variável de ambiente
mora em `env.ts`: `modules/push/vapid.ts` as lê de `process.env` **a cada chamada**, e não
uma vez no import, para que os dois estados (configurado e não) sejam exercitáveis no mesmo
processo pela suíte, e para que trocar a chave no servidor da loja seja um reinício e não um
rebuild. Sem chaves: as três rotas de `/push` respondem 503 `PUSH_NAO_CONFIGURADO`, a
varredura não tenta enviar (e loga uma vez, não a cada passagem) e a tela diz isso. O que não
acontece é o servidor recusar-se a subir.

**A inscrição é do aparelho, e o papel é conferido no envio.** `InscricaoPush` guarda
`endpoint` (`@unique`), as duas chaves da RFC 8291 e o usuário que inscreveu. Reinscrever o
mesmo `endpoint` **atualiza** e responde 200 em vez de 409: o navegador renova as chaves do
mesmo aparelho por conta própria, e recusar deixaria o aparelho com chave velha, que falha em
todo envio seguinte. O envio filtra por `papel: GESTOR` **no momento do envio**, e não no da
inscrição — uma conta rebaixada para ATENDENTE para de receber sem que ninguém limpe tabela,
e promovê-la de volta devolve a notificação sem reinscrever o aparelho.

**O `endpoint` não sai do banco.** É credencial de envio: quem o tem manda notificação para
aquele aparelho. Não volta em resposta de API (a inscrição devolve só `id` e `criadoEm`), não
vai para o `EventoLog` e não aparece no log do servidor, que registra o `id` da inscrição.

**O envio acontece depois do commit da varredura, e uma falha de push nunca desfaz um
alerta.** Chamada HTTP dentro de `$transaction` seguraria a transação pela latência da rede,
e um serviço de push fora do ar não pode fazer o `Alerta` deixar de existir — o registro é o
que a RF13 conta, e o push é só o empurrão. A varredura acumula o que emitiu, chama o envio
no fim e engole a falha com log, como o agendador de T18 já fazia com a varredura inteira.

**Inscrição morta é apagada no primeiro 404/410, e push perdido não é reenviado.** 404 e 410
são a forma padrão de o serviço do navegador dizer "este aparelho não existe mais"; sem
apagar, a tabela vira lixo que a varredura tenta contatar todo dia. Não há fila de reenvio:
a passagem seguinte não reemite o alerta (índice único de T18), então um push perdido está
perdido — aceitável porque a lista in-app continua sendo a fonte de verdade.

**O `ResumoDaVarredura` ganhou `notificacoesEnviadas`,** e as asserções de resumo da suíte de
T18 foram atualizadas para o campo novo. É a única edição em teste existente nesta tarefa.

## 2026-09-09 — Endpoints agregados de dashboard (T20)

**Duas rotas, não uma.** `docs/arquitetura.md` fixou só `GET /dashboard`, mas cinco dos seis
itens da RF13 são números e o sexto — histórico de saídas — é lista longa e paginada. Enfiá-la
no agregado faria toda abertura do painel carregar linhas que a tela mostra num canto, e
paginar dentro de um objeto de indicadores é contrato torto. Entrou `GET /dashboard/saidas`, no
mesmo módulo e mesmo papel. A alternativa recusada foi `GET /saidas`, que partiria o prefixo
entre dois módulos: quem fosse procurar acharia `saida.routes.ts`, onde ela não estaria.

**O módulo `dashboard` só conta; nunca produz fato.** Nenhuma das duas rotas grava `EventoLog`
— e menos ainda nesta tabela, que é de onde o painel lê. É essa separação que mantém o painel
incapaz de mentir sobre a operação: ele não participa dela.

**As faixas de vencimento são fixas no código, não derivadas de `ConfiguracaoAlerta`.** Seria
elegante reaproveitar as janelas que a gestora configurou em T17 (30 e 7 dias), e foi recusado
por dois motivos. O painel é instrumento de pesquisa, e um gráfico cujas faixas mudam quando
alguém edita uma configuração deixa de ser comparável entre dois momentos do piloto (PRD seção
9). E as duas respondem perguntas diferentes: a janela diz "sobre o que me avisam?", a faixa
diz "como está distribuído o estoque?" — só por acaso usam a mesma unidade de medida. Fixas:
vencida, até 7, 8–30, 31–90, acima de 90.

**As faixas são declaradas como cadeia de tetos, não como pares de bordas.** O piso de cada
uma é o teto da anterior mais um dia, calculado e não digitado. Faixas escritas à mão abririam
a chance de um vão de um dia em que a unidade não apareceria em faixa nenhuma — o mesmo tipo de
buraco que a fila de T13 existe para não ter. A consequência é que a soma das cinco é
`unidadesEmEstoque` por construção, e não por coincidência.

**O painel mistura dois tempos, e isso vai explícito na forma da resposta.** `estoque` é
fotografia do agora; `saidas`, `fifo`, `perdas.descartes` e `overrides` são do período. Não há
como uniformizar — "unidades em estoque no período" não significa nada, e "perdas agora" seria
o total histórico. Ficam em objetos distintos, com o período ecoado, para que a T21 rotule cada
bloco. `perdas.unidadesVencidasEmEstoque` é o único número repetido de propósito (é a faixa
`VENCIDA`), porque ali ele é lido como prejuízo iminente e não como distribuição.

**O corte do período é o dia local, não a meia-noite UTC.** Decisão de arquitetura, e a única
desta tarefa que muda `shared/data.ts`. `dataValidade` é `DATE` (RNF01), mas `Saida.dataHora`,
`Descarte.dataHora` e `EventoLog.ocorridoEm` são instantes: converter `de`/`ate` com
`dataDeString()` ancoraria o corte em UTC e, em BRT, jogaria a venda das 22h no relatório do dia
seguinte. É a mesma classe de erro que a RNF01 evita na validade, entrando pela porta do
recorte. Entraram `inicioDoDia` e `inicioDoDiaSeguinte`, montando os instantes a partir dos
componentes **locais**, coerentes com o `hojeComoData()` que já decide que dia é hoje na loja. O
intervalo é fechado no começo e aberto no fim: um "fim do dia" às 23:59:59.999 deixaria de fora
o que o Postgres grava nos microssegundos seguintes.

**`taxaAcertoPrimeiraLeitura` é `null`, nunca `0`, em período sem saída.** "0% de acerto" e
"nenhuma venda ainda" são fatos opostos, e um painel que mostra 0% num dia parado sugere um
sistema que não funciona. `null` obriga a tela a dizer "sem dados no período", que é a verdade.

**O denominador da taxa é a saída, não a leitura de QR.** As duas leituras do indicador são
defensáveis — por venda ("das vendas concluídas, quantas foram de primeira") e por leitura
("das leituras de QR, quantas confirmaram"). Ficou a primeira: ela responde "com que frequência
a atendente pega o frasco certo de primeira" sem contaminar o número com código inexistente,
unidade já baixada ou tentativa de venda de unidade vencida, que não são erro de FIFO. O dado
bruto para a segunda continua no `EventoLog`, intacto, e pode virar indicador adicional na
análise.

**A distorção conhecida da taxa: o override entra no denominador como acerto de primeira.** A
venda autorizada de unidade vencida cria `Saida` com `tentativasAteAcerto = 0` sem ter passado
pelo laço do FIFO, e por isso conta como acerto. É raro por construção (a fricção da
justificativa existe para isso) e `overrides.total` está na mesma resposta para a análise
descontá-lo — mas o número não se autocorrige, e a conferência no banco de desenvolvimento
mostrou exatamente esse caso: 2 saídas, taxa 1,0, sendo uma delas override. Registrado como
limitação em `docs/notas-para-artigo.md`; corrigir mudaria o significado de um indicador já
contratado, e é decisão do orientando.

**Nenhum índice novo.** A contagem por faixa varre `UnidadeProduto` por `status` e
`dataValidade`, e o índice existente (`[produtoId, status, dataValidade]`) não a atende. Na
escala do piloto é irrelevante — a conferência mediu 7–15 ms com o banco de desenvolvimento,
folgado dentro da RNF06 —, e uma migração só para o painel encareceria toda escrita de unidade
em troca de nada.

**`apenasOverrides` no histórico, e nenhum outro filtro.** É o que dá corpo ao item "overrides
autorizados" da RF13, que sem ele seria um número sem como olhar quais vendas o compõem. Filtro
por produto, por atendente ou por `sessaoVendaId` não foi implementado: são material de T21 ou
de análise, e cada um deles é uma decisão sobre o que o painel deve destacar.

## 2026-09-09 — Frontend do dashboard (T21)

**Gráfico de faixas em CSS, sem biblioteca de gráficos.** São cinco barras horizontais, e uma
dependência de gráficos traria eixos e tooltips prontos ao custo de centenas de kilobytes num
PWA que precisa carregar em celular de loja (RNF07). Confirmado pelo orientando antes da
implementação. A barra é `aria-hidden`: o rótulo e o número ao lado é que são a informação, e
é isso que sobrevive num leitor de tela e numa impressão. Consequência aceita: nada de eixo,
escala nem interação — se a defesa exigir gráfico mais elaborado, a troca é local, num
componente só.

**A barra mais longa é a maior faixa, não o estoque inteiro.** Com 700 unidades em "acima de
90 dias", normalizar pelo total transformaria as faixas urgentes em traços invisíveis —
justamente as que a gestora precisa ver. E faixa zerada não desenha barra alguma: o traço
mínimo que mantém visível a faixa de uma unidade mentiria sobre a de zero.

**Um seletor de período para a tela inteira.** As duas rotas aceitam `de`/`ate`
independentes, mas a tela aplica o mesmo recorte às duas. Dois seletores produziriam um painel
em que o agregado fala de agosto e a lista de setembro sem que ninguém percebesse. Perde-se
"ver o total do mês com o histórico da semana", que não é pergunta que o TCC faça.

**A primeira carga vai sem `de`/`ate`, e o período exibido é o que voltou ecoado.** A tela não
sabe calcular "hoje menos 29 dias" — deliberadamente. Se ela soubesse, existiriam dois donos
do recorte padrão, e o dia em que um mudasse o outro passaria a mentir. Os campos do
formulário só são preenchidos depois da primeira resposta, com o intervalo que o servidor
usou.

**O histórico de saídas é bloco do dashboard, não tela própria.** O número ("1 override") e a
lista ("qual foi") são a mesma pergunta em duas resoluções, e separá-los obrigaria a repetir o
seletor de período. Confirmado pelo orientando. Se a lista incomodar no piloto, virar tela
própria é barato — o serviço já está separado.

**A rota inicial do GESTOR continua `/produtos`.** Um painel é candidato natural a tela de
entrada, mas trocar isso é decisão de produto, não consequência técnica desta tarefa. Fica
como está, com o dashboard alcançável pela navegação.

**A limitação da taxa de acerto aparece na própria tela.** T20 registrou que o override grava
`tentativasAteAcerto = 0` sem ter passado pelo laço do FIFO, e por isso conta como acerto de
primeira. A tela exibe, colada ao percentual, quantas vendas autorizadas de unidade vencida o
período contém — usando o `overrides.total` que já vem na mesma resposta, **sem recalcular a
taxa**, que continua sendo a do servidor (RNF04). Confirmado pelo orientando. A alternativa
(número limpo, ressalva só na documentação) faria a limitação depender de quem leu
`docs/notas-para-artigo.md`, que não é quem lê o painel.

**`formatarInstante` entrou em `services/datas.ts`, ao lado de `formatarData`.** São formatos
diferentes de propósito: `dataValidade` é `DATE` e é fatiada como texto para não passar por
fuso (RNF01), enquanto `Saida.dataHora` é um instante e **deve** ser convertida para a hora
local de quem lê o relatório. Ter as duas no mesmo arquivo é o que deixa a diferença visível
para quem for escrever a próxima tela.

---

## 2026-09-09 — Configuração de produção: cookie cross-site, rewrite de SPA, conexão de migração e troca de senha (T23, fatia 3)

Antecipação de parte de T23, para viabilizar um deploy de piloto com dois usuários antes de
T22. Todas as decisões abaixo têm a mesma forma: o comportamento correto em produção é
diferente do comportamento correto em desenvolvimento, e a diferença **não é observável por
nenhum teste deste projeto**, porque `app.inject()` não é um navegador e `npm run dev` não é
uma hospedagem.

**O cookie de sessão passa a `SameSite=None` + `Secure` quando `NODE_ENV=production`.** Com
frontend e API em hosts distintos, `'lax'` faz o navegador descartar o cookie na resposta do
login — sem erro de servidor, sem entrada de log, sem teste vermelho: o sintoma é 401 em toda
rota protegida. `cookie.ts` já previa o caso em comentário desde T03; agora está no código.
Os dois atributos ligam pelo mesmo `NODE_ENV` de propósito, porque `None` sem `Secure` é
recusado por todos os navegadores atuais, e a suíte cobre a invariante, não só os dois ramos.
Se um dia frontend e API dividirem o mesmo domínio registrável, isto pode voltar a `'lax'`,
que é a opção mais conservadora — está anotado no próprio arquivo.

**`frontend/vercel.json` reescreve qualquer caminho para `index.html`.** Desde T10 cada tela
tem URL própria; sem o rewrite, abrir ou recarregar `/leitura` direto devolve o 404 da
hospedagem. A alternativa aparente — o `navigateFallback` que o `vite-plugin-pwa` já gera —
**não resolve**: ele só age depois que o service worker instalou, e a primeira visita é
anterior a isso. A regra `/(.*)` pode ser tão larga porque `rewrites` só age quando nenhum
arquivo do build casou com o caminho, então o `sw.js`, o manifest e os assets continuam sendo
servidos normalmente. O arquivo é de configuração da plataforma; se a hospedagem mudar, o
equivalente dela é obrigatório e não opcional.

**O datasource ganhou `directUrl`.** A aplicação fala pelo pooler (`DATABASE_URL`) e o
`prisma migrate` pela conexão direta (`DIRECT_URL`), porque pooler em modo transaction não
sustenta o advisory lock da migração. Em desenvolvimento as duas apontam para o mesmo
Postgres do `docker-compose`, e por isso a variável entrou nos dois `.env.example`: ela é
obrigatória em toda execução do `migrate`, inclusive local. A alternativa (passar a URL direta
na linha de comando só no deploy) foi descartada por ser um passo que se esquece exatamente
uma vez, no dia da migração de produção.

**`postinstall: prisma generate`.** Hospedagem reaproveita `node_modules` em cache, e o
`postinstall` do próprio Prisma não roda nesse caso — o Client sai desatualizado em relação ao
schema. É a recomendação da documentação do Prisma para esse ambiente.

**Trocar senha é script, não rota: `npm run usuario:senha -- <email>`.** O único caminho para
uma conta existir ainda é o `seed.ts`, que grava uma senha padrão conhecida e a imprime no
terminal — aceitável em `localhost`, inaceitável num endereço público. A alternativa seria
uma rota de troca de senha, que é superfície nova na API, com autorização e testes próprios, e
que T22 substituiria em seguida. O script é operado por quem já tem acesso ao banco, e
portanto não amplia o que essa pessoa podia fazer. Três decisões dentro dele: a senha é lida
do **stdin** (argumento fica no histórico do shell e na lista de processos); o piso é de **12
caracteres**, escolhido para recusar a senha do seed, que tem dez; e a **conta de sistema é
recusada explicitamente**, preservando a propriedade que `usuarioDoSistema.ts` documenta — ela
não autentica, e nada deve poder torná-la autenticável. A regra mora em `auth.service.ts` e é
testada; o `.cli.ts` é só a casca que lê argumento e imprime.

**O custo do bcrypt saiu para `modules/auth/hashDeSenha.ts`.** Estava declarado em
`auth.service.ts` e em `seed.ts`, com um comentário em cada lado pedindo que não divergissem;
o script seria a terceira cópia. Divergência aqui não produz falha: `bcrypt.compare` lê o
custo de dentro do próprio hash e confere normalmente — o efeito é uma senha gravada mais
fraca do que se imagina, sem sintoma nenhum. Um lugar só era o que o comentário já pedia.

---

## 2026-09-09 — Segurança de borda: limite de tentativas no login e cabeçalhos (T23, fatia 1)

**O limite de tentativas vale só em `POST /auth/login`.** O `@fastify/rate-limit` entrou com
`global: false`, e a configuração mora na rota. Um limite global seria ativamente nocivo: o
balcão lê QR em rajada — um atendimento com seis frascos são seis `POST /saidas/ler` em
segundos, e o laço de revalidação de T08 multiplica isso quando a atendente pega a unidade
errada. Bloquear essa rajada é impedir a venda para proteger o login, invertendo a ordem de
prioridade da loja. A suíte tem asserção explícita para isso: trinta requisições seguidas a
`/saidas/ler` e a `/health` não podem produzir 429.

**Dez tentativas por minuto, por IP.** Contar por e-mail deixaria a varredura automatizada
livre trocando o alvo a cada tentativa, então a chave é o IP. A contrapartida é específica
deste cenário e vale registrar: a loja inteira sai por **um** endereço público, então as duas
contas dividem a cota, e o número precisa tolerar o erro de digitação de duas pessoas no mesmo
minuto. Dez é o meio-termo — quem protege a senha de verdade é o piso de 12 caracteres
(fatia 3) somado ao custo do bcrypt, e este limite existe para inviabilizar varredura, não
para ser a única defesa. **O contador vive na memória do processo:** em servidor único é
exato; em serverless, cada instância tem o seu e o teto efetivo vira instâncias × 10. É mais
uma coisa que a decisão de hospedagem (fatia 2) muda.

**O corpo do 429 é montado pelo `tratarErro`, não pelo `errorResponseBuilder` do plugin.** A
primeira versão desta tarefa usou o construtor do plugin e **respondeu 500**: o plugin
`throw`-a o que aquele construtor devolve, e um objeto simples, sem `statusCode`, cai no
handler de T12b como exceção não tratada. O conserto não foi devolver um `Error` com
`statusCode` — foi tirar a formatação de lá. O handler já é o lugar único onde todo 4xx do
Fastify vira `{ erro, mensagem }`; ter um segundo formatador para o mesmo corpo é a duplicação
que produziu o defeito. O 429 ganhou ramo próprio, antes do genérico de 4xx, porque a
orientação ao usuário é outra: não há nada errado nos dados, o que falta é esperar.

**O helmet entrou com duas proteções desligadas de propósito.** `contentSecurityPolicy`: CSP
governa o que uma *página* pode carregar, e nenhuma resposta desta API é documento — as
etiquetas de T15 saem como texto SVG dentro de JSON, e quem as renderiza é a tela. Política
restritiva junto de um JSON não protege nada e vira ruído na depuração.
`crossOriginResourcePolicy`: o padrão do helmet é `same-origin`, que é exatamente o que esta
API não é — deixá-lo ligado seria a mesma classe de falha silenciosa do cookie `SameSite`,
recusa no navegador sem erro no servidor. Ficam ligados o `nosniff`, o `X-Frame-Options`, o
`Referrer-Policy` e o HSTS, que são os que fazem sentido para uma API JSON.

---

## 2026-09-09 — O relógio da RF08 nas duas hospedagens, e o roteiro de operação (T23, fatias 2 e 4)

**Decisão do orientando: suportar as duas hospedagens, em vez de escolher uma.** A alternativa
era assumir serverless e trocar o `setInterval` de T18 por rota de cron, ou assumir processo
persistente e não mexer em nada. As duas amarravam o projeto a um alvo, e uma delas reverteria
uma decisão de T18 que continua correta onde ela vale. O que ficou: o agendador interno
continua existindo e é ligado/desligado por `ALERTA_AGENDADOR_INTERNO`, e a rota para
agendador externo existe nos dois modos. **As duas formas chamam
`varrerEstoqueParaAlertas`** — exatamente como o CLI de T18 já fazia. A regra de o que é
alerta continua num lugar só; o que virou configuração foi o **gatilho**, não a regra.

**A rota é autorizada por segredo compartilhado, não por sessão.** `GET
/interno/varredura-alertas` com `Bearer $CRON_SECRET`, comparado em tempo constante sobre os
digests SHA-256 — comparar os textos exigiria buffers do mesmo tamanho e o modo de falhar
revelaria o tamanho do segredo certo. Nenhum papel do sistema alcança a rota, nem o GESTOR: é
uma porta de máquina. Sem `CRON_SECRET` configurado ela responde 503, mesma postura das rotas
de push sem chaves VAPID (T19b) — uma instalação que não usa cron externo não ganha porta
aberta por engano. T18 tinha recusado "uma rota de rodar agora" por ser escrita em massa
exposta; o que muda o veredito é a soma das três: não é alcançável por sessão, não existe sem
segredo, e a varredura é idempotente por construção.

**`ALERTA_AGENDADOR_INTERNO` tem padrão ligado e regra assimétrica.** Só `false` e `0`
desligam; qualquer outro valor liga. O modo de falhar é o motivo: um valor digitado errado no
painel da hospedagem não derruba nada e não aparece em log de erro — simplesmente nenhum
alerta é emitido, e a queixa chega dias depois como "o sistema parou de avisar". Errar para o
lado de manter o relógio ligado é inofensivo onde há processo, e é o único dos dois erros que
se percebe. O `server.ts` também registra em log qual modo está valendo, porque é ali que essa
investigação começa.

**`logger: true` virou `logger: { level: env.LOG_LEVEL }`, padrão `info`.** Aqui houve uma
correção de premissa: a fatia 4 foi escrita supondo que o logger registrava corpo de
requisição, o que colocaria a senha de `POST /auth/login` no log. **Não registra** — o
serializer padrão do Fastify grava método, URL, host e IP, e nada mais. A variável continua
justificada, mas pelo motivo certo: controlar volume de log num plano com retenção curta, não
evitar vazamento que nunca existiu.

**`docs/deploy.md` fecha com o que o deploy não tem.** Nove seções de roteiro, e a última
lista as limitações: sem cadastro de usuário pela interface, sem recuperação de senha, contador
de tentativas por instância, backup manual, sem monitoramento, sem homologação. Está no fim do
roteiro, e não em documento separado, porque a hora de descobrir isso é antes de subir — não no
meio do piloto. A rotina de `pg_dump` vem com a razão colada: o `EventoLog` é o dado do artigo,
e é a única coisa ali que não se recupera refazendo o deploy.

---

## 2026-09-14 — Gestão de contas de acesso (T22)

**`Usuario` ganhou `ativo`, e usuário nunca é excluído.** Mesmo argumento de `Produto`
(2026-09-07), e mais forte: `EventoLog`, `Saida`, `Descarte` e `UnidadeProduto` apontam para
`Usuario`, um deles com `onDelete: Restrict` explícito. Excluir quem operou apagaria a autoria
do dado de pesquisa, e o banco recusaria de qualquer forma. Desligar alguém é `ativo = false`.

**Conta inativa não autentica, e a recusa é indistinta.** Sem isso a coluna seria decoração —
a atendente desligada continuaria entrando com a senha que já tinha. A checagem de `ativo`
acontece **depois** da comparação de senha, não antes, para que o tempo de resposta não separe
"conta inativa" de "senha errada"; é a mesma razão do `HASH_INEXISTENTE` que T03 já usava.

**O gestor não muda o próprio papel nem se desativa.** O último gestor que faz isso tranca a
loja inteira para fora da gestão, sem caminho de volta pela interface. Rebaixar **outro**
gestor continua permitido: quem faz isso ainda é gestor e pode desfazer. A tela esconde as
ações da própria linha, mas é conveniência — quem recusa é o 409 do backend (RNF04).

**A própria senha sempre exige a senha atual, inclusive para o gestor.** Há duas rotas:
`PATCH /usuarios/:id/senha` (o gestor redefine a de outra pessoa, sem saber a antiga) e
`PATCH /usuarios/eu/senha` (a própria, exigindo a atual). A primeira **recusa o próprio id**.
Poderia permitir — o gestor já pode redefinir a de qualquer um, então não é escalação — mas a
regra "sua senha só muda com sua senha" vale mais por ser simples de enunciar, e quem perdeu a
própria senha não está logado para chamar rota nenhuma. Para esse caso continua existindo o
script de T23, que agora tem um papel claro: emergência do gestor único.

**A conta de sistema não aparece na lista e não aceita escrita.** `sistema@estoque.local`
assina os eventos da varredura (T18) e não é uma pessoa. Listá-la entre as contas da loja
convidaria alguém a "consertar" o `senhaHash` que existe justamente para ela nunca autenticar.

**Sem novo tipo de `EventoLog` para administração de conta.** Mesmo precedente da Decisão 6 de
T17, que recusou um décimo tipo para mudança de configuração: o `EventoLog` registra o que
acontece com o **estoque**, que é o objeto da pesquisa, não a administração do sistema.

**O e-mail é aparado antes da validação, em `preValidation`.** `format: 'email'` recusa
" nova@loja.com " — o espaço que o teclado do celular acrescenta ao colar — e a recusa sairia
como `CORPO_INVALIDO` genérico, que é o defeito que T12b existe para evitar. O `toLowerCase`
continua no serviço: lá é regra de unicidade, aqui é tolerância de digitação.

**O piso de 12 caracteres tem um dono só: o serviço.** Declará-lo também como `minLength` no
schema faria a recusa sair genérica em vez de dizer quantos caracteres faltam. É o mesmo
princípio de T12b aplicado a uma regra que não é de formato, e sim de negócio.

**Correção em `tests/apoio/bancoDeTeste.ts`, de um defeito introduzido em T23.** O helper
sobrescrevia só `DATABASE_URL` ao rodar `prisma migrate deploy`, mas o `prisma migrate` usa o
`directUrl` que T23 acrescentou ao datasource — então o `DIRECT_URL` do `.env` vazava do
`process.env` e **a suíte migrava o banco de desenvolvimento**. Passou despercebido em T23
porque aquela tarefa não criou migração nenhuma; apareceu na primeira migração seguinte, como
"a coluna `ativo` não existe" no banco de teste. Agora as duas variáveis são sobrescritas.

---

## 2026-09-15 — Hospedagem escolhida: Vercel (frontend), Render (backend), Neon (banco)

Fecha o ponto que T23 deixou explicitamente em aberto na fatia 2. A decisão é do orientando; o
que se registra aqui é o que ela implica no código e na operação.

**Backend em processo persistente, não em serverless.** É o que preserva a decisão de T18 — o
relógio da RF08 dentro do processo, para que um requisito funcional não dependa de
configuração no servidor da loja. `ALERTA_AGENDADOR_INTERNO=true`, e a rota
`/interno/varredura-alertas` fica sem uso em produção: ela continua existindo porque foi ela
que tornou a escolha reversível, e porque é o caminho do plano free (abaixo).

**A ressalva do plano free do Render muda o comportamento da RF08, e precisa ser dita.** O
serviço dorme após 15 minutos sem requisição. O `setInterval` de 24 h praticamente nunca
chega a disparar — o processo não vive tanto. O que roda é a **varredura de inicialização**, a
cada vez que o serviço acorda, e como ela é idempotente (índice único de `Alerta`, T18) isso
não emite alerta duplicado. O efeito líquido: a varredura acontece na primeira requisição do
dia, e o alerta in-app funciona. **O que se perde é o push** — ele existe justamente para
alcançar quem não abriu o app, e nada roda enquanto ninguém usa o sistema. Quem quiser a RF08
inteira no plano free precisa de um cron externo chamando a rota, que de quebra acorda o
serviço; `docs/deploy.md` seção 3.3 traz as três saídas.

**Neon obriga as duas strings, e é o que justifica o `directUrl` de T23.** A aplicação fala
pelo endpoint com pooler; o `prisma migrate` fala pelo direto, porque se serializa com um
advisory lock de sessão que o pooler em modo transaction não sustenta. O autosuspend de ~5
minutos do Neon soma-se ao spin-down do Render na latência da primeira requisição.

**Uma armadilha do Render que vale estar escrita.** O Render aplica as variáveis do painel
também durante o build, e `NODE_ENV=production` — que o runtime **precisa**, senão o cookie
não sai `Secure` — faz o `npm install` pular as devDependencies. Neste projeto isso derruba o
build duas vezes: `prisma` e `typescript` são devDependencies, então falham o `postinstall`
(`prisma generate`) e o `npm run build` (`tsc`). O build command tem de ser
`npm install --include=dev && npm run build`. É a mesma variável servindo a dois propósitos
opostos em duas fases diferentes, e o sintoma (`tsc: not found`) não sugere a causa.

**O cookie continua `SameSite=None`.** `.vercel.app` e `.onrender.com` são domínios
registráveis diferentes, então frontend e API são cross-site — exatamente o cenário para o
qual T23 mudou `modules/auth/cookie.ts`. Se um dia os dois ficarem sob o mesmo domínio,
`'lax'` volta a bastar e é a opção mais conservadora.

**O que a escolha melhora sem alarde:** o Render mantém uma instância só, então o contador de
tentativas de login (T23, fatia 1) é exato em vez de aproximado — a ressalva de "instâncias ×
10" registrada naquela entrada não se aplica a esta hospedagem.

---

## 2026-09-15 (revisão, no mesmo dia) — Backend também na Vercel, e não no Render

Revisa a entrada acima, que registrou Render para o backend. A entrada anterior fica como
está, porque a análise que ela contém é o que motivou a troca.

**O que mudou.** O levantamento dos planos de 2026 mostrou que "processo persistente e
gratuito" quase não existe mais: Fly e Railway encerraram o tier permanente, e o gratuito do
Koyeb dorme como o do Render. Sobrava pagar (Fly ~US$ 2/mês, Render Starter US$ 7/mês) ou
aceitar o spin-down. Diante disso, o orientando escolheu a Vercel para os dois.

**O que a escolha melhora.** No Render gratuito, o relógio da RF08 funcionava por acidente: o
`setInterval` não sobrevivia ao spin-down, e o que salvava a varredura era a passagem de
inicialização rodando a cada despertar — isto é, **a vigilância automática dependia de alguém
abrir o app**. Na Vercel isso deixa de ser acidente e vira configuração explícita: o cron da
plataforma chama `/interno/varredura-alertas` todo dia, tenha alguém aberto o sistema ou não.
A RF08 inteira volta a funcionar, push incluído. Trocou-se um mecanismo que funcionava por
efeito colateral por um que funciona por declaração — e a diferença aparece no dia em que a
loja não abre o sistema.

**O que a escolha custa, e está assumido.** Sai a decisão de T18 na forma original: o relógio
não vive mais dentro do processo, e passa a ser uma linha de `backend/vercel.json`. Foi para
permitir exatamente isso que a fatia 2 de T23 construiu os dois caminhos em vez de escolher
um — a regra de o que é um alerta continua em `varrerEstoqueParaAlertas`, num lugar só, e o
que virou configuração foi o gatilho. O outro custo é o contador de tentativas de login, que
volta a ser aproximado se a plataforma subir mais de uma instância.

**O que some da conta.** Some a armadilha do `--include=dev` (a Vercel instala
devDependencies no build por padrão), some o build command explícito, e some um fornecedor: o
projeto passa a ter dois painéis em vez de três. Para um piloto operado por uma pessoa só,
isso não é detalhe.

**O que não muda.** O banco continua no Neon com as duas strings; o cookie continua
`SameSite=None` + `Secure`, porque dois projetos em `.vercel.app` são cross-site — `.vercel.app`
está na Public Suffix List. E `ALERTA_AGENDADOR_INTERNO` passa a `false`, que é o valor que
T23 previu para esta hospedagem.

---

## 2026-09-15 — Prazos das transações, e por que espera longa é melhor que erro rápido no balcão

Decorrência direta da hospedagem escolhida hoje, e a única mudança de código que ela exigiu.

**O problema.** O Prisma usa `maxWait` de 2s (tempo para obter conexão) e `timeout` de 5s
(duração da transação). Os dois pressupõem servidor quente falando com banco quente — que é o
que a pilha escolhida **não** garante: a função parte fria depois de um período sem uso, e o
Neon suspende a computação após ~5 minutos ociosa. Numa perfumaria isso não é caso raro, é a
**primeira leitura de QR do dia**, e a segunda depois do almoço.

**A escolha:** `maxWait` de 10s e `timeout` de 15s, em `db/opcoesDeTransacao.ts`. O argumento
não é técnico, é de balcão: uma leitura que demora cinco segundos atrasa o atendimento; uma
que falha manda a atendente decidir sozinha qual frasco vender, que é exatamente o que o
sistema existe para evitar. **Espera longa é melhor que erro rápido aqui** — e essa frase é
uma decisão de produto que estava escondida dentro de um valor padrão de biblioteca.

**Aplicadas no construtor do client, não em cada `$transaction`.** São seis chamadas
interativas hoje, e a sétima é a que alguém escreve sem lembrar de repetir as opções. O módulo
não constrói client nenhum de propósito: é importado tanto por `db/prisma.ts` quanto por
`tests/apoio/bancoDeTeste.ts`, e importar um client ali abriria conexão com o banco de
desenvolvimento durante os testes. O client das suítes recebe as **mesmas** opções — do
contrário a suíte exercitaria um comportamento de transação diferente do que roda na loja, e a
configuração de produção não teria teste nenhum atrás dela.

**O teste custa ~6s à suíte, e é deliberado.** O Prisma não expõe as opções efetivas do client
para leitura, então a única forma de provar que a configuração chegou lá é exercer um prazo
que o padrão recusaria: uma transação de 6s, que com `timeout` de 5s aborta com
`Transaction already closed` — conferido. A alternativa seria uma configuração que pode parar
de valer sem que nada acuse, cujo sintoma aparece na primeira leitura de um dia frio, com
cliente na frente.

**O que isto não conserta.** A latência continua existindo; o que muda é o desfecho dela.
`docs/deploy.md` mantém o passo 9 da verificação — medir o pior caso — porque conhecer o
número continua sendo necessário.

## 2026-09-21 — A fábrica do Fastify deixa de se chamar `app.ts`

**O problema, descoberto no primeiro deploy.** A detecção de Fastify da Vercel escolhe como
entrypoint o **primeiro** arquivo que existir numa lista ordenada: `src/app.*`, `src/index.*`,
`src/server.*`, e os mesmos nomes na raiz. O backend tinha `src/app.ts` (a fábrica
`buildApp()`, usada pelo `server.ts` e por todas as suítes via `app.inject()`) e `src/server.ts`
(o processo, com o `listen()` e o gate do relógio da RF08). A Vercel pegava `app.ts`, que não
tem export default, e a função morria na partida em toda requisição:
`Invalid export found in module ".../src/app.js". The default export must be a function or server.`
O `deploy.md` supunha o `server.ts`, e o teste local não pegava o erro, porque localmente quem
decide o entrypoint é o `npm start`, não a lista da Vercel.

**Decisão.** Renomear a fábrica para `src/buildApp.ts`, o nome da função que ela exporta. O
`server.ts` passa a ser o único candidato da lista e roda sem alteração.

**Alternativa descartada.** Dar um export default ao `app.ts` (um handler que repassa a
requisição ao `app.server`). Funcionaria, mas faria da fábrica o processo: o `server.ts` —
onde vive o gate de `ALERTA_AGENDADOR_INTERNO` e a linha de log que o `deploy.md` manda
conferir — nunca rodaria na Vercel, e o comportamento de produção passaria a divergir do
local num ponto que ninguém lê.

**Segunda metade, descoberta no deploy seguinte.** Só o rename não bastou: o build passou a
falhar com `No entrypoint found which imports fastify. Found possible entrypoint: src/server.ts`.
A regra, lida no builder que roda de fato (`@vercel/fastify` → `generateNodeBuilderFunctions`
de `@vercel/build-utils` 14.10.1): dos candidatos da lista, valem só os que contêm
`import ... from 'fastify'` no texto (regex). O `server.ts` não importava `fastify`.

Uma primeira tentativa, `"main": "src/server.ts"` no `package.json`, foi ao ar e **não
resolveu**: ela saiu da leitura de outro pacote (`@vercel/backends`), onde o `main` é aceito
sem condição; no builder de Fastify, o arquivo do `main` também precisa casar com o regex. O
`main` foi retirado. Registrado aqui porque o erro de método é o que interessa: a simulação
reproduzia a mensagem certa com o código errado, e isso pareceu confirmação.

**Decisão final.** O `server.ts` anota a instância, `const app: FastifyInstance = buildApp()`,
com `import type { FastifyInstance } from 'fastify'`. É uma anotação que o arquivo pode ter por
mérito próprio, mas o motivo real é o regex, e isso está dito no comentário ao lado. Contra o
risco de alguém apagá-la numa limpeza, `tests/entrypointVercel.test.ts` aplica o regex do
builder sobre os candidatos e exige que o único a casar seja `src/server.ts` — cobrindo também
a volta de um `src/app.ts` ou `src/index.ts` que importe `fastify`. Conferido rodando o
`entrypointCallback` do próprio `@vercel/build-utils` 14.10.1: sobre o código que estava no ar,
dá a mensagem do build; sobre o corrigido, devolve `src/server.ts`.

**Consequência.** Criar `src/app.ts` ou `src/index.ts` que importe `fastify` volta a quebrar o
deploy, porque passa na frente do `server.ts`;
isso está registrado na seção 3.1 do `deploy.md`. Os arquivos de `tasks/` que citam `app.ts`
ficaram como estão, por serem registro histórico.

## 2026-09-21 — `listen()` sem `await` no `server.ts`

**O problema, terceiro do primeiro deploy.** Com o entrypoint certo, toda requisição passou a
ficar 60 s pendurada e cair com `INTERNAL_FUNCTION_INVOCATION_FAILED`. Causa, lida em
`@vercel/node` 13.0.1 (`compileUserCode`): para capturar o servidor criado no import, o runtime
troca `http.Server.prototype.listen` por uma função que guarda a instância e devolve `this` —
**sem chamar o callback**. A promise do `app.listen()` do Fastify resolve nesse callback, então
nunca resolve ali; e o `server.ts` fazia `await app.listen(...)` no topo do módulo, o que
impedia o próprio import de terminar.

**Decisão.** `app.listen(...).catch(...)`, sem `await`, que é também a forma do exemplo oficial
da Vercel. Em processo comum nada muda: falha ao escutar (porta ocupada, por exemplo) ainda
registra o erro e sai com código 1 — conferido. Reproduzido antes da mudança com uma réplica do
trecho do runtime (o import não termina) e conferido depois (`/health` → 200).

**O que isto não cobre.** O runtime espera no máximo 1 s, depois do import, pela chamada a
`listen`; o Fastify só a faz depois de registrar os plugins. Hoje isso leva bem menos de 1 s.
Um plugin que fizesse I/O lento no registro faria a função falhar com
`Can't detect handler export shape` — o sintoma a reconhecer.

## 2026-09-22 — Produtos fictícios em produção, e a única exceção à RNF05

**O problema.** Testar o sistema publicado exige estoque, e o único estoque de produção é o da
loja. Ler a etiqueta de um frasco real dá baixa de verdade. Criar produtos de teste pela
interface resolve o estoque, mas não a limpeza. Produto, unidades, saídas, descartes e alertas
se apagam por SQL. Os eventos no `EventoLog`, não: o trigger de T09 recusa o `DELETE`. E o
dashboard conta `ALERTA_FIFO_DISPARADO` direto do log, sem filtro de produto
(`dashboard.service.ts`), então os bloqueios FIFO dos testes entrariam para sempre nos números
da RF13.

**Decisão.** Uma planilha (`backend/dados-ficticios/produtos-ficticios.csv`) e dois scripts,
`ficticios:cadastrar` e `ficticios:remover`, com a lógica em `src/db/ficticios/`. O dado
fictício é reconhecido só pelo prefixo `ZZ-` do `codigoInterno`, o mesmo que o roteiro de
testes manuais já usava para o dado criado à mão. A remoção **apaga também os eventos**:
desliga o trigger `eventolog_append_only` dentro da própria transação, apaga só os eventos cujo
`produtoId` ou `unidadeId` pertence a um produto `ZZ-`, religa o trigger e só então apaga o
resto. `ALTER TABLE` é transacional no PostgreSQL, então uma falha no meio desfaz tudo e o
trigger volta ligado. O teste `tests/ficticios` confere que o trigger está ativo depois da
remoção, e falha se a linha que o religa for retirada.

**Por que é exceção à RNF05, e não violação dela.** A RNF05 protege o dado da pesquisa (RF12).
O evento de um produto fictício não é dado da pesquisa, é contaminação dele, e apagá-lo é o que
mantém o log fiel ao que aconteceu na loja. A regra continua valendo para a aplicação: nenhuma
rota, serviço ou tela ganhou caminho de `UPDATE`/`DELETE`. A exceção é um script operado da
linha de comando, com `--confirmar` explícito, restrito ao prefixo.

**Alternativas descartadas.** (a) Manter os eventos e separar o teste do piloto pela janela de
tempo: funciona só se os testes nunca se misturarem com o uso real, e o dashboard continuaria
mostrando o número contaminado para a gestora. (b) Manter os eventos e ensinar o dashboard a
ignorar produtos fictícios: exigiria guardar os `produtoId` removidos em algum lugar, porque o
produto some. Seria código de produção a serviço de um procedimento de teste. (c) Coluna
`ficticio` no `Produto`: migração de schema para uma marca que o prefixo já dá.

**Cadastro pelos serviços da aplicação.** O script usa `criarProduto` e `cadastrarUnidades`, e
não `createMany`. O dado fictício passa pelas mesmas regras que o real: normalização do código,
geração do `codigoQr` e evento por unidade. Um atalho testaria um estoque que a aplicação não
produz.

**Consequências.** O prefixo `ZZ-` passa a ser reservado: um produto real com esse código seria
apagado pela limpeza. Enquanto a remoção roda, o `ALTER TABLE` segura um lock exclusivo no
`EventoLog`, e toda leitura de QR espera por ele. Por isso ela roda fora do horário de
atendimento (`docs/deploy.md`, seção 7.1). A leitura de QR inexistente não aponta para produto
nenhum e não é removida.

## 2026-09-22 — Importação do catálogo por planilha CSV (T24)

**Contexto.** O gestor da loja tem o catálogo (~700 SKUs) numa planilha. O formulário de T04
cadastra um produto por vez, o que inviabiliza a carga inicial. A tarefa não estava no PRD e
entrou no backlog como T24, no incremento 8.

**Decisões.** As oito estão justificadas em `tasks/T24-importacao-produtos-csv.md`. Em resumo:

1. **Importa produtos, não unidades.** Cada unidade precisa de etiqueta no frasco e de validade
   lida no frasco. As unidades continuam entrando pelo Recebimento.
2. **Na tela de Catálogo**, visível só para GESTOR. O 403 da rota é quem recusa de fato.
3. **O servidor interpreta o CSV.** O navegador envia o texto do arquivo como está, em
   `{ conteudo }`. Descartada a alternativa de o frontend converter a planilha em JSON:
   deixaria no cliente a decisão sobre o que cada coluna significa e sobre o que é uma linha
   válida, em atrito com a RNF04.
4. **Planilha com problema não grava nada**, e a resposta lista todas as linhas a corrigir (até
   50), no formato do Excel: o número da linha conta o cabeçalho como 1.
5. **Código já cadastrado é pulado e avisado**, nunca atualizado. Decisão do orientando.
6. **Código repetido na mesma planilha é erro.**
7. **Colunas pelo nome**, comparado sem acento, maiúscula, espaço, `_` ou `-`, e **colunas
   extras são ignoradas**. A planilha do gestor pode manter preço e fornecedor.
8. **Sem novo tipo de `EventoLog`**, como no cadastro manual de produto.

**Achados da implementação.**

- **Encoding.** O Excel em português grava o "CSV (separado por vírgulas)" em Windows-1252. Lido
  como UTF-8, "Clássica" vira "Cl�ssica" e entra assim no catálogo. O navegador tenta UTF-8 em
  modo estrito e, se os bytes forem inválidos, relê como Windows-1252. É conversão de
  transporte, não decisão sobre o conteúdo, e por isso fica no cliente, onde estão os bytes.
  Conferido no navegador com um arquivo gravado em Windows-1252.
- **Limite de corpo.** O `bodyLimit` padrão do Fastify (1 MiB) recusaria com 413 uma planilha
  grande antes de a rota rodar. A rota ganhou limite próprio de 4 MiB, abaixo dos 4,5 MB da
  Vercel. O teste de 5.000 linhas passa de 1 MiB de propósito, e falha se o limite for retirado.
- **Leitor de CSV compartilhado.** A leitura de CSV da planilha de produtos fictícios passou para
  `shared/csv.ts` e agora serve às duas planilhas. Ele passou também a ignorar linhas só de
  separadores, que é o que o Excel grava quando alguém apaga o conteúdo das células sem excluir
  a linha.
- **`ErroApi.corpo`.** O frontend só guardava `mensagem` e `erro` da resposta de erro. A lista
  de linhas exigiu guardar o corpo inteiro. É acréscimo: os construtores existentes continuam
  válidos.

**A janela entre a consulta e a escrita.** Um código cadastrado por outra pessoa
entre a leitura dos existentes e o `createMany` é absorvido pelo `skipDuplicates`: não derruba a
importação, mas também não entra na lista de ignorados. Aceito: na loja, só a gestora cadastra
produtos.

## 2026-10-20 — Limite de 120 caracteres explicado no cadastro de produto (T25)

**Contexto.** Um nome de produto acima de 120 caracteres era recusado pelo schema da rota com a
mensagem genérica de T12b ("Alguns campos do formulário não foram aceitos..."), sem dizer o
campo nem o motivo. O formulário de `TelaProdutos.tsx` não espelhava o limite.

**Decisões.** As três da tarefa estão justificadas em `tasks/T25-limite-caracteres-produto.md`:

1. **Prevenir na tela.** Os quatro campos têm `maxLength` e um contador `n/120`. O contador fica
   **sempre** visível, e não só a partir de ~100 caracteres como a tarefa sugeria. Decisão do
   orientando.
2. **Avisar o corte da colagem.** O navegador corta em silêncio o texto colado que passa do
   `maxLength`. A tela calcula no `paste` se o corte vai acontecer, considerando o trecho
   selecionado que o texto colado substitui e as quebras de linha que o campo descarta, e avisa
   abaixo do campo ("O nome foi cortado em 120 caracteres."). O corte continua sendo do
   navegador. O aviso some na próxima edição do campo (decisão do orientando). A edição que a
   própria colagem gera é reconhecida por `inputType === 'insertFromPaste'` e não apaga o aviso.
3. **O servidor continua sendo a rede.** Na recusa `CORPO_INVALIDO`, o array `campos` de T12b
   vira mensagem junto ao campo, com o rótulo da tela: "O campo Nome aceita no máximo 120
   caracteres." O texto genérico do servidor só aparece quando nenhum campo do formulário é
   nomeado. O backend não mudou.

**A mensagem presume a regra.** `campos` diz qual campo foi recusado, não qual regra do ajv
falhou. A tela afirma "no máximo 120 caracteres" porque é a única regra que esses campos podem
violar com o formulário preenchido: os quatro vão sempre como texto, e o `required` impede o
vazio. Se o schema ganhar outra regra para eles, essa mensagem precisa ser revista. O orientando
preferiu manter o texto da tarefa a usar um texto neutro.

**Detalhes de implementação.**

- O limite mora em `TAMANHO_MAXIMO_CAMPO_PRODUTO` (`services/produtos.ts`), comentado como
  espelho do schema da rota. O helper `camposRecusados(corpo)` em `services/api.ts` lê `campos`
  de qualquer recusa, para outros formulários reaproveitarem.
- A recusa de um campo some quando esse campo é editado, porque era sobre o valor anterior.
- **Layout.** O formulário alinhava os campos pela base (`align-items: flex-end`). Com uma
  mensagem embaixo de um campo, a caixa dos outros descia e as quatro ficavam desalinhadas
  (visto no navegador). O cadastro passou a alinhar pelo topo, com o contador na linha do rótulo
  e o botão deslocado pela altura dessa linha.

**Achado: Contas de acesso (T22) tem o mesmo problema.** Nome (máx. 120), E-mail (máx. 200) e
Senha (máx. 200) não têm `maxLength` na tela, e a recusa sai genérica. Anotado no backlog, sem
correção nesta tarefa.

## 2026-10-20 — Busca em tempo real no Catálogo de produtos (T26)

**Contexto.** A busca do Catálogo só disparava no botão **Buscar**, e apagar o campo não
voltava à lista completa até um novo clique.

**Decisões.** As quatro da tarefa estão justificadas em `tasks/T26-busca-tempo-real-catalogo.md`:

1. **A busca continua no servidor** (`GET /produtos?busca=`). O backend não mudou.
2. **Atraso de 300 ms após a última tecla**, no hook `frontend/src/hooks/useValorComAtraso.ts`,
   que T28 vai reaproveitar. O termo passa pelo `trim()` antes do atraso: espaço a mais não gera
   consulta nova, e campo só com espaços é a lista completa.
3. **Resposta fora de ordem é ignorada, não cancelada.** Cada chamada de `carregar` recebe um
   número, e só a mais recente mexe na tela (lista, erro e indicador). A tarefa deixava aberto
   entre `AbortController` e ignorar; ignorar foi escolhido porque `carregar` também é chamado
   depois de cadastrar, inativar e importar, e o número cobre essas chamadas igual. O
   `AbortController` exigiria ainda distinguir o cancelamento da falha de rede, já que
   `requisitarApi` converte qualquer rejeição do `fetch` em `SEM_RESPOSTA`.
4. **Termo novo volta à página 1**, ajustado durante a renderização e não num efeito: num
   efeito, sairia antes uma consulta com o termo novo e a página antiga.

**Decisões do orientando.**

- **Botão × de limpar**, opcional na tarefa: implementado como botão próprio (não o × nativo de
  `type="search"`, que o Firefox não mostra). Aparece só com texto no campo, e devolve o foco a
  ele.
- **`maxLength={120}` no campo de busca**, espelhando o `maxLength` de `busca` no schema da
  listagem. Com a busca disparando sozinha, o 121º caractere viraria a recusa genérica de campo
  inválido.

**Detalhes de implementação.**

- **A tabela não some durante a busca.** `produtos` começa `null` e só a primeira carga mostra
  "Carregando produtos…". Depois dela, a lista anterior fica na tela, e um "Carregando…" discreto
  aparece na linha do rótulo da busca. Na primeira versão o indicador ficava ao lado da caixa,
  e o navegador mostrou a caixa encolhendo e voltando a cada busca; na linha do rótulo, como o
  contador de T25, a largura não muda. Isso vale também para paginação, filtro de inativos e as
  recargas depois de cadastrar ou inativar.
- **Falha na primeira carga** deixa de mostrar "Nenhum produto encontrado." embaixo do erro:
  sem lista carregada, a tela mostra só o erro.
- **Enter** continua preso no `onSubmit` do formulário, que só faz `preventDefault`. O campo
  é o único de texto do formulário, então o Enter submeteria e recarregaria a página.
- **Testes.** O relógio falso do Vitest fica ligado só no trecho que digita e avança o atraso:
  o `findBy` do Testing Library usa `setTimeout` real para terminar e trava com o relógio falso.

## 2026-10-20 — Componente de paginação compartilhado (T27)

**Contexto.** Catálogo, Alertas, fila de descarte, Etiquetas e histórico de saídas do Dashboard
repetiam o mesmo par **Anterior**/**Próxima**. Com 700 SKUs em páginas de 20, a página 30 do
catálogo ficava a 29 cliques. As cinco telas passaram a usar
`frontend/src/components/Paginacao.tsx`.

**Decisão da tarefa.** **Sem campo "ir para a página N".** Com primeira, última e a janela de
números, qualquer página fica a poucos cliques, e o campo só pesaria na tela do celular.
Reavaliar se a gestora pedir.

**Decisões do orientando.**

- **Sem linha "Página X de Y · N itens" no componente.** A tarefa desenhava essa linha embaixo
  dos botões, mas as cinco telas já têm um resumo no topo da lista com total e página, que
  continua aparecendo quando há uma página só (caso em que o componente some). Os resumos
  ficaram como estavam, e o componente não recebe `total` nem rótulo.
- **Mudar de página rola até o início da lista, não até o topo da tela.** No Catálogo do gestor
  há o formulário de cadastro e a importação acima da tabela, e no Dashboard os indicadores
  ficam acima do histórico: rolar ao topo deixaria a lista fora da vista. Cada tela passa ao
  componente uma referência (`alvoRolagem`) para o elemento que abre a lista: a tabela no
  Catálogo, o parágrafo de resumo em Alertas, Descartes e Dashboard, e a folha em Etiquetas.

**Detalhes de implementação.**

- **`alvoRolagem` é obrigatório**, embora a tarefa listasse só `{ pagina, totalPaginas,
  aoMudar }`. Opcional, uma tela nova que esquecesse a referência perderia a rolagem sem nada
  avisar.
- **Janela de duas páginas de cada lado**, sempre com a primeira e a última
  (`paginasVisiveis`). Um salto de **uma** página só mostra o número em vez da reticência: a
  reticência ocuparia o mesmo espaço e esconderia o número que substitui (`1 2 3 4 [5]`, não
  `1 … 3 4 [5]`).
- **A página atual não é botão.** É um `span` com `aria-current="page"` e o texto "Página "
  visualmente oculto, porque `aria-label` em `span` genérico não vale pela especificação ARIA.
  Os outros números são botões com rótulo "Ir para a página N". Os nomes acessíveis de
  Anterior e Próxima continuam exatamente "Anterior" e "Próxima" (as setas são
  `aria-hidden`), e por isso os testes das cinco telas passaram sem alteração.
- **O modo compacto (‹ 6 / 35 ›) usa container query, não media query.** A `.paginacao` é o
  contêiner, e o modo compacto entra quando **ela** tem menos de 50rem. O histórico do
  Dashboard fica dentro de um `.bloco-painel` com padding e borda, mais estreito que as outras
  listas na mesma tela. 50rem é a largura do layout completo no pior caso (página do meio,
  nove números), medida no navegador em 790 px. `flex-wrap` continua como reserva para fonte
  maior que a padrão.
- **"Imprima uma página por vez."** (Etiquetas) ficava dentro do bloco `.paginacao` e saiu para
  um parágrafo próprio (`.aviso-paginas`), escondido na impressão como a paginação.
- **Testes.** O jsdom não implementa `scrollIntoView`; `setupTests.ts` define um vazio, e o
  teste do componente confere a chamada com `vi.spyOn`.
- **Conferência no navegador.** O banco local tem 5 produtos (uma página), e os fictícios dão
  2. O `GET /produtos` foi simulado com 692 itens por `page.route` do `playwright-cli`, sem
  gravar nada no banco. A 360 px a paginação cabe. A página tem rolagem horizontal nessa
  largura por causa da tabela e das abas, que já eram assim antes (escopo de T36).

## 2026-10-20 — Seletor de produto com filtro (T28)

**Contexto.** Recebimento e Etiquetas escolhiam o produto em dois controles: um campo de busca
com botão **Buscar** e um `<select>` com o resultado. Os dois viraram um combobox só,
`frontend/src/components/SeletorProduto.tsx`, com `{ valor: Produto | null, aoEscolher }`. O
valor é sempre um produto escolhido da lista, nunca o texto digitado.

**Decisões da tarefa.**

1. **`downshift` (`useCombobox`), versão 9.4.0**, e não componente próprio. Headless, sem CSS:
   o padrão WAI-ARIA de combobox (`role="combobox"`, `aria-expanded`,
   `aria-activedescendant`, setas, Enter, Esc) vem pronto, e o visual continua do projeto.
   Confirmado pelo orientando.
2. **Só produtos ativos**, o padrão de `GET /produtos`: o backend já recusa receber unidade de
   produto inativo.
3. **Valor inicial.** O seletor aceita um produto já escolhido (`valor` na montagem preenche o
   campo), mas Etiquetas não o usa: vindo do Recebimento, a folha abre direto como antes, e
   "Escolher outro produto" mostra o seletor vazio. Decisão do orientando.

**Decisões do orientando.**

- **Campo vazio abre a lista com a primeira página do catálogo** ao receber o foco, como o
  `<select>` fazia; digitar filtra no servidor com o atraso de T26.
- **Sair do campo sem escolher apaga o texto.** Deixa claro que não há produto escolhido.

**Detalhes de implementação.**

- **Sair do campo não escolhe o item destacado.** O padrão do downshift escolhe ao perder o
  foco o item destacado, e um item fica destacado só por o mouse passar por cima dele. Escolher
  é clique, toque ou Enter (`stateReducer`, caso `InputBlur`).
- **O texto da caixa não é controlado pela tela.** No downshift 9 os callbacks `on*Change`
  rodam num efeito, depois da renderização. Com o texto em `useState` do componente, a
  renderização depois de cada tecla repunha o valor anterior na caixa, e digitando rápido uma
  tecla em cada duas se perdia ("perf" virava "pef"). O jsdom não reproduz, porque
  `fireEvent.change` troca o valor inteiro de uma vez; apareceu na conferência com o
  `playwright-cli`. O texto ficou com o downshift (`initialInputValue`, `setInputValue`).
- **Desfazer a escolha não apaga o texto editado.** Quando `valor` vira `null`, o downshift
  troca o texto pelo nome de "nenhum produto", que é vazio; o `stateReducer` mantém o texto
  nesse caso, porque a escolha é desfeita justamente por alguém estar editando.
- **Escolher não dispara busca pelo nome escolhido.** O termo da busca é o que foi digitado, e
  não o que está na caixa.
- **Erro de rede** aparece embaixo da caixa, com "Tentar de novo", que repete o mesmo termo sem
  tirar o foco do campo (senão o texto seria apagado). Com erro, a lista anterior sai de vista:
  ela é de outro termo, e embaixo do texto novo passaria por resultado dele.
- **A lista se ancora na caixa de texto, e não no `.campo`.** No Recebimento o `.campo` fica
  dentro de um formulário em coluna e herda `flex: 1 1 10rem`, ficando mais alto que o
  conteúdo; ancorada nele, a lista abria longe da caixa. O espaço vazio embaixo do campo já
  existia com o `<select>` e ficou como está (escopo de T35/T36).
- **Recebimento guarda o produto junto do resultado.** "Imprimir etiquetas destas unidades"
  passa a usar o produto do recebimento feito, e não o que estiver no seletor no momento.
  Antes, trocar o `<select>` depois de registrar mandaria à folha o `produtoId` errado.

## 2026-10-20 — Mensagens de resultado de ação em toasts (T29)

**Contexto.** Cada tela tinha o seu `<p className="erro" role="alert">` e, às vezes, um
parágrafo de sucesso, onde coubesse. Com isso a mensagem aparecia longe do botão clicado (no
celular, fora da tela), ficava parada depois de perder o sentido, e cada tela resolvia isso de
um jeito. Agora o resultado de ação é um toast, num lugar só.

**Decisões da tarefa.**

1. **`sonner`, versão 2.0.8**, e não `react-hot-toast`. Não tem dependências, aceita React 19 e
   tem botão de fechar e cores por tipo prontos. A troca de biblioteca fica isolada em dois
   arquivos.
2. **Duração.** O sucesso some em 4 s. O erro fica até ser fechado (`duration: Infinity`, com
   botão "Fechar aviso"), porque o usuário precisa ler o que deu errado.
3. **Um ponto de chamada.** As telas chamam `avisar.sucesso(msg)` e `avisar.erro(falha, padrao)`
   de `frontend/src/services/avisos.ts`. `erro` aceita `unknown`: usa a mensagem do `ErroApi`,
   ou uma string já pronta, ou então o texto padrão da ação. Um `TypeError` de programação não
   chega à tela com o texto técnico. A região dos toasts é `components/Avisos.tsx`, montada uma
   vez em `App.tsx`, fora do guardião de sessão, para não ser desmontada na troca entre login e
   área autenticada.
4. **O texto continua sendo o do servidor** quando ele manda um (RNF04).

**Critério de corte.** O arquivo da tarefa separa o que vira toast do que fica no lugar. Os
casos que ele não cobria foram decididos assim:

- **Erro de envio de formulário sem campo apontado vira toast.** Exemplos: código interno
  repetido, e-mail repetido, senha atual incorreta, janela de alerta repetida, produto inativo
  no recebimento. O formulário continua preenchido para a correção, e o toast de erro não some
  sozinho. Fica no formulário só o que aponta um campo: a recusa por campo de T25 e a
  conferência local "a confirmação não corresponde" de Minha senha.
- **A tela de login fica como está.** Nela, a falha é o único conteúdo da tela e diz respeito
  ao par e-mail/senha digitado. O aviso de backend inalcançável na verificação da sessão também
  fica: ele explica por que a tela de login apareceu, é estado da tela. A falha do **Sair** vira
  toast, e o parágrafo de aviso saiu da área autenticada, onde só ela o usava.
- **A tela de Leitura de QR não foi alterada.** O erro de uma leitura (código inexistente, rede)
  ocupa a área de resultado no lugar do veredito, e é o desfecho daquela leitura. O
  `PainelExcecaoVencido` também mantém o próprio erro: o painel faz parte da área do veredito,
  na Leitura e na Fila de descarte. O que mudou na Fila foi o desfecho mostrado depois que o
  painel fecha (descarte registrado, resultado da revalidação, unidade já resolvida por outra
  pessoa). Ele vira toast, e o tipo segue o veredito, como antes seguia a cor: só `CONFIRMAR` e
  o descarte são sucesso.
- **A importação por planilha fica como está.** O sucesso traz a lista de códigos pulados, e a
  recusa traz a lista de linhas com erro. As duas são relatório para a gestora consultar.
- **Notificações neste aparelho.** A falha ao *verificar* o aparelho fica no quadro, porque é
  estado. A falha ao ativar ou desativar vira toast, com a mensagem do navegador quando ela
  existe (`Error`, e não só `ErroApi`).
- **Sucessos que antes não tinham mensagem nenhuma** passam a ter toast: produto cadastrado,
  inativado e reativado; conta criada, desativada e reativada; papel trocado; janela de alerta
  adicionada, salva, inativada e reativada; alerta marcado como lido; unidades registradas. No
  Recebimento o resultado com os códigos e o botão das etiquetas continua abaixo do formulário,
  e o toast só confirma o clique.
- **Falha ao carregar a tela** continua no lugar em todas as telas. Onde o mesmo estado `erro`
  servia ao carregamento e às ações (Catálogo, Contas, Alertas, Configurar alertas), ele passou
  a ser só do carregamento.

**Posição: embaixo e no centro.** A primeira escolha foi embaixo e à direita. Na conferência
com o `playwright-cli`, o toast cobria a coluna "Ações" do Catálogo, e o de erro, que não some
sozinho, ficaria em cima do botão "Inativar" da última linha. No centro ele cobre colunas de
texto. No celular (390 px) a biblioteca estica o toast na largura da tela, colado embaixo,
longe da navegação, que fica no topo. Nenhuma tela que dispara toast tem conteúdo principal
na borda de baixo. A Leitura teria, mas não dispara toast.

**Acessibilidade.** A biblioteca anuncia os toasts por uma região única com
`aria-live="polite"` (nome acessível "Avisos"), sem `role` por toast. O erro é anunciado
educadamente, e não de forma assertiva como o `role="alert"` anterior. Pôr `role="alert"`
dentro de cada toast faria uma região viva dentro de outra, e o leitor de tela poderia anunciar
duas vezes. Fica como está, e o redesign (T35) pode rever isso.

**Testes.** `services/testes/avisos.tsx` traz `renderizarComAvisos(tela)`, que monta a tela
com `<Avisos />` ao lado como o `App` faz, além de `encontrarAviso(texto)`, que devolve o
elemento e o tipo (`success`/`error`), e de `semAvisos()`. Os testes de tela procuram o toast
pelo texto que o usuário lê, e não pela chamada ao módulo. A biblioteca guarda os toasts num
estado global e reapresenta os ativos a cada `<Toaster />` montado. Por isso o `setupTests.ts`
fecha todos depois de cada teste: sem isso, um erro (que não some) passaria para o teste
seguinte. `semAvisos()` espera uma volta do laço de eventos antes de olhar, porque o toast
entra num `setTimeout` da biblioteca.

## 2026-10-20 — Aviso de sessão expirada em modal (T30)

**Contexto.** Quando o JWT expira, a próxima requisição volta 401 `NAO_AUTENTICADO`, e cada
tela mostrava isso como mais um erro inline (ou, desde T29, como toast). A pessoa tentava de
novo, recebia o mesmo erro, e só descobria que precisava entrar outra vez recarregando a
página.

**Decisões da tarefa** (as quatro do arquivo da tarefa, confirmadas na implementação):

1. **Modal, não toast.** Toda ação a partir daí falha; o modal bloqueia a tela porque ela de
   fato está bloqueada. Não fecha por Esc nem por clique fora: não há para onde voltar.
2. **O que estava na tela se perde.** Ao clicar em "Entrar novamente" a área autenticada é
   desmontada. Guardar rascunho fica fora (limitação registrada em `docs/notas-para-artigo.md`).
3. **Detecção num ponto só**, em `requisitarApi`, pelo par status 401 + código
   `NAO_AUTENTICADO`. O aviso sai por um callback registrado pelo `App`
   (`aoExpirarSessao(ouvinte)`, que devolve a função de remoção, no formato de `useEffect`), e
   `services/` continua sem importar React. A falha continua sendo lançada para a tela que
   pediu; o aviso é a mais. O `GET /auth/me` da abertura e o `POST /auth/login` passam
   `{ avisaSessaoExpirada: false }` num terceiro parâmetro de `requisitarApi`, porque ali 401
   quer dizer "não está logado" e "senha errada". A exclusão é explícita na chamada, e não por
   comparação de caminho dentro de `api.ts`.
4. **`components/Dialogo.tsx`** sobre o `<dialog>` nativo com `showModal()`, que já dá tela de
   trás inerte, foco preso e camada superior (acima dos toasts). Controlado por `aberto`;
   `aoCancelar` opcional decide o que o Esc faz, e sem ele o Esc não fecha. O foco inicial vai
   para o primeiro botão de `acoes` — para T39, isso significa pôr "Cancelar" primeiro.

**Decisões que o arquivo da tarefa não cobria.**

- **O toast de erro ignora sessão expirada** (`avisar.erro` sai cedo quando
  `eSessaoExpirada(falha)`). A região dos toasts fica fora do guardião de sessão (T29) e o erro
  não some sozinho: sem isso, um clique recusado deixaria um toast "Sessão ausente ou expirada"
  na tela da sessão nova. O erro **inline** de carregamento continua sendo escrito pela tela,
  mas fica atrás do modal (inerte) e é desmontado junto com a área autenticada — é assim que o
  item 4 do comportamento ("a tela não mostra o erro por cima do modal") é atendido, sem mexer
  em nenhuma tela.
- **A rota de retorno é estado do `App`, e não estado de rota** (`navigate('/login', { state })`).
  O React Router 7 navega em transição, e a troca de sessão é uma atualização urgente: o ramo
  anônimo renderizava ainda na rota antiga, a rota coringa redirecionava para `/login` sem o
  estado, e o retorno se perdia. Pelo mesmo motivo, no login a troca de sessão e a navegação de
  volta ficam dentro de um `startTransition` único; fora dele a rota coringa do ramo
  autenticado mandava para a tela inicial do papel por cima do retorno. O teste de retorno
  falhava nas duas versões anteriores, e é ele que segura isso.
- **Outra pessoa entrando no mesmo aparelho** volta para a rota guardada; se o papel dela não
  alcança a rota, a rota coringa leva à tela inicial, como qualquer URL digitada.
- **Uma requisição que ainda estava no ar** pode voltar 401 depois do "Entrar novamente". O
  login zera o aviso, para que a sessão nova não abra com o modal.
- **Defesa contra o Chrome fechar o diálogo.** O Chrome ignora o `preventDefault` do `cancel`
  repetido sem interação do usuário entre um e outro. O Esc é barrado já no `keydown`, e se o
  diálogo fechar por fora (botão voltar do Android), um diálogo sem `aoCancelar` se reabre.

**Testes.** O jsdom não implementa `showModal`/`close`; o `setupTests.ts` ganhou um substituto
mínimo (atributo `open` e evento `close`). `services/api.test.ts` (novo) cobre o aviso e as
exclusões; `components/Dialogo.test.tsx` cobre foco, Esc e reabertura; `App.test.tsx` cobre o
modal em carregamento e em clique, a ausência de toast, o retorno à rota, e os casos que não
abrem o modal (401 do `/auth/me`, 401 do login, 403).

## 2026-10-20 — Confirmação em diálogo antes de ação destrutiva (T39)

**Contexto.** Descartar, autorizar venda vencida, inativar produto, desativar conta e trocar
papel aconteciam no primeiro clique (o papel, no `onChange` do `<select>`). A tarefa põe uma
confirmação igual em todas elas.

**Decisões da tarefa** (as seis do arquivo da tarefa, confirmadas na implementação):

1. **Confirmação como função que devolve promessa.** `components/DialogoConfirmacao.tsx`
   exporta `ProvedorConfirmacao`, montado uma vez em `App.tsx` em volta das telas, e
   `useConfirmacao()`, que devolve `confirmar({ titulo, consequencia, rotuloConfirmar })`.
   Na tela: `if (!(await confirmar({...}))) return` antes da chamada à API. Um pedido novo com
   outro aberto cancela o primeiro, para nenhuma promessa ficar pendurada.
2. **Foco em Cancelar**, que é o primeiro botão (o `Dialogo` de T30 foca o primeiro botão de
   `acoes`). Esc e clique fora cancelam.
3. **O botão repete o verbo** ("Descartar", "Autorizar venda", "Inativar", "Desativar conta",
   "Trocar papel") e o texto cita o dado concreto (código e produto da unidade, nome do
   produto, nome da conta).
4. **Trocar papel deixa de salvar no `onChange`.** Cancelar não precisa de código para
   devolver o `<select>`: ele é controlado por `conta.papel`, que só muda com a resposta do
   servidor, então ele já mostra o papel atual enquanto a pergunta está aberta.
5. **O override pergunta depois da justificativa.** Cancelar a pergunta mantém o texto da
   justificativa no formulário.
6. **A confirmação é só de interface** (RNF04): libera a mesma chamada de antes.

**Revisão de uma decisão de T30: clique fora.** T30 fez o `Dialogo` não fechar por clique
fora. Agora o clique fora chama `aoCancelar` quando ele existe; sem `aoCancelar` (o aviso de
sessão expirada) continua sem efeito. Na confirmação, cancelar é o desfecho seguro, então um
toque perdido no fundo cai nele. Para distinguir clique no fundo de clique no cartão, o
`<dialog>` ficou sem `padding` e o conteúdo foi para `.dialogo-conteudo`: um clique cujo alvo
é o próprio `<dialog>` só pode ter sido no fundo.

**O texto de cada consequência foi conferido no backend**, como o arquivo da tarefa pede:

- **Inativar produto:** o servidor recusa receber unidade de produto inativo
  (`unidade.service.ts`), e o seletor de produto do recebimento e das etiquetas só lista
  ativos. A venda e o descarte das unidades já em estoque **não** olham `ativo`, e o texto diz
  isso, em vez do rascunho "as unidades já em estoque não mudam", que era ambíguo.
- **Desativar conta e trocar papel:** o login recusa conta inativa, mas `autenticar`
  (`auth.middleware.ts`) só valida o JWT e lê o papel **do token**. Uma sessão aberta continua
  com a conta ativa e o papel anterior até o token expirar (`DURACAO_SESSAO_SEGUNDOS`, 8 h). O
  rascunho da tarefa ("não poderá mais entrar no sistema") era verdade só para o próximo login,
  e o texto final diz as duas coisas. As 8 horas ficaram escritas na tela, com comentário
  apontando para a constante do backend. Corrigir o comportamento é mudança de backend, fora
  do escopo; ficou registrado como achado no backlog.
- **Descarte e override:** gravam `Saida` e `EventoLog` (RNF05), e o override grava quem
  autorizou. "Não pode ser desfeito" é literal.

**Testes.** `services/testes/confirmacao.ts` traz `encontrarConfirmacao(titulo)` e
`responderConfirmacao(titulo, botao)`. `renderizarComAvisos` passou a montar também o
`ProvedorConfirmacao`, como o `App`, e a `montarTela` da Leitura também. Os 13 testes que
clicavam e esperavam a chamada direta agora respondem ao diálogo. Os casos novos cobrem, por
ação, o texto da consequência, o cancelamento sem chamada e a confirmação com uma chamada. No
`Dialogo`, cobrem o clique no fundo e no cartão.

## 2026-10-20 — Leitura única: a câmera desliga ao identificar o código (T31)

**Contexto.** Revisa a escolha de T10 de manter a câmera ligada depois do veredito, para o laço
do RF06 rodar sem toque na tela. No uso, a câmera aberta lia qualquer frasco que passasse na
frente dela, e enquanto T33b não chega, ler é vender. Agora cada leitura é um ato: a câmera lê
um código, desliga, e a atendente toca em **Ler próximo** para religá-la.

**Decisões da tarefa** (as duas do arquivo da tarefa, confirmadas na implementação):

1. **O modo é do `LeitorCamera`.** Prop `modo: 'unica' | 'continua'`, padrão `'continua'`
   (para T32). No `'unica'`, o callback de decodificação emite o primeiro código, chama
   `stop()` e descarta, numa variável local do efeito, os quadros que a `html5-qrcode` ainda
   entrega enquanto o `stop()` assíncrono não termina. Religar é montar o componente de novo.
2. **A proteção contra rajada de `TelaLeituraQr` continua** (`emVoo` e `codigoJaProcessado`),
   como defesa em profundidade para o RF12. O teste dela usa um botão do dublê que simula um
   leitor que não parou.

**Decisões tomadas na implementação:**

3. **A leitura digitada também desliga a câmera que estiver ligada.** Se não desligasse, a
   câmera leria o próximo frasco que passasse por trás do resultado digitado, que é o mesmo
   risco que a tarefa ataca.
4. **"Ler próximo" religa a câmera só se ela estava ligada quando a leitura partiu**
   (`religarCamera`). Depois de uma leitura digitada, o botão limpa o resultado e devolve o
   foco ao campo. Ligar a câmera sozinho mostraria o aviso de câmera indisponível a quem não
   tem câmera, a cada código.
5. **"Ler próximo" aparece também depois de erro**, não só depois de veredito ou desfecho da
   exceção. A câmera desliga na leitura que falhou, e o botão é o caminho de volta. Ele
   substitui os dois botões "Ler outra unidade".
6. **Ligar a câmera zera `codigoJaProcessado`**, como já fazia a digitação. O mesmo frasco
   pode ser lido de novo de propósito, e a guarda do código repetido fica só para o leitor que
   não parou.

**Testes.** `components/LeitorCamera.test.tsx` (novo) substitui a `html5-qrcode` por um dublê
que guarda o callback de decodificação. Ele cobre a emissão única com `stop()`, o descarte dos
quadros com `stop()` pendente, a leitura de novo numa montagem nova, o modo contínuo e a falha
de permissão. Em `TelaLeituraQr.test.tsx`, o dublê do leitor respeita o modo, e os casos novos
cobrem a câmera desligando, "Ler próximo" nos dois caminhos, a leitura digitada com a câmera
ligada, o bloqueio FIFO e a unidade vencida que ficam na tela, e o erro. A conferência no
navegador foi feita pela entrada manual. A leitura pela câmera fica para o celular real.

## 2026-10-20 — Casos de teste da leitura sem baixa e da confirmação da venda (T33)

**Contexto.** Ler o QR deixa de ser vender (incremento 10): a leitura valida e libera a unidade
para um carrinho que existe só no navegador, e a venda é a confirmação do carrinho. Pela regra
do CLAUDE.md e da seção 8 do PRD, os casos vêm antes da implementação (T33b), no mesmo par de
T06/T07. Nenhuma linha de `src/` mudou.

**Decisões anteriores revistas** (alerta do incremento 10, nenhuma bloqueia):

- **PRD 6.2** ("não há carrinho"): passa a haver carrinho, no navegador. Continuam valendo as
  consequências que a 6.2 protege: nenhuma entidade nova no schema, nenhuma reserva no
  servidor, lock só durante a transação de cada unidade. Um caso fixa isso: duas leituras da
  mesma unidade, inclusive de atendentes diferentes, liberam as duas.
- **T09** (remoção de `POST /saidas/confirmar`, por exigir partir a função em "decidir" e
  "efetivar"): é o que esta mudança faz, de propósito. A objeção de T09 era editar a suíte de
  T06 depois da implementação, e a resposta é esta tarefa, que reescreve os casos antes.
- **Suíte de T06**: os casos do ramo 5, do laço de revalidação e de concorrência foram
  reescritos, marcados com `T33` no comentário. Os ramos 1 a 4 não mudaram de significado e
  seguem como leitura.
- **T11, correção de validade**: a revalidação deixa de vender. Com `CONFIRMAR`, a unidade
  corrigida vai para o carrinho.
- **RF12**: "acerto na primeira leitura" mantém o significado, porque a validação continua na
  leitura. A `Saida` passa a nascer na confirmação.

**Contrato fixado pelos testes.**

1. **`validarSaidaFifo(codigoQr, usuarioId, tx, sessaoVendaId, { modo, noCarrinho? })`.** O
   arquivo da tarefa propunha `sessaoVendaId` dentro do objeto de opções. Ficou como quarto
   argumento, como já é hoje, e as opções vão num quinto. Justificativa: com a assinatura atual,
   a função ignora o quinto argumento e se comporta exatamente como antes. Assim os casos que
   não mudaram passam, e os que mudaram falham por asserção (`expected 'VENDIDA' to be
   'EM_ESTOQUE'`), e não por um erro do Prisma ao receber um objeto onde esperava texto. Com o
   `sessaoVendaId` no objeto, toda chamada que chegasse ao ramo 5 estouraria em `saida.create`,
   e o vermelho deixaria de mostrar o que mudou.
2. **Os dois modos recebem o código, não o id.** A rota de confirmação recebe ids (o carrinho
   guarda o que o servidor identificou) e precisa consultar as unidades de qualquer jeito para
   ordenar a fila por validade. Na mesma consulta ela obtém o código, que é imutável, e o lock
   por código trava a mesma linha que o lock por id. O arquivo de T33b dizia "a função ganha a
   busca por id"; foi atualizado.
3. **`EFETIVAR` grava os eventos dos ramos 3 e 4** (`TENTATIVA_VENDA_UNIDADE_VENCIDA`,
   `ALERTA_FIFO_DISPARADO`), iguais aos da leitura, e não grava `LEITURA_QR_SAIDA` em ramo
   nenhum. O bloqueio na confirmação (entrou uma unidade de validade menor depois da leitura)
   conta como tentativa do ciclo: a venda precisou de uma troca de frasco, como no bloqueio
   comum, ainda que a atendente não tenha errado ao ler. É raro (minutos entre leitura e
   confirmação), e separar exigiria um segundo tipo de alerta.
4. **`noCarrinho` tira unidades do pool do passo 4, menos a própria unidade lida.** Sem a
   exceção, reler o que já está no carrinho esvaziaria o pool e a função estouraria no
   `findFirstOrThrow`. Ids inexistentes ou já baixados não têm efeito. Evitar o item repetido
   no carrinho é da tela (T34), porque não é veredito.
5. **`tentativasAteAcerto` não muda de regra.** Contagem do par (SKU, atendente) desde a última
   `SAIDA_CONFIRMADA`. Com a confirmação em ordem de validade crescente, o bloqueio do ciclo fica
   com a unidade de menor validade do SKU no carrinho (a que a troca de frasco buscava), e as
   outras saem com 0. A soma no carrinho é o número de bloqueios, sem contagem dupla.
6. **`POST /saidas/finalizar`**: corpo `{ unidadeIds, sessaoVendaId? }`, teto de **50** itens,
   ids em formato uuid e sem repetição (400 `CORPO_INVALIDO`). Id que não é de unidade nenhuma
   recusa o carrinho inteiro com **404 `UNIDADE_NAO_ENCONTRADA`**, mesmo código e status dos
   caminhos de T11, sem processar item algum: unidade não é apagada, então o id desconhecido só
   vem de cliente quebrado. Resposta `200 { itens }`, um item por unidade na ordem do corpo,
   cada um no formato de `/saidas/ler` mais `unidadeId`.
7. **`POST /saidas/ler` e `POST /excecao-vencido/corrigir` aceitam `noCarrinho`** (uuids, teto
   50). A correção não estava no arquivo da tarefa, mas tem o mesmo problema da leitura: a
   unidade corrigida para fevereiro seria barrada pela de janeiro que já está no carrinho.
8. **A mensagem de `CONFIRMAR` não diz "registrada".** Um caso garante isso, sem fixar o texto,
   que é de T33b.

**Consequência registrada, não resolvida: liberar não fecha o ciclo.** A fronteira do ciclo de
tentativas continua sendo a `SAIDA_CONFIRMADA`, que agora só nasce na confirmação. Se a
atendente é barrada, pega o frasco certo e o cliente desiste antes de confirmar, o bloqueio
entra na conta da próxima venda do mesmo SKU pela mesma atendente. O efeito já existia para o
ciclo abandonado antes de T33, mas ficou mais frequente. Um caso fixa o comportamento atual
("liberar a unidade para o carrinho não fecha o ciclo"). Mudar a fronteira é decisão do
orientando, e afeta o indicador do TCC.

**Estado da suíte ao fim de T33:** 517 casos, 468 verdes e 49 vermelhos, todos nos casos novos
ou reescritos (18 em `fifo`, 21 em `saida/finalizar`, 6 em `saida/lerQr`, 2 em
`excecao-vencido`, 1 em `dashboard`, 1 em `evento-log`). `test:sem-banco` segue verde. A
definição de pronto de T33b é a mesma de T07: estes casos passam, sem editá-los.

**Achado: o typecheck nunca checou `tests/`.** `tsconfig.tests.json` estende `tsconfig.json` e
não redefine `exclude`, então herda `"exclude": [..., "tests"]`: os arquivos de teste ficam fora
do programa e `npm run typecheck` passa sem olhar para eles. A decisão de T06 ("o tipo
`Veredito` é o contrato, e um contrato que ninguém verifica não é contrato") está sem efeito
desde então. Medido com uma configuração temporária que corrige o `exclude`: 77 erros de tipo
já existentes nas suítes, nenhum nos arquivos tocados por T33, mais os 3 esperados da
assinatura nova em `tests/fifo` (`Expected 3-4 arguments, but got 5`), que somem com T33b. A
correção não entrou aqui por estar fora do escopo. Registrada no backlog como achado.

## 2026-10-20 — Leitura sem baixa e confirmação da venda (T33b)

**Contexto.** Implementação do contrato que T33 fixou nos testes. `validarSaidaFifo` ganhou o
modo `AVALIAR | EFETIVAR` e a lista `noCarrinho`; `POST /saidas/ler` e a revalidação de
`POST /excecao-vencido/corrigir` passam a avaliar sem baixar; `POST /saidas/finalizar` é a
venda. Os 49 casos vermelhos de T33 passaram sem que nenhum fosse editado. Suíte inteira em 517
de 517.

**Decisões do arquivo da tarefa:**

1. **O carrinho não existe no servidor.** Nenhuma tabela, nenhuma reserva, nenhum timeout (PRD
   6.2). Carrinho abandonado não deixa nada a limpar, e duas atendentes podem liberar o mesmo
   frasco: vende quem confirmar primeiro, e a outra recebe `UNIDADE_JA_BAIXADA` naquele item.
2. **Desistência não grava evento.** Uma leitura `CONFIRMAR` sem `SAIDA_CONFIRMADA` posterior
   da mesma unidade já é a desistência, derivável do log. Como contá-la sem inflar está em
   `docs/notas-para-artigo.md`.
3. **O override de venda vencida continua imediato, fora do carrinho.** Ele já é uma
   confirmação explícita: exige GESTOR, exige justificativa, e a tela de T12 passa pelo diálogo
   de T39 antes de chamá-lo. Pôr a unidade no carrinho exigiria levar justificativa e
   autorizador até `/saidas/finalizar`, e um carrinho com itens de dois regimes (um que
   revalida FIFO, outro que por definição não passa por ele). A alternativa foi descartada.
   **Efeito sobre T11:** nenhuma mudança de comportamento no override. **Efeito sobre T34:** a
   tela precisa deixar claro que o override vende na hora, enquanto o resto do carrinho espera
   a confirmação.
4. **`tentativasAteAcerto`** segue a regra fixada em T33 (item 5 daquela entrada), e quem a
   faz valer é a ordem da fila (item 6 abaixo).

**Decisões tomadas na implementação:**

5. **As opções são obrigatórias, sem modo padrão.** `sessaoVendaId` passou de opcional para
   `string | null`, porque um parâmetro obrigatório não pode vir depois de um opcional. Sem
   padrão, todo chamador diz se está lendo ou vendendo, e nenhum chamador novo vende por
   omissão.
6. **A fila da confirmação é ordenada por `dataValidade` crescente, com desempate por
   `codigoQr`, e isso não viola a RNF03.** Ordenar não decide veredito: cada item continua
   recebendo o veredito de `validarSaidaFifo`, sob o lock da própria unidade. A ordem só faz a
   pergunta na sequência em que o FIFO a responderia, e com isso a de fevereiro não é barrada
   pela de janeiro do mesmo carrinho. A consulta que ordena é feita sem lock, e é a mesma que
   traduz ids em códigos. Uma validade corrigida entre essa consulta e o item pode, no máximo,
   mudar a sequência, nunca o veredito.
7. **Uma transação por item, sem tudo-ou-nada.** Um item barrado não desfaz os outros (mesma
   semântica de "cada item é um ciclo independente" da 6.2). Uma transação para o carrinho
   inteiro seguraria o lock de todas as unidades até a última, que é a espera que a 6.2 evita.
   A consequência para a tela (T34) é que a resposta pode ser parcial, e ela precisa mostrar o
   veredito de cada item.
8. **`montarRespostaDeLeitura` recebe o modo, e ele só muda a mensagem de `CONFIRMAR`.** Na
   leitura e na revalidação: "Pode ser vendida: …". Na confirmação: "Venda registrada: …". Os
   outros ramos têm a mesma mensagem nos dois modos. O tipo da resposta não mudou.
9. **O schema de `noCarrinho` mora em `saida.routes.ts`** (`listaNoCarrinho`, com o teto
   `MAXIMO_ITENS_DO_CARRINHO = 50`) e a rota da correção o importa, para que as duas listas não
   divirjam. Repetição em `noCarrinho` é aceita (não muda o resultado); em `unidadeIds`, é
   recusada, como fixou T33.
10. **O frontend não mudou, e a T34 precisa vir em seguida.** O arquivo da tarefa oferecia
    trocar só o título da tela de leitura. Não troquei: com T33b sozinha, a tela de leitura
    **não vende nada**, porque nenhuma tela chama `/saidas/finalizar`, e corrigir o título não
    resolve isso. **T33b não pode ir para produção sem T34.** O mesmo vale para a fila de
    descarte pendente (T13): a correção que revalida como `CONFIRMAR` agora devolve a unidade
    ao estoque em vez de vendê-la, o que é o comportamento certo no painel do gestor (não há
    cliente no balcão). Mas os comentários de `TelaDescartesPendentes.tsx` e de
    `services/excecaoVencido.ts` ainda dizem que ela "foi vendida", e corrigi-los fica para
    T34.

## 2026-10-20 — Carrinho na tela de venda (T34)

**Contexto.** Fecha o incremento 10 do lado da tela. Desde T33b, ler valida sem baixar e a venda
é `POST /saidas/finalizar`, mas nenhuma tela a chamava: a leitura dizia "Saída registrada" para
uma unidade que continuava no estoque. A tela de leitura vira a tela de **Venda**, com carrinho.
Backend não mudou.

**Decisões anteriores revistas** (alerta do incremento 10, nenhuma bloqueia):

- **T10, "um veredito vale um instante"**: continua valendo para o veredito em tela, que a queda
  de conexão apaga. **Não vale para o carrinho**, que fica (decisão 2 abaixo).
- **T10, nome da tela**: "Leitura de QR" vira "Venda", e o componente `TelaLeituraQr` vira
  `TelaVenda` (renomeado com `git mv`, histórico preservado).
- **T10, "Encerrar atendimento" sempre visível**: passa a aparecer só com o carrinho vazio
  (decisão 5).

**Decisões do arquivo da tarefa:**

1. **O carrinho vive na memória da tela.** Recarregar a página o perde, e nada fica pendente no
   servidor, que não sabe do carrinho (T33b, decisão 1). `sessionStorage` continua sendo a
   alternativa, se a perda incomodar no uso.
2. **A queda de conexão não apaga o carrinho.** O carrinho não afirma nada sobre o estoque de
   agora: a confirmação revalida cada item sob lock antes de baixar. O portão de offline (RNF07)
   substitui a leitura como antes, e o carrinho aparece abaixo dele com **Confirmar venda**
   desabilitado. Remover e esvaziar continuam disponíveis offline, porque não vão ao servidor.
3. **Rota: `/leitura` vira `/venda`, com redirecionamento.** Favorito, PWA instalado e os
   roteiros de teste continuam abrindo a tela certa. O nome novo também evita a ambiguidade com a
   consulta de T32, que também lê QR. O redirecionamento mora numa tabela `REDIRECIONAMENTOS` do
   `App`, dentro do ramo autenticado (sem sessão, tudo leva ao login, e o retorno pós-login
   passa pelo redirecionamento).

**Decisões tomadas na implementação:**

4. **Item repetido: duas camadas, nenhuma é veredito.** Antes de chamar o servidor, a tela
   compara o texto lido com os códigos do carrinho, e o repetido vira o aviso "já está no
   carrinho", sem leitura no log. A comparação é do texto como veio, sem normalizar, porque o
   dono do formato do código é o servidor (T08). A variação de digitação que passar (`prf-…`
   minúsculo) chega ao servidor, volta `CONFIRMAR` com o mesmo id, e a tela mostra o mesmo aviso
   em vez de duplicar. Comparar identidade não é comparar validade, status ou ordem (RNF04).
5. **"Encerrar atendimento" só com o carrinho vazio.** Com itens, o atendimento termina pela
   confirmação (que troca o agrupador quando esvazia o carrinho) ou pelo esvaziamento. Encerrar
   com itens deixaria o carrinho de um cliente no atendimento do próximo. **Esvaziar não troca o
   agrupador**: pode ser o mesmo cliente recomeçando, e o arquivo da tarefa só pede que esvaziar
   não venda.
6. **Unidade vencida na confirmação: o painel abre na área de resultado, não dentro do item.** O
   `PainelExcecaoVencido` tem `id`s fixos nos campos (`validade-corrigida`, `motivo-descarte`), e
   dois painéis na tela (o da leitura e o de um item) duplicariam os ids e quebrariam os rótulos.
   O primeiro item vencido abre sozinho; os outros têm "Ver o que fazer com esta unidade" no
   próprio item. Os desfechos conciliam o carrinho pelo id: descarte, override e "outra pessoa já
   resolveu" tiram a unidade do carrinho; correção que revalida `CONFIRMAR` limpa a pendência;
   outro veredito vira a pendência nova.
7. **A correção de validade leva `noCarrinho`**, pela mesma razão da leitura (T33, item 7).
   O parâmetro é opcional no `PainelExcecaoVencido` e em `corrigirValidade`: a fila de descarte
   (T13) não tem carrinho e o omite.
8. **O override é avisado duas vezes como fora do carrinho:** no formulário, antes de autorizar
   ("A venda é registrada na hora, fora do carrinho."), e no resultado ("Esta venda já foi
   registrada e não faz parte do carrinho."). É o que T33b, decisão 3, pediu a esta tarefa.
9. **Teto de 50 espelhado na tela** (`MAXIMO_ITENS_DO_CARRINHO` em `services/saidas.ts`). Com 50
   itens, a tela não lê o 51º e pede para confirmar antes. Sem isso, a leitura passaria (o teto de
   `noCarrinho` é 50) e a confirmação de 51 voltaria 400 com a mensagem genérica de corpo
   inválido. Mesmo estatuto dos limites de texto de T12: conveniência, e quem recusa é o servidor.
10. **Durante a confirmação, a leitura não parte e a câmera desliga.** A tela concilia a resposta
    com o carrinho que foi enviado, e um item lido nesse meio tempo sumiria da conciliação.
11. **A confirmação usa o diálogo de T39 com a lista inteira** (código e produto de cada item) e a
    quantidade. É a última chance de ver o frasco que não devia estar ali, e a venda não tem
    estorno. Remover item não pede confirmação (já previsto em T39: basta ler de novo).
12. **Comentários de T13 corrigidos** (pendência de T33b, decisão 10): em
    `TelaDescartesPendentes.tsx` e `services/excecaoVencido.ts`, a revalidação `CONFIRMAR` deixa
    de ser descrita como venda. Na fila de descarte, ela é a unidade de volta à prateleira.

**Verificação.** Frontend: 264 casos verdes (54 em `TelaVenda.test.tsx`, um novo em
`App.test.tsx` para o redirecionamento), typecheck limpo. Os avisos de `act(...)` vindos do
`PainelExcecaoVencido` já existiam antes da tarefa (16 na suíte de T31, medidos num worktree do
commit anterior). Conferência no navegador com o `playwright-cli`, como atendente, com um produto
novo (`T34-CARRINHO`) e três unidades (jan, fev, mar): as três entram no carrinho, nenhuma
barrada pela anterior; no banco, as três `EM_ESTOQUE` e sem `Saida`; remover a de março e
confirmar mostra o diálogo com as duas restantes; depois da confirmação, jan e fev `VENDIDA` com
uma `Saida` cada, mar continua `EM_ESTOQUE`. Console sem erro além dos 401 de `/auth/me` antes do
login.

## 2026-10-20 — Consulta de unidade por QR, sem registrar saída (T32)

**Contexto.** Ler o QR na tela de Venda põe a unidade no carrinho. Para só conferir um frasco
(a validade, para responder a um cliente; se ele já foi vendido), não havia caminho. A tarefa
cria `GET /unidades/consulta/:codigoQr` e a tela **Consultar produto** (`/consulta`), das duas
funções. Nenhuma decisão anterior é revista.

**Decisões do arquivo da tarefa:**

1. **A consulta não grava `EventoLog`.** `LEITURA_QR_SAIDA` é o denominador da taxa de acerto na
   primeira leitura (RF12), e contar consulta ali falsearia o indicador. Também não ganha tipo
   próprio: o log registra o que acontece com o estoque, e olhar um frasco não muda o estoque
   (mesmo argumento das etiquetas, T14, e do catálogo, T24). A suíte prova que nenhuma linha
   nova aparece, nem no acerto nem no 404. Consequência em `docs/notas-para-artigo.md`.
2. **A consulta não diz se a unidade é a próxima a sair.** Isso é veredito FIFO, preso a
   `validarSaidaFifo` pela RNF03. O serviço (`unidade/consulta.service.ts`) não chama a função,
   não trava a linha e não lê o pool. Se um dia a tela quiser mostrar a ordem, o caminho é expor
   a consulta do pool que a função usa, nunca reescrevê-la.
3. **Câmera contínua** (modo `'continua'` de T31): nada é gravado, e ler o frasco seguinte sem
   tocar na tela é o comportamento desejado.

**Decisões tomadas na implementação:**

4. **Código inexistente é 404 `QR_NAO_ENCONTRADO`, não veredito em 200** como em `/saidas/ler`.
   Lá, 200 existe para a tela escolher layout pelo veredito, e não pelo status (RNF04); aqui não
   há veredito. O corpo segue o formato de erro da seção 5.1, com a mesma mensagem da leitura de
   saída.
5. **Rota em `/unidades/...`, não em `/produtos/:id/...`.** Quem consulta tem o código, não o
   produto. O schema aceita de 1 a 64 caracteres, o mesmo `MAXIMO_CODIGO` de `/saidas/ler`
   (agora exportado de `saida.routes.ts`), sem `pattern`: o código digitado à mão é normalizado
   por `codigoQr.ts`, como na leitura.
6. **`situacao` é calculada também para unidade vendida ou descartada.** Ela fala da validade, e
   o `status` diz se o frasco ainda está na loja. A borda é a do FIFO, da varredura e da fila de
   descarte: o que vence hoje é `NO_PRAZO`, com `diasParaVencer` 0. A tela mostra o destaque de
   vencida pelo `situacao` também numa unidade já vendida. Se isso confundir no uso, a
   alternativa é a tela atenuar o destaque quando `status` não for `EM_ESTOQUE`, o que é escolha
   de exibição e não veredito.
7. **A resposta estende `UnidadeNaResposta`** com `status`, `dataEntrada`, `produto.categoria` e
   `produto.ativo`, montando a base com `comProdutoJaLido`. Não alterei a forma comum: ela é a de
   toda resposta do fluxo de saída, que não precisa desses campos.
8. **Portão de offline extraído da tela de Venda** para `hooks/useConexao.ts` e
   `components/PortaoOffline.tsx`. O texto que explica o bloqueio vem de cada tela (`children`),
   porque o que cada uma não consegue fazer offline é diferente. Comportamento da Venda
   inalterado (suíte dela verde sem mudança).
9. **O que a câmera contínua ignora:** o código cujo resultado está na tela, inclusive o que
   voltou 404 (senão o frasco parado na frente da câmera viraria uma rajada de 404), e qualquer
   quadro enquanto uma consulta está no ar (descartado, não enfileirado: a câmera continua vendo
   o frasco e entrega de novo). Digitar consulta de novo mesmo o código da tela, e religar a
   câmera também, porque os dois são atos deliberados.
10. **Digitar não desliga a câmera**, ao contrário da Venda (T31): lá, um frasco que passasse na
    frente da câmera ia para o carrinho; aqui, só troca o cartão. O campo é limpo só no acerto:
    no 404, o código continua lá para a correção do erro de digitação.
11. **Destaque de vencida com as classes que já existem**: `resultado-vencido` no cartão (a cor
    da unidade vencida no balcão e na fila de descarte) e `.erro` na linha "Vencida há N dias". O
    destaque definitivo é de T38.

**Verificação.** Backend: 13 casos novos em `tests/consulta/consultaUnidade.test.ts` (em
estoque, vence hoje, vencida, vendida, descartada, produto inativo, normalização, gestor, 404,
400 de comprimento, 401, nenhum `EventoLog`, nenhuma escrita na unidade), 530 no total, typecheck
limpo. `curl` no servidor local com as quatro situações do banco de desenvolvimento, código em
caixa baixa e código inexistente; `EventoLog` com 65 linhas antes e depois. Frontend: 18 casos
em `TelaConsulta.test.tsx` e um em `App.test.tsx`, 283 no total, typecheck limpo. Conferência no
navegador com o `playwright-cli`, como atendente, pela entrada manual: unidade vencida com
destaque, unidade vendida, código inexistente substituindo o cartão anterior, e
`network-state-set offline` levando ao portão e apagando o cartão ao reconectar. Console sem
erro além do 404 esperado do código inexistente.
