import { prisma } from '../../db/prisma.js'

/**
 * A inscrição de um aparelho para receber a notificação push (RF08, T19b).
 *
 * A inscrição é **do navegador, não da pessoa**: a mesma gestora no celular e
 * no computador da loja são duas linhas, com dois `endpoint` diferentes. É
 * assim que o Web Push funciona, e é também o que a loja espera — desativar a
 * notificação no computador não deve calar o celular.
 *
 * O que este módulo guarda é credencial de envio (ver `schema.prisma`): o
 * `endpoint` não volta em resposta de API, não vai para o `EventoLog` e não
 * aparece em log de servidor. O que identifica a inscrição fora daqui é o `id`.
 */

export type DadosDeInscricao = {
  endpoint: string
  chaves: { p256dh: string; auth: string }
}

export type InscricaoNaResposta = {
  id: string
  criadoEm: string
}

export type ResultadoDaInscricao = {
  /** `false` quando o aparelho já estava inscrito e só teve as chaves trocadas. */
  criada: boolean
  inscricao: InscricaoNaResposta
}

export async function inscreverDispositivo(
  dados: DadosDeInscricao,
  usuarioId: string,
): Promise<ResultadoDaInscricao> {
  const existente = await prisma.inscricaoPush.findUnique({
    where: { endpoint: dados.endpoint },
    select: { id: true },
  })

  // Reinscrever o mesmo aparelho **atualiza**, e não é conflito: o navegador
  // renova as chaves do mesmo `endpoint` por conta própria (permissão
  // reconcedida, service worker reinstalado), e recusar com 409 deixaria o
  // aparelho inscrito com chave velha, que falha em todo envio seguinte.
  const inscricao = await prisma.inscricaoPush.upsert({
    where: { endpoint: dados.endpoint },
    update: {
      p256dh: dados.chaves.p256dh,
      auth: dados.chaves.auth,
      // O dono passa a ser quem reinscreveu: é o aparelho que está na mão de
      // alguém agora, e é o papel dessa pessoa que o envio confere.
      usuarioId,
    },
    create: {
      endpoint: dados.endpoint,
      p256dh: dados.chaves.p256dh,
      auth: dados.chaves.auth,
      usuarioId,
    },
  })

  return {
    criada: existente === null,
    inscricao: { id: inscricao.id, criadoEm: inscricao.criadoEm.toISOString() },
  }
}

/**
 * Remove a inscrição do aparelho. Endpoint desconhecido **não é erro**: o
 * estado desejado ("este aparelho não recebe notificação") já vale, e o
 * navegador pode ter cancelado a inscrição por conta própria antes de a tela
 * avisar o servidor.
 */
export async function desinscreverDispositivo(endpoint: string): Promise<void> {
  await prisma.inscricaoPush.deleteMany({ where: { endpoint } })
}
