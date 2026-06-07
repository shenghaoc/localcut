import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    tailwindcss(),
    solid(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'LocalCut Studio',
        short_name: 'LocalCut',
        start_url: '/',
        display: 'standalone',
        background_color: '#16161a',
        theme_color: '#16161a',
        icons: [
          { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,wasm,wgsl,woff,woff2}'] },
    }),
  ],
  assetsInclude: ['**/*.wgsl'],
  worker: { format: 'es' },
  build: { target: 'esnext', outDir: 'dist' },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
