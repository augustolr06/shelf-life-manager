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

/**
 * Lê variável de liga/desliga. Aceita `false`/`0` como desligado e qualquer
 * outra coisa como ligado, para que um valor digitado errado no painel da
 * hospedagem não desligue silenciosamente um requisito funcional.
 */
function booleana(nome: string, padrao: boolean): boolean {
  const valor = process.env[nome]?.trim().toLowerCase()
  if (valor === undefined || valor === '') return padrao
  return valor !== 'false' && valor !== '0'
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
  // Se o relógio da RF08 roda **dentro** deste processo (T18) ou vem de um
  // agendador externo chamando `/interno/varredura-alertas` (T23, fatia 2).
  //
  // Padrão ligado, que é o comportamento de T18 e o certo em qualquer
  // hospedagem com processo de longa duração. **Precisa ser `false` em
  // serverless**: lá não há processo entre requisições, o intervalo nunca
  // dispara, e a varredura de inicialização passaria a rodar a cada cold
  // start — idempotente, mas é uma consulta ao estoque inteiro por partida.
  ALERTA_AGENDADOR_INTERNO: booleana('ALERTA_AGENDADOR_INTERNO', true),
  // As chaves VAPID do Web Push (T19b) **não** entram aqui, e são a única
  // exceção deste módulo: elas são opcionais (sem elas o servidor sobe inteiro,
  // só sem notificação) e precisam ser lidas a cada uso, não uma vez no import
  // — quem as lê é `modules/push/vapid.ts`, que documenta o motivo. Os nomes
  // das variáveis estão em `.env.example`.
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  // Verbosidade do log (T23). `info` registra uma linha por requisição, que é
  // o que permite reconstruir o que aconteceu no balcão em um dia de piloto;
  // `warn` deixa só o que precisa de atenção. Nenhum nível registra corpo de
  // requisição — o serializer padrão do Fastify grava método, URL, host e IP,
  // e é por isso que a senha enviada em `POST /auth/login` nunca chega ao log.
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
} as const
