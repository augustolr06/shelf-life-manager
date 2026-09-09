/**
 * Troca a senha de um usuário: `npm run usuario:senha -- <email>`.
 *
 * Existe por causa de T23. O único caminho para uma conta existir neste
 * sistema ainda é o `seed.ts`, que grava uma senha padrão conhecida e impressa
 * no terminal — aceitável em `localhost`, inaceitável no instante em que a
 * aplicação ganha um endereço público. Enquanto T22 não entrega a gestão de
 * usuários pela interface, este script é o que separa uma coisa da outra.
 *
 * A senha é lida do **stdin**, e não de argumento: argumento fica no histórico
 * do shell e aparece na lista de processos da máquina. Aceita as duas formas:
 *
 *     npm run usuario:senha -- gestor@estoque.local        (digita e Enter)
 *     cat senha.txt | npm run usuario:senha -- gestor@…    (sem eco na tela)
 *
 * Termina com código 1 em qualquer recusa, para que um script de implantação
 * perceba.
 */
import 'dotenv/config'
import { createInterface } from 'node:readline/promises'
import { prisma } from '../../db/prisma.js'
import { definirSenha, TAMANHO_MINIMO_DE_SENHA } from './auth.service.js'

const MOTIVOS: Record<string, string> = {
  SENHA_CURTA: `senha curta demais: mínimo de ${TAMANHO_MINIMO_DE_SENHA} caracteres`,
  USUARIO_NAO_ENCONTRADO: 'não existe usuário com esse e-mail neste banco',
  CONTA_NAO_AUTENTICA: 'a conta de sistema não autentica, e não deve ganhar senha',
}

/**
 * No terminal a senha é digitada com eco na tela — `readline` não oferece
 * entrada oculta sem manipular o modo do TTY. Quem precisa de sigilo usa a
 * forma com pipe, que é a documentada acima.
 */
async function lerSenha(): Promise<string> {
  if (process.stdin.isTTY) {
    const leitor = createInterface({ input: process.stdin, output: process.stderr })
    const digitada = await leitor.question('Nova senha (aparece na tela): ')
    leitor.close()
    return digitada
  }

  const pedacos: Buffer[] = []
  for await (const pedaco of process.stdin) pedacos.push(pedaco as Buffer)
  // Só a quebra de linha final: espaço no fim pode ser parte da senha.
  return Buffer.concat(pedacos).toString('utf8').replace(/\r?\n$/, '')
}

const email = process.argv[2]

try {
  if (!email) {
    console.error('uso: npm run usuario:senha -- <email>')
    process.exitCode = 1
  } else {
    const resultado = await definirSenha(email, await lerSenha())

    if (resultado.ok) {
      console.log(`senha trocada: ${resultado.email}`)
    } else {
      console.error(`senha não trocada — ${MOTIVOS[resultado.motivo]}`)
      process.exitCode = 1
    }
  }
} catch (erro) {
  console.error('falha ao trocar a senha:', erro)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
