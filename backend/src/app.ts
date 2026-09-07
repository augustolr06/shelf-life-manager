import Fastify, { type FastifyInstance } from 'fastify'

/**
 * Monta a instância do Fastify sem subir o servidor, para que os testes
 * possam usar `app.inject()` sem abrir porta.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true })

  // Liveness. O frontend consulta este endpoint antes de habilitar a tela de
  // leitura de QR (docs/arquitetura.md seção 6).
  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
  }))

  return app
}
