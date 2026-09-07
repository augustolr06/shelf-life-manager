import bcrypt from 'bcryptjs'
import { prisma } from '../../db/prisma.js'
import type { UsuarioAutenticado } from './tipos.js'

// Mesmo custo usado pelo seed de T02 (docs/decisoes.md). Alterar aqui
// invalidaria os hashes já gravados no banco.
const CUSTO_BCRYPT = 10

// Hash de uma senha que ninguém usa. Serve apenas para consumir o mesmo tempo
// de CPU quando o e-mail não existe, de modo que o tempo de resposta não
// revele quais e-mails estão cadastrados.
const HASH_INEXISTENTE = bcrypt.hashSync('usuario-inexistente', CUSTO_BCRYPT)

/**
 * Confere e-mail e senha. Retorna `null` para credencial inválida sem
 * distinguir "e-mail não existe" de "senha errada" — quem chama não deve
 * vazar essa diferença na resposta.
 */
export async function autenticarCredenciais(
  email: string,
  senha: string,
): Promise<UsuarioAutenticado | null> {
  const usuario = await prisma.usuario.findUnique({ where: { email } })
  const senhaConfere = await bcrypt.compare(senha, usuario?.senhaHash ?? HASH_INEXISTENTE)

  if (!usuario || !senhaConfere) return null

  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
  }
}
