// server.mjs — Excalidraw Ray na nuvem: estáticos + cenas por usuário + share view/edit.
// Uso: node server.mjs [--check]   (PORT env, default 8050)
// Padrão manduu-apps: Node stdlib puro, escrita atômica, backup diário 7 dias.
import http from 'node:http'
import crypto from 'node:crypto'
import { readFile, writeFile, rename, mkdir, copyFile, stat, readdir, unlink } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PUB = path.join(ROOT, 'public')
let DATA = path.join(ROOT, 'data') // check() repõe pra um tmpdir
const MAX_BODY = 20 * 1024 * 1024 // cenas com imagens embutidas
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
const ID = /^[a-zA-Z0-9-]{8,40}$/
const USER = /^[a-z0-9-]{1,30}$/

const idxFile = () => path.join(DATA, 'index.json')
const sceneFile = (id) => path.join(DATA, 'scenes', id + '.excalidraw')

function readIndex() {
  try { return JSON.parse(readFileSync(idxFile(), 'utf8')) } catch { return { scenes: {} } }
}
function writeIndex(i) {
  mkdirSync(DATA, { recursive: true })
  writeFileSync(idxFile() + '.tmp', JSON.stringify(i, null, 2))
  renameSync(idxFile() + '.tmp', idxFile())
}

async function backupDaily(file) {
  // 1 backup por dia, mantém 7. ponytail: glob+sort resolve
  const day = new Date().toISOString().slice(0, 10)
  const bak = `${file}.${day}.bak`
  if (!existsSync(bak) && existsSync(file)) {
    await copyFile(file, bak)
    const dir = path.dirname(file), base = path.basename(file)
    const baks = (await readdir(dir)).filter((f) => f.startsWith(base + '.') && f.endsWith('.bak')).sort()
    for (const old of baks.slice(0, -7)) await unlink(path.join(dir, old))
  }
}

async function readBody(req, res) {
  let chunks = [], size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) { res.writeHead(413).end(); return null }
    chunks.push(c)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const json = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj))

async function handleApi(req, res, url) {
  const idx = readIndex()

  let m = url.pathname.match(/^\/api\/u\/([^/]+)\/scenes$/)
  if (m) {
    const user = m[1]
    if (!USER.test(user)) { json(res, 400, { error: 'usuário inválido' }); return }
    if (req.method === 'GET') {
      const list = Object.entries(idx.scenes).filter(([, s]) => s.owner === user)
        .map(([id, s]) => ({ id, name: s.name, updatedAt: s.updatedAt ?? 0 }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      json(res, 200, list)
      return
    }
    if (req.method === 'POST') {
      const raw = await readBody(req, res); if (raw === null) return
      let name = 'Sem nome'
      try { name = String(JSON.parse(raw).name || name).slice(0, 80) } catch {}
      const id = crypto.randomUUID()
      const viewId = 'v-' + crypto.randomUUID()
      await mkdir(path.join(DATA, 'scenes'), { recursive: true })
      await writeFile(sceneFile(id), JSON.stringify({ type: 'excalidraw', version: 2, source: 'excalidraw-ray', elements: [], appState: { theme: 'dark' }, files: {} }))
      idx.scenes[id] = { name, owner: user, viewId, updatedAt: Date.now() }
      writeIndex(idx)
      json(res, 200, { id, viewId })
      return
    }
    res.writeHead(405).end()
    return
  }

  m = url.pathname.match(/^\/api\/scene\/([^/]+)$/)
  if (m) {
    const ref = m[1]
    if (!ID.test(ref.replace(/^v-/, ''))) { res.writeHead(404).end(); return }
    const viewOf = Object.entries(idx.scenes).find(([, s]) => s.viewId === ref)?.[0]
    const id = idx.scenes[ref] ? ref : viewOf
    const meta = idx.scenes[id]
    if (!meta) { res.writeHead(404).end(); return }
    const readOnly = !idx.scenes[ref] // chegou pelo viewId

    if (req.method === 'GET') {
      try {
        const scene = JSON.parse(await readFile(sceneFile(id), 'utf8'))
        json(res, 200, { readOnly, name: meta.name, viewId: readOnly ? undefined : meta.viewId, scene })
      } catch { res.writeHead(404).end() }
      return
    }
    if (readOnly) { res.writeHead(403).end() } // viewId nunca escreve
    else if (req.method === 'PUT') {
      const raw = await readBody(req, res); if (raw === null) return
      try { JSON.parse(raw) } catch { res.writeHead(400).end('invalid json'); return }
      const f = sceneFile(id)
      await backupDaily(f)
      await writeFile(f + '.tmp', raw)
      await rename(f + '.tmp', f) // escrita atômica
      meta.updatedAt = Date.now()
      writeIndex(idx)
      res.writeHead(204).end()
    } else if (req.method === 'PATCH') {
      const raw = await readBody(req, res); if (raw === null) return
      try { meta.name = String(JSON.parse(raw).name).slice(0, 80) } catch { res.writeHead(400).end(); return }
      writeIndex(idx)
      res.writeHead(204).end()
    } else if (req.method === 'DELETE') {
      delete idx.scenes[id]
      writeIndex(idx)
      await mkdir(path.join(DATA, 'trash'), { recursive: true })
      try { await rename(sceneFile(id), path.join(DATA, 'trash', id + '.excalidraw')) } catch {}
      res.writeHead(204).end()
    } else res.writeHead(405).end()
    return
  }

  res.writeHead(404).end()
}

async function handleStatic(req, res, urlPath) {
  // rotas de app (/d/:id, /v/:viewId) servem o shell
  if (/^\/(d|v)\//.test(urlPath)) urlPath = '/index.html'
  let p = path.normalize(path.join(PUB, decodeURIComponent(urlPath)))
  if (p !== PUB && !p.startsWith(PUB + path.sep)) { res.writeHead(404).end(); return } // path traversal
  try {
    if ((await stat(p)).isDirectory()) p = path.join(p, 'index.html')
  } catch { /* cai no readFile 404 */ }
  try {
    const body = await readFile(p)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream', 'Cache-Control': p.includes(`${path.sep}assets${path.sep}`) || p.includes(`${path.sep}fonts${path.sep}`) ? 'public, max-age=604800' : 'no-cache' }).end(body)
  } catch { res.writeHead(404).end('não achei :(') }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x')
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url)
      else if (req.method === 'GET') await handleStatic(req, res, url.pathname)
      else res.writeHead(405).end()
    } catch (e) { console.error(e); res.writeHead(500).end() }
  })
}

async function check() {
  DATA = await mkdtemp(path.join(tmpdir(), 'ray-server-check-')) // nunca toca ./data/
  const srv = createServer()
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${srv.address().port}`
  const j = (r) => r.json()

  assert.deepEqual(await fetch(`${base}/api/u/ray/scenes`).then(j), [], 'lista vazia')
  const { id, viewId } = await fetch(`${base}/api/u/ray/scenes`, { method: 'POST', body: JSON.stringify({ name: 'Teste' }) }).then(j)
  assert.ok(id && viewId, 'create devolve id+viewId')
  assert.equal((await fetch(`${base}/api/u/ray/scenes`).then(j)).length, 1, 'lista com 1')
  assert.deepEqual(await fetch(`${base}/api/u/outro/scenes`).then(j), [], 'outro usuário não vê')

  const scene = { type: 'excalidraw', version: 2, elements: [{ type: 'rectangle', id: 'r1' }], appState: {}, files: {} }
  assert.equal((await fetch(`${base}/api/scene/${id}`, { method: 'PUT', body: JSON.stringify(scene) })).status, 204, 'PUT ok')
  const got = await fetch(`${base}/api/scene/${id}`).then(j)
  assert.equal(got.readOnly, false, 'edit id não é readOnly')
  assert.deepEqual(got.scene, scene, 'round-trip')
  assert.equal(got.viewId, viewId, 'edit devolve viewId')

  const view = await fetch(`${base}/api/scene/${viewId}`).then(j)
  assert.equal(view.readOnly, true, 'viewId é readOnly')
  assert.deepEqual(view.scene, scene, 'viewId lê a mesma cena')
  assert.equal(view.viewId, undefined, 'viewId não vaza na resposta view')
  assert.equal((await fetch(`${base}/api/scene/${viewId}`, { method: 'PUT', body: JSON.stringify(scene) })).status, 403, 'viewId nunca escreve')

  assert.equal((await fetch(`${base}/api/scene/${id}`, { method: 'PUT', body: 'lixo' })).status, 400, 'json inválido 400')
  assert.deepEqual((await fetch(`${base}/api/scene/${id}`).then(j)).scene, scene, 'inválido não corrompe')

  assert.equal((await fetch(`${base}/api/scene/${id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Novo nome' }) })).status, 204, 'rename')
  assert.equal((await fetch(`${base}/api/u/ray/scenes`).then(j))[0].name, 'Novo nome')

  assert.equal((await fetch(`${base}/api/u/Traversal..%2F/scenes`)).status, 400, 'usuário inválido 400')
  assert.equal((await fetch(`${base}/api/scene/..%2F..%2Fetc`)).status, 404, 'id inválido 404')
  assert.equal((await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).status, 404, 'traversal estático 404')

  assert.equal((await fetch(`${base}/api/scene/${id}`, { method: 'DELETE' })).status, 204, 'delete')
  assert.deepEqual(await fetch(`${base}/api/u/ray/scenes`).then(j), [], 'lista vazia após delete')
  assert.equal((await fetch(`${base}/api/scene/${id}`)).status, 404, 'cena deletada 404')

  srv.close()
  await rm(DATA, { recursive: true, force: true })
  console.log('server self-check OK')
}

if (process.argv.includes('--check')) check()
else {
  const port = Number(process.env.PORT ?? 8050)
  createServer().listen(port, () => console.log(`excalidraw-ray na porta ${port}`))
}
