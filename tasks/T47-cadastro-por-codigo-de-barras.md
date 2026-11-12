# T47 — Cadastro de produto assistido por código de barras

**Depende de:** T45 (painel "Novo produto" do Catálogo), T31 (leitura única da câmera)
**Incremento:** 13 (Cadastro assistido por código de barras)
**Bloqueia:** nada

## Objetivo

Hoje o painel "Novo produto" do Catálogo mostra os quatro campos (Código interno, Nome, Marca,
Categoria) e a gestora digita tudo. No catálogo real o `codigoInterno` já é, na prática, o EAN:
são 484 dos 524 produtos. Os outros 40 não têm código de barras e entraram como `SEMCOD-001…040`
(`docs/notas-para-artigo.md`, 2026-11-10).

A melhoria é a gestora informar primeiro o código de barras, digitando ou lendo pela câmera do
celular. O backend consulta um catálogo externo de produtos e, se achar, a tela mostra um card
com o produto para a gestora confirmar e cadastrar dali mesmo. Se não achar, aparece um aviso
curto e os campos para preencher à mão. O cadastro manual é raro (a carga grande é a importação
por CSV, T24), e por isso a cota pequena de um plano gratuito basta.

## Fonte de dados (pesquisa de 2026-11-11)

| Fonte | Custo | Cobertura BR | Situação |
|---|---|---|---|
| **SI5 Global** (`global.si5.com.br`) | Grátis: 30 consultas/dia, 1 token. Consulta que dá 404 não gasta cota | Base brasileira (~27 mi de GTINs declarados) | **Escolhida** |
| Cosmos/Bluesoft | O gratuito não aceita conta nova e seria desligado em 01/10/2026; pago a partir de R$ 499,99/mês | A melhor base BR | Fora pelo custo |
| Open Beauty Facts | Grátis, sem chave | ~519 produtos do Brasil no total | Cobertura baixa demais |
| UPCitemdb, Mercado Livre, GS1 Brasil | trial com foco nos EUA / OAuth com refresh token rotativo / contrato de associado | — | Fora |

A documentação do SI5 manda não chamar a API pelo navegador, porque o token ficaria exposto. Por
isso a consulta passa pelo backend, que também confere o catálogo da loja antes de gastar cota.

## Decisões tomadas com o orientando (2026-11-11)

1. Fonte: **SI5 Global**, plano gratuito.
2. Produto encontrado é **cadastrado direto do card**. A categoria fica no card, junto com
   "Editar antes de cadastrar" e "Não é este produto".
3. A categoria vem **preenchida com a da base** e continua editável.
4. A **leitura pela câmera do celular** entra nesta tarefa.

## Escopo

### Backend

1. `GET /produtos/codigo-de-barras/:codigo`, só para GESTOR. Ordem: normaliza o código (como
   `normalizarDadosProduto`) → procura no catálogo local, em qualquer formato → valida o GTIN
   (formato e dígito verificador) → consulta a fonte. Respostas:
   - `200 { situacao: 'JA_CADASTRADO', produto }`
   - `200 { situacao: 'ENCONTRADO', fonte, sugestao: { codigoInterno, nome, marca, categoria, imagemUrl } }`,
     com `marca`, `categoria` e `imagemUrl` podendo ser `null`
   - `200 { situacao: 'NAO_ENCONTRADO' }`
   - `200 { situacao: 'INDISPONIVEL', motivo: 'NAO_CONFIGURADA' | 'LIMITE_DIARIO' | 'FALHA' }`
   - `400 { erro: 'CODIGO_DE_BARRAS_INVALIDO', mensagem }`, com mensagem diferente para formato
     e para dígito verificador
2. Validação de GTIN-8, 12, 13 e 14 com o dígito verificador mod-10 da GS1.
3. Adaptador da fonte (SI5) isolado num arquivo, com `fetch` injetável, timeout e todas as falhas
   reduzidas a `INDISPONIVEL`. O token `SI5_TOKEN` é opcional e lido a cada uso; sem ele, nada é
   consultado.
4. A categoria da base que equivale a uma da loja, sem diferença de acento ou caixa, volta com a
   grafia da loja.

### Frontend

5. Painel "Novo produto" em três etapas: **código de barras** → **card do produto encontrado**
   ou **formulário** (o de hoje, com o código já preenchido e uma nota que diz por que se chegou
   ali). "Produto sem código de barras?" leva direto ao formulário vazio.
6. Card com imagem, nome, marca, código, fonte e campo Categoria. "Cadastrar este produto"
   quando nome e marca vieram completos; senão, "Completar e cadastrar", que abre o formulário
   preenchido.
7. Código já cadastrado: aviso com o produto e "Mostrar na lista".
8. No celular, "Ler com a câmera" (`LeitorCamera` em leitura única, restrito a EAN/UPC); a
   leitura preenche o campo e busca.
9. O rascunho (etapa e campos) sobrevive a fechar e reabrir o painel, como em T45.

## Decisões anteriores afetadas

- **T45 e a especificação do redesign** (`docs/redesign/claude-design/README.md`, seção
  "Catálogo"): o painel "Novo produto" deixa de abrir com os quatro campos. Ele abre pelo código
  de barras, e os quatro campos viram a terceira etapa.
- **T04**: o catálogo passa a ter uma dependência externa, que é opcional. Sem ela, o cadastro
  funciona como antes, só sem o preenchimento automático.

## Critério de aceite

- [ ] Testes de backend sem banco: validação de GTIN, cada `situacao` e cada motivo de
      `INDISPONIVEL`, papel (401/403), nenhuma consulta externa para código já cadastrado,
      inválido ou sem token, e token fora da resposta
- [ ] Testes de Vitest do cadastro: as três etapas, cada aviso, card com cadastro direto e com
      "Completar e cadastrar", câmera no celular (com dublê) e ausente no computador, rascunho
      preservado; testes de T25 e T45 adaptados e verdes
- [ ] `npm run typecheck` limpo no backend e no frontend
- [ ] `playwright-cli` a 1280×900 e 360×740: código já cadastrado, card (resposta simulada com
      `route`), não encontrado, sem código de barras; capturas em `docs/redesign/T47/`
- [ ] `docs/arquitetura.md` (stack, contrato, offline), `docs/deploy.md` e `backend/.env.example`
      com `SI5_TOKEN`
- [ ] Verificações manuais anotadas no backlog: câmera lendo EAN-13 num celular real, e a
      consulta com o token real

## Fora de escopo

- Guardar no `Produto` a imagem, o NCM ou a origem do dado.
- Cache de consultas.
- Segunda fonte (Open Beauty Facts) ou troca de fonte em tempo de execução.
- Consulta na edição de produto ou na importação CSV.
- Câmera no computador ou no tablet.
- Converter a caixa (CAIXA ALTA) do nome que vem da base.
