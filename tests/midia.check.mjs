// Prova de ponta a ponta no app de verdade (electron-vite dev + Electron isolado por RAY_TEST_DIR): solta um
// mp4 (>1 MiB, moov no FIM: obriga o Chromium a pedir um 2º Range, que quebrava) no canvas e cola um mp3 → viram embeddables com link ray-media://, o <video> lê os metadados pelo
// esquema próprio, o Range responde 206 (seek) e o autosave grava o link. `npm run check:midia`
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const PORT = 9333
const dir = await mkdtemp(path.join(tmpdir(), 'ray-midia-'))
const proc = spawn(`npx electron-vite dev --remoteDebuggingPort ${PORT}`, { env: { ...process.env, RAY_TEST_DIR: dir }, stdio: ['ignore', 'ignore', 'inherit'], shell: true })
const matar = () => { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); else proc.kill() }
setTimeout(() => { console.error('timeout'); matar(); process.exit(1) }, 120000).unref()

async function alvo() {
  for (let i = 0; i < 200; i++) {
    try {
      const p = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())).find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
      if (p) return p.webSocketDebuggerUrl
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Electron não abriu a porta de depuração')
}
const ws = new WebSocket(await alvo())
await new Promise((r) => (ws.onopen = r))
let seq = 0
const pend = new Map()
const respostas = [] // respostas de rede do ray-media:// (fetch da página pro esquema cai em CORS; a rede não mente)
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
  if (m.method === 'Network.responseReceived' && m.params.response.url.startsWith('ray-media://')) respostas.push(m.params.response)
}
const cdp = (method, params) => new Promise((r) => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
await cdp('Network.enable')
async function js(expression) {
  const { result, error } = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (error) throw new Error('CDP: ' + error.message)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails))
  return result.result.value
}

try {
  for (let i = 0; ; i++) { // a página pode ainda estar carregando (contexto destruído no meio) — insiste
    try { await js('new Promise((r) => { const t = setInterval(() => { if (window.__rayTest?.api) { clearInterval(t); r(true) } }, 200) })'); break }
    catch (e) { if (i > 20) throw e; await new Promise((r) => setTimeout(r, 500)) }
  }
  const b64 = async (f) => (await readFile(new URL('./fixtures/' + f, import.meta.url))).toString('base64')
  const out = await js(`(async () => {
    const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
    const dt = new DataTransfer(); dt.items.add(new File([bytes('${await b64('moov-no-fim.mp4')}')], 'moov-no-fim.mp4', { type: 'video/mp4' }))
    document.querySelector('canvas').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: 400, clientY: 300, bubbles: true, cancelable: true }))
    const dt2 = new DataTransfer(); dt2.items.add(new File([bytes('${await b64('mini.mp3')}')], 'mini.mp3', { type: 'audio/mpeg' }))
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt2, bubbles: true, cancelable: true }))
    const api = window.__rayTest.api
    const embeds = () => api.getSceneElements().filter((e) => e.type === 'embeddable')
    for (let i = 0; i < 100 && embeds().length < 2; i++) await new Promise((r) => setTimeout(r, 100))
    const video = document.querySelector('.excalidraw__embeddable-container video')
    if (video && video.readyState < 1) await new Promise((ok) => { video.onloadedmetadata = ok; video.onerror = ok; setTimeout(ok, 5000) })
    await new Promise((r) => setTimeout(r, 1500)) // autosave (800 ms)
    // como foto: clique no corpo cai no canvas, clique na barra cai no botão; só o vídeo selecionado → popup de link escondido
    const r = document.querySelector('.ray-player')?.getBoundingClientRect()
    const larguras = [document.querySelector('.excalidraw__embeddable-container').getBoundingClientRect().width, r?.width]
    const corpo = r && document.elementFromPoint(r.left + r.width / 2, r.top + 10)?.tagName
    const botao = r && document.elementFromPoint(r.left + 14, r.bottom - 14)?.tagName
    // popup de link do pacote (markup real: div.excalidraw-hyperlinkContainer > a.excalidraw-hyperlinkContainer-link[href]):
    // o pacote só o abre num clique de mouse de verdade, então a regra CSS é provada com o mesmo markup injetado
    const fakePopup = (href) => { const d = document.createElement('div'); d.className = 'excalidraw-hyperlinkContainer'; d.innerHTML = '<a class="excalidraw-hyperlinkContainer-link" href="' + href + '">x</a>'; document.body.appendChild(d); return getComputedStyle(d).display }
    return {
      larguras, corpo, botao, popupMidia: fakePopup('ray-media://x.mp4'), popupWeb: fakePopup('/api/media/x.mp4'), popupSite: fakePopup('https://exemplo.com'),
      els: embeds().map((e) => ({ link: e.link, w: e.width, h: e.height, traco: e.strokeColor, cantos: e.roundness })),
      temVideo: !!video, temAudio: !!document.querySelector('.excalidraw__embeddable-container audio'),
      ready: video?.readyState ?? 0, duracao: video?.duration ?? 0,
    }
  })()`)
  const mp4 = respostas.find((r) => /\.mp4\/?$/.test(r.url)) // esquema standard põe / no fim da URL
  const cabecalhos = Object.fromEntries(Object.entries(mp4?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  console.log(out, { status: mp4?.status, 'content-range': cabecalhos['content-range'] })
  assert.equal(out.els.length, 2, 'drop do mp4 + paste do mp3 = 2 embeddables')
  const video = out.els.find((e) => e.link.endsWith('.mp4')), audio = out.els.find((e) => e.link.endsWith('.mp3')) // o áudio entra antes (não mede metadado)
  assert.match(video?.link ?? '', /^ray-media:\/\/[a-z0-9]+\.mp4$/)
  assert.deepEqual([video.w, video.h], [480, 360], 'tamanho segue a proporção 4:3 do fixture')
  assert.deepEqual([video.traco, video.cantos], ['transparent', null], 'sem borda nem cantos arredondados (como foto)')
  assert.match(audio?.link ?? '', /^ray-media:\/\/[a-z0-9]+\.mp3$/)
  assert.deepEqual([audio.w, audio.h], [320, 64], 'áudio = barra + corpo pra arrastar')
  assert.ok(out.temVideo && out.temAudio, 'renderEmbeddable desenhou <video> e <audio>')
  assert.equal(out.larguras[0], out.larguras[1], 'player cobre a caixa inteira (sem respiro do traço)')
  assert.equal(out.corpo, 'CANVAS', 'clique no corpo do vídeo vai pro canvas (seleciona/arrasta como foto)')
  assert.equal(out.botao, 'BUTTON', 'barra do player recebe o clique sem ativar nada')
  assert.deepEqual([out.popupMidia, out.popupWeb, out.popupSite], ['none', 'none', 'flex'], 'popup de link escondido só pra mídia (desktop e web); o do pacote é flex')
  assert.ok(out.ready >= 1 && out.duracao > 7.5, 'vídeo carregou metadados pelo ray-media:// (2º Range aceito)')
  assert.equal(mp4?.status, 206, 'o <video> pede Range e o esquema responde 206 (seek)')
  assert.match(cabecalhos['content-range'] ?? '', /^bytes \d+-\d+\/\d+$/)
  const midias = await readdir(path.join(dir, 'docs', 'media'))
  assert.equal(midias.length, 2, 'dois arquivos em media/')
  const cenas = await readdir(path.join(dir, 'docs', 'projects'))
  const cena = await readFile(path.join(dir, 'docs', 'projects', cenas.find((f) => f.endsWith('.excalidraw'))), 'utf8')
  assert.ok(cena.includes(video.link) && cena.includes(audio.link), 'autosave gravou os links')
  const migrado = await js(`(async () => {
    const id = await window.ray.last(), cena = JSON.parse(await window.ray.load(id))
    cena.elements = cena.elements.map((e) => (e.type === 'embeddable' ? { ...e, strokeColor: '#1e1e1e' } : e)) // como ficou quem soltou vídeo antes da 1.8.1
    await window.ray.save(id, JSON.stringify(cena))
    location.reload()
  })()`).catch(() => {}) // reload derruba o contexto; o próximo evaluate espera o app voltar
  for (let i = 0; ; i++) { try { await js('new Promise((r) => { const t = setInterval(() => { if (window.__rayTest?.api?.getSceneElements().length) { clearInterval(t); r(true) } }, 200) })'); break } catch (e) { if (i > 20) throw e; await new Promise((r) => setTimeout(r, 500)) } }
  const tracos = await js("window.__rayTest.api.getSceneElements().filter((e) => e.type === 'embeddable').map((e) => e.strokeColor)")
  assert.deepEqual(tracos, ['transparent', 'transparent'], 'ao abrir a cena, mídia antiga com traço vira transparente')
  console.log('midia self-check OK')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await Promise.race([cdp('Browser.close'), new Promise((r) => setTimeout(r, 2000))]) // app pode já ter caído
  ws.close()
  matar()
  await new Promise((r) => setTimeout(r, 1500))
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
