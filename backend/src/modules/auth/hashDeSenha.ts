import bcrypt from 'bcryptjs'

/**
 * O custo do bcrypt, num lugar só.
 *
 * Até aqui ele estava declarado duas vezes — em `auth.service.ts` e em
 * `db/seed.ts` — com um comentário em cada lado pedindo que não divergissem.
 * T23 seria a terceira cópia (o script de troca de senha), e três é onde esse
 * tipo de acordo costuma quebrar: o hash gravado com um custo e conferido com
 * outro **não falha** — `bcrypt.compare` lê o custo de dentro do próprio hash e
 * confere normalmente. O estrago é silencioso e só aparece como senhas antigas
 * mais fracas do que se imagina.
 *
 * Alterar este valor não invalida os hashes já gravados; apenas passa a gravar
 * os novos com outro custo.
 */
export const CUSTO_BCRYPT = 10

/** O único caminho para transformar senha em hash neste sistema. */
export function gerarHashDeSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, CUSTO_BCRYPT)
}
