/**
 * O texto agregado da notificação push (RF08, T19b).
 *
 * Fica na raiz de `tests/`, e não em `tests/push/`, pela regra de T14b: a
 * pasta separa quem exige PostgreSQL de quem roda em qualquer máquina. Esta
 * suíte é função pura — nem banco, nem rede.
 *
 * O que ela protege é a Decisão 2 da tarefa: a notificação é **uma por
 * passagem**, e o número que ela mostra é de unidades distintas. Um recebimento
 * de 40 frascos que virasse 40 notificações faria a gestora desligar o aviso, e
 * a RF08 morreria no aparelho dela.
 *
 * Contrato: tasks/T19b-notificacao-push.md.
 */

import { describe, expect, it } from 'vitest'
import {
  URL_DA_NOTIFICACAO,
  montarMensagem,
  notificaPorPush,
  type AlertaEmitido,
} from '../src/modules/push/mensagemPush.js'

function alerta(unidadeId: string, diasAntecedencia = 30, canal = 'PUSH'): AlertaEmitido {
  return { unidadeId, diasAntecedencia, canal }
}

describe('quais janelas notificam', () => {
  it('notifica as janelas PUSH e AMBOS, e não a IN_APP', () => {
    expect(notificaPorPush('PUSH')).toBe(true)
    expect(notificaPorPush('AMBOS')).toBe(true)
    expect(notificaPorPush('IN_APP')).toBe(false)
  })

  it('não monta mensagem quando só há alerta de janela in-app', () => {
    expect(montarMensagem([alerta('u1', 30, 'IN_APP')])).toBeNull()
  })

  it('não monta mensagem quando a passagem não emitiu nada', () => {
    expect(montarMensagem([])).toBeNull()
  })

  it('ignora os alertas in-app ao contar, sem descartar a mensagem inteira', () => {
    const mensagem = montarMensagem([alerta('u1', 30, 'IN_APP'), alerta('u2', 7, 'AMBOS')])

    expect(mensagem?.titulo).toBe('1 unidade perto do vencimento')
    expect(mensagem?.corpo).toBe('Janela de 7 dias. Toque para ver a lista.')
  })
})

describe('o texto agregado', () => {
  it('fala no singular com uma unidade', () => {
    const mensagem = montarMensagem([alerta('u1')])

    expect(mensagem).toEqual({
      titulo: '1 unidade perto do vencimento',
      corpo: 'Janela de 30 dias. Toque para ver a lista.',
      url: URL_DA_NOTIFICACAO,
    })
  })

  it('resume um recebimento inteiro numa notificação só', () => {
    const lote = Array.from({ length: 40 }, (_, indice) => alerta(`u${indice}`))

    expect(montarMensagem(lote)?.titulo).toBe('40 unidades perto do vencimento')
  })

  it('conta unidades distintas, não alertas: a mesma unidade em duas janelas é uma', () => {
    const mensagem = montarMensagem([alerta('u1', 30), alerta('u1', 7)])

    expect(mensagem?.titulo).toBe('1 unidade perto do vencimento')
  })

  it('nomeia as janelas envolvidas, da mais larga para a mais estreita', () => {
    const mensagem = montarMensagem([alerta('u1', 7), alerta('u2', 30)])

    expect(mensagem?.corpo).toBe('Janelas de 30 e 7 dias. Toque para ver a lista.')
  })

  it('lista três janelas com vírgula e "e"', () => {
    const mensagem = montarMensagem([alerta('u1', 7), alerta('u2', 30), alerta('u3', 15)])

    expect(mensagem?.corpo).toBe('Janelas de 30, 15 e 7 dias. Toque para ver a lista.')
  })

  it('não nomeia produto: o toque leva à lista, que é quem detalha', () => {
    const mensagem = montarMensagem([alerta('u1')])

    expect(mensagem?.url).toBe('/alertas')
    expect(`${mensagem?.titulo} ${mensagem?.corpo}`).not.toMatch(/parfum|marca|produto/i)
  })
})
