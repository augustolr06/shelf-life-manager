# T37 — Revisão de copies (textos da interface e mensagens do servidor)

**Depende de:** T35 (fundação visual)
**Incremento:** 11 (Redesign)
**Bloqueia:** nada

## Objetivo

Boa parte dos textos da interface foi escrita do ponto de vista de quem desenvolveu, não de
quem usa. Exemplos reais:

- Leitura: "quem decide é o servidor, com o estoque inteiro do produto à vista";
  "Tentativa 2 neste produto. O contador é do servidor."
- Atendimento: "As saídas desta sequência ficam agrupadas no relatório."; "Sem agrupamento de
  atendimento neste navegador (exige HTTPS ou localhost)."
- Navegação: rótulos longos ("Catálogo de produtos", "Registrar recebimento") que não cabem
  no celular (T36).

## Escopo

1. **Guia curto de voz** em `docs/guia-de-textos.md`: tratamento (você), tom (direto, sem
   jargão técnico), termos fixos — escolher e usar sempre o mesmo para cada conceito
   (frasco/unidade, venda/saída, descarte/baixa, validade/vencimento), formato de datas e
   números, verbos nos botões ("Finalizar venda", não "OK").
2. **Inventário** de todos os textos visíveis (títulos, rótulos, botões, ajudas, estados
   vazios, mensagens) e reescrita.
3. **Mensagens do servidor.** Pela RNF04 a tela exibe `mensagem` como o backend escreveu —
   então melhorar os textos dos vereditos e recusas é mexer no **backend**
   (`saida.service.ts`, rotas de `/excecao-vencido`, `/produtos`, `/usuarios`, `errosDaApi.ts`
   etc.). Os códigos (`erro`, `veredito`, `motivo`) **não mudam** — só o texto.
4. Textos que não pertencem à interface (explicações de arquitetura) saem da tela e, se
   valiosos, vão para `docs/`.

## Critério de aceite

- [ ] `docs/guia-de-textos.md`
- [ ] Todas as telas revisadas segundo o guia
- [ ] Mensagens do backend revisadas, sem alterar códigos nem status HTTP
- [ ] Testes de backend e frontend que comparam texto atualizados (e, onde fizer sentido,
      trocados para comparar o código em vez do texto)
- [ ] `EventoLog` intocado: payloads não carregam as mensagens, conferir que nenhum carrega
- [ ] Conferência no navegador com o `playwright-cli` das telas de Venda e Catálogo
- [ ] `curl` em um veredito de cada tipo para conferir as mensagens novas

## Fora de escopo

- Internacionalização / outros idiomas.
- Textos do PDF de etiquetas além do rodapé.
