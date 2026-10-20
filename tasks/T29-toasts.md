# T29 — Mensagens de sucesso e erro de ação em toasts

**Depende de:** nada pendente
**Incremento:** 9 (Ajustes de uso em formulários e listas)
**Bloqueia:** T35 (o redesign estiliza os toasts junto com o resto)

## Objetivo

Cada tela tem seu próprio `<p className="erro" role="alert">` e, às vezes, um parágrafo de
sucesso, posicionados onde couberam. O resultado: a mensagem aparece longe do que o usuário
acabou de clicar (no celular, fora da tela), fica parada depois de perder o sentido, e cada
tela resolve isso de um jeito.

As mensagens **de resultado de ação** passam a ser toasts, num só lugar e com o mesmo
comportamento em todas as telas.

## O que vira toast e o que não vira

Este é o centro da tarefa — nem toda mensagem é resultado de ação.

| Vira toast | Continua no lugar |
|---|---|
| Sucesso de ação: produto cadastrado, inativado/reativado, unidades registradas, alerta marcado como lido, conta criada, senha trocada, janela de alerta salva | **Veredito da leitura de QR** (`CONFIRMAR`, `BLOQUEAR_FIFO`, `EXCECAO_VENCIDO`, `ERRO`). É o conteúdo principal da tela e a RNF04 manda exibi-lo como o servidor escreveu — um toast que some sozinho esconderia o código da unidade correta |
| Erro de ação que não pertence a um campo: falha de rede ao inativar, 409 ao trocar papel de conta, 500 | Erro de campo de formulário (T25) — fica junto ao campo |
| | Lista de erros da planilha recusada (T24) — é longa e precisa ficar para a gestora corrigir |
| | Portão de offline (RNF07), estados de carregando e de lista vazia |
| | Falha ao **carregar** a tela (a lista não veio): é estado da tela, com "tentar de novo" |
| | Sessão expirada — é T30, em modal |

## Decisões que esta tarefa toma (registrar em `docs/decisoes.md`)

1. **Biblioteca:** recomendação `sonner` — pequena, sem dependências, compatível com React 19,
   `role="status"`/`aria-live` corretos e fácil de estilizar com as classes do projeto. A
   alternativa `react-hot-toast` também serve; a escolha e o motivo vão para o registro.
2. **Duração:** sucesso some sozinho (~4 s); erro fica até ser fechado, porque o usuário
   precisa ler o que deu errado.
3. **Um ponto de chamada.** As telas chamam `avisar.sucesso(msg)` / `avisar.erro(falha)` de um
   módulo `frontend/src/services/avisos.ts`, que embrulha a biblioteca. Trocar de biblioteca
   depois mexe num arquivo só, e os testes podem substituir esse módulo.
4. **O texto continua sendo o do servidor** quando há um (`ErroApi.message`), como hoje.

## Critério de aceite

- [ ] Biblioteca instalada e `<Toaster />` montado uma vez em `App.tsx`
- [ ] `services/avisos.ts` com `sucesso` e `erro` (este aceita `unknown` e extrai a mensagem
      de `ErroApi`, com texto padrão para o resto)
- [ ] Todas as mensagens da coluna esquerda migradas; as da direita intactas
- [ ] Toasts posicionados de modo a não cobrir a área de resultado da leitura nem a barra de
      navegação no celular
- [ ] Testes de componente das telas afetadas atualizados (o texto do toast continua
      encontrável por `findByText`/`findByRole('status')`)
- [ ] Conferência no navegador com o `playwright-cli`: um sucesso e um erro, em uma tela

## Fora de escopo

- Confirmações antes de ação destrutiva ("tem certeza?") — T39.
- Estilo final dos toasts — T35 aplica os tokens do redesign.
