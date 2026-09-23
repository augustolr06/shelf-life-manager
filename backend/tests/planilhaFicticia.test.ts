/**
 * Leitura da planilha de produtos fictícios — sem banco: a planilha é
 * validada inteira antes de qualquer escrita, e é essa validação que se testa.
 */
import { describe, expect, it } from 'vitest'
import { interpretarValidade, lerPlanilha } from '../src/db/ficticios/planilha.js'

const HOJE = new Date(Date.UTC(2026, 8, 22))
const CABECALHO = 'codigoInterno;nome;marca;categoria;validade;quantidade'

function ler(...linhas: string[]) {
  return lerPlanilha([CABECALHO, ...linhas].join('\n'), HOJE)
}

describe('lerPlanilha', () => {
  it('junta as linhas do mesmo produto, que herdam a descrição da primeira', () => {
    const planilha = ler('zz-alfa;Alfa;Marca;Perfumaria;HOJE+10;2', 'ZZ-ALFA;;;;2027-01-31;1')

    expect(planilha).toEqual({
      ok: true,
      produtos: [
        {
          codigoInterno: 'ZZ-ALFA',
          nome: 'Alfa',
          marca: 'Marca',
          categoria: 'Perfumaria',
          itens: [
            { dataValidade: '2026-10-02', quantidade: 2 },
            { dataValidade: '2027-01-31', quantidade: 1 },
          ],
        },
      ],
    })
  })

  it('aceita o CSV do Excel: BOM, separador vírgula, aspas e CRLF', () => {
    const texto = '﻿codigoInterno,nome,marca,categoria,validade,quantidade\r\nZZ-A,"Perfume ""Um"", 50ml",M,C,,\r\n'

    const planilha = lerPlanilha(texto, HOJE)

    expect(planilha.ok && planilha.produtos[0]).toMatchObject({ nome: 'Perfume "Um", 50ml', itens: [] })
  })

  it('recusa código sem o prefixo ZZ- — é o que a remoção procura depois', () => {
    expect(ler('PRF-001;Real;Marca;Cat;HOJE;1')).toEqual({
      ok: false,
      erros: ['linha 2: codigoInterno "PRF-001" precisa começar com ZZ-'],
    })
  })

  it('junta todos os erros, com o número da linha, em vez de parar no primeiro', () => {
    const planilha = ler(
      'ZZ-A;;Marca;Cat;HOJE;1',
      'ZZ-B;B;Marca;Cat;31/02/2027;1',
      'ZZ-C;C;Marca;Cat;HOJE;0',
      'ZZ-C;Outro;;;HOJE;1',
    )

    expect(planilha.ok).toBe(false)
    expect(!planilha.ok && planilha.erros).toEqual([
      'linha 2: primeira linha de ZZ-A sem nome',
      'linha 3: validade "31/02/2027" não é AAAA-MM-DD, DD/MM/AAAA nem HOJE±N',
      'linha 4: quantidade "0" precisa ser inteiro de 1 a 200',
      'linha 5: nome "Outro" diverge de "C", da primeira linha de ZZ-C',
    ])
  })

  it('recusa planilha sem as colunas esperadas', () => {
    expect(lerPlanilha('codigo;nome\nZZ-A;A', HOJE).ok).toBe(false)
  })
})

describe('interpretarValidade', () => {
  it.each([
    ['HOJE', '2026-09-22'],
    ['hoje-5', '2026-09-17'],
    ['HOJE + 100', '2026-12-31'],
    ['01/03/2027', '2027-03-01'],
    ['2027-03-01', '2027-03-01'],
  ])('%s → %s', (texto, esperado) => {
    expect(interpretarValidade(texto, HOJE)).toBe(esperado)
  })

  it.each(['2027-02-30', '1/3/2027', 'amanhã', ''])('recusa %j', (texto) => {
    expect(interpretarValidade(texto, HOJE)).toBeNull()
  })
})
