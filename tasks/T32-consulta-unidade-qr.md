# T32 — Consulta de unidade por QR, sem registrar saída (backend + tela)

**Depende de:** T10 (`LeitorCamera`, portão de offline)
**Incremento:** 10 (Fluxo de leitura: leitura única, consulta e carrinho)
**Bloqueia:** nada (o carrinho de T34 não depende dela: lá a leitura passa pela validação FIFO)

## Objetivo

Hoje a única forma de saber o que é um frasco pelo QR é a tela de Leitura — e lá, ler é
vender. Uma atendente que quer só conferir a validade de um frasco para responder a um
cliente não tem como fazer isso sem dar baixa.

Esta tarefa cria uma tela **Consultar produto**: a câmera fica aberta esperando o próximo QR,
e cada leitura mostra os dados daquela unidade — **sem registrar saída**.

## Backend

`GET /unidades/consulta/:codigoQr` — papel `ATENDENTE` ou `GESTOR`.

```json
{
  "unidade": {
    "id": "...", "codigoQr": "PRF-AB12CD", "dataValidade": "2026-12-01",
    "status": "EM_ESTOQUE", "dataEntrada": "2026-09-20T13:02:11.000Z",
    "produto": { "id": "...", "codigoInterno": "...", "nome": "...", "marca": "...",
                 "categoria": "...", "ativo": true }
  },
  "situacao": "NO_PRAZO",
  "diasParaVencer": 49
}
```

- `situacao`: `VENCIDA | NO_PRAZO`, decidida no **servidor** com a mesma referência de "hoje"
  de `shared/data.ts` — o frontend não compara datas (RNF01, RNF04), como já é o caso do
  `situacao` de `/alertas` (T19).
- Código inexistente: 404 `QR_NAO_ENCONTRADO`. O código vai normalizado por `codigoQr.ts`,
  dono único do formato (T08).
- Unidade vendida ou descartada **é encontrada** e devolvida com o `status` real: saber que um
  frasco já foi baixado é justamente uma das perguntas que a consulta responde.

## Decisões que esta tarefa toma (registrar em `docs/decisoes.md`)

1. **A consulta não grava `EventoLog`.** `LEITURA_QR_SAIDA` é o denominador da taxa de acerto
   na primeira leitura (RF12); contar consultas ali falsearia o indicador. Também não cria
   um tipo novo: o log registra o que acontece com o estoque, e olhar um frasco não muda o
   estoque (mesmo argumento de T14 para a geração de etiquetas e de T24 para o catálogo).
   Consequência a declarar em `docs/notas-para-artigo.md`: o sistema não sabe quantas
   consultas houve.
2. **A consulta não diz se a unidade é a próxima a sair.** Isso é veredito FIFO, e a RNF03
   proíbe decidi-lo fora de `validarSaidaFifo`. A tela mostra dados, não ordem. Se no futuro
   isso for desejado, o caminho é expor a consulta do pool que a própria função usa — nunca
   reescrevê-la aqui.
3. **Câmera contínua** (modo `'continua'` de T31): na consulta, ler o frasco seguinte sem tocar
   na tela é o comportamento desejado, porque nada é gravado. Um código igual ao que está na
   tela é ignorado; um diferente substitui o resultado.

## Frontend

- Rota `/consulta`, rótulo "Consultar produto", papéis `ATENDENTE` e `GESTOR`.
- Câmera + entrada manual do código, como na Leitura. Portão de offline reaproveitado
  (a consulta também depende do servidor).
- Cartão com produto (nome, marca, categoria, código interno), validade, dias para vencer,
  situação no estoque (em estoque / vendida / descartada) e produto inativo, se for o caso.
- `VENCIDA` em destaque visual claro; o destaque definitivo é de T38, aqui basta a classe de
  perigo que já existe.
- Texto fixo na tela deixando claro que **consultar não dá baixa**.

## Critério de aceite

- [ ] Rota com schema, testes com banco real: unidade em estoque, vencida, vendida,
      descartada, código inexistente, 401 sem sessão, e **nenhuma linha nova em `EventoLog`**
- [ ] Conferência por `curl` no servidor local
- [ ] Tela com câmera contínua, leitura nova substituindo a anterior
- [ ] Nenhuma comparação de data no frontend
- [ ] Testes de componente com o `LeitorCamera` substituído por dublê
- [ ] Conferência no navegador com o `playwright-cli` pela entrada manual, incluindo
      `network-state-set offline`
- [ ] `docs/arquitetura.md` seção 5 com a rota nova

## Fora de escopo

- Indicar se a unidade é a prioritária do FIFO (Decisão 2).
- Histórico de consultas.
- Ações a partir da consulta (vender, descartar) — vender é o carrinho (T34).
