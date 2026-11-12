import { useEffect, useRef } from 'react'

/**
 * Câmera do balcão (RF05). Faz uma coisa só: pedir a câmera traseira e emitir
 * o texto que decodificar. Não conhece veredito, não conhece FIFO, não fala
 * com a API.
 *
 * O isolamento é deliberado. `html5-qrcode` (fixada em `docs/arquitetura.md`
 * seção 1) depende de `getUserMedia` e de decodificação de imagem, e nenhum
 * dos dois existe em jsdom — o `playwright-cli` também não aponta câmera para
 * um frasco. Com a integração inteira reduzida a este arquivo, o resto da tela
 * fica testável com um dublê, e o que sobra sem cobertura automatizada é só o
 * que precisa mesmo de celular real (ver `tasks/T10-tela-leitura-qr.md`).
 */

const ID_CAIXA = 'leitor-camera'

/**
 * `'unica'`: emite o primeiro código decodificado e para a câmera (T31). Para
 * ler outro, quem usa o componente o monta de novo.
 * `'continua'`: emite cada quadro decodificado até ser desmontado.
 */
export type ModoLeitura = 'unica' | 'continua'

/**
 * `'qr'`: a etiqueta da unidade (RF04), na Venda e na Consulta.
 * `'codigo-de-barras'`: o código de barras do fabricante na embalagem (T47),
 * no cadastro de produto. Só os formatos de varejo (EAN-13, EAN-8, UPC-A e
 * UPC-E), o que também impede ler ali, por engano, a etiqueta QR de uma
 * unidade que esteja na mesma bancada.
 */
export type TipoLeitura = 'qr' | 'codigo-de-barras'

type Props = {
  /**
   * Chamado a cada decodificação bem-sucedida. No modo `'continua'` pode
   * repetir em rajada; no `'unica'`, é chamado uma vez por montagem.
   */
  aoLer: (texto: string) => void
  /** Câmera indisponível: sem permissão, sem dispositivo, ou contexto inseguro. */
  aoFalhar: (mensagem: string) => void
  modo?: ModoLeitura
  /** Lido só ao ligar a câmera: trocar com ela ligada não tem efeito. */
  leitura?: TipoLeitura
}

export function LeitorCamera({ aoLer, aoFalhar, modo = 'continua', leitura = 'qr' }: Props) {
  // Os callbacks ficam em ref para que trocar de handler não reinicie a
  // câmera: religar o vídeo no meio do atendimento pisca a tela e perde
  // quadros.
  const aoLerRef = useRef(aoLer)
  const aoFalharRef = useRef(aoFalhar)
  const modoRef = useRef(modo)
  const leituraRef = useRef(leitura)
  aoLerRef.current = aoLer
  aoFalharRef.current = aoFalhar
  modoRef.current = modo

  useEffect(() => {
    let vivo = true
    let leitor: { stop: () => Promise<void>; clear: () => void } | null = null
    // O `stop()` é assíncrono e a biblioteca continua entregando quadros até
    // ele terminar. Na leitura única, esses quadros param aqui, e não em quem
    // usa o componente.
    let jaLeu = false

    async function iniciar() {
      try {
        // Import dinâmico: a biblioteca só é baixada quando a atendente liga a
        // câmera, e não no carregamento do app — que no balcão acontece em
        // rede de celular.
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        if (!vivo) return

        const codigoDeBarras = leituraRef.current === 'codigo-de-barras'
        const instancia = codigoDeBarras
          ? new Html5Qrcode(ID_CAIXA, {
              formatsToSupport: [
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E,
              ],
              // O leitor nativo do Android (BarcodeDetector) lê código de
              // barras em embalagem curva bem melhor que a decodificação em
              // JavaScript; onde ele não existe, a biblioteca usa a dela.
              useBarCodeDetectorIfSupported: true,
              verbose: false,
            })
          : new Html5Qrcode(ID_CAIXA)
        leitor = instancia

        await instancia.start(
          { facingMode: 'environment' },
          // O código de barras é largo e baixo; a mira quadrada do QR cortaria
          // as pontas dele.
          { fps: 10, qrbox: codigoDeBarras ? { width: 280, height: 120 } : { width: 250, height: 250 } },
          (texto) => {
            if (jaLeu) return
            if (modoRef.current === 'unica') {
              jaLeu = true
              void desligar(instancia)
            }
            aoLerRef.current(texto)
          },
          // O callback de erro dispara a cada quadro sem QR à vista, que é o
          // estado normal enquanto a atendente mira. Silêncio proposital.
          () => {},
        )

        // O componente pode ter sido desmontado durante o `await`, e aí ficou
        // uma câmera ligada sem ninguém olhando.
        if (!vivo) await desligar(instancia)
      } catch (falha) {
        if (vivo) aoFalharRef.current(mensagemDeFalha(falha))
      }
    }

    void iniciar()

    return () => {
      vivo = false
      if (leitor) void desligar(leitor)
    }
  }, [])

  // `html5-qrcode` injeta o <video> dentro deste elemento, pelo id.
  return <div id={ID_CAIXA} className="leitor-camera" data-testid="leitor-camera" />
}

async function desligar(leitor: { stop: () => Promise<void>; clear: () => void }) {
  try {
    await leitor.stop()
    leitor.clear()
  } catch {
    // Parar uma câmera que já parou não é problema desta tela.
  }
}

/**
 * Traduz a falha da câmera para o balcão. É texto de interface, não veredito:
 * a RNF04 fala sobre quem decide a saída, e a câmera não decide nada.
 */
function mensagemDeFalha(falha: unknown): string {
  const texto = falha instanceof Error ? `${falha.name} ${falha.message}` : String(falha)

  if (/NotAllowedError|Permission/i.test(texto)) {
    return 'Permissão de câmera negada. Libere a câmera nas configurações do navegador ou digite o código.'
  }
  if (/NotFoundError|no camera|Requested device not found/i.test(texto)) {
    return 'Nenhuma câmera encontrada neste aparelho. Digite o código.'
  }
  if (/NotReadableError|TrackStartError/i.test(texto)) {
    return 'A câmera está em uso por outro aplicativo. Feche-o ou digite o código.'
  }
  // Inclui o caso de contexto não-seguro (HTTP em IP de rede local), em que o
  // navegador nem oferece `getUserMedia`.
  return 'Não foi possível abrir a câmera neste navegador. Digite o código.'
}
