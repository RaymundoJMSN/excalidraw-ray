# Excalidraw Ray — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans para implementar tarefa a tarefa. Passos usam checkbox (`- [ ]`).

**Goal:** App desktop Windows instalável do Excalidraw com autosave local, multi-projetos (abre o último usado), menu limpo sem links sociais; fase 2 = cenas na nuvem + share view/edit + embed em `draw.raynathus.com.br`.

**Architecture:** App própria (NÃO fork do monorepo) usando o pacote oficial `@excalidraw/excalidraw@0.18.1` + electron-vite (alex8088) + electron-builder NSIS. Menu 100% via API `<MainMenu>` (child substitui o menu default inteiro). Projetos = arquivos `.excalidraw` padrão em `Documentos\ExcalidrawRay\projects\` + `state.json` (nomes, último aberto). Renderer fala com main via IPC (`contextBridge` → `window.ray`), com shim localStorage quando `window.ray` ausente (preview browser / futura versão web). Fase 2 reusa o padrão `server.mjs` Node puro do manduu-apps (porta 8050, systemd+nginx+certbot).

**Tech Stack:** React 18, @excalidraw/excalidraw 0.18.1, Electron 43, electron-vite 4 (Vite 7), electron-builder 26 (NSIS), Node 24. Testes: `node tests/store.check.mjs` (assert puro, padrão dos outros projetos Soltos).

**Fatos críticos da pesquisa (não esquecer):**
- `serializeAsJSON(elements, appState, files, "local")` — **posicional**, não objeto.
- `updateScene` NÃO aceita `files` → troca de projeto = **remount com `key={id}` + `initialData`** (initialData aceita `files`).
- `onChange` dispara em todo update (até seleção) → debounce obrigatório.
- `excalidrawAPI` é prop-callback → guardar com `useState`, não `useRef`.
- `import "@excalidraw/excalidraw/index.css"` obrigatório; container pai precisa altura explícita.
- Fontes vêm de CDN por padrão → copiar `dist/prod/fonts` pra `src/renderer/public/fonts` e `window.EXCALIDRAW_ASSET_PATH = './'` ANTES do render (offline).
- `langCode="pt-BR"` suportado. `MainMenu.DefaultItems`: LoadScene, SaveToActiveFile, SaveAsImage, Export, CommandPalette, SearchMenu, Help, ClearCanvas, ToggleTheme, ChangeCanvasBackground, Socials, LiveCollaborationTrigger (Preferences só no master, NÃO na 0.18.1).
- `MainMenu.Item` `shortcut` é só rótulo visual, não registra tecla.
- `window.prompt` NÃO existe no Electron; `confirm`/`alert` funcionam.
- Preload deve ser CJS (sandbox default on). Main buildado como CJS → `__dirname` ok.
- electron-vite injeta `ELECTRON_RENDERER_URL` no dev; prod usa `win.loadFile()` (nunca montar `file://` na mão).
- electron-builder: sem cert → não assina (SmartScreen avisa, ok pra uso pessoal). `files: [out/**, package.json]`, deps todas em devDependencies (bundladas). Ícone `.ico` real 256px em `build/icon.ico`.
- Colaboração ao vivo NÃO vem no pacote npm (só no excalidraw-app oficial) → fase 2 usa last-write-wins, sem excalidraw-room (YAGNI).

---

## Tarefa 1: Trocar toolchain para electron-vite

**Files:** Modify: `package.json`

- [ ] `npm uninstall concurrently wait-on cross-env vite @vitejs/plugin-react && npm install -D electron-vite@4 vite@7 @vitejs/plugin-react@5`
- [ ] Mover `react`, `react-dom`, `@excalidraw/excalidraw` para devDependencies (electron-vite bundla tudo em `out/`)
- [ ] package.json: `"main": "./out/main/index.js"`, scripts: `"dev": "electron-vite dev", "build": "electron-vite build", "check": "node tests/store.check.mjs", "dist": "electron-vite build && electron-builder --win"`. Remover `"type"` se existir (main CJS).
- [ ] Commit: `chore: toolchain electron-vite`

## Tarefa 2: Scaffold — Excalidraw renderizando em pt-BR/escuro

**Files:**
- Create: `electron.vite.config.mjs`, `src/main/index.js`, `src/main/store.js`, `src/preload/index.js`, `src/renderer/index.html`, `src/renderer/src/main.jsx`, `src/renderer/src/App.jsx`, `src/renderer/src/storage.js`, `src/renderer/public/fonts/**` (copiado de `node_modules/@excalidraw/excalidraw/dist/prod/fonts`)

- [ ] `electron.vite.config.mjs`:

```js
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: { plugins: [react()] },
})
```

- [ ] `src/renderer/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Excalidraw Ray</title>
  <script>window.EXCALIDRAW_ASSET_PATH = './'</script>
  <style>html, body, #root { height: 100%; margin: 0 } body { background: #121212 }</style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] `src/main/store.js` — projetos em disco, escrita atômica + `.bak`, DI de dir/trash pra teste:

```js
// src/main/store.js — projetos em Documentos/ExcalidrawRay. Sem deps de electron (testável com node puro).
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'

let DIR, PROJ, STATE_FILE, trashFn

export function init({ dir, trash }) {
  DIR = dir
  PROJ = path.join(dir, 'projects')
  STATE_FILE = path.join(dir, 'state.json')
  trashFn = trash
  fs.mkdirSync(PROJ, { recursive: true })
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return { last: null, projects: {} } }
}
function writeState(s) {
  fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(s, null, 2))
  fs.renameSync(STATE_FILE + '.tmp', STATE_FILE)
}
const sceneFile = (id) => path.join(PROJ, id + '.excalidraw')

const EMPTY = JSON.stringify({ type: 'excalidraw', version: 2, source: 'excalidraw-ray', elements: [], appState: { theme: 'dark' }, files: {} })

export function list() {
  const s = readState()
  return Object.entries(s.projects).map(([id, p]) => {
    let mtime = 0
    try { mtime = fs.statSync(sceneFile(id)).mtimeMs } catch {}
    return { id, name: p.name, updatedAt: mtime }
  }).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function create(name) {
  const s = readState()
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  fs.writeFileSync(sceneFile(id), EMPTY)
  s.projects[id] = { name }
  s.last = id
  writeState(s)
  return id
}

export function load(id) {
  try { return fs.readFileSync(sceneFile(id), 'utf8') } catch { return null }
}

export async function save(id, json) {
  JSON.parse(json) // valida antes de escrever — json inválido nunca corrompe o arquivo
  const f = sceneFile(id)
  if (fs.existsSync(f)) await fsp.copyFile(f, f + '.bak')
  await fsp.writeFile(f + '.tmp', json)
  await fsp.rename(f + '.tmp', f)
}

export function rename(id, name) {
  const s = readState()
  if (s.projects[id]) { s.projects[id].name = name; writeState(s) }
}

export async function remove(id) {
  const s = readState()
  delete s.projects[id]
  if (s.last === id) s.last = Object.keys(s.projects)[0] ?? null
  writeState(s)
  for (const f of [sceneFile(id), sceneFile(id) + '.bak']) if (fs.existsSync(f)) await trashFn(f)
}

export function getLast() { return readState().last }
export function setLast(id) { const s = readState(); s.last = id; writeState(s) }
export const dir = () => DIR
```

- [ ] `src/main/index.js` — janela (bounds persistidos, maximizada por default), IPC, flush-antes-de-fechar:

```js
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
```

- [ ] `src/preload/index.js` (CJS — sandbox default exige):

```js
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('ray', {
  list: () => ipcRenderer.invoke('projects:list'),
  create: (name) => ipcRenderer.invoke('projects:create', name),
  load: (id) => ipcRenderer.invoke('projects:load', id),
  save: (id, json) => ipcRenderer.invoke('projects:save', id, json),
  rename: (id, name) => ipcRenderer.invoke('projects:rename', id, name),
  remove: (id) => ipcRenderer.invoke('projects:delete', id),
  last: () => ipcRenderer.invoke('projects:last'),
  setLast: (id) => ipcRenderer.invoke('projects:setLast', id),
  openFolder: () => ipcRenderer.invoke('projects:openFolder'),
  onFlush: (cb) => ipcRenderer.on('flush', () => cb()),
  flushed: () => ipcRenderer.send('flushed'),
})
```

- [ ] `src/renderer/src/storage.js` — usa IPC se existir, senão localStorage (preview browser + base da futura versão web):

```js
// ponytail: shim localStorage — vira cliente HTTP na fase 2 (web)
const ls = {
  _index() { return JSON.parse(localStorage.rayIndex ?? '{"last":null,"projects":{}}') },
  _write(i) { localStorage.rayIndex = JSON.stringify(i) },
  async list() {
    const i = this._index()
    return Object.entries(i.projects).map(([id, p]) => ({ id, name: p.name, updatedAt: p.updatedAt ?? 0 })).sort((a, b) => b.updatedAt - a.updatedAt)
  },
  async create(name) {
    const i = this._index()
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    i.projects[id] = { name, updatedAt: Date.now() }
    i.last = id
    this._write(i)
    localStorage['rayScene:' + id] = JSON.stringify({ type: 'excalidraw', version: 2, source: 'excalidraw-ray', elements: [], appState: { theme: 'dark' }, files: {} })
    return id
  },
  async load(id) { return localStorage['rayScene:' + id] ?? null },
  async save(id, json) {
    localStorage['rayScene:' + id] = json
    const i = this._index()
    if (i.projects[id]) { i.projects[id].updatedAt = Date.now(); this._write(i) }
  },
  async rename(id, name) { const i = this._index(); if (i.projects[id]) { i.projects[id].name = name; this._write(i) } },
  async remove(id) {
    const i = this._index()
    delete i.projects[id]
    if (i.last === id) i.last = Object.keys(i.projects)[0] ?? null
    this._write(i)
    delete localStorage['rayScene:' + id]
  },
  async last() { return this._index().last },
  async setLast(id) { const i = this._index(); i.last = id; this._write(i) },
  async openFolder() {},
  onFlush() {},
  flushed() {},
}
export const ray = window.ray ?? ls
```

- [ ] `src/renderer/src/main.jsx`:

```jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
createRoot(document.getElementById('root')).render(<App />)
```

- [ ] `src/renderer/src/App.jsx` — versão scaffold mínima (menu custom e projetos entram nas tarefas 4–5):

```jsx
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

export default function App() {
  return (
    <div style={{ height: '100%' }}>
      <Excalidraw langCode="pt-BR" initialData={{ appState: { theme: 'dark' } }} />
    </div>
  )
}
```

- [ ] Copiar fontes: `cp -r node_modules/@excalidraw/excalidraw/dist/prod/fonts src/renderer/public/fonts` (commitar — app offline)
- [ ] Rodar `npm run dev` → janela Electron abre com Excalidraw escuro em pt-BR
- [ ] Verificar no browser (preview no dev server Vite) que canvas renderiza, fontes carregam de `/fonts/` (aba network, sem CDN)
- [ ] Commit: `feat: scaffold electron-vite + excalidraw pt-BR escuro`

## Tarefa 3: Self-check do store

**Files:** Create: `tests/store.check.mjs`

- [ ] Teste com node puro + tmpdir (padrão `--check` dos outros projetos Soltos):

```js
import assert from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as store from '../src/main/store.js'

const dir = await mkdtemp(path.join(tmpdir(), 'ray-check-'))
store.init({ dir, trash: (f) => rm(f) })

assert.deepEqual(store.list(), [], 'lista vazia no início')
const id = store.create('Projeto 1')
assert.equal(store.list().length, 1)
assert.equal(store.list()[0].name, 'Projeto 1')
assert.equal(store.getLast(), id, 'create seta last')

const scene = JSON.parse(store.load(id))
assert.equal(scene.type, 'excalidraw', 'cena vazia válida')

const edited = JSON.stringify({ ...scene, elements: [{ type: 'rectangle', id: 'r1' }] })
await store.save(id, edited)
assert.equal(store.load(id), edited, 'round-trip')
await store.save(id, JSON.stringify({ ...scene, elements: [] }))
assert.ok(existsSync(path.join(dir, 'projects', id + '.excalidraw.bak')), '.bak criado no 2º save')
assert.equal(JSON.parse(readFileSync(path.join(dir, 'projects', id + '.excalidraw.bak'), 'utf8')).elements.length, 1, '.bak guarda versão anterior')

await assert.rejects(() => store.save(id, 'não é json'), 'json inválido rejeita')
assert.ok(store.load(id).length > 0, 'json inválido não corrompe')

store.rename(id, 'Renomeado')
assert.equal(store.list()[0].name, 'Renomeado')

const id2 = store.create('Projeto 2')
store.setLast(id)
assert.equal(store.getLast(), id)
await store.remove(id)
assert.equal(store.list().length, 1)
assert.equal(store.getLast(), id2, 'remove do last cai pro restante')
assert.ok(!existsSync(path.join(dir, 'projects', id + '.excalidraw')), 'arquivo removido')

await rm(dir, { recursive: true, force: true })
console.log('store self-check OK')
```

- [ ] `npm run check` → `store self-check OK`
- [ ] Commit: `test: self-check do store`

## Tarefa 4: Menu custom (sem sociais, com projetos)

**Files:** Modify: `src/renderer/src/App.jsx` · Create: `src/renderer/src/icons.jsx`

- [ ] `icons.jsx` — SVGs 16px stroke no estilo dos ícones do Excalidraw:

```jsx
const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
export const IconNew = () => (<svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>)
export const IconProjects = () => (<svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>)
export const IconFolderOpen = () => (<svg {...p}><path d="M5 19l2.5-7H22l-2.5 7z" /><path d="M19.5 12V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2v12" /></svg>)
```

- [ ] `<MainMenu>` no App (substitui o default inteiro — some Excalidraw+, GitHub, Siga-nos, Discord, Sign up):

```jsx
<MainMenu>
  <MainMenu.Item onSelect={newProject} icon={<IconNew />}>Novo projeto</MainMenu.Item>
  <MainMenu.Item onSelect={() => setShowPanel(true)} icon={<IconProjects />}>Projetos…</MainMenu.Item>
  <MainMenu.Separator />
  <MainMenu.DefaultItems.LoadScene />
  <MainMenu.DefaultItems.Export />
  <MainMenu.DefaultItems.SaveAsImage />
  <MainMenu.DefaultItems.CommandPalette />
  <MainMenu.DefaultItems.SearchMenu />
  <MainMenu.DefaultItems.Help />
  <MainMenu.DefaultItems.ClearCanvas />
  <MainMenu.Separator />
  <MainMenu.Item onSelect={() => ray.openFolder()} icon={<IconFolderOpen />}>Abrir pasta de projetos</MainMenu.Item>
  <MainMenu.Separator />
  <MainMenu.DefaultItems.ToggleTheme />
  <MainMenu.DefaultItems.ChangeCanvasBackground />
</MainMenu>
```

- [ ] `UIOptions={{ canvasActions: { export: { saveFileToDisk: true } } }}` no `<Excalidraw>`
- [ ] Verificar no preview: menu abre só com esses itens, todos rotulados em pt-BR
- [ ] Commit: `feat: menu custom sem links sociais`

## Tarefa 5: Autosave + multi-projetos

**Files:** Modify: `src/renderer/src/App.jsx` · Create: `src/renderer/src/ProjectsPanel.jsx`, `src/renderer/src/panel.css`

- [ ] App completo — boot abre último projeto (ou cria "Projeto 1"), autosave debounce 800ms, flush na troca/fechamento, troca via remount `key`:

```jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Excalidraw, MainMenu, serializeAsJSON } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { ray } from './storage'
import { IconNew, IconProjects, IconFolderOpen } from './icons'
import ProjectsPanel from './ProjectsPanel'

export default function App() {
  const [projects, setProjects] = useState([])
  const [current, setCurrent] = useState(null) // { id, data }
  const [showPanel, setShowPanel] = useState(false)
  const pending = useRef(null)
  const timer = useRef(null)
  const idRef = useRef(null)

  const refresh = async () => setProjects(await ray.list())

  function flush() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!pending.current || !idRef.current) return Promise.resolve()
    const [els, st, files] = pending.current
    pending.current = null
    return ray.save(idRef.current, serializeAsJSON(els, st, files, 'local'))
  }

  const open = useCallback(async (id) => {
    await flush()
    const raw = await ray.load(id)
    let data = null
    try {
      data = JSON.parse(raw)
      data.appState = { ...data.appState, theme: localStorage.rayTheme ?? data.appState?.theme ?? 'dark' }
    } catch {}
    idRef.current = id
    setCurrent({ id, data })
    ray.setLast(id)
    setShowPanel(false)
    refresh()
  }, [])

  useEffect(() => {
    (async () => {
      let id = await ray.last()
      const list = await ray.list()
      if (!id || !list.some((p) => p.id === id)) id = list[0]?.id
      if (!id) id = await ray.create('Projeto 1')
      await open(id)
    })()
    ray.onFlush(async () => { await flush(); ray.flushed() })
  }, [])

  const onChange = useCallback((els, st, files) => {
    localStorage.rayTheme = st.theme
    pending.current = [els, st, files]
    if (!timer.current) timer.current = setTimeout(() => { timer.current = null; flush() }, 800)
  }, [])

  const newProject = async () => {
    await flush()
    const id = await ray.create(`Projeto ${projects.length + 1}`)
    await open(id)
    setShowPanel(true) // já abre o painel pra renomear
  }

  if (!current) return null
  return (
    <div style={{ height: '100%' }}>
      <Excalidraw key={current.id} initialData={current.data} langCode="pt-BR" onChange={onChange}
        UIOptions={{ canvasActions: { export: { saveFileToDisk: true } } }}>
        {/* MainMenu da tarefa 4 */}
      </Excalidraw>
      {showPanel && (
        <ProjectsPanel projects={projects} currentId={current.id}
          onOpen={open} onNew={newProject}
          onRename={async (id, name) => { await ray.rename(id, name); refresh() }}
          onDelete={async (id) => {
            if (!confirm('Excluir projeto? (vai pra Lixeira do Windows)')) return
            await ray.remove(id)
            if (id === current.id) location.reload()
            else refresh()
          }}
          onClose={() => setShowPanel(false)} />
      )}
    </div>
  )
}
```

- [ ] `ProjectsPanel.jsx` — overlay simples estilo island escuro do Excalidraw; duplo-clique renomeia inline (window.prompt não existe no Electron); Esc/backdrop fecha:

```jsx
import { useState } from 'react'
import './panel.css'

export default function ProjectsPanel({ projects, currentId, onOpen, onNew, onRename, onDelete, onClose }) {
  const [editing, setEditing] = useState(null) // id em edição
  const fmt = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
  return (
    <div className="ray-backdrop" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="ray-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Projetos</h2>
          <button className="ray-new" onClick={onNew}>+ Novo projeto</button>
        </header>
        <ul>
          {projects.map((p) => (
            <li key={p.id} className={p.id === currentId ? 'atual' : ''}>
              {editing === p.id ? (
                <input autoFocus defaultValue={p.name}
                  onBlur={(e) => { onRename(p.id, e.target.value.trim() || p.name); setEditing(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(null) }} />
              ) : (
                <button className="ray-name" onClick={() => onOpen(p.id)} onDoubleClick={() => setEditing(p.id)}
                  title="Clique abre · duplo-clique renomeia">
                  {p.name} {p.id === currentId && <span className="ray-badge">atual</span>}
                </button>
              )}
              <span className="ray-date">{fmt(p.updatedAt)}</span>
              <button className="ray-edit" title="Renomear" onClick={() => setEditing(p.id)}>✎</button>
              <button className="ray-del" title="Excluir (Lixeira)" onClick={() => onDelete(p.id)}>🗑</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] `panel.css` — cores do tema escuro do Excalidraw (island #232329, texto #ced4da, violeta #a8a5ff), fonte Assistant:

```css
.ray-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 10; display: flex; align-items: center; justify-content: center; }
.ray-panel { background: #232329; color: #ced4da; border-radius: 10px; padding: 16px; width: min(440px, 90vw); max-height: 70vh; overflow: auto; font-family: 'Assistant', system-ui, sans-serif; box-shadow: 0 7px 14px rgba(0,0,0,.35); }
.ray-panel header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.ray-panel h2 { margin: 0; font-size: 16px; font-weight: 600; }
.ray-panel ul { list-style: none; margin: 0; padding: 0; }
.ray-panel li { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 8px; }
.ray-panel li:hover { background: #2e2d39; }
.ray-panel li.atual { background: #403e6a33; }
.ray-name { flex: 1; text-align: left; background: none; border: 0; color: inherit; font: inherit; padding: 6px 4px; cursor: pointer; }
.ray-badge { font-size: 11px; color: #a8a5ff; margin-left: 6px; }
.ray-date { font-size: 12px; color: #7d7c88; white-space: nowrap; }
.ray-edit, .ray-del { background: none; border: 0; color: #7d7c88; cursor: pointer; font-size: 14px; padding: 4px; border-radius: 6px; }
.ray-edit:hover { color: #ced4da; background: #37363f; }
.ray-del:hover { color: #ff8383; background: #37363f; }
.ray-new { background: #a8a5ff22; border: 0; color: #a8a5ff; font: inherit; font-weight: 600; padding: 6px 10px; border-radius: 8px; cursor: pointer; }
.ray-new:hover { background: #a8a5ff33; }
.ray-panel input { flex: 1; background: #121212; border: 1px solid #a8a5ff; border-radius: 6px; color: #ced4da; font: inherit; padding: 5px 8px; }
```

- [ ] Verificar no preview (shim localStorage): desenhar → recarregar página → desenho volta; criar 2º projeto → alternar → cada um mantém o seu; renomear; excluir
- [ ] Rodar `npm run dev` (Electron de verdade): desenhar, fechar app, reabrir → tudo de volta; conferir arquivos em `Documentos\ExcalidrawRay\projects\`
- [ ] Commit: `feat: autosave + multi-projetos`

## Tarefa 6: Ícone + instalador NSIS

**Files:** Create: `tools/icon.mjs`, `build/icon.ico`, `electron-builder.yml`

- [ ] `npm i -D sharp png-to-ico`
- [ ] `tools/icon.mjs` — SVG (quadrado arredondado #121212, "R" traço à mão violeta #a8a5ff estilo Virgil) → PNGs 256/128/64/48/32/16 → `build/icon.ico`; rodar uma vez e commitar o .ico
- [ ] `electron-builder.yml`:

```yaml
appId: br.com.raynathus.excalidrawray
productName: Excalidraw Ray
directories:
  output: release
  buildResources: build
files:
  - out/**
  - package.json
win:
  target:
    - nsis
  icon: build/icon.ico
nsis:
  oneClick: true
  perMachine: false
  artifactName: ${productName}-Setup-${version}.${ext}
npmRebuild: false
```

- [ ] `npm run dist` → `release/Excalidraw Ray-Setup-1.0.0.exe` (~80 MB)
- [ ] Instalar de verdade na máquina, abrir pelo atalho, desenhar, fechar, reabrir → persiste
- [ ] `.gitignore` += `release/`
- [ ] Commit: `feat: instalador Windows (NSIS)` + `gh release create v1.0.0 release/*.exe`

## Tarefa 7: Fase 2 — draw.raynathus.com.br (nuvem + share + embed)

**Files:** Create: `server/server.mjs`, `server/public/` (build web do renderer), `deploy/deploy.ps1`, `deploy/excalidraw-ray.service`, `deploy/nginx-draw.conf`

Decisão da pesquisa: SEM excalidraw-room/colab ao vivo (cliente de colab não existe no pacote npm; YAGNI). Nuvem = API HTTP simples no padrão manduu-apps; link é a capability.

- [ ] `storage.js` ganha 3º modo: se `location.origin` for https (build web), usa API HTTP em vez de localStorage. Login = escolher nome (localStorage, padrão data-rpg).
- [ ] API (server.mjs Node puro, porta 8050, escrita atômica + backup diário 7 dias, allowlist implícita por dono):
  - `GET /api/u/<user>/scenes` → `[{id, name, updatedAt}]`
  - `POST /api/u/<user>/scenes` `{name}` → `{id, viewId}`
  - `GET /api/scene/<id>` → JSON da cena (id de edit OU viewId; resposta indica `readOnly`)
  - `PUT /api/scene/<id>` → salva (só id de edit; viewId → 403)
  - `PATCH /api/scene/<id>` `{name}` / `DELETE /api/scene/<id>`
  - ids = `crypto.randomUUID()`; arquivo por cena em `data/scenes/`; `data/index.json` user→cenas, viewId→id
- [ ] Rotas web: `/` hub (lista de cenas do usuário) · `/d/<id>` editor · `/v/<viewId>` `viewModeEnabled` (read-only, serve pra `<iframe>` embed)
- [ ] Botão "Compartilhar" no editor web: copia link edit / link view / snippet `<iframe src=".../v/<viewId>">`
- [ ] App desktop: item de menu "Enviar para a nuvem…" → POST da cena atual → copia link (integração mínima; sync bidirecional fica pra depois se sentir falta)
- [ ] `server.mjs --check` com asserts (padrão manduu): round-trip, viewId não edita, traversal 404, json inválido 400
- [ ] Deploy: `deploy.ps1` (scp + restart, padrão manduu-apps) + systemd unit + nginx vhost + certbot. **DNS: usuário cria registro A `draw` → 147.15.30.202 no registrador (sem wildcard) — avisar no chat quando chegar aqui.**
- [ ] Commit por sub-etapa; ao final atualizar `Soltos/CLAUDE.md` e memória com o novo projeto/porta

## Tarefa 8: Review final

- [ ] Workflow multi-agente: revisores independentes (correção/UX/edge-cases/segurança do server) + verificação adversarial dos achados; corrigir confirmados
- [ ] `npm run check` + self-check do server verdes
- [ ] Commit + push finais; release atualizada
