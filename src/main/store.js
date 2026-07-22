// src/main/store.js — projetos em Documentos/ExcalidrawRay. Sem deps de electron (testável com node puro).
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'

let DIR, PROJ, STATE_FILE, trashFn
const queues = new Map() // id → promise chain: serializa saves concorrentes do mesmo projeto

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
const thumbFile = (id) => path.join(PROJ, id + '.thumb')

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

export function save(id, json) {
  JSON.parse(json) // valida antes de escrever — json inválido nunca corrompe o arquivo
  const next = (queues.get(id) ?? Promise.resolve()).then(() => doSave(id, json))
  queues.set(id, next.catch(() => {}))
  return next
}

async function doSave(id, json) {
  const f = sceneFile(id)
  if (fs.existsSync(f)) await fsp.copyFile(f, f + '.bak')
  const tmp = f + '.' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.tmp'
  await fsp.writeFile(tmp, json)
  await fsp.rename(tmp, f) // escrita atômica
}

export function saveThumb(id, dataURL) {
  try { fs.writeFileSync(thumbFile(id), String(dataURL)) } catch {}
}
export function thumb(id) {
  try { return fs.readFileSync(thumbFile(id), 'utf8') } catch { return null }
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
  for (const f of [sceneFile(id), sceneFile(id) + '.bak', thumbFile(id)]) {
    if (fs.existsSync(f)) { try { await trashFn(f) } catch { try { await fsp.rm(f) } catch {} } }
  }
}

export function getLast() { return readState().last }
export function setLast(id) { const s = readState(); s.last = id; writeState(s) }
export const dir = () => DIR
