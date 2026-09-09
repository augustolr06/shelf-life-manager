/*
 * Handlers de push do service worker (RF08, T19b).
 *
 * Este arquivo é **importado** pelo service worker que o `vite-plugin-pwa`
 * gera (`workbox.importScripts` em `vite.config.ts`), em vez de substituí-lo.
 * A alternativa seria trocar o `generateSW` por um `injectManifest` com service
 * worker próprio — e aí as três regras de RNF07 escritas em T10
 * (`navigateFallback` para o app abrir sem rede, `NetworkOnly` em `/saidas/ler`
 * e `/health`, precache do app shell) passariam a ser código nosso, sem teste
 * nenhum por trás. Um erro ali não quebraria a tela de alertas: quebraria o
 * comportamento offline do balcão (T19b, Decisão 1).
 *
 * A contrapartida, declarada em `docs/decisoes.md`: este arquivo fica fora do
 * build do Vite — sem TypeScript, sem Vitest, sem `typecheck`. Por isso ele é
 * curto e não tem regra de negócio: quem decide o que notificar é o servidor
 * (RNF04), e o texto vem pronto no payload. A verificação dele é a de campo, em
 * aparelho real.
 */

/* global self, clients */

const URL_PADRAO = '/alertas'

/**
 * A notificação em si. `showNotification` é obrigatória: a inscrição é feita
 * com `userVisibleOnly`, e um push que não mostra nada faz o navegador revogar
 * a permissão do aplicativo.
 */
self.addEventListener('push', (evento) => {
  let dados = {}
  try {
    dados = evento.data ? evento.data.json() : {}
  } catch (erro) {
    // Payload que não é JSON não deve calar a notificação: melhor um aviso
    // genérico do que nenhum.
    dados = {}
  }

  const titulo = dados.titulo || 'Unidades perto do vencimento'
  const opcoes = {
    body: dados.corpo || 'Toque para ver a lista de alertas.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    // Marca fixa: uma segunda notificação **substitui** a anterior em vez de
    // empilhar. O aviso é diário e agregado, e duas notificações na bandeja
    // dizendo números diferentes sobre o mesmo estoque confundem mais do que
    // avisam.
    tag: 'alertas-de-validade',
    data: { url: dados.url || URL_PADRAO },
  }

  evento.waitUntil(self.registration.showNotification(titulo, opcoes))
})

/**
 * O toque leva à lista. Reaproveita uma aba já aberta do app quando há uma —
 * abrir uma segunda cópia do sistema no balcão é o tipo de coisa que faz a
 * atendente perder o atendimento em andamento.
 */
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close()

  const destino = (evento.notification.data && evento.notification.data.url) || URL_PADRAO

  evento.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const janela of janelas) {
        if ('focus' in janela) {
          if ('navigate' in janela) janela.navigate(destino)
          return janela.focus()
        }
      }
      return clients.openWindow(destino)
    }),
  )
})
