import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// caminhos derivados deste arquivo: o repo é junction (C:\Users\rayna\Soltos ⇄ X:\Soltos) e
// misturar os dois prefixos fazia o rollup receber input absoluto e abortar o build do renderer.
const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: path.join(here, 'src/renderer'),
    plugins: [react()],
    build: { rollupOptions: { input: path.join(here, 'src/renderer/index.html') } },
  },
})
