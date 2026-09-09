import { Papel, type Usuario } from '@prisma/client'
import { prisma } from '../../db/prisma.js'

/**
 * Quem assina os eventos que **ninguém pediu**.
 *
 * `EventoLog.usuarioId` é FK obrigatória (seção 5 do PRD, schema de T02): todo
 * evento até aqui tem um humano por trás — quem leu o QR, quem cadastrou o
 * lote, quem autorizou a venda vencida. A varredura de T18 não tem: ela roda
 * por relógio, sem clique.
 *
 * Das três saídas possíveis, esta é a menos invasiva. Tornar `usuarioId`
 * nullable enfraqueceria a garantia de todos os nove tipos de evento por causa
 * de um só; não gravar o `ALERTA_PROATIVO_EMITIDO` tiraria do `EventoLog` um
 * dos tipos que o PRD declara e quebraria a propriedade que faz dele
 * instrumento de pesquisa — poder ler a linha do tempo inteira de uma unidade
 * em **uma** tabela ("alertada no dia X, vendida no dia X+4"), sem `JOIN`
 * entre tabelas de formatos diferentes.
 *
 * **A conta não autentica.** O hash gravado não é hash de senha nenhuma:
 * `bcrypt.compare` devolve `false` para qualquer entrada, inclusive string
 * vazia, porque o valor não tem o formato que o algoritmo espera. E o papel é
 * `ATENDENTE`, o menor privilégio disponível — se um dia alguém trocar o hash
 * por um válido, a conta ainda não gerencia nada.
 *
 * A análise dos dados do piloto precisa saber excluí-la ao contar ações
 * humanas; está registrado em `docs/notas-para-artigo.md`.
 */

export const EMAIL_DO_SISTEMA = 'sistema@estoque.local'

/**
 * A conta em si, exportada para que o `seed.ts` crie exatamente a mesma —
 * ele usa um `PrismaClient` próprio e não pode chamar a função abaixo. Dois
 * literais soltos divergiriam, e o que divergiria seria o do seed, que
 * ninguém lê.
 *
 * `senhaHash` não é hash de senha nenhuma: bcrypt produz 60 caracteres no
 * formato `$2b$...`, e `compare` recusa qualquer coisa fora dele.
 */
export const DADOS_DO_USUARIO_DO_SISTEMA = {
  nome: 'Sistema (varredura automática)',
  email: EMAIL_DO_SISTEMA,
  senhaHash: 'sem-senha:conta-de-sistema-nao-autentica',
  papel: Papel.ATENDENTE,
} as const

/**
 * O usuário de sistema, criado na primeira vez que for preciso.
 *
 * Idempotente por `upsert` na chave natural (o e-mail é `@unique`): a
 * varredura roda indefinidamente e não pode acumular contas. O `seed.ts`
 * também o cria, para que o banco de demonstração já o tenha antes da primeira
 * varredura — mas a varredura não depende de o seed ter rodado.
 */
export function usuarioDoSistema(): Promise<Usuario> {
  return prisma.usuario.upsert({
    where: { email: EMAIL_DO_SISTEMA },
    // Nunca sobrescreve: se alguém renomeou a conta no banco, o nome é dele.
    update: {},
    create: { ...DADOS_DO_USUARIO_DO_SISTEMA },
  })
}
