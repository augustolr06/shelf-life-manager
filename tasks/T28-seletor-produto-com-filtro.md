# T28 — Seletor de produto com filtro (busca e escolha num campo só)

**Depende de:** T26 (hook `useValorComAtraso`)
**Incremento:** 9 (Ajustes de uso em formulários e listas)
**Bloqueia:** nada

## Objetivo

`TelaRecebimento` e `TelaEtiquetas` escolhem o produto em **dois** controles: um campo
"Buscar produto por nome ou código" com botão **Buscar**, e um `<select>` abaixo que lista o
resultado ("Mostrando 20 de 692 produtos. Refine a busca…"). A gestora digita num lugar e
escolhe em outro, e com o catálogo real o `<select>` vira uma lista longa e sem filtro.

Os dois viram **um** campo de seleção com filtro (combobox): digita-se, a lista abaixo filtra,
e escolhe-se um item. O valor que a tela usa é **o produto escolhido** (`id`), nunca o texto
digitado.

## Comportamento

- Digitar filtra a lista (busca no servidor, com o atraso de T26).
- Cada opção mostra nome, marca e código interno — dois produtos com o mesmo nome precisam
  ser distinguíveis.
- Escolher um item preenche o campo com o nome do produto e fecha a lista.
- Editar o texto depois de escolher **desfaz a escolha** (o botão de cadastrar/imprimir volta a
  ficar desabilitado). Não existe "produto digitado": sair do campo sem escolher deixa o
  campo sem valor.
- Teclado: setas navegam, Enter escolhe, Esc fecha. Padrão WAI-ARIA *combobox* com
  *listbox* (`role="combobox"`, `aria-expanded`, `aria-activedescendant`).
- Estados: carregando, nenhum produto encontrado, e erro de rede (com tentar de novo).
- Mais resultados que o limite da página: rodapé "Mostrando 20 de 140 — continue digitando
  para refinar", como hoje.

## Decisões que esta tarefa toma (registrar em `docs/decisoes.md`)

1. **Biblioteca ou componente próprio.** Recomendação: `downshift` (`useCombobox`) — headless,
   sem CSS próprio, acessibilidade do padrão ARIA já resolvida, e o projeto continua dono do
   visual. Escrever o combobox à mão é viável, mas a parte difícil (foco, leitores de tela,
   `aria-activedescendant`) é justamente a que não é o assunto do trabalho. Se a decisão for
   componente próprio, registrar o porquê.
2. **Só produtos ativos aparecem**, que é o filtro padrão de `GET /produtos`. O recebimento
   já é recusado pelo backend para produto inativo; mostrar e deixar falhar seria pior.
3. **Pré-seleção vinda de outra tela continua funcionando.** `TelaEtiquetas` recebe o produto
   pelo estado de rota quando chega do Recebimento (T15); o seletor precisa aceitar um valor
   inicial.

## Critério de aceite

- [ ] Componente `frontend/src/components/SeletorProduto.tsx`, com
      `{ valor: Produto | null, aoEscolher: (p: Produto | null) => void }`
- [ ] Recebimento e Etiquetas usam o seletor; o par campo + `<select>` + botão Buscar some
- [ ] Texto digitado sem escolha nunca chega a `cadastrarUnidades` nem a `listarEtiquetas`
- [ ] Testes de componente: filtrar, escolher por clique e por teclado, editar desfaz a
      escolha, estados vazio e de erro
- [ ] Testes de `TelaRecebimento.test.tsx` e `TelaEtiquetas.test.tsx` atualizados
- [ ] Conferência no navegador com o `playwright-cli` nas duas telas

## Fora de escopo

- Usar o seletor no filtro do Catálogo (ali a busca filtra a tabela, não escolhe um item — é
  T26).
- Cadastro rápido de produto a partir do seletor ("não achou? cadastre").
