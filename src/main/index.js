import { app, BrowserWindow, ipcMain, shell, Menu, protocol } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { spawn } from 'node:child_process'
import * as store from './store'
import * as sync from './sync'

// mídia do canvas (<video src="ray-media://x.mp4">): `stream` deixa vídeo/áudio tocar por esquema próprio e `standard`
// dá origem de verdade à URL — sem ele o Chromium aceita o 1º Range mas descarta o 2º (mp4 com moov no fim) e o <video>
// morre com erro 4, mesmo com bytes e cabeçalhos certos (medido com um mp4 de 1 MB; o fixture pequeno nunca pedia o 2º)
protocol.registerSchemesAsPrivileged([{ scheme: 'ray-media', privileges: { standard: true, stream: true, supportFetchAPI: true, corsEnabled: true, secure: true, bypassCSP: true } }])
const MEDIA_MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mkv: 'video/x-matroska', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg', weba: 'audio/webm', mpeg: 'audio/mpeg', mpg: 'audio/mpeg', mpga: 'audio/mpeg' }

if (process.env.RAY_TEST_DIR) { // instância isolada p/ testes: não briga com o app instalado nem toca nos projetos reais
  app.setPath('userData', path.join(process.env.RAY_TEST_DIR, 'userData'))
}
if (!app.requestSingleInstanceLock()) app.quit() // duas instâncias = autosave corrompido

const winStateFile = () => path.join(app.getPath('userData'), 'window-state.json')
let flushed = false

function createWindow() {
  let s = {}
  try { s = JSON.parse(fs.readFileSync(winStateFile(), 'utf8')) } catch {}
  const win = new BrowserWindow({
    width: s.width ?? 1280, height: s.height ?? 800, x: s.x, y: s.y,
    show: false, autoHideMenuBar: true, backgroundColor: '#121212',
    webPreferences: { preload: path.join(__dirname, '../preload/index.js') },
  })
  const teste = !!process.env.RAY_TEST_DIR // janela de teste fica escondida: não rouba a tela de quem está usando o PC
  if ((s.maximized ?? true) && !teste) win.maximize() // maximize() também mostra a janela
  win.once('ready-to-show', () => { if (!teste) win.show() })
  win.on('close', (e) => {
    try { fs.writeFileSync(winStateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })) } catch {}
    if (!flushed) { // dá até 20 s pro renderer salvar o autosave pendente (cena de 100 MB no HD leva segundos)
      e.preventDefault()
      win.webContents.send('flush')
      let closing = false
      const done = () => {
        ipcMain.removeListener('flushed', done)
        clearTimeout(t)
        if (closing) return
        closing = true
        // sobe o que falta pra nuvem antes de fechar (no máx 4s; o que não subir vai no próximo início)
        const fim = () => { if (!flushed) { flushed = true; win.close() } }
        Promise.race([sync.syncNow(), new Promise((r) => setTimeout(r, 4000))]).finally(fim)
      }
      const t = setTimeout(done, 20000)
      ipcMain.once('flushed', done)
    }
  })
  // corretor ortográfico: o Chromium já sublinha, mas o Electron não mostra menu nenhum no botão
  // direito — sem isto não tem como aceitar a sugestão. Só em campo editável (o canvas tem o menu do Excalidraw).
  win.webContents.session.setSpellCheckerLanguages(['pt-BR', 'en-US']) // no Windows vale só idioma instalado no sistema
  win.webContents.on('context-menu', (_e, p) => {
    if (!p.isEditable) return
    const itens = p.dictionarySuggestions.map((s) => ({ label: s, click: () => win.webContents.replaceMisspelling(s) }))
    if (p.misspelledWord) itens.push({ label: 'Adicionar ao dicionário', click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' })
    itens.push({ role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' })
    Menu.buildFromTemplate(itens).popup()
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
  return win
}

// ---- site de bibliotecas: abre em janela do app; o "Add to Excalidraw" (referrer#addLibrary=<url>,
// via navegação OU target=_blank) é interceptado aqui e entregue ao renderer principal.
let mainWin = null

function handleAddLibrary(url) {
  const m = url.match(/#addLibrary=([^&]+)/)
  if (!m) return false
  ;(async () => {
    try {
      const libUrl = decodeURIComponent(m[1])
      if (!/^https:\/\/.+\.excalidrawlib$/.test(libUrl)) return
      const r = await fetch(libUrl, { headers: { 'User-Agent': 'excalidraw-ray' } })
      if (r.ok) mainWin?.webContents.send('add-library', await r.text())
    } catch (err) { console.log('[lib] erro', err) }
  })()
  return true
}

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (handleAddLibrary(url)) return { action: 'deny' }
    if (url.startsWith('https://libraries.excalidraw.com')) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1100, height: 800, autoHideMenuBar: true, backgroundColor: '#121212' } }
    }
    if (/^https?:/.test(url)) shell.openExternal(url) // demais links (ajuda etc) vão pro navegador
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
    if (handleAddLibrary(url)) e.preventDefault() // janela de bibliotecas fica aberta pra adicionar mais
  })
})

// ---- auto-update: consulta a release mais nova no GitHub; botão verde no app baixa e roda o Setup
const REPO = 'RaymundoJMSN/excalidraw-ray'
let update = null // { version, url }

async function checkUpdate(win) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'excalidraw-ray' } })
    if (!r.ok) return
    const rel = await r.json()
    const latest = String(rel.tag_name || '').replace(/^v/, '')
    const atual = app.getVersion()
    const newer = latest.localeCompare(atual, undefined, { numeric: true }) > 0
    const asset = (rel.assets || []).find((a) => a.name.endsWith('.exe'))
    if (newer && asset) {
      update = { version: latest, url: asset.browser_download_url, name: asset.name }
      win.webContents.send('update-available', latest)
    }
  } catch {} // sem rede = sem update, silencioso
}

async function runUpdate() {
  if (!update) return false
  const dest = path.join(app.getPath('temp'), update.name)
  const r = await fetch(update.url, { headers: { 'User-Agent': 'excalidraw-ray' } })
  if (!r.ok) return false
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
  spawn(dest, [], { detached: true, stdio: 'ignore' }).unref() // NSIS oneClick instala por cima e reabre
  flushed = true // flush já foi pedido pelo renderer antes de chamar update:run
  app.quit()
  return true
}

app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0]
  if (w) { if (w.isMinimized()) w.restore(); w.focus() }
})

app.whenReady().then(() => {
  store.init({ dir: process.env.RAY_TEST_DIR ? path.join(process.env.RAY_TEST_DIR, 'docs') : path.join(app.getPath('documents'), 'ExcalidrawRay'), trash: (f) => shell.trashItem(f) })
  ipcMain.handle('projects:list', () => store.list())
  ipcMain.handle('projects:create', (_e, name) => { const id = store.create(name); sync.localCreated(id); return id })
  ipcMain.handle('projects:load', (_e, id) => store.load(id))
  ipcMain.handle('projects:save', async (_e, id, json) => { await store.save(id, json); sync.localSaved(id, json) })
  ipcMain.handle('projects:saveThumb', (_e, id, dataURL) => { store.saveThumb(id, dataURL); sync.localThumb(id) })
  ipcMain.handle('projects:thumb', (_e, id) => store.thumb(id))
  ipcMain.handle('projects:rename', (_e, id, name) => { store.rename(id, name); sync.localRenamed(id) })
  ipcMain.handle('projects:delete', async (_e, id) => { await store.remove(id); sync.localRemoved(id) })
  ipcMain.handle('projects:last', () => store.getLast())
  ipcMain.handle('projects:setLast', (_e, id) => store.setLast(id))
  ipcMain.handle('projects:openFolder', () => shell.openPath(store.dir()))
  ipcMain.handle('update:run', () => runUpdate())
  ipcMain.handle('sync:get', () => sync.config())
  ipcMain.handle('sync:enable', (_e, cfg) => sync.enable(cfg))
  ipcMain.handle('sync:disable', () => sync.disable())
  ipcMain.handle('sync:now', () => sync.syncNow())
  sync.init({ dir: store.dir(), store, notify: (type, payload) => mainWin?.webContents.send('sync', type, payload) })
  app.on('browser-window-focus', () => sync.syncNow()) // voltou pro PC: puxa o que mudou no celular
  ipcMain.handle('media:save', async (_e, nome, origem) => 'ray-media://' + await store.saveMedia(nome, origem))
  protocol.handle('ray-media', (req) => {
    const f = store.mediaPath(decodeURIComponent(req.url.slice('ray-media://'.length).replace(/\/$/, ''))) // standard põe / no fim
    let size
    try { size = fs.statSync(f).size } catch { return new Response('', { status: 404 }) }
    // Range na mão: net.fetch(file://) ignora o cabeçalho e devolve 200 inteiro (medido) — aí o vídeo não busca posição
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '')
    const start = m ? (m[1] ? +m[1] : Math.max(0, size - +m[2])) : 0
    const end = m && m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1
    if (start > end) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    return new Response(Readable.toWeb(fs.createReadStream(f, { start, end })), {
      status: m ? 206 : 200,
      headers: { 'Content-Type': MEDIA_MIME[path.extname(f).slice(1)] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Content-Length': String(end - start + 1), ...(m && { 'Content-Range': `bytes ${start}-${end}/${size}` }) },
    })
  })
  // mídia nossa que o Chromium não renderize inline viraria "salvar como" a cada abertura (aconteceu com um .mpeg no iframe)
  mainWin = createWindow()
  mainWin.webContents.session.on('will-download', (e, item) => { if (item.getURL().startsWith('ray-media://')) e.preventDefault() })
  checkUpdate(mainWin)
})
app.on('window-all-closed', () => store.idle().then(() => app.quit())) // gravação em curso termina antes de sair (ficavam .tmp pela metade)
