import { buildApp } from './app.js'
import { env } from './shared/env.js'

const app = buildApp()

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
} catch (erro) {
  app.log.error(erro)
  process.exit(1)
}
