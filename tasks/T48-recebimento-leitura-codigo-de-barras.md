# T48 — Recebimento: escolher o produto pela leitura do código de barras

**Depende de:** T47 (modo `leitura="codigo-de-barras"` do `LeitorCamera`), T28 (seletor de produto)
**Incremento:** 13 (Cadastro assistido por código de barras)
**Bloqueia:** nada

## Objetivo

No Recebimento, a gestora escolhe hoje o produto da entrega no seletor de T28, digitando o nome
ou o código. Com a caixa da entrega na mão, ler o código de barras da embalagem é mais rápido e
não confunde dois produtos de nome quase igual. O catálogo real é dominado por tons de coloração
que só diferem no número (`docs/notas-para-artigo.md`, 2026-11-10). Esta tarefa acrescenta a
leitura pela câmera do celular como **alternativa** ao seletor, sem tirar nada dele.

Pedido do orientando em 2026-11-11, como tarefa separada e feita depois de T47.

## Escopo

### Backend

1. `GET /produtos` aceita `codigoInterno`, com igualdade exata depois da mesma normalização do
   cadastro (pontas aparadas e maiúsculas). Combina com os outros filtros, inclusive
   `incluirInativos`. Vazio não filtra. O teto é de 120 caracteres, como `busca` e `categoria`.

### Frontend

2. No Recebimento, no celular, o botão secundário "Ler código de barras" logo abaixo do seletor.
   Ele abre o `LeitorCamera` em leitura única e `leitura="codigo-de-barras"`, com "Desligar
   câmera" para fechar.
3. Lido o código, a tela pede `GET /produtos?codigoInterno=…&incluirInativos=true` e mostra o que
   o servidor devolveu:
   - **produto ativo**: vira o produto escolhido no seletor, e uma nota curta diz que foi pela
     leitura;
   - **produto inativo**: aviso de que ele está inativo e não recebe unidades, com o caminho para
     o Catálogo; nada é escolhido;
   - **nenhum produto**: aviso de que o código não está no catálogo, com o caminho para cadastrá-lo
     no Catálogo; nada é escolhido.
4. Falha da câmera vira aviso, como em T47. Falha ao falar com o servidor vira toast (T29).

## Decisões tomadas nesta tarefa

- **Filtro exato no `GET /produtos`, e não a consulta de T47.** Aquela rota consulta o catálogo
  externo quando o código não está na loja, gastando a cota diária do SI5 com uma pergunta que o
  Recebimento não faz: ele só recebe produto já cadastrado. A busca `busca` de T26 é por
  "contém" em nome e código, e acharia mais de um.
- **Câmera só no celular**, pela mesma regra de T47 (decisão do orientando): é nele que a gestora
  está com a embalagem na mão.
- **A câmera fica na tela, e não dentro do `SeletorProduto`**, que também serve às Etiquetas, onde
  ninguém pediu câmera.

## Critério de aceite

- [x] Testes de backend do filtro `codigoInterno` (exato e normalizado, combinado com inativos,
      vazio não filtra, acima de 120 recusado)
- [x] Testes de Vitest do Recebimento: botão só no celular, os três desfechos da leitura, falha da
      câmera, falha de rede, e o envio do recebimento com o produto escolhido pela leitura
- [x] `npm run typecheck` limpo no backend e no frontend
- [x] `playwright-cli` a 360×740: o botão no Recebimento e o aviso da câmera indisponível; a
      leitura em si fica para o celular real (verificação manual no backlog)
- [x] `docs/arquitetura.md` (filtro novo na tabela de rotas) e `docs/decisoes.md`

## Fora de escopo

- Câmera nas Etiquetas, ou no computador e no tablet.
- Abrir o cadastro do Catálogo com o código já preenchido a partir do aviso de "não está no
  catálogo".
- Equivalência entre UPC-A de 12 dígitos e o EAN-13 com zero à esquerda: o catálogo da loja é de
  EAN-13 brasileiros (789…), e o código lido é comparado como veio.
