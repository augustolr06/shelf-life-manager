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
  // Segredo de assinatura do JWT de sessão (T03). Obrigatório: sem ele o
  // servidor não deve subir com um valor padrão adivinhável.
  JWT_SECRET: obrigatoria('JWT_SECRET'),
  PORT: Number(process.env.PORT ?? 3333),
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
} as const
