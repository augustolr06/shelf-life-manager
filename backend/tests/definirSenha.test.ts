import bcrypt from 'bcryptjs'
import { Papel } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Sem banco: o que se prova aqui é a regra de quem pode ter senha trocada e o
// que é gravado — não a persistência (convenção de T14b: arquivo solto).
vi.mock('../src/db/prisma.js', () => ({
  prisma: { usuario: { findUnique: vi.fn(), update: vi.fn() } },
}))

import { prisma } from '../src/db/prisma.js'
import { definirSenha, TAMANHO_MINIMO_DE_SENHA } from '../src/modules/auth/auth.service.js'
import { EMAIL_DO_SISTEMA } from '../src/modules/alerta/usuarioDoSistema.js'

const buscar = vi.mocked(prisma.usuario.findUnique)
const atualizar = vi.mocked(prisma.usuario.update)

const EMAIL = 'gestor@estoque.local'
const SENHA_FORTE = 'perfumaria-2026-balcao'

const GESTOR = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Gestora de Loja',
  email: EMAIL,
  senhaHash: bcrypt.hashSync('estoque123', 10),
  papel: Papel.GESTOR,
}

beforeEach(() => {
  vi.clearAllMocks()
  buscar.mockResolvedValue(GESTOR)
  atualizar.mockResolvedValue(GESTOR)
})

describe('definirSenha', () => {
  it('grava a senha nova de um usuário existente', async () => {
    const resultado = await definirSenha(EMAIL, SENHA_FORTE)

    expect(resultado).toEqual({ ok: true, email: EMAIL })
    expect(atualizar).toHaveBeenCalledOnce()
  })

  it('grava hash, nunca a senha em claro', async () => {
    await definirSenha(EMAIL, SENHA_FORTE)

    const { senhaHash } = atualizar.mock.calls[0][0].data as { senhaHash: string }
    expect(senhaHash).not.toBe(SENHA_FORTE)
    expect(senhaHash).toMatch(/^\$2[aby]\$/)
  })

  it('grava um hash que autentica a senha nova', async () => {
    await definirSenha(EMAIL, SENHA_FORTE)

    const { senhaHash } = atualizar.mock.calls[0][0].data as { senhaHash: string }
    expect(await bcrypt.compare(SENHA_FORTE, senhaHash)).toBe(true)
  })

  // A razão de o script existir: a senha do seed tem dez caracteres e precisa
  // ser recusada por este piso.
  it('recusa a senha do seed por ser curta demais', async () => {
    const resultado = await definirSenha(EMAIL, 'estoque123')

    expect(resultado).toEqual({ ok: false, motivo: 'SENHA_CURTA' })
    expect(atualizar).not.toHaveBeenCalled()
  })

  it('recusa senha no limite de baixo e aceita no limite exato', async () => {
    const curta = 'a'.repeat(TAMANHO_MINIMO_DE_SENHA - 1)
    const exata = 'a'.repeat(TAMANHO_MINIMO_DE_SENHA)

    expect(await definirSenha(EMAIL, curta)).toMatchObject({ ok: false, motivo: 'SENHA_CURTA' })
    expect(await definirSenha(EMAIL, exata)).toMatchObject({ ok: true })
  })

  it('recusa dar senha à conta de sistema, que não deve autenticar', async () => {
    const resultado = await definirSenha(EMAIL_DO_SISTEMA, SENHA_FORTE)

    expect(resultado).toEqual({ ok: false, motivo: 'CONTA_NAO_AUTENTICA' })
    expect(atualizar).not.toHaveBeenCalled()
  })

  it('recusa e-mail que não existe no banco, sem escrever nada', async () => {
    buscar.mockResolvedValueOnce(null)

    const resultado = await definirSenha('ninguem@estoque.local', SENHA_FORTE)

    expect(resultado).toEqual({ ok: false, motivo: 'USUARIO_NAO_ENCONTRADO' })
    expect(atualizar).not.toHaveBeenCalled()
  })
})
