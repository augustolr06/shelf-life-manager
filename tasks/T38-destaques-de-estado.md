# T38 — Destaque de estado: vencidos, inativos e ações destrutivas

**Depende de:** T35 (paleta semântica e componentes base), T39 (confirmações já existentes)
**Incremento:** 11 (Redesign)
**Bloqueia:** nada

## Objetivo

Três tipos de estado hoje se parecem com todo o resto da tela:

1. **Unidades vencidas** — o caso que o trabalho inteiro existe para evitar — aparecem como
   uma data comum em várias telas.
2. **Produtos inativos** são distinguidos só por uma classe `linha-inativa` e pela palavra
   "Inativo" numa coluna.
3. **Ações destrutivas ou irreversíveis** ("Vender mesmo assim", descartar, inativar produto,
   desativar conta, esvaziar carrinho) têm o mesmo botão de qualquer outra ação.

## Escopo

### Vencidos (e perto de vencer)

- Distintivo `perigo` "Vencida" + ícone (não só cor — acessibilidade) em: venda/carrinho,
  consulta (T32), painel de exceção, alertas, fila de descarte, etiquetas.
- `situacao` e `diasParaVencer` **sempre vindos do servidor** (RNF01, RNF04). Onde uma tela
  ainda não recebe esse dado pronto, a tarefa acrescenta o campo na resposta do backend —
  nunca compara datas no navegador.
- Opcional: distintivo `atencao` "Vence em N dias" onde o servidor já devolve `diasParaVencer`.

### Inativos

- Distintivo neutro "Inativo", texto atenuado e ações desabilitadas visivelmente na linha/cartão.
- Inativo também identificável na consulta (T32) e no histórico do dashboard.

### Ações destrutivas

- Variante `perigo` de botão em todas elas, e no botão de confirmar do diálogo de T39.
- A **confirmação** em si (diálogo com a consequência e o verbo da ação) já existe desde
  T39; esta tarefa só aplica o destaque visual.
- **"Vender mesmo assim" (override, PRD 6.1):** recebe a cor de perigo, **mas continua não
  sendo o botão primário**. A seção 6.1 do PRD exige que correção e descarte sejam a ação
  padrão e que o override tenha fricção deliberada — destacar aqui significa sinalizar o
  risco, não dar proeminência. A justificativa obrigatória (10–500) continua no lugar.

## Critério de aceite

- [ ] Vencidos destacados em todas as telas listadas, com dado do servidor
- [ ] Inativos destacados no catálogo, seletor (se aparecerem), consulta e dashboard
- [ ] Todas as ações destrutivas com variante perigo, inclusive no diálogo de confirmação
- [ ] Ordem visual do painel de exceção preservada: correção → descarte → override (PRD 6.1)
- [ ] Conferência no navegador com o `playwright-cli`: painel de exceção como GESTOR,
      inativação no catálogo
- [ ] `docs/notas-para-artigo.md`: o destaque do vencido e a fricção do override como
      continuação da filosofia do bloqueio FIFO reativo

## Fora de escopo

- Mudar regras: quem pode fazer o quê continua igual (o override segue restrito a GESTOR).
- Desfazer ações destrutivas.
- O comportamento da confirmação (quais ações, textos, foco) — T39.
