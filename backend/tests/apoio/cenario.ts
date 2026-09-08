/**
 * Construtores de cenário para as suítes com banco real.
 *
 * Todas as datas são derivadas de `hojeComoData()`, nunca de literais como
 * '2026-09-01': o objeto de teste da validação FIFO é justamente a comparação
 * com "hoje", e uma suíte com datas fixas começa a mentir assim que o
 * calendário avança do dia em que ela foi escrita.
 */

import { Papel, type PrismaClient, StatusUnidade, type UnidadeProduto, type Usuario } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { NOME_COOKIE_SESSAO } from '../../src/modules/auth/cookie.js'
import type { PayloadToken } from '../../src/modules/auth/tipos.js'
import { hojeComoData } from '../../src/shared/data.js'
import { gerarCodigosQr } from '../../src/modules/unidade/codigoQr.js'

let sequencial = 0
function proximo(): number {
  return (sequencial += 1)
}

/** Uma data de calendário a N dias de hoje. N negativo é passado. */
export function emDias(dias: number): Date {
  const hoje = hojeComoData()
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + dias))
}

export function criarUsuario(prisma: PrismaClient, papel: Papel = Papel.ATENDENTE) {
  const n = proximo()
  return prisma.usuario.create({
    data: {
      nome: `Usuário de Teste ${n}`,
      email: `teste-${n}@estoque.local`,
      // As suítes com banco não exercitam login; o hash só precisa existir.
      senhaHash: 'hash-irrelevante-para-esta-suite',
      papel,
    },
  })
}

export function criarProduto(prisma: PrismaClient, nome = 'Eau de Parfum 50ml') {
  const n = proximo()
  return prisma.produto.create({
    data: {
      codigoInterno: `PRF-${String(n).padStart(3, '0')}`,
      nome,
      marca: 'Marca Exemplo',
      categoria: 'Perfumaria',
    },
  })
}

/**
 * Uma unidade física do SKU, posicionada no calendário por `diasAteVencer`.
 * `0` é uma unidade que vence hoje; negativo é uma unidade já vencida.
 */
export function criarUnidade(
  prisma: PrismaClient,
  dados: {
    produtoId: string
    registradoPorId: string
    diasAteVencer: number
    status?: StatusUnidade
  },
): Promise<UnidadeProduto> {
  return prisma.unidadeProduto.create({
    data: {
      produtoId: dados.produtoId,
      registradoPorId: dados.registradoPorId,
      codigoQr: gerarCodigosQr(1)[0] as string,
      dataValidade: emDias(dados.diasAteVencer),
      status: dados.status ?? StatusUnidade.EM_ESTOQUE,
    },
  })
}

export function eventosDe(prisma: PrismaClient, tipoEvento: string) {
  return prisma.eventoLog.findMany({ where: { tipoEvento } })
}

/**
 * O cookie de sessão de um usuário já existente no banco, para `app.inject()`.
 *
 * Assina o token direto em vez de passar por `POST /auth/login`: o cenário
 * cria usuários com hash de senha inventado (login não é o objeto destas
 * suítes), e o payload é o mesmo que a rota de login monta.
 */
export function cookieDeSessao(app: FastifyInstance, usuario: Usuario): Record<string, string> {
  const payload: PayloadToken = {
    sub: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
  }
  return { [NOME_COOKIE_SESSAO]: app.jwt.sign(payload) }
}
