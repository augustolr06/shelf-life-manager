import type { FastifyInstance } from 'fastify'
import { buildApp } from './buildApp.js'
import { iniciarAgendadorDeAlertas } from './modules/alerta/agendador.js'
import { env } from './shared/env.js'

// O import de `fastify` neste arquivo é requisito do deploy, não só do tipo:
// a Vercel só aceita como entrypoint um arquivo cujo texto contenha
// `import ... from 'fastify'` (docs/deploy.md seção 3.1). Guardado por
// tests/entrypointVercel.test.ts.
const app: FastifyInstance = buildApp()

// Iniciado aqui, e não em `buildApp()`: as suítes montam o app com
// `app.inject()` e não devem herdar um timer varrendo o banco por trás.
//
// O gate é de T23: onde não existe processo de longa duração, o relógio da
// RF08 vem de fora, por `GET /interno/varredura-alertas`. A rota existe nos
// dois modos — o que muda é quem a dispara. O log diz qual dos dois está
// valendo, porque "o alerta não chegou" é uma queixa que começa exatamente
// aqui.
if (env.ALERTA_AGENDADOR_INTERNO) {
  iniciarAgendadorDeAlertas({ intervaloHoras: env.ALERTA_INTERVALO_HORAS, log: app.log })
  app.log.info(
    { intervaloHoras: env.ALERTA_INTERVALO_HORAS },
    'relógio da RF08: agendador interno ligado',
  )
} else {
  app.log.info(
    { rota: '/interno/varredura-alertas' },
    'relógio da RF08: agendador interno desligado; a varredura depende de agendador externo',
  )
}

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
} catch (erro) {
  app.log.error(erro)
  process.exit(1)
}
