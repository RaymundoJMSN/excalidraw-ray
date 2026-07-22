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

await assert.rejects(async () => store.save(id, 'não é json'), 'json inválido rejeita')
assert.ok(store.load(id).length > 0, 'json inválido não corrompe')

store.rename(id, 'Renomeado')
assert.equal(store.list().find((p) => p.id === id).name, 'Renomeado')

const id2 = store.create('Projeto 2')
store.setLast(id)
assert.equal(store.getLast(), id)
await store.remove(id)
assert.equal(store.list().length, 1)
assert.equal(store.getLast(), id2, 'remove do last cai pro restante')
assert.ok(!existsSync(path.join(dir, 'projects', id + '.excalidraw')), 'arquivo removido')

await rm(dir, { recursive: true, force: true })
console.log('store self-check OK')
