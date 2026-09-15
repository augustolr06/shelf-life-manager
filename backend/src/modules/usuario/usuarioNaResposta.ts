import type { Usuario } from '@prisma/client'

/**
 * A forma como um usuário aparece em qualquer resposta da API.
 *
 * Existe por um motivo só, e ele é de segurança: `senhaHash` é campo do
 * modelo do Prisma, e devolver o registro cru em **uma** rota já basta para
 * publicar o hash de todo mundo. Uma projeção explícita transforma esse
 * descuido possível num erro de compilação — quem escrever uma rota nova e
 * devolver `Usuario` direto não passa pelo tipo.
 *
 * Mesmo padrão de `unidade/unidadeNaResposta.ts`, e pela mesma razão de fundo:
 * uma segunda forma da mesma entidade acabaria divergindo.
 */
export type UsuarioNaResposta = {
  id: string
  nome: string
  email: string
  papel: Usuario['papel']
  ativo: boolean
}

export function comoResposta(usuario: Usuario): UsuarioNaResposta {
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
    ativo: usuario.ativo,
  }
}
