/**
 * Dublê de `Response` para os testes de componente: expõe só o que
 * `requisitarApi` consome (`ok`, `status`, `json`). Sem corpo, `json()`
 * rejeita — é o que uma resposta 204 real faz.
 */
export function respostaFalsa(status: number, corpo?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (corpo === undefined) throw new SyntaxError('resposta sem corpo')
      return corpo
    },
  } as Response
}
