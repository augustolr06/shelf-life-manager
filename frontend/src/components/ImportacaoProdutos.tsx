import { useRef, useState, type FormEvent } from 'react'
import { ErroApi } from '../services/api'
import {
  errosDaPlanilha,
  importarProdutos,
  lerTextoDaPlanilha,
  type ResultadoImportacao,
} from '../services/produtos'

/**
 * O modelo que a gestora baixa para preencher. O BOM no início é o que faz o
 * Excel abrir os acentos do cabeçalho certos em vez de "CÃ³digo".
 */
const MODELO = '﻿código interno;nome;marca;categoria\n'
const HREF_MODELO = `data:text/csv;charset=utf-8,${encodeURIComponent(MODELO)}`

type Props = {
  /** Chamado depois de uma importação aceita, para a lista do catálogo recarregar. */
  aoImportar: () => void
}

/**
 * Importação do catálogo por planilha CSV (T24). Só lê o arquivo e o envia:
 * interpretar o CSV, validar as linhas e decidir o que entra é do servidor, e a
 * tela mostra o que ele respondeu (RNF04).
 */
export function ImportacaoProdutos({ aoImportar }: Props) {
  const campoArquivo = useRef<HTMLInputElement>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [errosDeLinha, setErrosDeLinha] = useState<string[]>([])

  async function importar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!arquivo) return

    setEnviando(true)
    setResultado(null)
    setErro(null)
    setErrosDeLinha([])

    try {
      const resposta = await importarProdutos(await lerTextoDaPlanilha(arquivo))
      setResultado(resposta)
      setArquivo(null)
      if (campoArquivo.current) campoArquivo.current.value = ''
      aoImportar()
    } catch (falha) {
      if (falha instanceof ErroApi) {
        setErro(falha.message)
        setErrosDeLinha(errosDaPlanilha(falha.corpo))
      } else {
        setErro('Não foi possível ler o arquivo escolhido.')
      }
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="formulario-produto importacao-produtos" onSubmit={importar}>
      <h3>Importar produtos de planilha</h3>

      <p className="explicacao">
        Salve a planilha como CSV. A primeira linha precisa ter as colunas{' '}
        <strong>código interno</strong>, <strong>nome</strong>, <strong>marca</strong> e{' '}
        <strong>categoria</strong>, em qualquer ordem. Outras colunas são ignoradas. Códigos que já
        estão no catálogo são pulados, sem alteração. Se alguma linha tiver problema, nada é
        importado. <a href={HREF_MODELO} download="modelo-produtos.csv">Baixar planilha modelo</a>
      </p>

      <div className="campo">
        <label htmlFor="arquivo-planilha">Arquivo CSV</label>
        <input
          id="arquivo-planilha"
          ref={campoArquivo}
          type="file"
          accept=".csv,text/csv"
          onChange={(evento) => setArquivo(evento.target.files?.[0] ?? null)}
        />
      </div>

      <button type="submit" disabled={!arquivo || enviando}>
        {enviando ? 'Importando…' : 'Importar'}
      </button>

      {resultado && (
        <div className="nota-sucesso" role="status">
          <p>{resultado.criados} produto(s) importado(s).</p>
          {resultado.ignorados.length > 0 && (
            <>
              <p>
                {resultado.ignorados.length} código(s) já estavam cadastrados e foram pulados:
              </p>
              <ul>
                {resultado.ignorados.map((ignorado) => (
                  <li key={ignorado.linha}>
                    Linha {ignorado.linha}: {ignorado.codigoInterno}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {erro && (
        <div className="erro" role="alert">
          <p>{erro}</p>
          {errosDeLinha.length > 0 && (
            <ul>
              {errosDeLinha.map((linha) => (
                <li key={linha}>{linha}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  )
}
