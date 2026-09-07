import { Papel } from '@prisma/client'
import type { FastifyReply, FastifyRequest } from 'fastify'
import './tipos.js'

/**
 * Decodifica o JWT (lido do cookie httpOnly) e injeta `request.usuario`.
 * Use como preHandler em toda rota que não seja pública.
 */
export async function autenticar(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    // `jwtVerify` valida a assinatura e popula `request.user` já tipado como
    // PayloadToken (ver tipos.ts); o retorno da própria função é genérico.
    await request.jwtVerify()
    const payload = request.user
    request.usuario = {
      id: payload.sub,
      nome: payload.nome,
      email: payload.email,
      papel: payload.papel,
    }
  } catch {
    return reply.code(401).send({
      erro: 'NAO_AUTENTICADO',
      mensagem: 'Sessão ausente ou expirada. Faça login novamente.',
    })
  }
}

/**
 * Autorização por papel (RF01). Sempre encadeado **depois** de `autenticar`:
 * `preHandler: [autenticar, exigirPapel(Papel.GESTOR)]`.
 */
export function exigirPapel(...papeisPermitidos: Papel[]) {
  return async function verificarPapel(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Defesa contra encadeamento errado: sem `autenticar` antes, não há papel
    // a verificar e a rota não pode simplesmente passar.
    if (!request.usuario) {
      return reply.code(401).send({
        erro: 'NAO_AUTENTICADO',
        mensagem: 'Sessão ausente ou expirada. Faça login novamente.',
      })
    }

    if (!papeisPermitidos.includes(request.usuario.papel)) {
      return reply.code(403).send({
        erro: 'PAPEL_INSUFICIENTE',
        mensagem: 'Seu papel não permite esta ação.',
      })
    }
  }
}
