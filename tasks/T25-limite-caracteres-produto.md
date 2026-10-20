# T25 — Mensagem clara para o limite de 120 caracteres no cadastro de produto

**Depende de:** T04 (formulário de cadastro de produto)
**Incremento:** 9 (Ajustes de uso em formulários e listas)
**Bloqueia:** nada

## Objetivo

Hoje, cadastrar um produto com nome (ou marca, categoria, código) acima de 120 caracteres
devolve a mensagem genérica do `errorHandler` de T12b — "Alguns campos do formulário não foram
aceitos. Confira os dados e tente de novo." — sem dizer **qual** campo nem **qual** é o
problema. A gestora não tem como descobrir que o nome era longo demais.

O limite mora no JSON Schema de `backend/src/modules/produto/produto.routes.ts`
(`campoTexto`, `maxLength: 120`) e é repetido em `importacao.service.ts`
(`TAMANHO_MAXIMO_CAMPO`). O formulário em `frontend/src/pages/TelaProdutos.tsx` não espelha
o limite.

## Decisões que esta tarefa toma (registrar em `docs/decisoes.md`)

1. **Prevenir na tela, não só explicar depois.** É o mesmo princípio da Decisão 3 de T12,
   reafirmado em T12b: um campo que mostra o limite é melhor que uma recusa bem escrita.
   Os quatro campos ganham `maxLength={120}` e um contador (`87/120`) sempre visível. (A
   versão inicial previa o contador só a partir de ~100 caracteres; o orientando decidiu
   mantê-lo sempre à vista — ver `docs/decisoes.md`, 2026-10-20.)
2. **`maxLength` sozinho não basta.** Colar um texto maior que 120 é truncado em silêncio
   pelo navegador — a gestora cadastraria um nome cortado sem perceber. Ao colar texto
   truncado, a tela avisa abaixo do campo ("O nome foi cortado em 120 caracteres").
3. **A rede embaixo continua sendo o servidor.** Se ainda assim o backend recusar com
   `CORPO_INVALIDO`, a tela usa o array `campos` (que T12b já devolve) para nomear o campo
   pelo rótulo do formulário: "O campo Nome aceita no máximo 120 caracteres." O texto genérico
   só aparece se `campos` vier vazio. **Não** traduzir regra a regra do ajv no backend — T12b
   rejeitou isso explicitamente.

## Critério de aceite

- [x] Os quatro campos do cadastro com `maxLength` e contador de caracteres
- [x] Aviso ao colar texto maior que o limite
- [x] Recusa `CORPO_INVALIDO` com `campos: ['nome']` mostra a mensagem com o rótulo do campo,
      junto ao campo (não num aviso solto no topo)
- [x] O valor 120 vem de uma constante única do frontend, comentada como espelho do schema da
      rota (o servidor continua sendo a fonte)
- [x] Testes de componente: contador, aviso de colagem, mensagem a partir de `campos`
- [x] Conferência no navegador com o `playwright-cli` (colar 130 caracteres no Nome)

## Notas técnicas

- `ErroApi.corpo` já carrega o corpo inteiro da resposta (T24); um helper
  `camposRecusados(corpo): string[]` em `services/api.ts`, no padrão de `errosDaPlanilha`,
  deixa o mapeamento reaproveitável por outros formulários.
- Conferir se a tela de Contas de acesso (T22) tem o mesmo problema; se tiver, **anotar** no
  backlog como achado, não corrigir aqui.

## Fora de escopo

- Mudar o limite de 120 caracteres.
- Mensagens de erro da importação por planilha (T24 já devolve uma por linha).
- Trocar o aviso por toast — erro de campo fica junto ao campo (ver T29).
