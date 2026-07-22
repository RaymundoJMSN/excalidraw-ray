// Build web (fase 2): mesmo renderer, storage vira cliente HTTP. Sai em server/public.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.join(here, 'src/renderer'),
  mode: 'web',
  plugins: [react()],
  build: { outDir: path.join(here, 'server/public'), emptyOutDir: true },
})
