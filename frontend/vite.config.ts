import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // RNF07 — instalabilidade e comportamento offline previsível.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icone.svg', 'favicon.png', 'apple-touch-icon.png'],
      workbox: {
        // T19b — os handlers de `push` e `notificationclick` entram por
        // importação, e não trocando o `generateSW` por um `injectManifest`:
        // assim as três regras de offline decididas em T10 (logo abaixo)
        // continuam sendo geradas pelo plugin, e não viram código nosso sem
        // teste por trás. O arquivo vive em `public/sw-push.js` e é copiado
        // para a raiz do build.
        importScripts: ['sw-push.js'],
        // O padrão do plugin é `js,css,html`: sem o `woff2`, o app instalado
        // abriria offline na fonte do sistema (T40). O `woff` que o
        // `@fontsource` também emite fica de fora, porque todo navegador que
        // instala o PWA lê `woff2`.
        globPatterns: ['**/*.{js,css,html,woff2}'],
        // Duas razões, ambas de T10. (a) O app instalado precisa abrir sem
        // rede para mostrar o bloqueio explícito da tela de leitura, em vez do
        // erro de rede do navegador, que não explica nada. (b) Cada tela tem
        // URL própria desde T10, e recarregar `/leitura` direto precisa
        // resolver no app shell.
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // A leitura de QR e o health check nunca passam por cache, e nunca
            // são repetidos automaticamente. Um retry do service worker
            // gravaria um segundo `LEITURA_QR_SAIDA` no log e inflaria o
            // denominador da taxa de acerto na primeira leitura, que é o
            // indicador do TCC (RF12). Servir veredito de cache seria pior
            // ainda: ele vale para o estoque de um instante só.
            urlPattern: ({ url }) => url.pathname === '/saidas/ler' || url.pathname === '/health',
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'Controle de Estoque FIFO por Validade',
        short_name: 'Estoque FIFO',
        description:
          'Controle de estoque por unidade física com saída FIFO por data de validade.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // As duas cores repetem o fundo da página (`--cor-fundo` de
        // `src/estilos.css`): a tela de abertura e a barra de status do celular
        // emendam no app, que desde T40 não tem barra colorida no topo. O
        // manifest é JSON e não lê variável CSS.
        background_color: '#f6f7f5',
        theme_color: '#f6f7f5',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
