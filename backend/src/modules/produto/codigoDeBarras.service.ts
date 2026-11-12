import type { Produto } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { fonteSi5, type FonteDeProduto, type MotivoIndisponivel, type RegistroDeAviso } from './fonteSi5.js'
import { validarGtin } from './gtin.js'
import { listarCategorias } from './produto.service.js'

/** O que a fonte externa sabe do produto, já na forma dos campos do cadastro. */
export type SugestaoProduto = {
  codigoInterno: string
  nome: string
  marca: string | null
  categoria: string | null
  imagemUrl: string | null
}

/**
 * Desfechos da consulta pelo código de barras (T47). Como em
 * `produto.service.ts`, o serviço descreve o que aconteceu e a rota decide o
 * status HTTP: só `CODIGO_INVALIDO` vira recusa (400). Os outros quatro são
 * respostas normais — não achar o produto não é erro de quem perguntou.
 */
export type ConsultaCodigoDeBarras =
  | { situacao: 'JA_CADASTRADO'; produto: Produto }
  | { situacao: 'ENCONTRADO'; fonte: string; sugestao: SugestaoProduto }
  | { situacao: 'NAO_ENCONTRADO' }
  | { situacao: 'INDISPONIVEL'; motivo: MotivoIndisponivel }
  | { situacao: 'CODIGO_INVALIDO'; motivo: 'FORMATO' | 'DIGITO_VERIFICADOR' }

const ORDEM_PT_BR = new Intl.Collator('pt-BR', { sensitivity: 'base' })

/**
 * A ordem dos passos é o que economiza a cota diária da fonte (30 consultas
 * no plano gratuito):
 *
 * 1. **Catálogo da loja primeiro**, para qualquer formato de código. Um
 *    produto já cadastrado responde daqui, sem consulta externa — inclusive o
 *    `SEMCOD-…`, que não é GTIN, e o EAN com dígito errado que tenha entrado
 *    pela planilha antes desta validação existir.
 * 2. **Validação do GTIN**: código digitado errado é recusado aqui, e não
 *    gasta consulta para voltar como "não encontrado".
 * 3. **A fonte externa**, só para o GTIN válido que a loja ainda não tem.
 */
export async function consultarCodigoDeBarras(
  codigo: string,
  log: RegistroDeAviso,
  fonte: FonteDeProduto = fonteSi5,
): Promise<ConsultaCodigoDeBarras> {
  // A normalização do cadastro (`normalizarDadosProduto`: pontas aparadas e
  // maiúsculas), mais os espaços do meio — código de barras copiado de nota
  // fiscal costuma vir em grupos ("7 891234 567895").
  const normalizado = codigo.trim().toUpperCase().replace(/\s+/g, '')

  const existente = await prisma.produto.findUnique({ where: { codigoInterno: normalizado } })
  if (existente) return { situacao: 'JA_CADASTRADO', produto: existente }

  const gtin = validarGtin(normalizado)
  if (!gtin.ok) return { situacao: 'CODIGO_INVALIDO', motivo: gtin.motivo }

  const resposta = await fonte.consultar(normalizado, log)
  if (resposta.tipo === 'NAO_ENCONTRADO') return { situacao: 'NAO_ENCONTRADO' }
  if (resposta.tipo === 'INDISPONIVEL') return { situacao: 'INDISPONIVEL', motivo: resposta.motivo }

  const { nome, marca, categoria, imagemUrl } = resposta.dados
  return {
    situacao: 'ENCONTRADO',
    fonte: fonte.nome,
    sugestao: {
      codigoInterno: normalizado,
      nome,
      marca,
      categoria: categoria ? await categoriaDaLoja(categoria) : null,
      imagemUrl,
    },
  }
}

/**
 * A categoria da fonte entra como veio (decisão do orientando, T47), com uma
 * exceção: se ela é uma categoria que a loja já tem, escrita com outra caixa
 * ou sem acento ("TONALIZANTE", "coloracao"), volta com a grafia da loja.
 * Senão o filtro do Catálogo ganharia duas pílulas para a mesma coisa — o que
 * as sugestões do campo Categoria (T45) existem para evitar.
 */
async function categoriaDaLoja(categoria: string): Promise<string> {
  const existentes = await listarCategorias()
  return existentes.find((existente) => ORDEM_PT_BR.compare(existente, categoria) === 0) ?? categoria
}
