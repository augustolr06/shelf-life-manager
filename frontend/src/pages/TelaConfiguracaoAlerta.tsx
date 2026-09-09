import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ErroApi } from '../services/api'
import {
  CANAIS,
  ROTULO_CANAL,
  alterarConfiguracao,
  criarConfiguracao,
  inativarConfiguracao,
  listarConfiguracoes,
  reativarConfiguracao,
  type Canal,
  type ConfiguracaoAlerta,
} from '../services/configuracaoAlerta'

/**
 * A janela de antecedência dos alertas proativos (RF08).
 *
 * É a única tela do sistema que não fala de um frasco: aqui o gestor define um
 * parâmetro — quantos dias antes do vencimento ele quer ser avisado. O número
 * depende do giro do produto, e quem sabe qual serve é a loja, não o código.
 *
 * Como as demais, a tela não decide nada. Os limites de 1 a 365 e a recusa de
 * duas janelas iguais são do servidor; o `min`/`max` do campo é conveniência
 * de teclado, e quem recusa de fato é o 400 (RNF04).
 */

/** O que o formulário mostra antes de o gestor digitar. É o exemplo da
 * jornada J3 do PRD, e o mesmo valor que o seed cria. */
const PADRAO: { dias: string; canal: Canal } = { dias: '30', canal: 'IN_APP' }

type EmEdicao = { id: string; dias: string; canal: Canal }

export function TelaConfiguracaoAlerta() {
  const [configuracoes, setConfiguracoes] = useState<ConfiguracaoAlerta[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [novoDias, setNovoDias] = useState(PADRAO.dias)
  const [novoCanal, setNovoCanal] = useState<Canal>(PADRAO.canal)
  const [erroFormulario, setErroFormulario] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // Uma linha em edição por vez: são poucos campos, e a tabela inteira
  // editável viraria um formulário sem contorno.
  const [edicao, setEdicao] = useState<EmEdicao | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setConfiguracoes(await listarConfiguracoes())
      setEdicao(null)
    } catch (falha) {
      setErro(
        falha instanceof ErroApi
          ? falha.message
          : 'Não foi possível carregar as configurações de alerta.',
      )
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function cadastrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setErroFormulario(null)
    setSalvando(true)

    try {
      await criarConfiguracao({ diasAntecedencia: Number(novoDias), canal: novoCanal })
      setNovoDias(PADRAO.dias)
      setNovoCanal(PADRAO.canal)
      await carregar()
    } catch (falha) {
      // Antecedência repetida chega como 409 com mensagem própria do backend.
      // O formulário fica como está: o gestor vai querer só trocar o número,
      // não redigitar tudo.
      setErroFormulario(
        falha instanceof ErroApi ? falha.message : 'Não foi possível salvar a configuração.',
      )
    } finally {
      setSalvando(false)
    }
  }

  async function salvarEdicao(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!edicao) return

    const original = configuracoes.find((c) => c.id === edicao.id)
    if (!original) return

    // Só o que mudou. Um `PATCH` com o valor atual seria inofensivo, mas
    // reenviar a antecedência inalterada dispara a verificação de colisão
    // contra a própria linha sem necessidade.
    const alteracao: { diasAntecedencia?: number; canal?: Canal } = {}
    if (Number(edicao.dias) !== original.diasAntecedencia) {
      alteracao.diasAntecedencia = Number(edicao.dias)
    }
    if (edicao.canal !== original.canal) alteracao.canal = edicao.canal

    if (Object.keys(alteracao).length === 0) {
      setEdicao(null)
      return
    }

    setErro(null)
    try {
      const alterada = await alterarConfiguracao(edicao.id, alteracao)
      setConfiguracoes((atuais) => atuais.map((c) => (c.id === alterada.id ? alterada : c)))
      setEdicao(null)
    } catch (falha) {
      setErro(falha instanceof ErroApi ? falha.message : 'Não foi possível alterar a configuração.')
    }
  }

  async function alternarSituacao(configuracao: ConfiguracaoAlerta) {
    setErro(null)
    try {
      const atualizada = configuracao.ativo
        ? await inativarConfiguracao(configuracao.id)
        : await reativarConfiguracao(configuracao.id)
      setConfiguracoes((atuais) => atuais.map((c) => (c.id === atualizada.id ? atualizada : c)))
    } catch (falha) {
      // Reativar pode colidir com outra janela criada nesse meio-tempo — 409
      // com a mensagem do servidor, como no cadastro.
      setErro(
        falha instanceof ErroApi ? falha.message : 'Não foi possível alterar a situação.',
      )
    }
  }

  return (
    <section className="tela-configuracao-alerta">
      <h2>Alertas de vencimento próximo</h2>
      <p className="subtitulo">
        Quantos dias antes do vencimento o sistema deve avisar. O número depende do giro do
        produto — 30 dias dá tempo de decidir uma promoção; 7 dias é última chamada.
      </p>

      {/* Terceira versão deste aviso: T17 dizia que não havia varredura, T18
          que não havia entrega, e T19 entregou — no aplicativo. O que resta
          por dizer é o canal `PUSH`, que continua aceitável na configuração e
          ainda não sai do aparelho. Enquanto for assim, o texto precisa dizê-lo:
          a alternativa seria uma janela configurada como push cujo aviso não
          chega a lugar nenhum. */}
      <p className="nota-informativa" role="note">
        A verificação periódica roda automaticamente e os alertas aparecem na aba{' '}
        <strong>Alertas</strong>. A notificação push ainda não está implantada: janelas com
        canal push ou ambos também são avisadas no aplicativo, por enquanto.
      </p>

      <form className="formulario-configuracao-alerta" onSubmit={cadastrar}>
        <h3>Nova janela de antecedência</h3>

        <div className="campo">
          <label htmlFor="diasAntecedencia">Dias de antecedência</label>
          <input
            id="diasAntecedencia"
            name="diasAntecedencia"
            type="number"
            required
            // Conveniência de teclado no celular, não autorização: quem
            // recusa 0 e 366 é o backend.
            min={1}
            max={365}
            step={1}
            value={novoDias}
            onChange={(evento) => setNovoDias(evento.target.value)}
          />
        </div>

        <div className="campo">
          <label htmlFor="canal">Como avisar</label>
          <select
            id="canal"
            name="canal"
            value={novoCanal}
            onChange={(evento) => setNovoCanal(evento.target.value as Canal)}
          >
            {CANAIS.map((canal) => (
              <option key={canal} value={canal}>
                {ROTULO_CANAL[canal]}
              </option>
            ))}
          </select>
        </div>

        {erroFormulario && (
          <p className="erro" role="alert">
            {erroFormulario}
          </p>
        )}

        <button type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Adicionar janela'}
        </button>
      </form>

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      {carregando ? (
        <p role="status">Carregando configurações…</p>
      ) : configuracoes.length === 0 ? (
        <p>Nenhuma janela de antecedência configurada.</p>
      ) : (
        <table>
          <caption>Janelas configuradas, da mais larga para a mais estreita</caption>
          <thead>
            <tr>
              <th scope="col">Antecedência</th>
              <th scope="col">Como avisar</th>
              <th scope="col">Situação</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {configuracoes.map((configuracao) =>
              edicao?.id === configuracao.id ? (
                <tr key={configuracao.id}>
                  <td colSpan={4}>
                    <form className="edicao-configuracao" onSubmit={salvarEdicao}>
                      <div className="campo">
                        <label htmlFor={`dias-${configuracao.id}`}>Dias de antecedência</label>
                        <input
                          id={`dias-${configuracao.id}`}
                          type="number"
                          required
                          min={1}
                          max={365}
                          step={1}
                          value={edicao.dias}
                          onChange={(evento) =>
                            setEdicao((atual) =>
                              atual ? { ...atual, dias: evento.target.value } : atual,
                            )
                          }
                        />
                      </div>

                      <div className="campo">
                        <label htmlFor={`canal-${configuracao.id}`}>Como avisar</label>
                        <select
                          id={`canal-${configuracao.id}`}
                          value={edicao.canal}
                          onChange={(evento) =>
                            setEdicao((atual) =>
                              atual ? { ...atual, canal: evento.target.value as Canal } : atual,
                            )
                          }
                        >
                          {CANAIS.map((canal) => (
                            <option key={canal} value={canal}>
                              {ROTULO_CANAL[canal]}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button type="submit">Salvar</button>
                      <button type="button" onClick={() => setEdicao(null)}>
                        Cancelar
                      </button>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={configuracao.id} className={configuracao.ativo ? undefined : 'linha-inativa'}>
                  <td>{configuracao.diasAntecedencia} dias antes</td>
                  <td>{ROTULO_CANAL[configuracao.canal]}</td>
                  <td>{configuracao.ativo ? 'Ativa' : 'Inativa'}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() =>
                        setEdicao({
                          id: configuracao.id,
                          dias: String(configuracao.diasAntecedencia),
                          canal: configuracao.canal,
                        })
                      }
                    >
                      Alterar
                    </button>
                    <button type="button" onClick={() => void alternarSituacao(configuracao)}>
                      {configuracao.ativo ? 'Inativar' : 'Reativar'}
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
    </section>
  )
}
