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
