/**
 * O texto da notificação — a única parte desta tarefa que é decisão de
 * redação, e por isso a única que fica isolada num módulo sem banco e sem rede.
 *
 * **Uma notificação por passagem da varredura, agregada** (T19b, Decisão 2). O
 * `Alerta` continua sendo por unidade no banco, porque é dele que a RF13 conta;
 * a *entrega* não pode seguir a mesma granularidade. Um recebimento de 40
 * frascos com a mesma validade entrando na janela dispararia 40 notificações no
 * mesmo segundo, e o efeito prático de 40 notificações é o de zero — a gestora
 * desliga o aviso, e a RF08 morre no aparelho dela.
 *
 * **O texto não nomeia produto.** Notificação aparece em tela bloqueada, à
 * vista de quem estiver por perto; e com dezenas de unidades o nome de uma só
 * seria arbitrário. Quem detalha é a lista de `/alertas`, que é para onde o
 * toque leva.
 */

/** O que a varredura emitiu, reduzido ao que a mensagem precisa saber. */
export type AlertaEmitido = {
  unidadeId: string
  diasAntecedencia: number
  /** `IN_APP`, `PUSH` ou `AMBOS` — o canal da janela que emitiu. */
  canal: string
}

export type MensagemPush = {
  titulo: string
  corpo: string
  /** Para onde o `notificationclick` do service worker leva. */
  url: string
}

/** O destino do toque: a lista in-app de T19, que é onde o detalhe está. */
export const URL_DA_NOTIFICACAO = '/alertas'

/** Só estas duas janelas notificam; `IN_APP` é entregue apenas na lista. */
export function notificaPorPush(canal: string): boolean {
  return canal === 'PUSH' || canal === 'AMBOS'
}

/**
 * Une os números numa lista legível: `30`, `30 e 7`, `30, 15 e 7`.
 */
function listar(numeros: number[]): string {
  if (numeros.length === 1) return String(numeros[0])
  const inicio = numeros.slice(0, -1).join(', ')
  return `${inicio} e ${numeros[numeros.length - 1]}`
}

/**
 * A mensagem de uma passagem, ou `null` quando não há o que notificar.
 *
 * Conta **unidades distintas**, não alertas: a mesma unidade pode entrar em
 * duas janelas na mesma passagem (30 e 7 dias configuradas juntas, uma unidade
 * que já estava dentro das duas), e dizer "2 unidades" quando há um frasco só
 * seria mentira sobre o estoque.
 */
export function montarMensagem(emitidos: readonly AlertaEmitido[]): MensagemPush | null {
  const porPush = emitidos.filter((alerta) => notificaPorPush(alerta.canal))

  if (porPush.length === 0) return null

  const unidades = new Set(porPush.map((alerta) => alerta.unidadeId)).size

  // Da janela mais larga para a mais estreita, a mesma ordem da listagem de
  // T17 e da varredura de T18.
  const janelas = [...new Set(porPush.map((alerta) => alerta.diasAntecedencia))].sort(
    (a, b) => b - a,
  )

  return {
    titulo:
      unidades === 1
        ? '1 unidade perto do vencimento'
        : `${unidades} unidades perto do vencimento`,
    corpo:
      janelas.length === 1
        ? `Janela de ${listar(janelas)} dias. Toque para ver a lista.`
        : `Janelas de ${listar(janelas)} dias. Toque para ver a lista.`,
    url: URL_DA_NOTIFICACAO,
  }
}
