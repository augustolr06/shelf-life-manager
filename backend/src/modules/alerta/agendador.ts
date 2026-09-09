import type { ResumoDaVarredura } from './varreduraAlertas.js'
import { varrerEstoqueParaAlertas } from './varreduraAlertas.js'

/**
 * O relógio da RF08: quem chama a varredura, e quando.
 *
 * **Um `setInterval` dentro do processo do backend**, e não `cron` do sistema
 * nem uma rota HTTP de "rodar agora". Uma rota seria uma porta autenticada que
 * dispara escrita em massa; o `cron` exigiria configuração no servidor da loja
 * para que um requisito funcional acontecesse. A contrapartida está declarada
 * em `docs/notas-para-artigo.md`: **backend fora do ar, varredura não roda** —
 * tolerável porque a janela tem dias de folga, e não seria em escala maior.
 *
 * O intervalo pode ser tosco justamente porque a varredura é idempotente (o
 * índice único de `Alerta`): a segunda passagem do mesmo dia não emite nada, e
 * por isso não é preciso guardar "última execução" nem acertar um horário
 * fixo — estado que se perderia no primeiro reinício do servidor.
 *
 * Recebe a varredura por parâmetro: o que se testa aqui é comportamento de
 * relógio (roda ao iniciar, repete, não se sobrepõe, sobrevive a erro), e isso
 * não precisa de banco.
 */

/** O mínimo que o agendador usa do `app.log` do Fastify. */
export type LogDoAgendador = {
  info: (dados: Record<string, unknown>, mensagem: string) => void
  warn: (dados: Record<string, unknown>, mensagem: string) => void
  error: (dados: Record<string, unknown>, mensagem: string) => void
}

export type OpcoesDoAgendador = {
  intervaloHoras: number
  log: LogDoAgendador
  /** Injetável para os testes; em produção é sempre a varredura de verdade. */
  varrer?: () => Promise<ResumoDaVarredura>
}

export type AgendadorDeAlertas = {
  /** Para os tiques seguintes. Não interrompe uma varredura em andamento. */
  parar: () => void
}

const MILISSEGUNDOS_POR_HORA = 60 * 60 * 1000

export function iniciarAgendadorDeAlertas(opcoes: OpcoesDoAgendador): AgendadorDeAlertas {
  const { intervaloHoras, log } = opcoes
  const varrer = opcoes.varrer ?? varrerEstoqueParaAlertas

  let emExecucao = false

  async function executar(motivo: 'inicialização' | 'intervalo'): Promise<void> {
    // Sem sobreposição. Uma varredura mais lenta que o intervalo é o caso em
    // que duas passagens simultâneas competiriam pelas mesmas unidades: o
    // índice único recusaria a segunda com erro, e o log encheria de falha
    // para descrever uma situação que não é falha nenhuma.
    if (emExecucao) {
      log.warn({ motivo }, 'varredura de alertas ainda em andamento; tique ignorado')
      return
    }

    emExecucao = true
    try {
      const resumo = await varrer()
      log.info({ motivo, ...resumo }, 'varredura de alertas concluída')
    } catch (erro) {
      // Engolido de propósito: o balcão precisa continuar vendendo se o job
      // quebrar, e o tique seguinte precisa acontecer mesmo assim. A falha
      // aparece no log do servidor, que é onde ela pode ser vista.
      log.error(
        { motivo, erro: erro instanceof Error ? erro.message : String(erro) },
        'varredura de alertas falhou',
      )
    } finally {
      emExecucao = false
    }
  }

  // Uma passagem ao subir, para que reiniciar o servidor não adie o alerta em
  // um dia inteiro. É seguro porque a operação é idempotente. Sem `await`: o
  // servidor não espera a varredura para começar a atender.
  void executar('inicialização')

  const timer = setInterval(() => void executar('intervalo'), intervaloHoras * MILISSEGUNDOS_POR_HORA)

  // O agendador não é motivo para o processo continuar vivo: sem `unref`, um
  // `node dist/server.js` que perdesse o servidor HTTP ficaria de pé só por
  // causa deste timer.
  timer.unref()

  return { parar: () => clearInterval(timer) }
}
