// Sync desktop ⇄ nuvem: sobe server.mjs num tmpdir e simula o "celular" via HTTP direto.
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as store from '../src/main/store.js'
import * as sync from '../src/main/sync.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = await mkdtemp(path.join(tmpdir(), 'ray-sync-'))
const PORT = 18000 + Math.floor(Math.random() * 1000)
const srv = spawn(process.execPath, [path.join(root, 'server/server.mjs')], { env: { ...process.env, PORT, RAY_DATA: path.join(tmp, 'data') }, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((r) => srv.stdout.once('data', r))
const base = `http://127.0.0.1:${PORT}`
const j = (r) => r.json()
const scene = (els) => JSON.stringify({ type: 'excalidraw', version: 2, elements: els, appState: { viewBackgroundColor: '#fff' }, files: {} })
const el = (id, version) => ({ type: 'rectangle', id, version })

try {
  store.init({ dir: path.join(tmp, 'docs'), trash: (f) => rm(f) })
  const events = []
  sync.init({ dir: store.dir(), store, notify: (t, p) => events.push([t, p]) })

  // celular já tem uma cena; PC tem um projeto local
  const cel = await fetch(`${base}/api/u/ray/scenes`, { method: 'POST', body: JSON.stringify({ name: 'Do celular' }) }).then(j)
  await fetch(`${base}/api/scene/${cel.id}`, { method: 'PUT', body: scene([el('c1', 1)]) })
  const pc = store.create('Do PC')
  await store.save(pc, scene([el('p1', 1)])); sync.localSaved(pc, store.load(pc))

  await assert.rejects(sync.enable({ user: 'Ray Inválido' }), 'nome inválido rejeita')
  const cfg = await sync.enable({ user: 'ray', server: base })
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.error, null, 'sem erro: ' + cfg.error)

  // mescla: os dois lados têm os dois projetos
  const remote = await fetch(`${base}/api/u/ray/scenes`).then(j)
  assert.deepEqual(remote.map((s) => s.name).sort(), ['Do PC', 'Do celular'], 'nuvem tem os dois')
  assert.deepEqual(store.list().map((p) => p.name).sort(), ['Do PC', 'Do celular'], 'PC tem os dois')
  assert.equal(JSON.parse(store.load(cel.id)).elements[0].id, 'c1', 'cena do celular baixada')
  const pcRemote = remote.find((s) => s.name === 'Do PC').id
  assert.equal((await fetch(`${base}/api/scene/${pcRemote}`).then(j)).scene.elements[0].id, 'p1', 'cena do PC subiu')

  // edição no PC sobe
  await store.save(pc, scene([el('p1', 2), el('p2', 1)])); sync.localSaved(pc, store.load(pc))
  await sync.syncNow()
  assert.equal((await fetch(`${base}/api/scene/${pcRemote}`).then(j)).scene.elements.length, 2, 'edição do PC subiu')

  // re-salvar sem mudar o desenho (scroll etc) não suja
  const antes = (await fetch(`${base}/api/scene/${pcRemote}?meta=1`).then(j)).updatedAt
  sync.localSaved(pc, store.load(pc)); await sync.syncNow()
  assert.equal((await fetch(`${base}/api/scene/${pcRemote}?meta=1`).then(j)).updatedAt, antes, 'sem mudança = sem upload')

  // edição no celular desce e avisa o renderer
  events.length = 0
  await fetch(`${base}/api/scene/${pcRemote}`, { method: 'PUT', body: scene([el('p1', 3)]) })
  await sync.syncNow()
  assert.equal(JSON.parse(store.load(pc)).elements[0].version, 3, 'edição do celular desceu')
  assert.ok(events.some(([t, p]) => t === 'changed' && p.id === pc), 'avisou changed')

  // rename nos dois sentidos
  store.rename(pc, 'PC renomeado'); sync.localRenamed(pc); await sync.syncNow()
  assert.equal((await fetch(`${base}/api/u/ray/scenes`).then(j)).find((s) => s.id === pcRemote).name, 'PC renomeado', 'rename subiu')
  await fetch(`${base}/api/scene/${cel.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Cel renomeado' }) })
  await sync.syncNow()
  assert.ok(store.list().some((p) => p.name === 'Cel renomeado'), 'rename desceu')

  // delete nos dois sentidos
  await store.remove(pc); sync.localRemoved(pc); await sync.syncNow()
  assert.equal((await fetch(`${base}/api/scene/${pcRemote}`)).status, 404, 'delete subiu')
  await fetch(`${base}/api/scene/${cel.id}`, { method: 'DELETE' })
  await sync.syncNow()
  assert.equal(store.list().length, 0, 'delete desceu')
  assert.equal(sync.config().error, null)

  // servidor fora do ar: erro, não quebra
  sync.disable()
  await assert.rejects(sync.enable({ user: 'ray', server: 'http://127.0.0.1:1' }), 'servidor fora rejeita')
  console.log('sync check OK')
} finally {
  sync.disable()
  srv.kill()
  await rm(tmp, { recursive: true, force: true })
}
