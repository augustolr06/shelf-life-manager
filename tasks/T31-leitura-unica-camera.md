# T31 — Leitura única: câmera desliga ao identificar o código e a tela mostra o resultado

**Depende de:** T10 (tela de leitura e `LeitorCamera`)
**Incremento:** 10 (Fluxo de leitura: leitura única, consulta e carrinho)
**Bloqueia:** T34 (o carrinho parte de uma leitura por vez)

## Objetivo

Na tela de Leitura, a câmera continua ligada depois do veredito e segue decodificando — a
`html5-qrcode` emite o mesmo código ~10 vezes por segundo. T10 contornou isso com
`emVoo` e `codigoJaProcessado`, mas o efeito para a atendente é uma tela que "continua lendo"
enquanto ela ainda olha o resultado, e qualquer frasco que passar na frente da câmera vira
uma leitura nova (e, hoje, uma venda).

Com esta tarefa a câmera lê **um** código, **desliga**, e a tela mostra o resultado. Para ler
o próximo frasco, a atendente toca em **Ler próximo**, que religa a câmera.

## Decisões anteriores afetadas (alerta — não bloqueia)

- **T10** manteve a câmera ligada para "o laço do RF06 funcionar sem a atendente tocar na tela
  entre um frasco e outro". O custo disso apareceu no uso: a câmera aberta lê sem querer um
  frasco que não era para sair — e hoje, ler é vender. Um toque a mais por frasco é o preço de
  cada leitura ser intencional.

## Decisões que esta tarefa toma (registrar em `docs/decisoes.md`)

1. **O modo é do `LeitorCamera`, não da tela.** Uma prop `modo: 'unica' | 'continua'`
   (padrão `'continua'`, que T32 usa). No modo `'unica'`, o componente emite só o **primeiro**
   código decodificado e para a câmera ele mesmo, antes do `stop()` assíncrono terminar — os
   quadros que ainda chegam são descartados ali, e não na tela.
2. **A proteção contra rajada em `TelaLeituraQr` continua**, por defesa em profundidade: o
   denominador da taxa de acerto (RF12) não pode inflar se o leitor falhar em parar.

## Critério de aceite

- [x] Ao decodificar, a câmera desliga e o vídeo some; o resultado aparece no lugar
- [x] Botão **Ler próximo** religa a câmera e limpa o resultado anterior
- [x] No modo `'unica'`, `aoLer` é chamado **uma** vez por ligação da câmera, mesmo com vários
      quadros decodificados em seguida
- [x] Entrada manual do código continua funcionando e não liga a câmera sozinha
- [x] O fluxo da exceção de unidade vencida (painel de T12) e o do bloqueio FIFO continuam
      iguais: o resultado fica na tela até a atendente pedir o próximo
- [x] Testes de `TelaLeituraQr.test.tsx` atualizados (o dublê do `LeitorCamera` precisa
      respeitar o modo) e teste do `LeitorCamera` com a `html5-qrcode` substituída
- [x] Conferência no navegador com o `playwright-cli` pela entrada manual (o navegador
      automatizado não lê QR de câmera física — ver verificação manual de T10 no backlog);
      a leitura pela câmera fica para o teste em celular real

## Fora de escopo

- Leitura sem baixa e carrinho — T33, T33b e T34. Até lá, a leitura continua registrando a
  saída no `CONFIRMAR`; esta tarefa já reduz o risco, porque a câmera para depois de um código.
- A tela de consulta (T32), que usa o modo contínuo.
