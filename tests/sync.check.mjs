// Sync desktop ⇄ nuvem: sobe server.mjs num tmpdir e simula o "celular" via HTTP direto.
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
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

  // celular entra na conta (cria) e já tem uma cena; PC tem um projeto local
  const { token } = await fetch(`${base}/api/entrar`, { method: 'POST', body: JSON.stringify({ nome: 'ray', senha: 'segredo1' }) }).then(j)
  const H = { headers: { Authorization: 'Bearer ' + token } }
  const cel = await fetch(`${base}/api/u/ray/scenes`, { method: 'POST', ...H, body: JSON.stringify({ name: 'Do celular' }) }).then(j)
  await fetch(`${base}/api/scene/${cel.id}`, { method: 'PUT', body: scene([el('c1', 1)]) })
  const pc = store.create('Do PC')
  await store.save(pc, scene([el('p1', 1)])); sync.localSaved(pc, store.load(pc))

  await assert.rejects(sync.enable({ user: 'Ray Inválido', senha: '1234' }), 'nome inválido rejeita')
  await assert.rejects(sync.enable({ user: 'ray', senha: 'errada1', server: base }), /senha errada/, 'senha errada rejeita')
  assert.equal(sync.config().enabled, false, 'senha errada não liga nada')
  const cfg = await sync.enable({ user: 'ray', senha: 'segredo1', server: base })
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.error, null, 'sem erro: ' + cfg.error)

  // mescla: os dois lados têm os dois projetos
  const remote = await fetch(`${base}/api/u/ray/scenes`, H).then(j)
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

  // mídia: arquivo local sobe com o mesmo nome e o link vira /api/media/; mídia da nuvem desce como ray-media:// e baixa na 1ª vez
  const nomeLocal = await store.saveMedia('clipe.mp4', Buffer.from('video-falso'))
  const comMidia = (els, link) => JSON.stringify({ type: 'excalidraw', version: 2, elements: [...els, { type: 'embeddable', id: 'm1', version: 1, link }], appState: { viewBackgroundColor: '#fff' }, files: {} })
  await store.save(pc, comMidia([el('p1', 4)], 'ray-media://' + nomeLocal)); sync.localSaved(pc, store.load(pc))
  await sync.syncNow()
  assert.equal(sync.config().error, null, 'sem erro no sync com mídia: ' + sync.config().error)
  assert.equal((await fetch(`${base}/api/scene/${pcRemote}`).then(j)).scene.elements[1].link, '/api/media/' + nomeLocal, 'link virou /api/media/ na nuvem')
  assert.equal(await fetch(`${base}/api/media/${nomeLocal}`).then((r) => r.text()), 'video-falso', 'arquivo subiu com o mesmo nome')
  assert.ok(store.load(pc).includes('ray-media://' + nomeLocal), 'o arquivo local continua com ray-media://')
  await fetch(`${base}/api/media/web1.mp4`, { method: 'PUT', ...H, body: 'da-web' })
  await fetch(`${base}/api/scene/${cel.id}`, { method: 'PUT', body: comMidia([el('c1', 5)], '/api/media/web1.mp4') })
  await sync.syncNow()
  assert.equal(JSON.parse(store.load(cel.id)).elements[1].link, 'ray-media://web1.mp4', 'link da nuvem vira ray-media:// no PC')
  assert.ok(!existsSync(store.mediaPath('web1.mp4')), 'não baixa antes de precisar')
  await Promise.all([sync.baixarMedia('web1.mp4'), sync.baixarMedia('web1.mp4')]) // dois pedidos = um download
  assert.equal(readFileSync(store.mediaPath('web1.mp4'), 'utf8'), 'da-web', 'baixa na 1ª vez que o canvas pede')
  await assert.rejects(sync.baixarMedia('nao-existe.mp4'), /nuvem/, 'mídia que não está na nuvem avisa')

  // rename nos dois sentidos
  store.rename(pc, 'PC renomeado'); sync.localRenamed(pc); await sync.syncNow()
  assert.equal((await fetch(`${base}/api/u/ray/scenes`, H).then(j)).find((s) => s.id === pcRemote).name, 'PC renomeado', 'rename subiu')
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
