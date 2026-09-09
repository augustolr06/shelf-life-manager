import { buildApp } from './app.js'
import { iniciarAgendadorDeAlertas } from './modules/alerta/agendador.js'
import { env } from './shared/env.js'

const app = buildApp()

// Iniciado aqui, e não em `buildApp()`: as suítes montam o app com
// `app.inject()` e não devem herdar um timer varrendo o banco por trás.
iniciarAgendadorDeAlertas({ intervaloHoras: env.ALERTA_INTERVALO_HORAS, log: app.log })

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
} catch (erro) {
  app.log.error(erro)
  process.exit(1)
}
