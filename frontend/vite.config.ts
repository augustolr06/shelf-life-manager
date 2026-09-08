import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // RNF07 — instalabilidade e comportamento offline previsível.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      workbox: {
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
        background_color: '#ffffff',
        theme_color: '#0f766e',
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
