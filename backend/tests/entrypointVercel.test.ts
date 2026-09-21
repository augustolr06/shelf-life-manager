import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * O entrypoint que a Vercel escolhe para o backend (T23, deploy).
 *
 * O builder de Fastify (`@vercel/fastify`, via `generateNodeBuilderFunctions`
 * de `@vercel/build-utils`) procura `app`, `index` e `server`, em `src/` e na
 * raiz, e aceita só os arquivos cujo **texto** casa com o regex abaixo — copiado
 * do builder. Vence o primeiro da lista que casar. Os dois modos de falhar já
 * aconteceram no primeiro deploy, e nenhum aparece em teste de rota nem em
 * execução local, porque localmente quem escolhe o entrypoint é o `npm start`:
 *
 *   - a fábrica se chamava `src/app.ts`, casava e era escolhida, e toda
 *     requisição morria com "Invalid export found in module";
 *   - renomeada a fábrica, o `server.ts` não importava `fastify`, e o build
 *     falhava com "No entrypoint found which imports fastify".
 */
const REGEX_DA_VERCEL = /(?:from|require|import)\s*(?:\(\s*)?["']fastify["']\s*(?:\))?/g

const RAIZ = join(import.meta.dirname, '..')
const NOMES = ['src/app', 'src/index', 'src/server', 'app', 'index', 'server']
const EXTENSOES = ['js', 'mjs', 'cjs', 'ts', 'cts', 'mts']

function candidatosQueCasam(): string[] {
  return NOMES.flatMap((nome) => EXTENSOES.map((ext) => `${nome}.${ext}`))
    .filter((caminho) => existsSync(join(RAIZ, caminho)))
    .filter((caminho) => readFileSync(join(RAIZ, caminho), 'utf-8').match(REGEX_DA_VERCEL) !== null)
}

describe('entrypoint do backend na Vercel', () => {
  it('src/server.ts é o primeiro candidato que casa — e o único', () => {
    expect(candidatosQueCasam()).toEqual(['src/server.ts'])
  })
})
