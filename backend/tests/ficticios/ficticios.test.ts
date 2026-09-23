/**
 * Cadastro e remoção de produtos fictícios contra PostgreSQL de verdade.
 *
 * O objeto de teste da remoção está no banco: ela desliga e religa o trigger
 * append-only do `EventoLog` dentro de uma transação, e só um Postgres real
 * diz se o trigger voltou e se o `DELETE` alcançou só o que devia.
 */

import { Papel, type PrismaClient, StatusUnidade, type Usuario } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/db/prisma.js', async () => {
  const { clienteCompartilhadoDeTeste } = await import('../apoio/bancoDeTeste.js')
  return { prisma: clienteCompartilhadoDeTeste() }
})

import { cadastrarFicticios, removerFicticios } from '../../src/db/ficticios/ficticios.js'
import { lerPlanilha, type ProdutoFicticio } from '../../src/db/ficticios/planilha.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { criarProduto, criarUnidade, criarUsuario } from '../apoio/cenario.js'

let prisma: PrismaClient
let gestor: Usuario

const PLANILHA = [
  'codigoInterno;nome;marca;categoria;validade;quantidade',
  'zz-alfa;TESTE Alfa;Marca;Perfumaria;HOJE+60;2',
  'ZZ-ALFA;;;;HOJE+200;1',
  'ZZ-EPS;TESTE Épsilon;Marca;Corpo;;',
].join('\n')

function produtosDaPlanilha(): ProdutoFicticio[] {
  const planilha = lerPlanilha(PLANILHA)
  if (!planilha.ok) throw new Error(planilha.erros.join('\n'))
  return planilha.produtos
}

beforeAll(async () => {
  await prepararBancoDeTeste()
  prisma = clienteCompartilhadoDeTeste()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await limparBanco(prisma)
  gestor = await criarUsuario(prisma, Papel.GESTOR)
})

describe('cadastro a partir da planilha', () => {
  it('cria produtos e unidades pelos serviços da aplicação, com evento por unidade', async () => {
    const resultado = await cadastrarFicticios(produtosDaPlanilha(), gestor.email)

    expect(resultado.ok).toBe(true)
    const alfa = await prisma.produto.findUniqueOrThrow({
      where: { codigoInterno: 'ZZ-ALFA' },
      include: { unidades: true },
    })
    expect(alfa.unidades).toHaveLength(3)
    expect(alfa.unidades.every((unidade) => unidade.registradoPorId === gestor.id)).toBe(true)
    expect(await prisma.produto.findUnique({ where: { codigoInterno: 'ZZ-EPS' } })).not.toBeNull()
    expect(await prisma.eventoLog.count({ where: { tipoEvento: 'UNIDADE_CADASTRADA' } })).toBe(3)
  })

  it('rodar duas vezes não duplica o estoque de teste', async () => {
    await cadastrarFicticios(produtosDaPlanilha(), gestor.email)
    const segunda = await cadastrarFicticios(produtosDaPlanilha(), gestor.email)

    expect(segunda.ok && segunda.produtos.map((produto) => produto.situacao)).toEqual([
      'JA_EXISTIA',
      'JA_EXISTIA',
    ])
    expect(await prisma.unidadeProduto.count()).toBe(3)
  })

  it('recusa quem registra se a conta não existe, sem gravar nada', async () => {
    const resultado = await cadastrarFicticios(produtosDaPlanilha(), 'ninguem@estoque.local')

    expect(resultado.ok).toBe(false)
    expect(await prisma.produto.count()).toBe(0)
  })
})

describe('remoção', () => {
  /** Um produto fictício que passou pelo sistema inteiro, e um real ao lado. */
  async function cenarioUsado() {
    await cadastrarFicticios(produtosDaPlanilha(), gestor.email)
    const [vendida, descartada, alertada] = await prisma.unidadeProduto.findMany({
      where: { produto: { codigoInterno: 'ZZ-ALFA' } },
    })

    await prisma.unidadeProduto.update({ where: { id: vendida!.id }, data: { status: StatusUnidade.VENDIDA } })
    await prisma.saida.create({ data: { unidadeId: vendida!.id, usuarioId: gestor.id } })
    await prisma.unidadeProduto.update({
      where: { id: descartada!.id },
      data: { status: StatusUnidade.DESCARTADA },
    })
    await prisma.descarte.create({ data: { unidadeId: descartada!.id, usuarioId: gestor.id, motivo: 'teste' } })
    const configuracao = await prisma.configuracaoAlerta.create({ data: { diasAntecedencia: 90, canal: 'IN_APP' } })
    await prisma.alerta.create({ data: { unidadeId: alertada!.id, configuracaoId: configuracao.id } })
    await prisma.eventoLog.create({
      data: {
        tipoEvento: 'ALERTA_FIFO_DISPARADO',
        unidadeId: vendida!.id,
        produtoId: vendida!.produtoId,
        usuarioId: gestor.id,
        payload: {},
      },
    })

    const real = await criarProduto(prisma)
    const unidadeReal = await criarUnidade(prisma, {
      produtoId: real.id,
      registradoPorId: gestor.id,
      diasAteVencer: 30,
    })
    await prisma.eventoLog.create({
      data: {
        tipoEvento: 'UNIDADE_CADASTRADA',
        unidadeId: unidadeReal.id,
        produtoId: real.id,
        usuarioId: gestor.id,
        payload: {},
      },
    })
    // A leitura de um QR inexistente não aponta para produto nenhum: fica.
    await prisma.eventoLog.create({
      data: { tipoEvento: 'LEITURA_QR_SAIDA', usuarioId: gestor.id, payload: { codigoQr: 'PRF-000000' } },
    })

    return { real }
  }

  it('sem confirmar, só levanta o que apagaria', async () => {
    await cenarioUsado()

    const levantamento = await removerFicticios(false)

    expect(levantamento).toMatchObject({ unidades: 3, saidas: 1, descartes: 1, alertas: 1, eventos: 4 })
    expect(levantamento.produtos.map((produto) => produto.codigoInterno)).toEqual(['ZZ-ALFA', 'ZZ-EPS'])
    expect(await prisma.produto.count()).toBe(3)
    expect(await prisma.eventoLog.count()).toBe(6)
  })

  it('confirmada, apaga o fictício inteiro — eventos inclusive — e só ele', async () => {
    const { real } = await cenarioUsado()

    await removerFicticios(true)

    expect(await prisma.produto.findMany({ select: { id: true } })).toEqual([{ id: real.id }])
    expect(await prisma.unidadeProduto.count()).toBe(1)
    expect(await prisma.saida.count()).toBe(0)
    expect(await prisma.descarte.count()).toBe(0)
    expect(await prisma.alerta.count()).toBe(0)
    const restantes = await prisma.eventoLog.findMany({ orderBy: { tipoEvento: 'asc' } })
    expect(restantes.map((evento) => [evento.tipoEvento, evento.produtoId])).toEqual([
      ['LEITURA_QR_SAIDA', null],
      ['UNIDADE_CADASTRADA', real.id],
    ])
  })

  it('religa o trigger append-only ao terminar', async () => {
    await cenarioUsado()
    await removerFicticios(true)

    const evento = await prisma.eventoLog.findFirstOrThrow()
    await expect(prisma.eventoLog.delete({ where: { id: evento.id } })).rejects.toThrow(/append-only/i)
  })

  it('sem produto fictício no banco, não faz nada', async () => {
    const levantamento = await removerFicticios(true)

    expect(levantamento.produtos).toEqual([])
  })
})
