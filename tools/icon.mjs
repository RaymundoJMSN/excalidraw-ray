// Gera build/icon.ico a partir de SVG inline (rodar uma vez: node tools/icon.mjs)
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { mkdir, writeFile } from 'node:fs/promises'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="52" fill="#232329"/>
  <rect x="8" y="8" width="240" height="240" rx="46" fill="none" stroke="#403e6a" stroke-width="4"/>
  <path d="M84 196 L84 62 Q84 58 89 58 L142 60 Q174 63 176 92 Q177 120 146 126 L92 128 M118 130 Q150 158 172 192"
        fill="none" stroke="#a8a5ff" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M86 194 L84 64 Q85 60 90 60 L140 62" fill="none" stroke="#8b88e0" stroke-width="5" stroke-linecap="round" opacity=".55"/>
</svg>`

await mkdir('build', { recursive: true })
const pngs = await Promise.all([256, 128, 64, 48, 32, 16].map((s) => sharp(Buffer.from(svg)).resize(s, s).png().toBuffer()))
await writeFile('build/icon.ico', await pngToIco(pngs))
await writeFile('build/icon.png', pngs[0]) // útil pra README/futura versão web
console.log('build/icon.ico gerado')
