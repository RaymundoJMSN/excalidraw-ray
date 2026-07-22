import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import * as store from './store'

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
  if (s.maximized ?? true) win.maximize()
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url) // links (bibliotecas, ajuda) abrem no navegador de verdade
    return { action: 'deny' }
  })
  win.on('close', (e) => {
    try { fs.writeFileSync(winStateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })) } catch {}
    if (!flushed) { // dá 1.5s pro renderer salvar o autosave pendente
      e.preventDefault()
      win.webContents.send('flush')
      const done = () => {
        ipcMain.removeListener('flushed', done)
        clearTimeout(t)
        if (!flushed) { flushed = true; win.close() }
      }
      const t = setTimeout(done, 1500)
      ipcMain.once('flushed', done)
    }
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
  return win
}

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
  store.init({ dir: path.join(app.getPath('documents'), 'ExcalidrawRay'), trash: (f) => shell.trashItem(f) })
  ipcMain.handle('projects:list', () => store.list())
  ipcMain.handle('projects:create', (_e, name) => store.create(name))
  ipcMain.handle('projects:load', (_e, id) => store.load(id))
  ipcMain.handle('projects:save', (_e, id, json) => store.save(id, json))
  ipcMain.handle('projects:saveThumb', (_e, id, dataURL) => store.saveThumb(id, dataURL))
  ipcMain.handle('projects:thumb', (_e, id) => store.thumb(id))
  ipcMain.handle('projects:rename', (_e, id, name) => store.rename(id, name))
  ipcMain.handle('projects:delete', (_e, id) => store.remove(id))
  ipcMain.handle('projects:last', () => store.getLast())
  ipcMain.handle('projects:setLast', (_e, id) => store.setLast(id))
  ipcMain.handle('projects:openFolder', () => shell.openPath(store.dir()))
  ipcMain.handle('update:run', () => runUpdate())
  const win = createWindow()
  checkUpdate(win)
})
app.on('window-all-closed', () => app.quit())
