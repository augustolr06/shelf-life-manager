import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useConfirmacao, type PedidoConfirmacao } from '../components/DialogoConfirmacao'
import { ErroApi } from '../services/api'
import { avisar } from '../services/avisos'
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
function rotuloDoPapel(papel: Papel): string {
  return PAPEIS.find(({ valor }) => valor === papel)?.rotulo.toLowerCase() ?? papel
}

/**
 * O que muda no acesso de quem passa a ter o papel, para a confirmação da
 * troca (T39). Espelha o que o `App` e as telas mostram por papel; quem recusa
 * de fato continua sendo o 403 do backend.
 */
const ACESSO_DO_NOVO_PAPEL: Record<Papel, string> = {
  GESTOR:
    'Passa a ter as telas de gestão (recebimento, etiquetas, fila de descarte, alertas, dashboard e contas de acesso), a edição do catálogo e, na leitura, a correção de validade e a autorização de venda de unidade vencida.',
  ATENDENTE:
    'Perde as telas de gestão (recebimento, etiquetas, fila de descarte, alertas, dashboard e contas de acesso), a edição do catálogo e, na leitura, a correção de validade e a autorização de venda de unidade vencida. Fica com a leitura de QR, a consulta ao catálogo e a própria senha.',
}

/**
 * O papel e a conta ativa viajam no token da sessão, e o servidor não os
 * relê a cada requisição: desativar ou trocar papel vale a partir do próximo
 * login. A confirmação diz isso em vez de prometer efeito imediato. As 8 horas
 * são `DURACAO_SESSAO_SEGUNDOS`, do backend.
 */
const SESSAO_ABERTA_CONTINUA = 'continua valendo até expirar, em até 8 horas'

/**
 * A pergunta antes de alterar a conta, ou `null` quando a alteração não pede
 * confirmação: reativar desfaz uma desativação, sem perda (T39).
 */
function pedidoDeConfirmacao(
  conta: Conta,
  alteracoes: { papel?: Papel; ativo?: boolean },
): PedidoConfirmacao | null {
  if (alteracoes.papel !== undefined) {
    return {
      titulo: 'Trocar papel?',
      consequencia: `${conta.nome} passa de ${rotuloDoPapel(conta.papel)} para ${rotuloDoPapel(alteracoes.papel)}. ${ACESSO_DO_NOVO_PAPEL[alteracoes.papel]} A mudança vale a partir do próximo login: uma sessão já aberta ${SESSAO_ABERTA_CONTINUA}, com o papel anterior.`,
      rotuloConfirmar: 'Trocar papel',
    }
  }

  if (alteracoes.ativo === false) {
    return {
      titulo: 'Desativar conta?',
      consequencia: `${conta.nome} não poderá mais entrar no sistema. Uma sessão já aberta ${SESSAO_ABERTA_CONTINUA}. Você pode reativar a conta depois.`,
      rotuloConfirmar: 'Desativar conta',
    }
  }

  return null
}

export function TelaUsuarios({ usuario }: Props) {
  const [contas, setContas] = useState<Conta[]>([])
  const [incluirInativas, setIncluirInativas] = useState(false)
  const [carregando, setCarregando] = useState(true)
  // Só a falha ao carregar a lista: é estado da tela. Falha de ação vira
  // toast (T29).
  const [erro, setErro] = useState<string | null>(null)

  const [nova, setNova] = useState<DadosNovaConta>(CAMPOS_VAZIOS)
  const [salvando, setSalvando] = useState(false)

  /** Id da conta cuja senha está sendo redefinida; `null` quando nenhuma. */
  const [redefinindo, setRedefinindo] = useState<string | null>(null)
  const [senhaNova, setSenhaNova] = useState('')
  const confirmar = useConfirmacao()

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
    setSalvando(true)

    try {
      const criada = await criarConta(nova)
      avisar.sucesso(`Conta de ${criada.nome} criada.`)
      setNova(CAMPOS_VAZIOS)
      await carregar()
    } catch (falha) {
      avisar.erro(falha, 'Não foi possível criar a conta.')
    } finally {
      setSalvando(false)
    }
  }

  async function alterar(conta: Conta, alteracoes: { papel?: Papel; ativo?: boolean }) {
    // Cancelar não precisa devolver o `<select>` ao papel anterior: ele é
    // controlado por `conta.papel`, que só muda com a resposta do servidor.
    const pedido = pedidoDeConfirmacao(conta, alteracoes)
    if (pedido && !(await confirmar(pedido))) return

    try {
      const atualizada = await alterarConta(conta.id, alteracoes)
      avisar.sucesso(
        alteracoes.papel !== undefined
          ? `${atualizada.nome} agora é ${rotuloDoPapel(atualizada.papel)}.`
          : `Conta de ${atualizada.nome} ${atualizada.ativo ? 'reativada' : 'desativada'}.`,
      )

      // Conta desativada some do filtro corrente: recarrega em vez de deixar
      // uma linha que não pertence mais à lista.
      if (!atualizada.ativo && !incluirInativas) {
        await carregar()
        return
      }
      setContas((atuais) => atuais.map((c) => (c.id === atualizada.id ? atualizada : c)))
    } catch (falha) {
      // O 409 de mexer no próprio acesso chega aqui, com a mensagem do backend.
      avisar.erro(falha, 'Não foi possível alterar a conta.')
    }
  }

  async function confirmarRedefinicao(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!redefinindo) return

    try {
      await redefinirSenha(redefinindo, senhaNova)
      const alvo = contas.find((c) => c.id === redefinindo)
      avisar.sucesso(`Senha redefinida para ${alvo?.nome ?? 'a conta'}. Informe a pessoa.`)
      setRedefinindo(null)
      setSenhaNova('')
    } catch (falha) {
      avisar.erro(falha, 'Não foi possível redefinir a senha.')
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

          <button type="submit">Salvar senha</button>
          <button type="button" onClick={() => setRedefinindo(null)}>
            Cancelar
          </button>
        </form>
      )}
    </section>
  )
}
