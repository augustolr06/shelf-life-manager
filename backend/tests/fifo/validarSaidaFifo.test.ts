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
 *
 * REESCRITA EM T33, ANTES DE T33B, pela mesma regra. Ler o QR deixou de ser
 * vender (tasks/T33-testes-avaliacao-efetivacao.md): a função ganha o modo
 * `AVALIAR` (a leitura, que decide sem baixar) e o modo `EFETIVAR` (a
 * confirmação do carrinho, que revalida e baixa). Os ramos 1 a 4 não mudam de
 * significado e seguem chamados como leitura. Os casos que mudaram estão
 * marcados com `T33` no comentário. Enquanto T33b não existir, a função ignora
 * o quinto argumento e continua vendendo na leitura: os casos novos falham por
 * isso, e só por isso.
 */

import { Papel, type PrismaClient, type Produto, StatusUnidade, type UnidadeProduto, type Usuario } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { criarClienteDeTeste, limparBanco, prepararBancoDeTeste } from '../apoio/bancoDeTeste.js'
import { criarProduto, criarUnidade, criarUsuario, eventosDe } from '../apoio/cenario.js'
import { validarSaidaFifo, type Veredito } from '../../src/modules/saida/validarSaidaFifo.js'

let prisma: PrismaClient
let atendente: Usuario
let perfume: Produto

/**
 * Chama a função como `POST /saidas/ler` vai chamá-la: dentro de uma transação
 * aberta por quem chama, nunca sobre o client global. A função não abre
 * transação própria — é o chamador que delimita o escopo atômico (RNF02).
 *
 * `noCarrinho` são os ids das unidades já liberadas no mesmo atendimento, que
 * ainda estão `EM_ESTOQUE` porque só baixam na confirmação (T33).
 */
function avaliar(codigoQr: string, usuarioId = atendente.id, noCarrinho?: string[]): Promise<Veredito> {
  return prisma.$transaction((tx) =>
    validarSaidaFifo(codigoQr, usuarioId, tx, null, { modo: 'AVALIAR', noCarrinho }),
  )
}

/**
 * A confirmação de um item do carrinho, como `POST /saidas/finalizar` vai
 * chamá-la: uma transação por item (T33b). A unidade é a mesma que a leitura
 * identificou; a rota traduz o id que o carrinho guarda no código.
 */
function efetivar(codigoQr: string, usuarioId = atendente.id, cliente: PrismaClient = prisma): Promise<Veredito> {
  return cliente.$transaction((tx) => validarSaidaFifo(codigoQr, usuarioId, tx, null, { modo: 'EFETIVAR' }))
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
    expect(await avaliar('PRF-ZZZZZZ')).toEqual({ tipo: 'ERRO', motivo: 'QR_NAO_ENCONTRADO' })
  })

  it('não baixa nada quando o código não existe', async () => {
    const unidade = await novaUnidade(10)

    await avaliar('PRF-ZZZZZZ')

    expect(await prisma.saida.count()).toBe(0)
    expect((await recarregar(unidade)).status).toBe(StatusUnidade.EM_ESTOQUE)
  })

  it('registra a leitura mesmo sem unidade, com o código no payload', async () => {
    // Ler um código que o sistema não conhece é dado de pesquisa (RF12): pode
    // ser etiqueta danificada, item de outra loja, ou unidade nunca cadastrada.
    // Sem `unidadeId` para identificá-la, o código precisa estar no payload.
    await avaliar('PRF-ZZZZZZ')

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

    expect(await avaliar(unidade.codigoQr)).toEqual({ tipo: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
  })

  it('devolve ERRO/UNIDADE_JA_BAIXADA para unidade DESCARTADA', async () => {
    const unidade = await novaUnidade(10, { status: StatusUnidade.DESCARTADA })

    expect(await avaliar(unidade.codigoQr)).toEqual({ tipo: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
  })

  it('a checagem de status vem antes da de validade', async () => {
    // Unidade vencida E já descartada: o veredito é UNIDADE_JA_BAIXADA, não
    // EXCECAO_VENCIDO. A ordem das verificações da seção 7 do PRD não é
    // decorativa — mandar a atendente para o fluxo de exceção (T11) de um
    // item que já foi resolvido a faria descartar duas vezes o mesmo frasco.
    const unidade = await novaUnidade(-5, { status: StatusUnidade.DESCARTADA })

    expect(await avaliar(unidade.codigoQr)).toEqual({ tipo: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
  })

  it('não cria segunda Saida para unidade já vendida', async () => {
    const unidade = await novaUnidade(10, { status: StatusUnidade.VENDIDA })

    await avaliar(unidade.codigoQr)

    expect(await prisma.saida.count({ where: { unidadeId: unidade.id } })).toBe(0)
  })
})

describe('validarSaidaFifo — ramo 3: unidade vencida (exceção da seção 6.1)', () => {
  it('devolve EXCECAO_VENCIDO com a unidade lida', async () => {
    const vencida = await novaUnidade(-1)

    const veredito = await avaliar(vencida.codigoQr)

    expect(veredito.tipo).toBe('EXCECAO_VENCIDO')
    expect(veredito).toHaveProperty('unidade.id', vencida.id)
  })

  it('validade igual a hoje NÃO é vencida — segue por FIFO', async () => {
    // Borda que decide a definição de "vencido": a unidade vence no fim do
    // dia impresso, não no começo. Tratar hoje como vencido tiraria da venda
    // um item ainda válido e o empurraria para a fila de descarte.
    const venceHoje = await novaUnidade(0)

    expect((await avaliar(venceHoje.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('curto-circuita o FIFO mesmo havendo unidade não-vencida no mesmo SKU', async () => {
    // A vencida é a de menor validade do SKU. Se o ramo 3 não viesse antes do
    // ramo 4, ela seria tratada como "a prioritária" e confirmada.
    const vencida = await novaUnidade(-3)
    await novaUnidade(10)

    const veredito = await avaliar(vencida.codigoQr)

    expect(veredito.tipo).toBe('EXCECAO_VENCIDO')
    expect(veredito).toHaveProperty('unidade.id', vencida.id)
  })

  it('não baixa nem altera a unidade vencida', async () => {
    // O destino dela é decidido pelos três caminhos da seção 6.1 (T11):
    // correção de dado, descarte ou override. Nenhum deles é esta função.
    const vencida = await novaUnidade(-3)

    await avaliar(vencida.codigoQr)

    const depois = await recarregar(vencida)
    expect(depois.status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(depois.dataValidade).toEqual(vencida.dataValidade)
    expect(await prisma.saida.count()).toBe(0)
    expect(await prisma.descarte.count()).toBe(0)
  })

  it('grava TENTATIVA_VENDA_UNIDADE_VENCIDA', async () => {
    const vencida = await novaUnidade(-3)

    await avaliar(vencida.codigoQr)

    expect(await eventosDe(prisma, 'TENTATIVA_VENDA_UNIDADE_VENCIDA')).toMatchObject([
      { unidadeId: vencida.id, produtoId: perfume.id, usuarioId: atendente.id },
    ])
  })

  it('não conta como alerta de FIFO', async () => {
    // O indicador do TCC separa "pegou o frasco errado" de "pegou um frasco
    // vencido": são problemas diferentes, com respostas diferentes.
    const vencida = await novaUnidade(-3)
    await novaUnidade(10)

    await avaliar(vencida.codigoQr)

    expect(await eventosDe(prisma, 'ALERTA_FIFO_DISPARADO')).toHaveLength(0)
  })
})

describe('validarSaidaFifo — ramo 4: bloqueio FIFO', () => {
  it('aponta a unidade de menor validade como unidadeCorreta', async () => {
    const maisAntiga = await novaUnidade(5)
    await novaUnidade(20)
    const lida = await novaUnidade(60)

    const veredito = await avaliar(lida.codigoQr)

    expect(veredito.tipo).toBe('BLOQUEAR_FIFO')
    expect(veredito).toHaveProperty('unidadeCorreta.id', maisAntiga.id)
  })

  it('devolve a dataValidade da unidade correta, para a tela exibir', async () => {
    // RF06: o sistema informa a validade da unidade que deveria ter sido
    // pega. É o que permite à atendente achar o frasco certo na prateleira.
    const maisAntiga = await novaUnidade(5)
    const lida = await novaUnidade(60)

    const veredito = await avaliar(lida.codigoQr)

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

    const veredito = await avaliar(lida.codigoQr)

    expect(veredito.tipo).toBe('BLOQUEAR_FIFO')
    expect(veredito).toHaveProperty('unidadeCorreta.id', prioritaria.id)
    expect(veredito).not.toHaveProperty('unidadeCorreta.id', vencida.id)
  })

  it('confirma quando a única unidade de validade menor está vencida', async () => {
    // Consequência da exclusão acima: sobrando uma só unidade não-vencida,
    // ela é a prioritária, mesmo que exista uma vencida "mais antiga".
    await novaUnidade(-10)
    const unica = await novaUnidade(30)

    expect((await avaliar(unica.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('ignora unidades de outro produto', async () => {
    // O pool é por SKU. Um hidratante vencendo antes não pode bloquear a
    // venda de um perfume.
    const outroProduto = await criarProduto(prisma, 'Hidratante 200ml')
    await novaUnidade(1, { produto: outroProduto })
    const unica = await novaUnidade(30)

    expect((await avaliar(unica.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('ignora unidades VENDIDA e DESCARTADA no pool', async () => {
    await novaUnidade(1, { status: StatusUnidade.VENDIDA })
    await novaUnidade(2, { status: StatusUnidade.DESCARTADA })
    const unica = await novaUnidade(30)

    expect((await avaliar(unica.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('empate de validade: ler qualquer uma das prioritárias confirma', async () => {
    // Duas unidades com a mesma menor validade são igualmente prioritárias.
    // Se a função escolhesse uma delas arbitrariamente e bloqueasse a outra,
    // a atendente que pegou a "errada" veria o sistema pedir um frasco
    // indistinguível do que está na mão dela — laço sem saída.
    const gemea = await novaUnidade(7)
    const outraGemea = await novaUnidade(7)
    await novaUnidade(40)

    expect((await avaliar(gemea.codigoQr)).tipo).toBe('CONFIRMAR')
    expect((await avaliar(outraGemea.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('não baixa nada no bloqueio', async () => {
    await novaUnidade(5)
    const lida = await novaUnidade(60)

    await avaliar(lida.codigoQr)

    expect((await recarregar(lida)).status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(await prisma.saida.count()).toBe(0)
  })

  it('grava ALERTA_FIFO_DISPARADO com a unidade lida e a correta', async () => {
    // `unidadeId` é a unidade LIDA — o evento descreve a leitura. A correta
    // vai no payload, porque o indicador da RF13 ("alertas disparados vs.
    // substituições efetivas") precisa cruzar as duas pontas.
    const correta = await novaUnidade(5)
    const lida = await novaUnidade(60)

    await avaliar(lida.codigoQr)

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

    expect(await avaliar(errada.codigoQr)).toHaveProperty('tentativas', 1)
    expect(await avaliar(outraErrada.codigoQr)).toHaveProperty('tentativas', 2)
  })

  it('tentativas não conta bloqueios de outro atendente', async () => {
    // O ciclo é de um atendimento: quem está com o cliente na frente é uma
    // pessoa só. Somar as tentativas da colega inflaria o indicador.
    const outroAtendente = await criarUsuario(prisma, Papel.ATENDENTE)
    await novaUnidade(5)
    const errada = await novaUnidade(20)

    await avaliar(errada.codigoQr, outroAtendente.id)
    await avaliar(errada.codigoQr, outroAtendente.id)

    expect(await avaliar(errada.codigoQr)).toHaveProperty('tentativas', 1)
  })

  it('tentativas não conta bloqueios de outro SKU', async () => {
    const outroProduto = await criarProduto(prisma, 'Hidratante 200ml')
    await novaUnidade(5, { produto: outroProduto })
    const erradaDoOutro = await novaUnidade(20, { produto: outroProduto })
    await avaliar(erradaDoOutro.codigoQr)

    await novaUnidade(5)
    const errada = await novaUnidade(20)

    expect(await avaliar(errada.codigoQr)).toHaveProperty('tentativas', 1)
  })

  it('o contador recomeça depois de uma saída confirmada', async () => {
    // `tentativas` é derivado do EventoLog desde a última SAIDA_CONFIRMADA do
    // par (SKU, atendente) — não há contador persistido, porque a seção 6.2
    // do PRD proíbe estado intermediário no servidor.
    //
    // T33: a saída confirmada passa a ser a efetivação, não a leitura que
    // liberou a unidade.
    await novaUnidade(20)
    const primeira = await novaUnidade(5)
    const terceira = await novaUnidade(60)

    await avaliar(terceira.codigoQr)
    await avaliar(primeira.codigoQr)
    await efetivar(primeira.codigoQr)

    // Já houve um ALERTA_FIFO_DISPARADO neste par (SKU, atendente), mas ele
    // pertence ao atendimento anterior, que fechou.
    expect(await avaliar(terceira.codigoQr)).toHaveProperty('tentativas', 1)
  })

  it('liberar a unidade para o carrinho não fecha o ciclo (T33)', async () => {
    // A fronteira do ciclo continua sendo a SAIDA_CONFIRMADA, que agora só
    // nasce na confirmação. Uma leitura liberada e não vendida (o cliente
    // desistiu) deixa o ciclo aberto, e o bloqueio dela entra na conta da
    // próxima venda do mesmo SKU pela mesma atendente. É o mesmo efeito que um
    // ciclo abandonado já tinha antes de T33, agora num caso mais frequente.
    await novaUnidade(20)
    const primeira = await novaUnidade(5)
    const terceira = await novaUnidade(60)

    await avaliar(terceira.codigoQr)
    expect((await avaliar(primeira.codigoQr)).tipo).toBe('CONFIRMAR')

    expect(await avaliar(terceira.codigoQr)).toMatchObject({ tipo: 'BLOQUEAR_FIFO', tentativas: 2 })
  })
})

describe('validarSaidaFifo — ramo 5 na leitura: libera sem baixar (T33)', () => {
  // Antes de T33 este ramo vendia: criava a `Saida` e mudava o status dentro
  // da transação da leitura. Com a câmera aberta, um segundo QR lido sem
  // querer vendia o frasco errado. Agora a leitura só diz "pode ser vendida",
  // e a venda é a efetivação, na confirmação do carrinho.

  it('confirma a unidade prioritária', async () => {
    const prioritaria = await novaUnidade(5)
    await novaUnidade(20)

    const veredito = await avaliar(prioritaria.codigoQr)

    expect(veredito.tipo).toBe('CONFIRMAR')
    expect(veredito).toHaveProperty('unidade.id', prioritaria.id)
  })

  it('confirma quando o SKU tem uma unidade só', async () => {
    const unica = await novaUnidade(30)

    expect((await avaliar(unica.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('a unidade liberada continua EM_ESTOQUE', async () => {
    // T33: antes, VENDIDA.
    const unica = await novaUnidade(30)

    const veredito = await avaliar(unica.codigoQr)

    expect((await recarregar(unica)).status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(veredito).toHaveProperty('unidade.status', StatusUnidade.EM_ESTOQUE)
  })

  it('não cria Saida nem Descarte', async () => {
    // T33: antes, criava a Saida.
    const unica = await novaUnidade(30)

    await avaliar(unica.codigoQr)

    expect(await prisma.saida.count()).toBe(0)
    expect(await prisma.descarte.count()).toBe(0)
  })

  it('não grava SAIDA_CONFIRMADA, e grava uma única LEITURA_QR_SAIDA com veredito CONFIRMAR', async () => {
    // O nome do veredito fica: o payload de LEITURA_QR_SAIDA já guarda
    // `veredito`, e trocá-lo quebraria a comparação com as leituras gravadas
    // antes de T33. "Acerto na primeira leitura" (RF12) mantém o significado,
    // porque a validação continua acontecendo na leitura.
    const unica = await novaUnidade(30)

    await avaliar(unica.codigoQr)

    expect(await eventosDe(prisma, 'SAIDA_CONFIRMADA')).toHaveLength(0)
    const leituras = await eventosDe(prisma, 'LEITURA_QR_SAIDA')
    expect(leituras).toHaveLength(1)
    expect(leituras[0]?.payload).toMatchObject({ veredito: 'CONFIRMAR' })
  })

  it('ler de novo a unidade liberada libera de novo: não existe reserva', async () => {
    // A seção 6.2 do PRD continua valendo: nenhuma reserva no servidor. Duas
    // leituras da mesma unidade, inclusive de atendentes diferentes, são duas
    // liberações; quem decide quem vende é a confirmação, sob lock.
    const outraAtendente = await criarUsuario(prisma, Papel.ATENDENTE)
    const unica = await novaUnidade(30)

    expect((await avaliar(unica.codigoQr)).tipo).toBe('CONFIRMAR')
    expect((await avaliar(unica.codigoQr, outraAtendente.id)).tipo).toBe('CONFIRMAR')
    expect(await prisma.saida.count()).toBe(0)
  })
})

describe('validarSaidaFifo — leitura com unidades no carrinho (`noCarrinho`, T33)', () => {
  // As unidades já liberadas no atendimento continuam EM_ESTOQUE até a
  // confirmação. Sem tirá-las do pool do passo 4, a segunda unidade do mesmo
  // produto seria bloqueada pela primeira, que já está na mão da atendente.

  it('empate de validade continua liberando, com a gêmea no carrinho', async () => {
    // Passa também sem `noCarrinho` (regra de empate de T06). Fica aqui para
    // fixar que a lista não muda essa regra.
    const gemea = await novaUnidade(7)
    const outraGemea = await novaUnidade(7)
    await novaUnidade(40)

    expect((await avaliar(gemea.codigoQr)).tipo).toBe('CONFIRMAR')
    expect((await avaliar(outraGemea.codigoQr, atendente.id, [gemea.id])).tipo).toBe('CONFIRMAR')
  })

  it('a de validade maior é liberada quando a de validade menor já está no carrinho', async () => {
    // Sem ler a de janeiro antes: a lista sozinha é o que está sob teste.
    // Enquanto a leitura ainda vender (antes de T33b), lê-la tiraria a
    // unidade do pool pelo status, e o caso passaria pelo motivo errado.
    const janeiro = await novaUnidade(10)
    const fevereiro = await novaUnidade(40)

    const veredito = await avaliar(fevereiro.codigoQr, atendente.id, [janeiro.id])

    expect(veredito.tipo).toBe('CONFIRMAR')
    expect(veredito).toHaveProperty('unidade.id', fevereiro.id)
  })

  it('a unidade no carrinho não dispara ALERTA_FIFO_DISPARADO', async () => {
    // A atendente não errou de frasco: está levando dois. Um alerta aqui
    // inflaria o indicador de erro da RF13.
    const janeiro = await novaUnidade(10)
    const fevereiro = await novaUnidade(40)

    await avaliar(fevereiro.codigoQr, atendente.id, [janeiro.id])

    expect(await eventosDe(prisma, 'ALERTA_FIFO_DISPARADO')).toHaveLength(0)
  })

  it('uma de validade menor fora do carrinho continua bloqueando, e é ela que a tela aponta', async () => {
    const janeiroNoCarrinho = await novaUnidade(10)
    const janeiroNaPrateleira = await novaUnidade(10)
    const fevereiro = await novaUnidade(40)

    const veredito = await avaliar(fevereiro.codigoQr, atendente.id, [janeiroNoCarrinho.id])

    expect(veredito.tipo).toBe('BLOQUEAR_FIFO')
    expect(veredito).toHaveProperty('unidadeCorreta.id', janeiroNaPrateleira.id)
  })

  it('ids inexistentes ou de unidades já baixadas são ignorados e não liberam nada a mais', async () => {
    // A lista vem do cliente. Ela não é veredito afirmado pelo cliente: só
    // tira do pool unidades que ainda estão EM_ESTOQUE, e a confirmação
    // revalida tudo de novo.
    const vendida = await novaUnidade(10, { status: StatusUnidade.VENDIDA })
    const janeiro = await novaUnidade(10)
    const fevereiro = await novaUnidade(40)

    const veredito = await avaliar(fevereiro.codigoQr, atendente.id, [randomUUID(), vendida.id])

    expect(veredito.tipo).toBe('BLOQUEAR_FIFO')
    expect(veredito).toHaveProperty('unidadeCorreta.id', janeiro.id)
  })

  it('a própria unidade lida na lista não a tira do pool: ler de novo o que já está no carrinho libera', async () => {
    // Sem esta regra, o pool do passo 4 ficaria vazio e a função estouraria
    // no meio do atendimento. Evitar o item repetido no carrinho é da tela
    // (T34): não é veredito, é a lista que ela mostra.
    const unica = await novaUnidade(30)

    const veredito = await avaliar(unica.codigoQr, atendente.id, [unica.id])

    expect(veredito.tipo).toBe('CONFIRMAR')
    expect(veredito).toHaveProperty('unidade.id', unica.id)
  })

  it('a lista não muda os ramos 2 e 3', async () => {
    const janeiro = await novaUnidade(10)
    const vencida = await novaUnidade(-3)

    expect((await avaliar(vencida.codigoQr, atendente.id, [janeiro.id])).tipo).toBe('EXCECAO_VENCIDO')
  })
})

describe('validarSaidaFifo — efetivação: a confirmação do carrinho (T33)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('item liberado e estoque inalterado: a efetivação vende', async () => {
    const unica = await novaUnidade(30)
    await avaliar(unica.codigoQr)

    const veredito = await efetivar(unica.codigoQr)

    expect(veredito.tipo).toBe('CONFIRMAR')
    expect(veredito).toHaveProperty('unidade.status', StatusUnidade.VENDIDA)
    expect((await recarregar(unica)).status).toBe(StatusUnidade.VENDIDA)
  })

  it('cria a Saida com o usuário recebido como argumento', async () => {
    const unica = await novaUnidade(30)

    await efetivar(unica.codigoQr)

    // RF07: toda saída é atribuível a um usuário — é a rastreabilidade que a
    // pesquisa exige.
    expect(await prisma.saida.findUniqueOrThrow({ where: { unidadeId: unica.id } })).toMatchObject({
      usuarioId: atendente.id,
    })
  })

  it('grava SAIDA_CONFIRMADA', async () => {
    const unica = await novaUnidade(30)

    await efetivar(unica.codigoQr)

    expect(await eventosDe(prisma, 'SAIDA_CONFIRMADA')).toMatchObject([
      { unidadeId: unica.id, produtoId: perfume.id, usuarioId: atendente.id },
    ])
  })

  it('não grava LEITURA_QR_SAIDA em ramo nenhum: não houve leitura', async () => {
    // A confirmação não é leitura. Gravar aqui dobraria o denominador da taxa
    // de acerto na primeira leitura (RF12).
    await novaUnidade(5)
    const bloqueada = await novaUnidade(60)
    const vendida = await novaUnidade(10, { status: StatusUnidade.VENDIDA })
    const vencida = await novaUnidade(-3)
    const outroProduto = await criarProduto(prisma, 'Hidratante 200ml')
    const confirmada = await novaUnidade(30, { produto: outroProduto })

    await efetivar('PRF-ZZZZZZ')
    await efetivar(vendida.codigoQr)
    await efetivar(vencida.codigoQr)
    await efetivar(bloqueada.codigoQr)
    await efetivar(confirmada.codigoQr)

    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(0)
  })

  it('não cria Descarte', async () => {
    const unica = await novaUnidade(30)

    await efetivar(unica.codigoQr)

    expect(await prisma.descarte.count()).toBe(0)
  })

  it('unidade vendida por outra atendente entre a leitura e a confirmação: UNIDADE_JA_BAIXADA, nada criado', async () => {
    const outraAtendente = await criarUsuario(prisma, Papel.ATENDENTE)
    const unica = await novaUnidade(30)

    await avaliar(unica.codigoQr)
    await avaliar(unica.codigoQr, outraAtendente.id)
    await efetivar(unica.codigoQr, outraAtendente.id)

    expect(await efetivar(unica.codigoQr)).toEqual({ tipo: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
    const saida = await prisma.saida.findUniqueOrThrow({ where: { unidadeId: unica.id } })
    expect(saida.usuarioId).toBe(outraAtendente.id)
    expect(await eventosDe(prisma, 'SAIDA_CONFIRMADA')).toHaveLength(1)
  })

  it('unidade que venceu entre a leitura e a confirmação (virada do dia): EXCECAO_VENCIDO', async () => {
    // Liberada no último dia da validade, confirmada depois da meia-noite. Só
    // o relógio do processo avança: o banco e os timers seguem reais.
    const venceHoje = await novaUnidade(0)
    expect((await avaliar(venceHoje.codigoQr)).tipo).toBe('CONFIRMAR')

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000)

    const veredito = await efetivar(venceHoje.codigoQr)

    expect(veredito.tipo).toBe('EXCECAO_VENCIDO')
    expect((await recarregar(venceHoje)).status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(await prisma.saida.count()).toBe(0)
    // Foi, de fato, uma tentativa de vender unidade vencida. O evento é o
    // mesmo da leitura.
    expect(await eventosDe(prisma, 'TENTATIVA_VENDA_UNIDADE_VENCIDA')).toHaveLength(1)
  })

  it('entrou no estoque uma unidade de validade menor depois da leitura: BLOQUEAR_FIFO', async () => {
    const fevereiro = await novaUnidade(40)
    expect((await avaliar(fevereiro.codigoQr)).tipo).toBe('CONFIRMAR')

    const janeiroQueChegou = await novaUnidade(10)
    const veredito = await efetivar(fevereiro.codigoQr)

    expect(veredito.tipo).toBe('BLOQUEAR_FIFO')
    expect(veredito).toHaveProperty('unidadeCorreta.id', janeiroQueChegou.id)
    expect((await recarregar(fevereiro)).status).toBe(StatusUnidade.EM_ESTOQUE)
    expect(await prisma.saida.count()).toBe(0)
    // O bloqueio na confirmação grava o mesmo alerta da leitura e conta como
    // tentativa do ciclo: a venda precisou de uma troca de frasco, como no
    // bloqueio comum, ainda que a atendente não tenha errado ao ler.
    expect(await eventosDe(prisma, 'ALERTA_FIFO_DISPARADO')).toHaveLength(1)
  })

  it('venda direta grava alertaFifoDisparado=false e tentativasAteAcerto=0', async () => {
    const unica = await novaUnidade(30)

    await avaliar(unica.codigoQr)
    await efetivar(unica.codigoQr)

    expect(await prisma.saida.findUniqueOrThrow({ where: { unidadeId: unica.id } })).toMatchObject({
      alertaFifoDisparado: false,
      tentativasAteAcerto: 0,
    })
  })

  it('bloqueio na leitura, depois a certa, depois a confirmação: tentativasAteAcerto=1', async () => {
    const prioritaria = await novaUnidade(5)
    const errada = await novaUnidade(20)

    await avaliar(errada.codigoQr)
    await avaliar(prioritaria.codigoQr)
    await efetivar(prioritaria.codigoQr)

    expect(
      await prisma.saida.findUniqueOrThrow({ where: { unidadeId: prioritaria.id } }),
    ).toMatchObject({ alertaFifoDisparado: true, tentativasAteAcerto: 1 })
  })

  it('duas unidades do mesmo SKU no carrinho, um bloqueio no ciclo: ele vai para a primeira efetivada', async () => {
    // A regra de T07 continua: a contagem é do par (SKU, atendente) desde a
    // última SAIDA_CONFIRMADA. Com a confirmação processando por validade
    // crescente (T33b), o bloqueio do ciclo fica com a unidade de menor
    // validade, que é a que a troca de frasco buscava, e a outra sai com 0. A
    // soma no carrinho é o número de bloqueios, sem contar duas vezes.
    const janeiro = await novaUnidade(10)
    const fevereiro = await novaUnidade(40)

    expect((await avaliar(fevereiro.codigoQr)).tipo).toBe('BLOQUEAR_FIFO')
    expect((await avaliar(janeiro.codigoQr)).tipo).toBe('CONFIRMAR')
    expect((await avaliar(fevereiro.codigoQr, atendente.id, [janeiro.id])).tipo).toBe('CONFIRMAR')

    expect((await efetivar(janeiro.codigoQr)).tipo).toBe('CONFIRMAR')
    expect((await efetivar(fevereiro.codigoQr)).tipo).toBe('CONFIRMAR')

    const saidaDe = (unidade: UnidadeProduto) =>
      prisma.saida.findUniqueOrThrow({ where: { unidadeId: unidade.id } })
    expect(await saidaDe(janeiro)).toMatchObject({ alertaFifoDisparado: true, tentativasAteAcerto: 1 })
    expect(await saidaDe(fevereiro)).toMatchObject({ alertaFifoDisparado: false, tentativasAteAcerto: 0 })
  })
})

describe('validarSaidaFifo — LEITURA_QR_SAIDA em toda leitura (RF12)', () => {
  // Sem o registro de TODA leitura não existe denominador para o indicador
  // que o TCC quer medir: a taxa de acerto na primeira leitura. Os eventos de
  // veredito sozinhos só contam os casos que deram errado.

  it('registra a leitura no ramo de unidade já baixada', async () => {
    const unidade = await novaUnidade(10, { status: StatusUnidade.VENDIDA })

    await avaliar(unidade.codigoQr)

    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toMatchObject([
      { unidadeId: unidade.id, produtoId: perfume.id, usuarioId: atendente.id },
    ])
  })

  it('registra a leitura no ramo de unidade vencida', async () => {
    const vencida = await novaUnidade(-3)

    await avaliar(vencida.codigoQr)

    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toMatchObject([
      { unidadeId: vencida.id, produtoId: perfume.id },
    ])
  })

  it('registra a leitura no ramo de bloqueio', async () => {
    await novaUnidade(5)
    const lida = await novaUnidade(60)

    await avaliar(lida.codigoQr)

    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toMatchObject([{ unidadeId: lida.id }])
  })

  it('registra a leitura no ramo de confirmação', async () => {
    const unica = await novaUnidade(30)

    await avaliar(unica.codigoQr)

    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toMatchObject([{ unidadeId: unica.id }])
  })

  it('registra uma leitura por chamada, sem acumular nem faltar', async () => {
    await novaUnidade(5)
    const lida = await novaUnidade(60)

    await avaliar(lida.codigoQr)
    await avaliar(lida.codigoQr)
    await avaliar('PRF-ZZZZZZ')

    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(3)
  })

  it('a venda inteira, leitura e confirmação, grava uma leitura só', async () => {
    // T33: o par leitura + efetivação conta uma vez no denominador.
    const unica = await novaUnidade(30)

    await avaliar(unica.codigoQr)
    await efetivar(unica.codigoQr)

    expect(await eventosDe(prisma, 'LEITURA_QR_SAIDA')).toHaveLength(1)
  })
})

describe('validarSaidaFifo — laço de revalidação (RF06, jornada J2)', () => {
  it('erra, erra, acerta, confirma: o ciclo fecha com o total de tentativas na Saida', async () => {
    // A jornada que o sistema existe para produzir: a atendente pega o frasco
    // mais acessível, é barrada, pega outro, é barrada de novo, e só a
    // terceira leitura — a unidade que vence primeiro — passa.
    //
    // T33: a terceira leitura libera, e a Saida nasce na confirmação.
    const prioritaria = await novaUnidade(5)
    const segunda = await novaUnidade(20)
    const terceira = await novaUnidade(60)

    const primeiroBloqueio = await avaliar(terceira.codigoQr)
    const segundoBloqueio = await avaliar(segunda.codigoQr)
    const liberacao = await avaliar(prioritaria.codigoQr)

    expect(primeiroBloqueio).toMatchObject({ tipo: 'BLOQUEAR_FIFO', tentativas: 1 })
    expect(primeiroBloqueio).toHaveProperty('unidadeCorreta.id', prioritaria.id)
    expect(segundoBloqueio).toMatchObject({ tipo: 'BLOQUEAR_FIFO', tentativas: 2 })
    expect(liberacao.tipo).toBe('CONFIRMAR')
    expect(await prisma.saida.count()).toBe(0)

    expect((await efetivar(prioritaria.codigoQr)).tipo).toBe('CONFIRMAR')

    expect(await eventosDe(prisma, 'ALERTA_FIFO_DISPARADO')).toHaveLength(2)
    expect(
      await prisma.saida.findUniqueOrThrow({ where: { unidadeId: prioritaria.id } }),
    ).toMatchObject({ alertaFifoDisparado: true, tentativasAteAcerto: 2 })
  })

  it('depois da baixa, a próxima unidade vira a prioritária', async () => {
    const primeira = await novaUnidade(5)
    const segunda = await novaUnidade(20)
    const terceira = await novaUnidade(60)

    await avaliar(primeira.codigoQr)
    await efetivar(primeira.codigoQr)

    // O alvo apontado muda sozinho: o pool encolheu, e agora quem vence
    // primeiro entre as que sobraram é `segunda`.
    const veredito = await avaliar(terceira.codigoQr)
    expect(veredito.tipo).toBe('BLOQUEAR_FIFO')
    expect(veredito).toHaveProperty('unidadeCorreta.id', segunda.id)

    expect((await avaliar(segunda.codigoQr)).tipo).toBe('CONFIRMAR')
  })

  it('vendida a última não-vencida, a vencida não vira prioritária', async () => {
    // Fim de estoque com um item vencido esquecido na prateleira. Depois da
    // última venda legítima, o sistema não pode "promover" a vencida a
    // prioritária só porque ela é a única que sobrou.
    const ultima = await novaUnidade(15)
    const vencida = await novaUnidade(-2)

    expect((await avaliar(ultima.codigoQr)).tipo).toBe('CONFIRMAR')
    expect((await efetivar(ultima.codigoQr)).tipo).toBe('CONFIRMAR')
    expect(await avaliar(ultima.codigoQr)).toEqual({ tipo: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
    expect((await avaliar(vencida.codigoQr)).tipo).toBe('EXCECAO_VENCIDO')
  })
})

describe('validarSaidaFifo — concorrência (RNF02)', () => {
  // O que separa "tem lock" de "não tem lock" aqui é a FORMA da falha da
  // perdedora. Com `SELECT ... FOR UPDATE`, ela espera a vencedora comitar,
  // relê a linha já baixada e devolve um veredito que a tela sabe mostrar.
  // Sem lock, ela lê a linha antiga, segue para o `create` e estoura na
  // restrição `@unique` de `Saida.unidadeId` — o que também impede a dupla
  // baixa, mas como exceção de banco no meio do atendimento.
  //
  // T33: a baixa passou da leitura para a efetivação, e com ela os casos de
  // corrida. Duas leituras simultâneas não disputam mais nada.

  it('duas efetivações simultâneas: uma confirma, a outra recebe UNIDADE_JA_BAIXADA', async () => {
    const unica = await novaUnidade(30)

    // Clientes distintos para que as transações sejam inequivocamente
    // concorrentes, sem depender do pool de um client compartilhado.
    const clienteA = criarClienteDeTeste()
    const clienteB = criarClienteDeTeste()

    try {
      const vereditos = await Promise.all([
        efetivar(unica.codigoQr, atendente.id, clienteA),
        efetivar(unica.codigoQr, atendente.id, clienteB),
      ])

      const tipos = vereditos.map((v) => v.tipo).sort()
      expect(tipos).toEqual(['CONFIRMAR', 'ERRO'])
      expect(vereditos).toContainEqual({ tipo: 'ERRO', motivo: 'UNIDADE_JA_BAIXADA' })
    } finally {
      await Promise.all([clienteA.$disconnect(), clienteB.$disconnect()])
    }
  })

  it('seis efetivações simultâneas produzem uma única Saida', async () => {
    // Mais concorrentes aumentam a sobreposição real das transações: com
    // duas, há chance de a segunda só começar depois de a primeira ter
    // comitado, e o teste passaria sem provar nada.
    const unica = await novaUnidade(30)
    const clientes = Array.from({ length: 6 }, () => criarClienteDeTeste())

    try {
      const vereditos = await Promise.all(
        clientes.map((cliente) => efetivar(unica.codigoQr, atendente.id, cliente)),
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
      await Promise.all(clientes.map((cliente) => efetivar(unica.codigoQr, atendente.id, cliente)))

      expect(await eventosDe(prisma, 'SAIDA_CONFIRMADA')).toHaveLength(1)
    } finally {
      await Promise.all(clientes.map((cliente) => cliente.$disconnect()))
    }
  })

  it('efetivações simultâneas de unidades diferentes do mesmo SKU não se bloqueiam entre si', async () => {
    // O lock é da unidade, não do SKU. Travar o produto inteiro serializaria
    // o balcão: duas atendentes vendendo o mesmo perfume para clientes
    // diferentes esperariam uma pela outra.
    const prioritaria = await novaUnidade(5)
    const outra = await novaUnidade(20)

    const clienteA = criarClienteDeTeste()
    const clienteB = criarClienteDeTeste()

    try {
      const [confirmada, bloqueada] = await Promise.all([
        efetivar(prioritaria.codigoQr, atendente.id, clienteA),
        efetivar(outra.codigoQr, atendente.id, clienteB),
      ])

      expect(confirmada.tipo).toBe('CONFIRMAR')
      // A efetivação de `outra` pode cair antes ou depois da baixa de
      // `prioritaria` — as duas ordens são corretas. O que não pode acontecer
      // é uma das duas travar indefinidamente ou estourar.
      expect(['BLOQUEAR_FIFO', 'CONFIRMAR']).toContain(bloqueada.tipo)
    } finally {
      await Promise.all([clienteA.$disconnect(), clienteB.$disconnect()])
    }
  })

  it('leituras simultâneas da mesma unidade liberam as duas e não baixam nada', async () => {
    const unica = await novaUnidade(30)
    const clienteA = criarClienteDeTeste()
    const clienteB = criarClienteDeTeste()

    const avaliarEm = (cliente: PrismaClient) =>
      cliente.$transaction((tx) => validarSaidaFifo(unica.codigoQr, atendente.id, tx, null, { modo: 'AVALIAR' }))

    try {
      const vereditos = await Promise.all([avaliarEm(clienteA), avaliarEm(clienteB)])

      expect(vereditos.map((v) => v.tipo)).toEqual(['CONFIRMAR', 'CONFIRMAR'])
      expect(await prisma.saida.count()).toBe(0)
      expect((await recarregar(unica)).status).toBe(StatusUnidade.EM_ESTOQUE)
    } finally {
      await Promise.all([clienteA.$disconnect(), clienteB.$disconnect()])
    }
  })
})
