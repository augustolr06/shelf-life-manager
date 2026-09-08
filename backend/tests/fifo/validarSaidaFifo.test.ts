/**
 * Casos de teste de `validarSaidaFifo` — o núcleo do sistema (RF06).
 *
 * ESCRITOS ANTES DA IMPLEMENTAÇÃO, como exige a seção 8 do PRD. Enquanto T07
 * não existir, esta suíte falha inteira com `NAO_IMPLEMENTADO_T07`, e isso é
 * o resultado esperado. A definição de pronto de T07 é: esta suíte passa,
 * sem que nenhum caso daqui seja editado para acomodar a implementação.
 *
 * Roda contra PostgreSQL de verdade (banco `estoque_fifo_test`, ver
 * tests/apoio/bancoDeTeste.ts). Diferente de T03–T05, aqui o mock não serve:
 * o lock da RNF02 e a semântica de `DATE` da RNF01 não existem fora do banco.
 *
 * Contrato: docs/arquitetura.md seção 4 · PRD seções 6.1, 6.2 e 7.
 */

import { Papel, type PrismaClient, type Produto, StatusUnidade, type UnidadeProduto, type Usuario } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { criarClienteDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { criarProduto, criarUnidade, criarUsuario, eventosDe } from '../apoio/cenario.js'
import { validarSaidaFifo, type Veredito } from '../../src/modules/saida/validarSaidaFifo.js'

let prisma: PrismaClient
let atendente: Usuario
let perfume: Produto

/**
 * Chama a função como T08 vai chamá-la: dentro de uma transação aberta por
 * quem chama, nunca sobre o client global. A função não abre transação
 * própria — é o chamador que delimita o escopo atômico (RNF02).
 */
function ler(codigoQr: string, usuarioId = atendente.id): Promise<Veredito> {
  return prisma.$transaction((tx) => validarSaidaFifo(codigoQr, usuarioId, tx))
}

function recarregar(unidade: UnidadeProduto) {
  return prisma.unidadeProduto.findUniqueOrThrow({ where: { id: unidade.id } })
}

function novaUnidade(diasAteVencer: number, opcoes: { status?: StatusUnidade; produto?: Produto } = {}) {
  return criarUnidade(prisma, {
    produtoId: (opcoes.produto ?? perfume).id,
    registradoPorId: atendente.id,
    diasAteVencer,
    status: opcoes.status,
  })
}

beforeAll(async () => {
  await prepararBancoDeTeste()
  prisma = criarClienteDeTeste()
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
})

beforeEach(async () => {
  await limparBanco(prisma)
  atendente = await criarUsuario(prisma, Papel.ATENDENTE)
  perfume = await criarProduto(prisma)
})

describe('validarSaidaFifo — ramo 1: QR não encontrado', () => {
  it('devolve ERRO/QR_NAO_ENCONTRADO para código não cadastrado', async () => {
    expect(await ler('PRF-ZZZZZZ')).toEqual({ tipo: 'ERRO', motivo: 'QR_NAO_ENCONTRADO' })
  })

  it('não baixa nada quando o código não existe', async () => {
    const unidade = await novaUnidade(10)

    await ler('PRF-ZZZZZZ')

    expect(await prisma.saida.count()).toBe(0)
    expect((await recarregar(unidade)).status).toBe(StatusUnidade.EM_ESTOQUE)
  })

  it('registra a leitura mesmo sem unidade, com o código no payload', async () => {
    // Ler um código que o sistema não conhece é dado de pesquisa (RF12): pode
    // ser etiqueta danificada, item de outra loja, ou unidade nunca cadastrada.
    // Sem `unidadeId` para identificá-la, o código precisa estar no payload.
    await ler('PRF-ZZZZZZ')

    const [evento] = await eventosDe(prisma, 'LEITURA_QR_SAIDA')

    expect(evento).toMatchObject({
      unidadeId: null,
      produtoId: null,
      usuarioId: atendente.id,
      payload: expect.objectContaining({ codigoQr: 'PRF-ZZZZZZ' }),
    })
  })
})

describe('validarSaidaFifo — ramo 2: unidade já baixada', () => {
  it('devolve ERRO/UNIDADE_JA_BAIXADA para unidade VENDIDA', async () => {
    const unidade = await novaUnidade(10, { status: StatusUnidade.VENDIDA })

    expect(await ler(unidade.codigoQr)).toEqual({ tipo: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
  })

  it('devolve ERRO/UNIDADE_JA_BAIXADA para unidade DESCARTADA', async () => {
    const unidade = await novaUnidade(10, { status: StatusUnidade.DESCARTADA })

    expect(await ler(unidade.codigoQr)).toEqual({ tipo: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
  })

  it('a checagem de status vem antes da de validade', async () => {
    // Unidade vencida E já descartada: o veredito é UNIDADE_JA_BAIXADA, não
    // EXCECAO_VENCIDO. A ordem das verificações da seção 7 do PRD não é
    // decorativa — mandar a atendente para o fluxo de exceção (T11) de um
    // item que já foi resolvido a faria descartar duas vezes o mesmo frasco.
    const unidade = await novaUnidade(-5, { status: StatusUnidade.DESCARTADA })

    expect(await ler(unidade.codigoQr)).toEqual({ tipo: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
  })

  it('não cria segunda Saida para unidade já vendida', async () => {
    const unidade = await novaUnidade(10, { status: StatusUnidade.VENDIDA })

    await ler(unidade.codigoQr)

    expect(await prisma.saida.count({ where: { unidadeId: unidade.id } })).toBe(0)
  })
})

describe('validarSaidaFifo — ramo 3: unidade vencida (exceção da seção 6.1)', () => {
  it('devolve EXCECAO_VENCIDO com a unidade lida', async () => {
    const vencida = await novaUnidade(-1)

    const veredito = await ler(vencida.codigoQr)

    expect(veredito.tipo).toBe('EXCECAO_VENCIDO')
    expect(veredito).toHaveProperty('unidade.id', vencida.id)
  })

  it('validade igual a hoje NÃO é vencida — segue por FIFO', async () => {
    // Borda que decide a definição de "vencido": a unidade vence no fim do
    // dia impresso, não no começo. Tratar hoje como vencido tiraria da venda
    // um item ainda válido e o empurraria para a fila de descarte.
    const venceHoje = await novaUnidade(0)

    expect((await ler(venceHoje.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('curto-circuita o FIFO mesmo havendo unidade não-vencida no mesmo SKU', async () => {
    // A vencida é a de menor validade do SKU. Se o ramo 3 não viesse antes do
    // ramo 4, ela seria tratada como "a prioritária" e confirmada.
    const vencida = await novaUnidade(-3)
    await novaUnidade(10)

    const veredito = await ler(vencida.codigoQr)

    expect(veredito.tipo).toBe('EXCECAO_VENCIDO')
    expect(veredito).toHaveProperty('unidade.id', vencida.id)
  })

  it('não baixa nem altera a unidade vencida', async () => {
    // O destino dela é decidido pelos três caminhos da seção 6.1 (T11):
    // correção de dado, descarte ou override. Nenhum deles é esta função.
    const vencida = await novaUnidade(-3)

    await ler(vencida.codigoQr)

    const depois = await recarregar(vencida)
    expect(depois.status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(depois.dataValidade).toEqual(vencida.dataValidade)
    expect(await prisma.saida.count()).toBe(0)
    expect(await prisma.descarte.count()).toBe(0)
  })

  it('grava TENTATIVA_VENDA_UNIDADE_VENCIDA', async () => {
    const vencida = await novaUnidade(-3)

    await ler(vencida.codigoQr)

    expect(await eventosDe(prisma, 'TENTATIVA_VENDA_UNIDADE_VENCIDA')).toMatchObject([
      { unidadeId: vencida.id, produtoId: perfume.id, usuarioId: atendente.id },
    ])
  })

  it('não conta como alerta de FIFO', async () => {
    // O indicador do TCC separa "pegou o frasco errado" de "pegou um frasco
    // vencido": são problemas diferentes, com respostas diferentes.
    const vencida = await novaUnidade(-3)
    await novaUnidade(10)

    await ler(vencida.codigoQr)

    expect(await eventosDe(prisma, 'ALERTA_FIFO_DISPARADO')).toHaveLength(0)
  })
})

describe('validarSaidaFifo — ramo 4: bloqueio FIFO', () => {
  it('aponta a unidade de menor validade como unidadeCorreta', async () => {
    const maisAntiga = await novaUnidade(5)
    await novaUnidade(20)
    const lida = await novaUnidade(60)

    const veredito = await ler(lida.codigoQr)

    expect(veredito.tipo).toBe('BLOQUEAR_FIFO')
    expect(veredito).toHaveProperty('unidadeCorreta.id', maisAntiga.id)
  })

  it('devolve a dataValidade da unidade correta, para a tela exibir', async () => {
    // RF06: o sistema informa a validade da unidade que deveria ter sido
    // pega. É o que permite à atendente achar o frasco certo na prateleira.
    const maisAntiga = await novaUnidade(5)
    const lida = await novaUnidade(60)

    const veredito = await ler(lida.codigoQr)

    expect(veredito).toHaveProperty('unidadeCorreta.dataValidade', maisAntiga.dataValidade)
    expect(veredito).toHaveProperty('unidadeCorreta.codigoQr', maisAntiga.codigoQr)
  })

  it('NUNCA aponta unidade vencida como unidadeCorreta', async () => {
    // Caso central do trabalho. O pool prioritário exclui vencidas
    // (`dataValidade >= hoje`, PRD 6.1): sem essa exclusão o laço FIFO
    // apontaria a unidade vencida como "a mais antiga" e empurraria
    // ativamente produto vencido para o cliente — o oposto do objetivo.
    const vencida = await novaUnidade(-10)
    const prioritaria = await novaUnidade(5)
    const lida = await novaUnidade(60)

    const veredito = await ler(lida.codigoQr)

    expect(veredito.tipo).toBe('BLOQUEAR_FIFO')
    expect(veredito).toHaveProperty('unidadeCorreta.id', prioritaria.id)
    expect(veredito).not.toHaveProperty('unidadeCorreta.id', vencida.id)
  })

  it('confirma quando a única unidade de validade menor está vencida', async () => {
    // Consequência da exclusão acima: sobrando uma só unidade não-vencida,
    // ela é a prioritária, mesmo que exista uma vencida "mais antiga".
    await novaUnidade(-10)
    const unica = await novaUnidade(30)

    expect((await ler(unica.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('ignora unidades de outro produto', async () => {
    // O pool é por SKU. Um hidratante vencendo antes não pode bloquear a
    // venda de um perfume.
    const outroProduto = await criarProduto(prisma, 'Hidratante 200ml')
    await novaUnidade(1, { produto: outroProduto })
    const unica = await novaUnidade(30)

    expect((await ler(unica.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('ignora unidades VENDIDA e DESCARTADA no pool', async () => {
    await novaUnidade(1, { status: StatusUnidade.VENDIDA })
    await novaUnidade(2, { status: StatusUnidade.DESCARTADA })
    const unica = await novaUnidade(30)

    expect((await ler(unica.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('empate de validade: ler qualquer uma das prioritárias confirma', async () => {
    // Duas unidades com a mesma menor validade são igualmente prioritárias.
    // Se a função escolhesse uma delas arbitrariamente e bloqueasse a outra,
    // a atendente que pegou a "errada" veria o sistema pedir um frasco
    // indistinguível do que está na mão dela — laço sem saída.
    const gemea = await novaUnidade(7)
    const outraGemea = await novaUnidade(7)
    await novaUnidade(40)

    expect((await ler(gemea.codigoQr)).tipo).toBe('CONFIRMAR')
    expect((await ler(outraGemea.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('não baixa nada no bloqueio', async () => {
    await novaUnidade(5)
    const lida = await novaUnidade(60)

    await ler(lida.codigoQr)

    expect((await recarregar(lida)).status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(await prisma.saida.count()).toBe(0)
  })

  it('grava ALERTA_FIFO_DISPARADO com a unidade lida e a correta', async () => {
    // `unidadeId` é a unidade LIDA — o evento descreve a leitura. A correta
    // vai no payload, porque o indicador da RF13 ("alertas disparados vs.
    // substituições efetivas") precisa cruzar as duas pontas.
    const correta = await novaUnidade(5)
    const lida = await novaUnidade(60)

    await ler(lida.codigoQr)

    expect(await eventosDe(prisma, 'ALERTA_FIFO_DISPARADO')).toMatchObject([
      {
        unidadeId: lida.id,
        produtoId: perfume.id,
        usuarioId: atendente.id,
        payload: expect.objectContaining({ unidadeCorretaId: correta.id }),
      },
    ])
  })

  it('tentativas conta as leituras erradas do ciclo corrente, inclusive a atual', async () => {
    await novaUnidade(5)
    const errada = await novaUnidade(20)
    const outraErrada = await novaUnidade(60)

    expect(await ler(errada.codigoQr)).toHaveProperty('tentativas', 1)
    expect(await ler(outraErrada.codigoQr)).toHaveProperty('tentativas', 2)
  })

  it('tentativas não conta bloqueios de outro atendente', async () => {
    // O ciclo é de um atendimento: quem está com o cliente na frente é uma
    // pessoa só. Somar as tentativas da colega inflaria o indicador.
    const outroAtendente = await criarUsuario(prisma, Papel.ATENDENTE)
    await novaUnidade(5)
    const errada = await novaUnidade(20)

    await ler(errada.codigoQr, outroAtendente.id)
    await ler(errada.codigoQr, outroAtendente.id)

    expect(await ler(errada.codigoQr)).toHaveProperty('tentativas', 1)
  })

  it('tentativas não conta bloqueios de outro SKU', async () => {
    const outroProduto = await criarProduto(prisma, 'Hidratante 200ml')
    await novaUnidade(5, { produto: outroProduto })
    const erradaDoOutro = await novaUnidade(20, { produto: outroProduto })
    await ler(erradaDoOutro.codigoQr)

    await novaUnidade(5)
    const errada = await novaUnidade(20)

    expect(await ler(errada.codigoQr)).toHaveProperty('tentativas', 1)
  })

  it('o contador recomeça depois de uma saída confirmada', async () => {
    // `tentativas` é derivado do EventoLog desde a última SAIDA_CONFIRMADA do
    // par (SKU, atendente) — não há contador persistido, porque a seção 6.2
    // do PRD proíbe estado intermediário no servidor.
    await novaUnidade(20)
    const primeira = await novaUnidade(5)
    const terceira = await novaUnidade(60)

    await ler(terceira.codigoQr)
    await ler(primeira.codigoQr)

    // Já houve um ALERTA_FIFO_DISPARADO neste par (SKU, atendente), mas ele
    // pertence ao atendimento anterior, que fechou.
    expect(await ler(terceira.codigoQr)).toHaveProperty('tentativas', 1)
  })
})

describe('validarSaidaFifo — ramo 5: confirmação', () => {
  it('confirma a unidade prioritária', async () => {
    const prioritaria = await novaUnidade(5)
    await novaUnidade(20)

    const veredito = await ler(prioritaria.codigoQr)

    expect(veredito.tipo).toBe('CONFIRMAR')
    expect(veredito).toHaveProperty('unidade.id', prioritaria.id)
  })

  it('confirma quando o SKU tem uma unidade só', async () => {
    const unica = await novaUnidade(30)

    expect((await ler(unica.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('muda o status da unidade para VENDIDA', async () => {
    const unica = await novaUnidade(30)

    await ler(unica.codigoQr)

    expect((await recarregar(unica)).status).toBe(StatusUnidade.VENDIDA)
  })

  it('cria a Saida com o usuário recebido como argumento', async () => {
    const unica = await novaUnidade(30)

    await ler(unica.codigoQr)

    // RF07: toda saída é atribuível a um usuário — é a rastreabilidade que a
    // pesquisa exige.
    expect(await prisma.saida.findUniqueOrThrow({ where: { unidadeId: unica.id } })).toMatchObject({
      usuarioId: atendente.id,
    })
  })

  it('confirmação direta grava alertaFifoDisparado=false e tentativasAteAcerto=0', async () => {
    const unica = await novaUnidade(30)

    await ler(unica.codigoQr)

    expect(await prisma.saida.findUniqueOrThrow({ where: { unidadeId: unica.id } })).toMatchObject({
      alertaFifoDisparado: false,
      tentativasAteAcerto: 0,
    })
  })

  it('confirmação após bloqueios grava o total de tentativas do ciclo', async () => {
    const prioritaria = await novaUnidade(5)
    const errada = await novaUnidade(20)
    const outraErrada = await novaUnidade(60)

    await ler(errada.codigoQr)
    await ler(outraErrada.codigoQr)
    await ler(prioritaria.codigoQr)

    expect(
      await prisma.saida.findUniqueOrThrow({ where: { unidadeId: prioritaria.id } }),
    ).toMatchObject({ alertaFifoDisparado: true, tentativasAteAcerto: 2 })
  })

  it('grava SAIDA_CONFIRMADA', async () => {
    const unica = await novaUnidade(30)

    await ler(unica.codigoQr)

    expect(await eventosDe(prisma, 'SAIDA_CONFIRMADA')).toMatchObject([
      { unidadeId: unica.id, produtoId: perfume.id, usuarioId: atendente.id },
    ])
  })

  it('não cria Descarte', async () => {
    const unica = await novaUnidade(30)

    await ler(unica.codigoQr)

    expect(await prisma.descarte.count()).toBe(0)
  })
})

describe('validarSaidaFifo — LEITURA_QR_SAIDA em toda leitura (RF12)', () => {
  // Sem o registro de TODA leitura não existe denominador para o indicador
  // que o TCC quer medir: a taxa de acerto na primeira leitura. Os eventos de
  // veredito sozinhos só contam os casos que deram errado.

  it('registra a leitura no ramo de unidade já baixada', async () => {
    const unidade = await novaUnidade(10, { status: StatusUnidade.VENDIDA })

    await ler(unidade.codigoQr)

    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toMatchObject([
      { unidadeId: unidade.id, produtoId: perfume.id, usuarioId: atendente.id },
    ])
  })

  it('registra a leitura no ramo de unidade vencida', async () => {
    const vencida = await novaUnidade(-3)

    await ler(vencida.codigoQr)

    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toMatchObject([
      { unidadeId: vencida.id, produtoId: perfume.id },
    ])
  })

  it('registra a leitura no ramo de bloqueio', async () => {
    await novaUnidade(5)
    const lida = await novaUnidade(60)

    await ler(lida.codigoQr)

    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toMatchObject([{ unidadeId: lida.id }])
  })

  it('registra a leitura no ramo de confirmação', async () => {
    const unica = await novaUnidade(30)

    await ler(unica.codigoQr)

    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toMatchObject([{ unidadeId: unica.id }])
  })

  it('registra uma leitura por chamada, sem acumular nem faltar', async () => {
    await novaUnidade(5)
    const lida = await novaUnidade(60)

    await ler(lida.codigoQr)
    await ler(lida.codigoQr)
    await ler('PRF-ZZZZZZ')

    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(3)
  })
})

describe('validarSaidaFifo — laço de revalidação (RF06, jornada J2)', () => {
  it('erra, erra, acerta: o ciclo fecha com o total de tentativas na Saida', async () => {
    // A jornada que o sistema existe para produzir: a atendente pega o frasco
    // mais acessível, é barrada, pega outro, é barrada de novo, e só a
    // terceira leitura — a unidade que vence primeiro — passa.
    const prioritaria = await novaUnidade(5)
    const segunda = await novaUnidade(20)
    const terceira = await novaUnidade(60)

    const primeiroBloqueio = await ler(terceira.codigoQr)
    const segundoBloqueio = await ler(segunda.codigoQr)
    const confirmacao = await ler(prioritaria.codigoQr)

    expect(primeiroBloqueio).toMatchObject({ tipo: 'BLOQUEAR_FIFO', tentativas: 1 })
    expect(primeiroBloqueio).toHaveProperty('unidadeCorreta.id', prioritaria.id)
    expect(segundoBloqueio).toMatchObject({ tipo: 'BLOQUEAR_FIFO', tentativas: 2 })
    expect(confirmacao.tipo).toBe('CONFIRMAR')

    expect(await eventosDe(prisma, 'ALERTA_FIFO_DISPARADO')).toHaveLength(2)
    expect(
      await prisma.saida.findUniqueOrThrow({ where: { unidadeId: prioritaria.id } }),
    ).toMatchObject({ alertaFifoDisparado: true, tentativasAteAcerto: 2 })
  })

  it('depois da baixa, a próxima unidade vira a prioritária', async () => {
    const primeira = await novaUnidade(5)
    const segunda = await novaUnidade(20)
    const terceira = await novaUnidade(60)

    await ler(primeira.codigoQr)

    // O alvo apontado muda sozinho: o pool encolheu, e agora quem vence
    // primeiro entre as que sobraram é `segunda`.
    const veredito = await ler(terceira.codigoQr)
    expect(veredito.tipo).toBe('BLOQUEAR_FIFO')
    expect(veredito).toHaveProperty('unidadeCorreta.id', segunda.id)

    expect((await ler(segunda.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('vendida a última não-vencida, a vencida não vira prioritária', async () => {
    // Fim de estoque com um item vencido esquecido na prateleira. Depois da
    // última venda legítima, o sistema não pode "promover" a vencida a
    // prioritária só porque ela é a única que sobrou.
    const ultima = await novaUnidade(15)
    const vencida = await novaUnidade(-2)

    expect((await ler(ultima.codigoQr)).tipo).toBe('CONFIRMAR')
    expect(await ler(ultima.codigoQr)).toEqual({ tipo: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
    expect((await ler(vencida.codigoQr)).tipo).toBe('EXCECAO_VENCIDO')
  })
})

describe('validarSaidaFifo — concorrência (RNF02)', () => {
  // O que separa "tem lock" de "não tem lock" aqui é a FORMA da falha da
  // perdedora. Com `SELECT ... FOR UPDATE`, ela espera a vencedora comitar,
  // relê a linha já baixada e devolve um veredito que a tela sabe mostrar.
  // Sem lock, ela lê a linha antiga, segue para o `create` e estoura na
  // restrição `@unique` de `Saida.unidadeId` — o que também impede a dupla
  // baixa, mas como exceção de banco no meio do atendimento.

  it('duas leituras simultâneas: uma confirma, a outra recebe UNIDADE_JA_BAIXADA', async () => {
    const unica = await novaUnidade(30)

    // Clientes distintos para que as transações sejam inequivocamente
    // concorrentes, sem depender do pool de um client compartilhado.
    const clienteA = criarClienteDeTeste()
    const clienteB = criarClienteDeTeste()

    try {
      const vereditos = await Promise.all([
        clienteA.$transaction((tx) => validarSaidaFifo(unica.codigoQr, atendente.id, tx)),
        clienteB.$transaction((tx) => validarSaidaFifo(unica.codigoQr, atendente.id, tx)),
      ])

      const tipos = vereditos.map((v) => v.tipo).sort()
      expect(tipos).toEqual(['CONFIRMAR', 'ERRO'])
      expect(vereditos).toContainEqual({ tipo: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
    } finally {
      await Promise.all([clienteA.$disconnect(), clienteB.$disconnect()])
    }
  })

  it('seis leituras simultâneas produzem uma única Saida', async () => {
    // Mais leitores aumentam a sobreposição real das transações: com duas, há
    // chance de a segunda só começar depois de a primeira ter comitado, e o
    // teste passaria sem provar nada.
    const unica = await novaUnidade(30)
    const clientes = Array.from({ length: 6 }, () => criarClienteDeTeste())

    try {
      const vereditos = await Promise.all(
        clientes.map((cliente) =>
          cliente.$transaction((tx) => validarSaidaFifo(unica.codigoQr, atendente.id, tx)),
        ),
      )

      expect(vereditos.filter((v) => v.tipo === 'CONFIRMAR')).toHaveLength(1)
      expect(vereditos.filter((v) => v.tipo === 'ERRO')).toHaveLength(5)
      expect(await prisma.saida.count({ where: { unidadeId: unica.id } })).toBe(1)
      expect((await recarregar(unica)).status).toBe(StatusUnidade.VENDIDA)
    } finally {
      await Promise.all(clientes.map((cliente) => cliente.$disconnect()))
    }
  })

  it('não registra duas saídas confirmadas no EventoLog', async () => {
    // O EventoLog é append-only (RNF05) e é o instrumento de coleta: um
    // SAIDA_CONFIRMADA a mais é um número errado no resultado da pesquisa,
    // e não há como corrigi-lo depois.
    const unica = await novaUnidade(30)
    const clientes = Array.from({ length: 4 }, () => criarClienteDeTeste())

    try {
      await Promise.all(
        clientes.map((cliente) =>
          cliente.$transaction((tx) => validarSaidaFifo(unica.codigoQr, atendente.id, tx)),
        ),
      )

      expect(await eventosDe(prisma, 'SAIDA_CONFIRMADA')).toHaveLength(1)
    } finally {
      await Promise.all(clientes.map((cliente) => cliente.$disconnect()))
    }
  })

  it('leituras simultâneas de unidades diferentes do mesmo SKU não se bloqueiam entre si', async () => {
    // O lock é da unidade lida, não do SKU. Travar o produto inteiro
    // serializaria o balcão: duas atendentes vendendo o mesmo perfume para
    // clientes diferentes esperariam uma pela outra.
    const prioritaria = await novaUnidade(5)
    const outra = await novaUnidade(20)

    const clienteA = criarClienteDeTeste()
    const clienteB = criarClienteDeTeste()

    try {
      const [confirmada, bloqueada] = await Promise.all([
        clienteA.$transaction((tx) => validarSaidaFifo(prioritaria.codigoQr, atendente.id, tx)),
        clienteB.$transaction((tx) => validarSaidaFifo(outra.codigoQr, atendente.id, tx)),
      ])

      expect(confirmada.tipo).toBe('CONFIRMAR')
      // A leitura de `outra` pode cair antes ou depois da baixa de
      // `prioritaria` — as duas ordens são corretas. O que não pode acontecer
      // é uma das duas travar indefinidamente ou estourar.
      expect(['BLOQUEAR_FIFO', 'CONFIRMAR']).toContain(bloqueada.tipo)
    } finally {
      await Promise.all([clienteA.$disconnect(), clienteB.$disconnect()])
    }
  })
})
