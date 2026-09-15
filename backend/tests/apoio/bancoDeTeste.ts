/**
 * Infraestrutura das suítes que exigem PostgreSQL de verdade.
 *
 * Até T05 todas as suítes rodavam com o Prisma Client substituído por um
 * duplo, porque o que elas provavam era contrato de rota. A partir de T06 o
 * objeto de teste é outro: o lock `SELECT ... FOR UPDATE` da RNF02 e a
 * comparação de `DATE` da RNF01 não existem fora do banco — um mock que os
 * "reproduzisse" estaria só repetindo a resposta que se quer verificar.
 *
 * O banco é o `estoque_fifo_test`, separado do `estoque_fifo` de trabalho
 * manual (decisão de 2026-09-07): a suíte trunca todas as tabelas entre os
 * testes, e apontar para o banco de desenvolvimento destruiria o seed e os
 * dados da conferência manual.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

const executar = promisify(execFile)

const RAIZ_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CAMINHO_ENV_TESTE = path.join(RAIZ_BACKEND, '.env.test')

/**
 * A URL do banco de teste vem só do `.env.test` — nunca do `.env`, nem do
 * ambiente do processo. Ler qualquer outra fonte abriria a chance de a suíte
 * truncar o banco de desenvolvimento por engano de configuração.
 */
function urlDoBancoDeTeste(): string {
  if (!existsSync(CAMINHO_ENV_TESTE)) {
    throw new Error(
      `Arquivo ${CAMINHO_ENV_TESTE} não encontrado.\n` +
        'Copie backend/.env.test.example para backend/.env.test antes de rodar a suíte.',
    )
  }

  const { parsed, error } = dotenv.config({ path: CAMINHO_ENV_TESTE, processEnv: {} })
  if (error) throw error

  const url = parsed?.DATABASE_URL
  if (!url) throw new Error(`DATABASE_URL ausente em ${CAMINHO_ENV_TESTE}.`)

  const nome = new URL(url).pathname.replace(/^\//, '')
  if (!nome.endsWith('_test')) {
    // Trava deliberada: a suíte trunca tudo o que encontra. Se a URL não
    // aponta para um banco de teste, é mais provável ser engano do que
    // intenção.
    throw new Error(
      `Recusado: DATABASE_URL de ${CAMINHO_ENV_TESTE} aponta para "${nome}", ` +
        'que não termina em "_test". A suíte apaga todas as tabelas do banco que usa.',
    )
  }

  return url
}

export const URL_BANCO_DE_TESTE = urlDoBancoDeTeste()

/** A mesma URL, apontando para o banco de manutenção `postgres`. */
function urlDeManutencao(): string {
  const url = new URL(URL_BANCO_DE_TESTE)
  url.pathname = '/postgres'
  url.search = ''
  return url.toString()
}

function nomeDoBanco(): string {
  return new URL(URL_BANCO_DE_TESTE).pathname.replace(/^\//, '')
}

/**
 * Cria o banco de teste se ele ainda não existir e aplica as migrações.
 * Idempotente: rodar com o banco já pronto não faz nada além de conferir.
 */
async function prepararUmaVez(): Promise<void> {
  const manutencao = new PrismaClient({ datasources: { db: { url: urlDeManutencao() } } })

  try {
    await manutencao.$connect()
  } catch (erro) {
    // O erro cru do Prisma para container fora do ar é P1001 com a URL
    // inteira — pouco útil para quem só esqueceu de subir o docker.
    throw new Error(
      `Não foi possível conectar ao PostgreSQL em ${new URL(URL_BANCO_DE_TESTE).host}.\n` +
        'Suba o banco antes de rodar a suíte:  docker compose up -d\n' +
        'Para rodar apenas as suítes que não precisam de banco:  npm run test:sem-banco\n' +
        `Causa original: ${erro instanceof Error ? erro.message.split('\n')[0] : String(erro)}`,
      { cause: erro },
    )
  }

  try {
    const existentes = await manutencao.$queryRaw<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname = ${nomeDoBanco()}
    `
    // CREATE DATABASE não aceita parâmetro nem roda dentro de transação; o
    // nome vem do .env.test e já foi validado contra o sufixo _test.
    if (existentes.length === 0) {
      await manutencao.$executeRawUnsafe(`CREATE DATABASE "${nomeDoBanco()}"`)
    }
  } finally {
    await manutencao.$disconnect()
  }

  // `migrate deploy` e não `migrate dev`: aplica as migrações versionadas sem
  // tentar gerar migração nova nem pedir confirmação.
  //
  // **As duas variáveis, e não só `DATABASE_URL`.** Desde T23 o datasource tem
  // `directUrl`, e é ela que o `prisma migrate` usa — com apenas `DATABASE_URL`
  // sobrescrita aqui, o `DIRECT_URL` do `.env` vazaria do `process.env` e a
  // suíte migraria o **banco de desenvolvimento**, furando a trava que este
  // módulo inteiro existe para manter. Descoberto em T22, na primeira migração
  // criada depois de T23: a suíte falhou com "a coluna `ativo` não existe",
  // porque a migração tinha ido para o banco errado.
  await executar('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: RAIZ_BACKEND,
    env: {
      ...process.env,
      DATABASE_URL: URL_BANCO_DE_TESTE,
      DIRECT_URL: URL_BANCO_DE_TESTE,
    },
  })
}

let preparacao: Promise<void> | undefined

/** Memoizado: vários arquivos de teste no mesmo worker preparam uma vez só. */
export function prepararBancoDeTeste(): Promise<void> {
  preparacao ??= prepararUmaVez()
  return preparacao
}

export function criarClienteDeTeste(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: URL_BANCO_DE_TESTE } } })
}

/**
 * Zera o banco entre os testes.
 *
 * A lista de tabelas é lida do catálogo do Postgres em vez de escrita à mão,
 * para que uma entidade nova no schema não deixe resíduo silencioso entre um
 * teste e outro.
 *
 * O `TRUNCATE` alcança também o `EventoLog`. Isso não contraria a RNF05, que
 * proíbe `UPDATE`/`DELETE` na tabela **pela aplicação** — aqui é a preparação
 * de um banco descartável, e nenhum código de produção passa por este módulo.
 */
export async function limparBanco(prisma: PrismaClient): Promise<void> {
  const tabelas = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `

  if (tabelas.length === 0) return

  const lista = tabelas.map((t) => `"public"."${t.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`)
}

/**
 * O mesmo client, memoizado.
 *
 * As suítes de endpoint precisam que o app e o próprio teste falem com a
 * mesma conexão: o app chega ao banco por `src/db/prisma.ts`, que é um client
 * único apontado para o `DATABASE_URL` de desenvolvimento. Substituir aquele
 * módulo por este client redireciona o destino sem trocar o comportamento —
 * é Prisma de verdade contra Postgres de verdade, só que no banco descartável.
 */
let compartilhado: PrismaClient | undefined

export function clienteCompartilhadoDeTeste(): PrismaClient {
  compartilhado ??= criarClienteDeTeste()
  return compartilhado
}
