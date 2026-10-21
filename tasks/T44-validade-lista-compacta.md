# T44 — Descarte e alertas em lista compacta

**Depende de:** T41 (navegação por tarefa)
**Incremento:** 12 (Redesign — proposta do Claude Design)
**Bloqueia:** nada

**Fonte de verdade:** `docs/redesign/claude-design/README.md`, seção "Validade: descarte e
alertas". Mockup: `telas/descarte-celular.html`.

## Objetivo

Na fila de descarte e nos alertas, cada unidade ocupa hoje um cartão alto com uma tabela de
rótulos, e no celular cabem duas por tela. A lista compacta mostra a fila inteira de uma vez,
com o estado num distintivo.

## Escopo

1. **Descarte:** um cartão com uma linha por unidade — nome; distintivo vermelho "há N dias"
   (`diasVencida`) e código; botão secundário "Resolver", que continua abrindo o
   `PainelExcecaoVencido` na própria linha.
2. **Alertas:** mesma linha, com distintivo pela `situacao` do servidor (`VENCIDA` → faixa
   vencida, "há N dias"; `NA_JANELA` → faixa 8 a 30, "vence em N dias"), texto suave quando
   lido e o botão "Marcar como lido". Filtro "Mostrar só os não lidos" continua.
3. Frase de contexto numa linha só, abaixo do título (computador) ou das abas (celular).
4. A faixa lateral colorida e a tabela de rótulos dos cartões atuais saem.
5. Paginação (T27) no fim da lista.

## Decisões anteriores afetadas

- T13 e T19: o formato de cartão por unidade dá lugar à linha. Os dados mostrados não mudam,
  exceto a data de entrada e a janela do alerta, que saem da linha e ficam no painel de
  resolução (descarte) ou em `title` (alerta).

## Critério de aceite

- [ ] Nenhuma classificação no navegador: dias e situação vêm do servidor
- [ ] A 360×740, a fila de 7 unidades do banco de produção cabe sem rolar (com a barra
      inferior)
- [ ] Resolver e marcar como lido funcionam como antes
- [ ] Testes de Vitest de `TelaDescartesPendentes` e `TelaAlertas` verdes
- [ ] `playwright-cli` a 360×740 e 1280×900; capturas em `docs/redesign/T44/`

## Fora de escopo

- Distintivos de faixa em outras telas (Etiquetas, Consulta, Relatórios): não fazem parte da
  especificação.
