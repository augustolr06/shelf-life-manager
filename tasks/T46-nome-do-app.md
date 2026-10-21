# T46 — Nome do app: ShelfLife Manager

**Depende de:** T41 (navegação por tarefa, onde a marca passou para o menu lateral)
**Incremento:** 12 (Redesign — proposta do Claude Design)
**Bloqueia:** nada

**Fonte de verdade:** `docs/redesign/claude-design/README.md`, decisão 7. Mockups com o nome
novo em `docs/redesign/claude-design/telas/` (`inicio.html` e `catalogo.html`, na marca do menu).

## Objetivo

O app aparece hoje como "Controle de Estoque FIFO por Validade" (nome longo) e "Estoque FIFO"
(nome curto). O nome escolhido pelo orientando é **ShelfLife Manager**. Esta tarefa troca o
nome em todo lugar onde ele é mostrado como nome do app.

## Escopo

Levantamento feito em 2026-10-21; conferir com uma busca por `Estoque FIFO` e
`Controle de Estoque` antes de começar, porque T45 pode ter tocado em algum destes arquivos.

1. **Marca do menu** (`frontend/src/components/Navegacao.tsx`, `.marca-nome`): "Estoque
   FIFO" → "ShelfLife Manager". O lema "Primeiro que vence, primeiro que sai" continua.
   Conferir que o nome cabe em uma linha no menu lateral de 232 px, e como fica no menu
   recolhido do tablet e na folha "Mais" do celular.
2. **Tela de login** (`frontend/src/pages/TelaLogin.tsx`): o `<h1>` passa a "ShelfLife
   Manager". Logo abaixo, uma linha de apoio diz o que o sistema é ("Controle de estoque por
   validade"), para quem abre o app pela primeira vez.
3. **Título da aba** (`frontend/index.html`, `<title>`): "ShelfLife Manager". Se as telas
   definem título próprio, o padrão passa a ser "{tela} — ShelfLife Manager".
4. **Manifest do PWA** (`frontend/vite.config.ts`):
   - `name`: "ShelfLife Manager";
   - `short_name`: "ShelfLife" (o nome que aparece embaixo do ícone na tela inicial do celular;
     a recomendação é até ~12 caracteres, e "ShelfLife Manager" tem 17 e seria cortado);
   - `description`: mantém o texto descritivo atual.
5. **iOS** (`frontend/index.html`): `<meta name="apple-mobile-web-app-title"
   content="ShelfLife">`, porque o Safari não usa o `short_name` do manifest ao adicionar à
   tela de início.
6. **Documentação:** o título de `README.md` e o de `CLAUDE.md` passam a "ShelfLife Manager —
   Controle de Estoque FIFO por Validade" (o nome e, depois do travessão, o que o sistema é,
   que é como o artigo descreve o trabalho).
7. **Testes:** atualizar os que procuram o nome antigo por texto (na busca de 2026-10-21, nenhum
   procurava; conferir de novo).

## Decisões a registrar em `docs/decisoes.md`

- O nome do app passa a ShelfLife Manager (decisão do orientando), com `short_name`
  "ShelfLife". As entradas antigas do log que citam "Estoque FIFO" **não** são editadas (regra
  do próprio arquivo).

## Critério de aceite

- [ ] Nenhuma ocorrência de "Estoque FIFO" ou "Controle de Estoque FIFO por Validade" como nome
      do app em `frontend/` (fora de comentários históricos), conferida por busca
- [ ] Manifest gerado no build (`dist/manifest.webmanifest`) com `name` e `short_name` novos
- [ ] Testes de Vitest verdes; `npm run typecheck` limpo
- [ ] `playwright-cli` a 1280×900 e 360×740: login, menu lateral e folha "Mais", e o título da
      aba; capturas em `docs/redesign/T46/`
- [ ] Verificação manual anotada no backlog: no celular com o PWA já instalado, o nome novo só
      aparece depois que o navegador atualiza o manifest (Android, em geral em até um dia com o
      app aberto) ou depois de reinstalar (iOS)

## Fora de escopo

- Nome do repositório, nomes de pacote (`estoque-fifo-frontend`), variáveis e identificadores
  no código.
- E-mails das contas (`@estoque.local`) e o contato VAPID (`mailto:estoque@exemplo.local`):
  não são mostrados como nome do app, e as contas de produção dependem desses e-mails.
- Ícone do PWA (os três frascos continuam).
- Entradas antigas de `docs/decisoes.md`, `docs/notas-para-artigo.md` e dos arquivos de tarefa.
- Domínio da Vercel (`shelf-life-manager.vercel.app` já tem o nome).
