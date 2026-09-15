import { useState, type FormEvent } from 'react'
import { ErroApi } from '../services/api'
import { trocarPropriaSenha } from '../services/usuarios'

/**
 * Troca da própria senha (T22). Disponível aos dois papéis — é a única tela
 * deste módulo que a atendente enxerga.
 *
 * Nenhum id sai daqui: o backend troca a senha de quem está na sessão. Uma
 * tela que enviasse o próprio id estaria oferecendo ao cliente a chance de
 * enviar outro.
 */
export function TelaMinhaSenha() {
  const [senhaAtual, setSenhaAtual] = useState('')
  const [senhaNova, setSenhaNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState(false)
  const [salvando, setSalvando] = useState(false)

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setSucesso(false)

    // Conferência local, não veredito (RNF04): a confirmação existe só neste
    // formulário, para pegar erro de digitação antes da viagem. Tamanho
    // mínimo, senha atual e tudo o mais quem julga é o backend.
    if (senhaNova !== confirmacao) {
      setErro('A confirmação não corresponde à nova senha.')
      return
    }

    setSalvando(true)
    try {
      await trocarPropriaSenha(senhaAtual, senhaNova)
      setSenhaAtual('')
      setSenhaNova('')
      setConfirmacao('')
      setSucesso(true)
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível trocar a senha.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section className="tela-minha-senha">
      <h2>Minha senha</h2>

      <form className="formulario-senha" onSubmit={enviar}>
        {(
          [
            ['senhaAtual', 'Senha atual', senhaAtual, setSenhaAtual],
            ['senhaNova', 'Nova senha', senhaNova, setSenhaNova],
            ['confirmacao', 'Repetir a nova senha', confirmacao, setConfirmacao],
          ] as const
        ).map(([campo, rotulo, valor, definir]) => (
          <div className="campo" key={campo}>
            <label htmlFor={campo}>{rotulo}</label>
            <input
              id={campo}
              name={campo}
              type="password"
              autoComplete={campo === 'senhaAtual' ? 'current-password' : 'new-password'}
              required
              value={valor}
              onChange={(evento) => definir(evento.target.value)}
            />
          </div>
        ))}

        {erro && (
          <p className="erro" role="alert">
            {erro}
          </p>
        )}

        {sucesso && (
          <p className="nota-sucesso" role="status">
            Senha trocada. Ela vale a partir do próximo login.
          </p>
        )}

        <button type="submit" disabled={salvando}>
          {salvando ? 'Trocando…' : 'Trocar senha'}
        </button>
      </form>
    </section>
  )
}
