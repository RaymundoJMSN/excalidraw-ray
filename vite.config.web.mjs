// Build web (fase 2): mesmo renderer, storage vira cliente HTTP. Sai em server/public.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// PWA (instalar no celular): manifest + service worker só no build web — no Electron (file://) não faz sentido
const pwa = {
  name: 'ray-pwa',
  transformIndexHtml: () => [
    { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'theme-color', content: '#121212' }, injectTo: 'head' },
    { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/icon-180.png' }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'Ray Draw' }, injectTo: 'head' },
    { // embed em iframe (link /v/) não registra SW; sandbox pode lançar
      tag: 'script',
      children: "try { if ('serviceWorker' in navigator && window.top === window) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {})) } catch {}",
      injectTo: 'head',
    },
  ],
}

export default defineConfig({
  root: path.join(here, 'src/renderer'),
  mode: 'web',
  plugins: [react(), pwa],
  build: { outDir: path.join(here, 'server/public'), emptyOutDir: true },
})
