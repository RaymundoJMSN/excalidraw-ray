// Gera build/icon.ico + build/icon.png a partir do ícone oficial do Excalidraw (MIT).
// Fonte: build/icon-oficial.png (baixado de https://excalidraw.com/android-chrome-512x512.png).
// Rodar uma vez: node tools/icon.mjs
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFile } from 'node:fs/promises'

const SRC = 'build/icon-oficial.png'
const pngs = await Promise.all([256, 128, 64, 48, 32, 16].map((s) => sharp(SRC).resize(s, s).png().toBuffer()))
await writeFile('build/icon.ico', await pngToIco(pngs))
await writeFile('build/icon.png', pngs[0]) // favicon do site
console.log('build/icon.ico e build/icon.png gerados do ícone oficial')
