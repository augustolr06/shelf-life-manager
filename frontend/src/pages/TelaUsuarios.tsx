import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ErroApi } from '../services/api'
import type { Papel, Usuario } from '../services/auth'
import {
  alterarConta,
  criarConta,
  listarContas,
  redefinirSenha,
  type Conta,
  type DadosNovaConta,
} from '../services/usuarios'

const CAMPOS_VAZIOS: DadosNovaConta = { nome: '', email: '', papel: 'ATENDENTE', senha: '' }

const PAPEIS: readonly { valor: Papel; rotulo: string }[] = [
  { valor: 'ATENDENTE', rotulo: 'Atendente' },
  { valor: 'GESTOR', rotulo: 'Gestor' },
]

type Props = {
  usuario: Usuario
}

/**
 * Contas de acesso (T22, RF01).
 *
 * A tela não decide permissão nenhuma (RNF04). As duas condições que ela usa
 * — esconder as ações da própria linha — são **conveniência**: quem recusa
 * mudar o próprio papel ou desativar a própria conta é o backend, com 409, e
 * a tela exibe a mensagem que vier. Se a condição daqui estiver errada, a
 * recusa continua acontecendo no lugar certo.
 */
export function TelaUsuarios({ usuario }: Props) {
  const [contas, setContas] = useState<Conta[]>([])
  const [incluirInativas, setIncluirInativas] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [nova, setNova] = useState<DadosNovaConta>(CAMPOS_VAZIOS)
  const [erroFormulario, setErroFormulario] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  /** Id da conta cuja senha está sendo redefinida; `null` quando nenhuma. */
  const [redefinindo, setRedefinindo] = useState<string | null>(null)
  const [senhaNova, setSenhaNova] = useState('')
  const [erroSenha, setErroSenha] = useState<string | null>(null)
  const [avisoSenha, setAvisoSenha] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setContas(await listarContas(incluirInativas))
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível carregar as contas.')
    } finally {
      setCarregando(false)
    }
  }, [incluirInativas])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function cadastrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErroFormulario(null)
    setSalvando(true)

    try {
      await criarConta(nova)
      setNova(CAMPOS_VAZIOS)
      await carregar()
    } catch (falha) {
      setErroFormulario(
        falha instanceof ErroApi ? falha.message : 'Não foi possível criar a conta.',
      )
    } finally {
      setSalvando(false)
    }
  }

  async function alterar(conta: Conta, alteracoes: { papel?: Papel; ativo?: boolean }) {
    setErro(null)
    try {
      const atualizada = await alterarConta(conta.id, alteracoes)

      // Conta desativada some do filtro corrente: recarrega em vez de deixar
      // uma linha que não pertence mais à lista.
      if (!atualizada.ativo && !incluirInativas) {
        await carregar()
        return
      }
      setContas((atuais) => atuais.map((c) => (c.id === atualizada.id ? atualizada : c)))
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível alterar a conta.')
    }
  }

  async function confirmarRedefinicao(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!redefinindo) return

    setErroSenha(null)
    setAvisoSenha(null)
    try {
      await redefinirSenha(redefinindo, senhaNova)
      const alvo = contas.find((c) => c.id === redefinindo)
      setAvisoSenha(`Senha redefinida para ${alvo?.nome ?? 'a conta'}. Informe a pessoa.`)
      setRedefinindo(null)
      setSenhaNova('')
    } catch (falha) {
      setErroSenha(
        falha instanceof ErroApi ? falha.message : 'Não foi possível redefinir a senha.',
      )
    }
  }

  return (
    <section className="tela-usuarios">
      <h2>Contas de acesso</h2>

      <form className="formulario-usuario" onSubmit={cadastrar}>
        <h3>Criar conta</h3>

        <div className="campo">
          <label htmlFor="nome">Nome</label>
          <input
            id="nome"
            name="nome"
            required
            value={nova.nome}
            onChange={(evento) => setNova((atual) => ({ ...atual, nome: evento.target.value }))}
          />
        </div>

        <div className="campo">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            // Este formulário cria a conta de **outra pessoa**: o navegador
            // não deve oferecer o e-mail de quem está logado, que é o que ele
            // faz por padrão ao ver um campo de e-mail ao lado de um de senha.
            autoComplete="off"
            required
            value={nova.email}
            onChange={(evento) => setNova((atual) => ({ ...atual, email: evento.target.value }))}
          />
        </div>

        <div className="campo">
          <label htmlFor="papel">Papel</label>
          <select
            id="papel"
            name="papel"
            value={nova.papel}
            onChange={(evento) =>
              setNova((atual) => ({ ...atual, papel: evento.target.value as Papel }))
            }
          >
            {PAPEIS.map(({ valor, rotulo }) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label htmlFor="senha">Senha inicial</label>
          <input
            id="senha"
            name="senha"
            type="password"
            autoComplete="new-password"
            required
            value={nova.senha}
            onChange={(evento) => setNova((atual) => ({ ...atual, senha: evento.target.value }))}
          />
        </div>

        {erroFormulario && (
          <p className="erro" role="alert">
            {erroFormulario}
          </p>
        )}

        <button type="submit" disabled={salvando}>
          {salvando ? 'Criando…' : 'Criar conta'}
        </button>
      </form>

      <label className="caixa-selecao">
        <input
          type="checkbox"
          checked={incluirInativas}
          onChange={(evento) => setIncluirInativas(evento.target.checked)}
        />
        Mostrar contas desativadas
      </label>

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      {avisoSenha && (
        <p className="nota-sucesso" role="status">
          {avisoSenha}
        </p>
      )}

      {carregando ? (
        <p role="status">Carregando contas…</p>
      ) : contas.length === 0 ? (
        <p>Nenhuma conta encontrada.</p>
      ) : (
        <table>
          <caption>{contas.length} conta(s) de acesso</caption>
          <thead>
            <tr>
              <th scope="col">Nome</th>
              <th scope="col">E-mail</th>
              <th scope="col">Papel</th>
              <th scope="col">Situação</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {contas.map((conta) => {
              const souEu = conta.id === usuario.id

              return (
                <tr key={conta.id} className={conta.ativo ? undefined : 'linha-inativa'}>
                  <td>
                    {conta.nome}
                    {souEu && ' (você)'}
                  </td>
                  <td>{conta.email}</td>
                  <td>
                    <select
                      aria-label={`Papel de ${conta.nome}`}
                      value={conta.papel}
                      disabled={souEu}
                      onChange={(evento) =>
                        void alterar(conta, { papel: evento.target.value as Papel })
                      }
                    >
                      {PAPEIS.map(({ valor, rotulo }) => (
                        <option key={valor} value={valor}>
                          {rotulo}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{conta.ativo ? 'Ativa' : 'Desativada'}</td>
                  <td>
                    {!souEu && (
                      <>
                        <button
                          type="button"
                          onClick={() => void alterar(conta, { ativo: !conta.ativo })}
                        >
                          {conta.ativo ? 'Desativar' : 'Reativar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRedefinindo(conta.id)
                            setSenhaNova('')
                            setErroSenha(null)
                            setAvisoSenha(null)
                          }}
                        >
                          Redefinir senha
                        </button>
                      </>
                    )}
                    {souEu && <span>Use “Minha senha” para trocar a sua</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {redefinindo && (
        <form className="formulario-senha" onSubmit={confirmarRedefinicao}>
          <h3>Redefinir senha de {contas.find((c) => c.id === redefinindo)?.nome}</h3>

          <div className="campo">
            <label htmlFor="senha-nova">Nova senha</label>
            <input
              id="senha-nova"
              name="senha-nova"
              type="password"
              autoComplete="new-password"
              required
              value={senhaNova}
              onChange={(evento) => setSenhaNova(evento.target.value)}
            />
          </div>

          {erroSenha && (
            <p className="erro" role="alert">
              {erroSenha}
            </p>
          )}

          <button type="submit">Salvar senha</button>
          <button type="button" onClick={() => setRedefinindo(null)}>
            Cancelar
          </button>
        </form>
      )}
    </section>
  )
}
