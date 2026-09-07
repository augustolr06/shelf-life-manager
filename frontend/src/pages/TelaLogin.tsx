import { useState, type FormEvent } from 'react'
import { ErroApi } from '../services/api'
import { autenticar, type Usuario } from '../services/auth'

type Props = {
  /** Chamado com o usuário devolvido pelo backend após login bem-sucedido. */
  aoAutenticar: (usuario: Usuario) => void
}

export function TelaLogin({ aoAutenticar }: Props) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function submeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErro(null)
    setEnviando(true)

    try {
      const usuario = await autenticar(email, senha)
      aoAutenticar(usuario)
    } catch (falha) {
      // A mensagem vem pronta do backend (RNF04): o frontend não deduz se o
      // problema foi o e-mail ou a senha — o backend responde igual para os
      // dois casos, de propósito.
      setErro(
        falha instanceof ErroApi ? falha.message : 'Não foi possível entrar. Tente novamente.',
      )
      setEnviando(false)
    }
  }

  return (
    <main className="tela-login">
      <form className="cartao" onSubmit={submeter}>
        <h1>Controle de Estoque FIFO por Validade</h1>
        <p className="subtitulo">Entre com suas credenciais para continuar.</p>

        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
        />

        <label htmlFor="senha">Senha</label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(evento) => setSenha(evento.target.value)}
        />

        {erro && (
          // `role="alert"` para que o leitor de tela anuncie a falha sem que o
          // foco precise sair do formulário.
          <p className="erro" role="alert">
            {erro}
          </p>
        )}

        <button type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
