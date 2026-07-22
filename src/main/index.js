import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import * as store from './store'

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
  win.on('close', (e) => {
    try { fs.writeFileSync(winStateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })) } catch {}
    if (!flushed) { // dá 1.5s pro renderer salvar o autosave pendente
      e.preventDefault()
      win.webContents.send('flush')
      const done = () => { if (!flushed) { flushed = true; win.close() } }
      setTimeout(done, 1500)
      ipcMain.once('flushed', done)
    }
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  store.init({ dir: path.join(app.getPath('documents'), 'ExcalidrawRay'), trash: (f) => shell.trashItem(f) })
  ipcMain.handle('projects:list', () => store.list())
  ipcMain.handle('projects:create', (_e, name) => store.create(name))
  ipcMain.handle('projects:load', (_e, id) => store.load(id))
  ipcMain.handle('projects:save', (_e, id, json) => store.save(id, json))
  ipcMain.handle('projects:rename', (_e, id, name) => store.rename(id, name))
  ipcMain.handle('projects:delete', (_e, id) => store.remove(id))
  ipcMain.handle('projects:last', () => store.getLast())
  ipcMain.handle('projects:setLast', (_e, id) => store.setLast(id))
  ipcMain.handle('projects:openFolder', () => shell.openPath(store.dir()))
  createWindow()
})
app.on('window-all-closed', () => app.quit())
