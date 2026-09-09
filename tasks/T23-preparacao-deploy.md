# T23 — Endurecimento e preparação de deploy

**Depende de:** T22 para a tarefa completa (não faz sentido publicar um sistema cuja única
credencial é a do seed). A **fatia 3** abaixo foi antecipada e já está feita, justamente
porque ela é o que torna um deploy de teste possível sem T22
**Incremento:** 7 (Preparação para produção)
**Bloqueia:** o deploy do piloto, e por consequência as quatro verificações manuais que
exigem HTTPS (câmera em aparelho real, push, PWA offline instalado, e o teste de leitura
física de T16 em condição de uso)

## Objetivo

Levar o sistema de "roda na máquina do desenvolvedor" para "roda num endereço público, com
dois usuários reais, sem que nada silenciosamente deixe de funcionar".

A palavra que organiza esta tarefa é **silenciosamente**. Nenhum dos itens abaixo produz erro
de compilação, falha de teste ou exceção em log: o cookie recusado pelo navegador aparece
como "não consigo entrar", a rota sem rewrite aparece como página da hospedagem, o agendador
que não dispara aparece como um alerta que ninguém recebeu. São falhas que só se manifestam
no ambiente que nenhum teste deste projeto simula — o navegador de verdade, contra dois hosts
de verdade.

## Critério de aceite

### Fatia 1 — Segurança de borda (concluída em 2026-09-09)

- [x] `@fastify/rate-limit` registrado com `global: false`, e o limite declarado **só** em
      `POST /auth/login`: 10 tentativas por minuto, por IP. Um limite global travaria a
      rajada de leituras de QR do balcão, que é o oposto da prioridade da loja
- [x] `@fastify/helmet` registrado em `buildApp()`, com `contentSecurityPolicy` e
      `crossOriginResourcePolicy` desligados — esta API só responde JSON e é consumida de
      outro host, e o padrão `same-origin` do segundo recusaria no navegador exatamente o
      acesso que ela existe para servir
- [x] O corpo do 429 é montado pelo `tratarErro` de T12b, não pelo `errorResponseBuilder` do
      plugin. O plugin **lança** o erro, então ele cai no handler de qualquer forma:
      formatar dos dois lados foi o que fez a primeira versão responder 500
- [x] `tests/limiteDeLogin.test.ts` — 9 asserções, sem banco: o limite permite as dez, recusa
      a décima primeira com 429 no formato `{ erro, mensagem }`, conta também as tentativas
      bem-sucedidas, **não** alcança `/saidas/ler` nem `/health` em rajada de trinta, e os
      cabeçalhos do helmet saem com `nosniff` e sem CSP nem CORP

### Fatia 2 — Relógio da RF08 fora do processo (pendente, e só se o alvo for serverless)

- [ ] **Decidir o alvo de hospedagem e registrar em `docs/decisoes.md`.** Em servidor com
      processo persistente, `modules/alerta/agendador.ts` continua valendo como está e esta
      fatia inteira é descartada. Em serverless não existe processo entre requisições: o
      `setInterval` nunca dispara e a RF08 para de funcionar sem emitir erro
- [ ] Se serverless: rota interna protegida por segredo compartilhado, chamada por cron da
      plataforma, mais a supressão da varredura de inicialização (que rodaria a cada cold
      start). A função varrida tem de continuar sendo a mesma (RNF03 aplicado ao job)
- [ ] Contorno já disponível enquanto isso não existe: `npm run alertas:varrer` apontando
      `DATABASE_URL` para o banco de produção. O CLI existe desde T18 exatamente para isso

### Fatia 3 — Configuração de produção (concluída em 2026-09-09)

- [x] **Cookie de sessão cross-site** — `modules/auth/cookie.ts` passa a emitir
      `SameSite=None` + `Secure` quando `NODE_ENV=production`, e mantém `'lax'` fora dela.
      Com hosts distintos para frontend e API, `'lax'` faz o navegador descartar o cookie na
      resposta do login e toda rota protegida responder 401
- [x] `tests/cookieDeSessao.test.ts` — cobre os dois ramos e, principalmente, a invariante
      "nunca `None` sem `Secure`", que é a combinação que o navegador recusa
- [x] **Rewrite de SPA** — `frontend/vercel.json` reescreve qualquer caminho para
      `index.html`. Desde T10 cada tela tem URL própria (`BrowserRouter`), e sem isso abrir
      ou recarregar `/leitura` direto devolve 404 da hospedagem. O `navigateFallback` do
      `vite-plugin-pwa` **não** cobre esse caso: ele só age depois que o service worker
      instalou, e a primeira visita é anterior a isso
- [x] **`directUrl` no datasource** — a aplicação fala pelo pooler, a migração pela conexão
      direta. Pooler em modo transaction não sustenta o advisory lock do `prisma migrate`
- [x] **`postinstall: prisma generate`** — a hospedagem reaproveita `node_modules` em cache,
      e sem isso o Prisma Client sai desatualizado em relação ao schema
- [x] **Troca de senha fora do seed** — `npm run usuario:senha -- <email>`, senha lida do
      stdin. A regra (`definirSenha`) mora em `auth.service.ts` e é testada; o `.cli.ts` é só
      a casca
- [x] `tests/definirSenha.test.ts` — grava hash e nunca senha em claro, o hash autentica a
      senha nova, recusa a senha do seed por tamanho, recusa a conta de sistema, recusa
      e-mail inexistente

### Fatia 4 — Operação (pendente)

- [ ] `docs/deploy.md`: roteiro de subida, variáveis de ambiente, e **restauração de backup**
- [ ] Rotina de `pg_dump`. O `EventoLog` é append-only e é a base do indicador do TCC (RF12):
      perdê-lo é perder o material do artigo, não só o estado da aplicação
- [ ] Decidir o que fazer com `logger: true` (hoje registra corpo de toda requisição)

## Notas técnicas

**Por que `definirSenha` é script e não rota.** A gestão de usuário pela interface é T22.
Até lá, a alternativa a um script seria uma rota de troca de senha — superfície nova na API,
autenticada, que precisaria de sua própria autorização e seus próprios testes, e que T22 vai
substituir. O script é operado por quem já tem acesso ao banco: não amplia o que essa pessoa
podia fazer.

**Por que o piso de senha é 12.** A senha do seed tem dez caracteres. Um piso de oito
deixaria passar exatamente aquilo de que o script existe para sair.

**O custo do bcrypt saiu para `modules/auth/hashDeSenha.ts`.** Estava declarado em dois
lugares com um comentário em cada pedindo que não divergissem; o script seria o terceiro.
Divergência aqui não falha: `bcrypt.compare` lê o custo de dentro do hash e confere
normalmente — o efeito é senha antiga mais fraca do que se imagina, sem sintoma.

**O limite é por IP, e a loja inteira tem um.** Contar por e-mail deixaria a varredura livre
trocando o alvo a cada tentativa, então por IP é o certo — mas as duas contas dividem a cota,
e é por isso que o número é dez, e não três: precisa caber o erro de digitação de duas pessoas
no mesmo minuto sem trancar o balcão. Quem protege a senha de verdade é o piso de 12
caracteres somado ao custo do bcrypt; este limite existe para inviabilizar varredura
automatizada.

**O contador vive na memória do processo.** Em servidor único é exato. Se a fatia 2 escolher
serverless, cada instância passa a ter o seu e o teto efetivo vira o número de instâncias
vezes dez — continua sendo freio, deixa de ser teto.

**O rewrite não engole os arquivos estáticos.** Na Vercel, `rewrites` só age quando nenhum
arquivo do build casou com o caminho, então `sw.js`, o manifest e os assets continuam sendo
servidos. É o que permite a regra `/(.*)` ser tão larga sem quebrar o PWA.

## Fora de escopo desta tarefa

- **CRUD de usuário e troca de senha pela interface** — T22. Este script não é uma versão
  pequena de T22; é o que permite não precisar dela para um piloto de dois usuários
- **O deploy em si** (criar projeto, apontar domínio, subir variáveis) — é operação, não
  código, e o roteiro fica em `docs/deploy.md` (fatia 4)
- **Migrar a aplicação para outra hospedagem**, se a decisão da fatia 2 for essa. Aqui só se
  registra a decisão e se adapta o relógio da RF08
- **Qualquer mudança em `validarSaidaFifo`, no schema ou nas regras de negócio.** Nada nesta
  tarefa toca o núcleo — se tocar, é sinal de que a tarefa foi mal delimitada
