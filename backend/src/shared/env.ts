import 'dotenv/config'

function obrigatoria(nome: string): string {
  const valor = process.env[nome]
  if (!valor) {
    throw new Error(
      `Variável de ambiente ${nome} não definida. Copie backend/.env.example para backend/.env e preencha.`,
    )
  }
  return valor
}

export const env = {
  DATABASE_URL: obrigatoria('DATABASE_URL'),
  PORT: Number(process.env.PORT ?? 3333),
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
} as const
