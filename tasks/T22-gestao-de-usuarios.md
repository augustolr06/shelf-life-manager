# T22 — Cadastro e gestão de usuários pelo GESTOR (RF01)

**Depende de:** T03b (sessão e tela de login) e T04 (o padrão de tela de gestão com lista e
formulário). O modelo `Usuario` existe desde T02
**Incremento:** 7 (Preparação para produção)
**Bloqueia:** nada em código. Destrava a operação **em regime**: enquanto ela não existe, a
loja depende de alguém com acesso ao banco para toda mudança de pessoal

## Objetivo

Tirar do desenvolvedor a única coisa que ainda passa por ele para a loja funcionar: **quem
pode entrar no sistema**.

Hoje as contas nascem do `seed.ts`, e o script de T23 (`npm run usuario:senha`) só troca
senha de quem já existe. Contratar uma atendente exige `INSERT` no banco; desligar uma exige
`UPDATE`; esquecer a senha exige alguém no terminal. Nada disso é aceitável num sistema que
substitui uma planilha — a dona da loja não tem desenvolvedor de plantão, e o processo manual
que este sistema substitui nunca precisou de um para admitir alguém.

A RF01 foi lida em T03 como "autenticar". Esta tarefa entrega a outra metade: **administrar
quem autentica**.

## Decisões que esta tarefa toma (registrar em `docs/decisoes.md`)

1. **`Usuario` ganha `ativo`, e usuário nunca é excluído.** Mesmo argumento de `Produto`
   (`docs/decisoes.md`, 2026-09-07) e mais forte aqui: `EventoLog`, `Saida`, `Descarte` e
   `UnidadeProduto` todos apontam para `Usuario`, e um deles com `onDelete: Restrict`
   explícito (o autorizador de override). Excluir quem operou apagaria a autoria do dado de
   pesquisa — e o banco recusaria de qualquer forma. Exige migração.
2. **Usuário inativo não autentica.** Sem isso a coluna seria decoração: a atendente
   desligada continuaria entrando. `autenticarCredenciais` passa a exigir `ativo`.
3. **O GESTOR não pode se desativar nem se rebaixar.** O último gestor a fazer isso tranca a
   loja inteira para fora da gestão, sem caminho de volta pela interface.
4. **A conta de sistema não aparece e não é editável.** `sistema@estoque.local` assina os
   eventos da varredura (T18) e não é uma pessoa; listá-la entre as contas da loja convida
   alguém a "consertar" o hash que existe justamente para ela nunca autenticar.
5. **Sem novo tipo de `EventoLog`.** Mesmo precedente da Decisão 6 de T17, que recusou um
   décimo tipo para mudança de configuração: o `EventoLog` registra o que acontece com o
   **estoque**, que é o objeto da pesquisa, não a administração do sistema.
6. **O piso de 12 caracteres é o mesmo de T23** (`TAMANHO_MINIMO_DE_SENHA`), reusado, não
   recopiado.

## Critério de aceite

### Backend — migração

- [x] `Usuario.ativo Boolean @default(true)`, com migração nomeada. Contas existentes entram
      ativas

### Backend — `modules/usuario/`

- [x] `usuarioNaResposta.ts`: a projeção que **nunca** carrega `senhaHash`, no padrão de
      `unidade/unidadeNaResposta.ts`. Nenhuma rota devolve `Usuario` do Prisma cru
- [x] `GET /usuarios`, papel `GESTOR`: lista, sem a conta de sistema, ordenada por nome.
      Inativos fora por padrão, `incluirInativos` os traz
- [x] `POST /usuarios`, papel `GESTOR`: cria com `{ nome, email, papel, senha }`. E-mail
      normalizado (minúsculas, sem espaço nas pontas); colisão responde 409
- [x] `PATCH /usuarios/:id`, papel `GESTOR`: `{ nome?, papel?, ativo? }`. Recusa mudar o
      próprio `papel` ou o próprio `ativo` (Decisão 3), e qualquer escrita na conta de
      sistema (Decisão 4)
- [x] `PATCH /usuarios/:id/senha`, papel `GESTOR`: redefine a senha de outra pessoa **sem**
      exigir a senha atual. É o caminho de recuperação que hoje não existe
- [x] `PATCH /usuarios/eu/senha`, qualquer autenticado: troca a própria senha exigindo a
      atual. Senha atual errada responde 401, não 400 — é falha de credencial
- [x] `autenticarCredenciais` recusa usuário inativo, sem distinguir isso de senha errada na
      resposta (a mesma discrição que T03 já tem entre "e-mail não existe" e "senha errada")

### Backend — testes (arquivo solto em `tests/`, sem banco)

- [x] Autorização: ATENDENTE recebe 403 em todas as rotas de gestão, e 200 na própria senha
- [x] A senha nunca aparece em resposta alguma, em nenhuma das rotas
- [x] Auto-proteção: gestor não se desativa, não se rebaixa, e não escreve na conta de sistema
- [x] Inativo não autentica
- [x] Troca da própria senha: exige a atual, recusa a errada, aplica a nova

### Frontend

- [x] `/usuarios` (GESTOR): lista, criação, edição de nome e papel, ativar/desativar, e
      redefinir senha. Mesmo padrão visual de `TelaProdutos`
- [x] `/minha-senha` (ATENDENTE e GESTOR): troca da própria senha
- [x] As duas entram em `TELAS` no `App.tsx`, com `papeis` espelhando o backend
- [x] O frontend não decide nada sobre permissão além de qual link mostrar (RNF04): quem
      recusa é o backend, e a tela exibe a mensagem que veio
- [x] Testes de componente em Vitest + Testing Library, e conferência no navegador com o
      `playwright-cli` (é alteração de UI)

### Fechamento

- [x] `docs/deploy.md` — as seções 2 e 9 mentem depois desta tarefa: passa a existir cadastro
      pela interface e recuperação de senha
- [x] `docs/decisoes.md` com as seis decisões acima; `README.md` com as telas novas

## Achados durante a implementação

**Um defeito de T23 apareceu aqui, e não era de T22.** A primeira migração criada depois que
o `directUrl` entrou no datasource revelou que `tests/apoio/bancoDeTeste.ts` sobrescrevia
apenas `DATABASE_URL` ao rodar `prisma migrate deploy` — e o `prisma migrate` usa o
`directUrl`. Com o `DIRECT_URL` do `.env` vazando do `process.env`, **a suíte migrava o banco
de desenvolvimento** em vez do de teste, furando a trava que aquele módulo inteiro existe
para manter. O sintoma foi a suíte falhando com "a coluna `ativo` não existe": a migração
tinha sido aplicada, só que no banco errado. Corrigido passando as duas variáveis.

**`format: 'email'` recusava o espaço colado.** O e-mail é digitado no celular, e o
autocompletar acrescenta espaço ao fim — o schema recusava antes de o serviço poder aparar, e
a recusa saía como `CORPO_INVALIDO` genérico, exatamente a experiência que T12b existe para
evitar. A aparagem virou `preValidation` na rota: o formato continua validado, mas sobre o
valor já aparado. Conferido no navegador com `"  Conferencia@Loja.COM "`, que entrou como
`conferencia@loja.com`.

**O piso de senha tinha dois donos.** Começou declarado no schema (`minLength`) e no serviço.
Ficou só no serviço: no schema, a recusa sairia como `CORPO_INVALIDO` em vez de dizer quantos
caracteres faltam.

## Notas técnicas

**O script `usuario:senha` de T23 continua existindo.** Ele não vira redundância: é o
caminho quando ninguém consegue entrar — gestor único com senha esquecida, que pela interface
não tem saída. A rota resolve o caso comum, o script resolve o caso de emergência.

**Normalizar o e-mail é o que faz a restrição `@unique` valer.** Sem isso `Gestor@loja.com` e
`gestor@loja.com` são duas contas para o Postgres e a mesma pessoa para a loja — o mesmo
argumento do `codigoInterno` em T04.

## Fora de escopo desta tarefa

- **Perfis de permissão além dos dois papéis existentes.** `ATENDENTE` e `GESTOR` são o que o
  PRD define; inventar um terceiro é decisão de produto
- **Autenticação de dois fatores, política de expiração de senha, histórico de senhas usadas.**
  Nada disso está no PRD, e a loja tem duas pessoas
- **Recuperação de senha por e-mail.** Exigiria serviço de envio e domínio verificado; a
  redefinição pelo GESTOR cobre o caso real desta loja
- **Auditar administração de usuário no `EventoLog`** — Decisão 5
- **Tela de perfil** (trocar o próprio nome, foto, preferências). A tarefa entrega troca de
  senha, que é o que tem consequência operacional
