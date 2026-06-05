import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    solid(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Video Editor',
        short_name: 'Editor',
        start_url: '/',
        display: 'standalone',
        background_color: '#16161a',
        theme_color: '#16161a',
        icons: [
          { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,wasm,wgsl}'] },
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
