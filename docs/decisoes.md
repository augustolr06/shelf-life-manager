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

**JWT implementado com `@fastify/jwt`; CORS com `@fastify/cors`.** `docs/arquitetura.md` seção 1 fixa "JWT em cookie httpOnly + bcrypt" como mecanismo, sem nomear biblioteca. `@fastify/jwt` foi escolhido por ler o token direto do cookie (opção `cookie.cookieName`) e por expor `request.jwtVerify()` como preHandler, dispensando código de extração manual de header/cookie. Justificativa: menos superfície própria para errar num ponto de segurança, e integração nativa com o ciclo de vida do Fastify. Consequência: `@fastify/cookie` precisa ser registrado antes de `@fastify/jwt`, e essa ordem está comentada em `src/app.ts`.

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
