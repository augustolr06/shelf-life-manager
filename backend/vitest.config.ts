import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    /**
     * Arquivos de teste rodam um de cada vez.
     *
     * As suítes com banco real (`tests/fifo`, `tests/saida`) dividem o mesmo
     * `estoque_fifo_test` e truncam todas as tabelas entre um caso e outro.
     * Em paralelo, uma apaga os dados da outra no meio da execução — foi o que
     * aconteceu ao chegar a segunda suíte com banco, em T08. Isolar por banco
     * separado seria a alternativa; não compensa na escala deste projeto, e o
     * custo desta escolha é nulo na prática (a suíte inteira leva o mesmo
     * tempo, porque o gargalo é o banco, não a CPU).
     */
    fileParallelism: false,
  },
})
