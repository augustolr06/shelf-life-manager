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
  // De quanto em quanto tempo a varredura de alertas roda (T18). Padrão 24h:
  // a janela da RF08 é medida em dias, então varrer com mais frequência não
  // muda o resultado — a segunda passagem do dia é no-op por construção. A
  // variável existe para que a demonstração possa usar um valor curto sem
  // alterar código.
  ALERTA_INTERVALO_HORAS: Number(process.env.ALERTA_INTERVALO_HORAS ?? 24),
  // As chaves VAPID do Web Push (T19b) **não** entram aqui, e são a única
  // exceção deste módulo: elas são opcionais (sem elas o servidor sobe inteiro,
  // só sem notificação) e precisam ser lidas a cada uso, não uma vez no import
  // — quem as lê é `modules/push/vapid.ts`, que documenta o motivo. Os nomes
  // das variáveis estão em `.env.example`.
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
} as const
