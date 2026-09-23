/**
 * Importação do catálogo por planilha CSV (T24), pela rota e contra
 * PostgreSQL de verdade: o que se testa é o que chega ao banco — nada, quando a
 * planilha tem problema, e só o que não existia, quando não tem.
 *
 * Contrato: tasks/T24-importacao-produtos-csv.md.
 */

import { Papel, type PrismaClient, type Usuario } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/db/prisma.js', async () => {
  const { clienteCompartilhadoDeTeste } = await import('../apoio/bancoDeTeste.js')
  return { prisma: clienteCompartilhadoDeTeste() }
})

import { buildApp } from '../../src/buildApp.js'
import { clienteCompartilhadoDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { cookieDeSessao, criarUsuario } from '../apoio/cenario.js'

let prisma: PrismaClient
let app: FastifyInstance
let gestor: Usuario
let atendente: Usuario

const CABECALHO = 'codigoInterno;nome;marca;categoria'

function importar(conteudo: string, usuario: Usuario = gestor) {
  return app.inject({
    method: 'POST',
    url: '/produtos/importar',
    cookies: cookieDeSessao(app, usuario),
    payload: { conteudo },
  })
}

function planilha(...linhas: string[]): string {
  return [CABECALHO, ...linhas].join('\r\n')
}

beforeAll(async () => {
  await prepararBancoDeTeste()
  prisma = clienteCompartilhadoDeTeste()
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await limparBanco(prisma)
  gestor = await criarUsuario(prisma, Papel.GESTOR)
  atendente = await criarUsuario(prisma, Papel.ATENDENTE)
})

describe('POST /produtos/importar', () => {
  it('cadastra os produtos com a mesma normalização do formulário', async () => {
    const resposta = await importar(
      planilha('prf-001;  Eau de Parfum 50ml ;Marca A;Perfumaria', 'PRF-002;Creme 200g;Marca B;Pele'),
    )

    expect(resposta.statusCode).toBe(200)
    expect(resposta.json()).toEqual({ criados: 2, ignorados: [] })
    const gravados = await prisma.produto.findMany({ orderBy: { codigoInterno: 'asc' } })
    expect(gravados.map((p) => [p.codigoInterno, p.nome, p.ativo])).toEqual([
      ['PRF-001', 'Eau de Parfum 50ml', true],
      ['PRF-002', 'Creme 200g', true],
    ])
  })

  it('pula o código já cadastrado, avisa qual foi, e não o altera', async () => {
    await prisma.produto.create({
      data: { codigoInterno: 'PRF-001', nome: 'Nome ajustado pela gestora', marca: 'M', categoria: 'C' },
    })

    const resposta = await importar(planilha('PRF-001;Nome da planilha;M;C', 'PRF-002;Novo;M;C'))

    expect(resposta.json()).toEqual({ criados: 1, ignorados: [{ linha: 2, codigoInterno: 'PRF-001' }] })
    const existente = await prisma.produto.findUniqueOrThrow({ where: { codigoInterno: 'PRF-001' } })
    expect(existente.nome).toBe('Nome ajustado pela gestora')
  })

  it('reenviar a mesma planilha não duplica nada', async () => {
    const conteudo = planilha('PRF-001;A;M;C', 'PRF-002;B;M;C')
    await importar(conteudo)

    const segunda = await importar(conteudo)

    expect(segunda.json()).toMatchObject({ criados: 0 })
    expect(await prisma.produto.count()).toBe(2)
  })

  it('com um problema só, recusa a planilha inteira e lista todas as linhas a corrigir', async () => {
    const resposta = await importar(
      planilha(
        'PRF-001;Bom;M;C',
        'PRF-002;;M;C',
        `PRF-003;${'x'.repeat(121)};M;C`,
        'prf-001;Repetido;M;C',
      ),
    )

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json()).toMatchObject({
      erro: 'PLANILHA_INVALIDA',
      erros: [
        'Linha 3: nome em branco.',
        'Linha 4: nome com mais de 120 caracteres.',
        'Linha 5: código PRF-001 repetido (já aparece na linha 2).',
      ],
    })
    expect(await prisma.produto.count()).toBe(0)
  })

  it('acha as colunas pelo nome, em qualquer ordem e grafia, e ignora as extras', async () => {
    const conteudo = [
      'Preço,Categoria,Nome,Código Interno,Marca,Fornecedor',
      '"89,90",Perfumaria,"Perfume ""Noite"", 50ml",prf-010,Marca A,Distribuidora X',
    ].join('\n')

    const resposta = await importar(conteudo)

    expect(resposta.json()).toEqual({ criados: 1, ignorados: [] })
    expect(await prisma.produto.findUniqueOrThrow({ where: { codigoInterno: 'PRF-010' } })).toMatchObject({
      nome: 'Perfume "Noite", 50ml',
      marca: 'Marca A',
      categoria: 'Perfumaria',
    })
  })

  it('recusa cabeçalho sem as colunas obrigatórias, dizendo quais faltam', async () => {
    const resposta = await importar('codigo;descricao\nPRF-001;Perfume')

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erros[0]).toMatch(/^Linha 1: faltam as colunas código interno, nome, marca, categoria/)
  })

  it('recusa planilha só com cabeçalho', async () => {
    const resposta = await importar(CABECALHO)

    expect(resposta.statusCode).toBe(400)
    expect(resposta.json().erros).toEqual(['A planilha não tem nenhum produto abaixo do cabeçalho.'])
  })

  it('lista no máximo 50 problemas, e diz quantos ficaram de fora', async () => {
    const linhas = Array.from({ length: 60 }, (_, i) => `PRF-${i};;M;C`)

    const erros: string[] = (await importar(planilha(...linhas))).json().erros

    expect(erros).toHaveLength(51)
    expect(erros[50]).toBe('… e mais 10 linha(s) com problema.')
  })

  it('aceita, numa requisição só, planilha acima do limite padrão de corpo do Fastify', async () => {
    // Cada campo perto do teto de 120 caracteres, como vem de fornecedor.
    const texto = 'Descrição longa como as que vêm na planilha do fornecedor '.repeat(2)
    const linhas = Array.from(
      { length: 5000 },
      (_, i) => `PRF-${String(i).padStart(4, '0')};${texto}${i};${texto};${texto}`,
    )
    const conteudo = planilha(...linhas)
    // O caso só prova o `bodyLimit` da rota se passar do 1 MiB padrão.
    expect(Buffer.byteLength(JSON.stringify({ conteudo }))).toBeGreaterThan(1024 * 1024)

    const resposta = await importar(conteudo)

    expect(resposta.json()).toEqual({ criados: 5000, ignorados: [] })
  })

  it('recusa planilha acima do teto de linhas', async () => {
    const linhas = Array.from({ length: 5001 }, (_, i) => `PRF-${i};A;M;C`)

    const resposta = await importar(planilha(...linhas))

    expect(resposta.json().erros).toEqual(['A planilha tem mais de 5000 linhas. Divida em partes.'])
  })

  it('é exclusiva do GESTOR', async () => {
    const resposta = await importar(planilha('PRF-001;A;M;C'), atendente)

    expect(resposta.statusCode).toBe(403)
    expect(await prisma.produto.count()).toBe(0)
  })
})
