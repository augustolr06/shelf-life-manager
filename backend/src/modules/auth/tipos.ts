import type { Papel } from '@prisma/client'

/**
 * Identidade do usuário logado. Toda saída precisa ser atribuível a um usuário
 * (RF01), então este é o objeto que os módulos seguintes consomem.
 */
export type UsuarioAutenticado = {
  id: string
  nome: string
  email: string
  papel: Papel
}

/** Conteúdo do JWT. `sub` carrega o id do usuário, pela convenção do RFC 7519. */
export type PayloadToken = {
  sub: string
  nome: string
  email: string
  papel: Papel
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: PayloadToken
    user: PayloadToken
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Preenchido pelo preHandler `autenticar`. Só existe em rotas que o
     * declaram — rotas públicas não devem ler este campo.
     */
    usuario: UsuarioAutenticado
  }
}
