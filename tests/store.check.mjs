import assert from 'node:assert'
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises'
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
const bak = path.join(dir, 'projects', id + '.excalidraw.bak')
assert.ok(existsSync(bak), '.bak criado no 1º save')
await store.save(id, JSON.stringify({ ...scene, elements: [{ type: 'rectangle', id: 'r1' }, { type: 'rectangle', id: 'r2' }] }))
assert.equal(JSON.parse(readFileSync(bak, 'utf8')).elements.length, 0, '.bak novo demais não é refeito a cada save')
const velho = new Date(Date.now() - 11 * 60 * 1000); await utimes(bak, velho, velho)
await store.save(id, JSON.stringify({ ...scene, elements: [] }))
assert.ok(existsSync(bak), '.bak existe')
assert.equal(JSON.parse(readFileSync(bak, 'utf8')).elements.length, 2, '.bak com mais de 10 min é refeito com a versão anterior')
await store.idle()
// .tmp abandonado (gravação cortada) some no init; recente fica
const tmpVelho = path.join(dir, 'projects', 'x.excalidraw.abc.tmp'), tmpNovo = path.join(dir, 'projects', 'y.excalidraw.def.tmp')
await writeFile(tmpVelho, '{'); await utimes(tmpVelho, velho, velho); await writeFile(tmpNovo, '{')
store.init({ dir, trash: (f) => rm(f) })
assert.ok(!existsSync(tmpVelho) && existsSync(tmpNovo), 'init limpa só .tmp velho')

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

// mídia: por caminho (cópia) e por bytes; nome sai com a extensão limpa e nunca sobe de pasta
const src = path.join(dir, 'origem.MP4')
await writeFile(src, 'video')
const m1 = await store.saveMedia('origem.MP4', src)
assert.match(m1, /^[a-z0-9]+\.mp4$/, 'nome gerado com extensão minúscula')
assert.equal(readFileSync(store.mediaPath(m1), 'utf8'), 'video', 'cópia por caminho')
const m2 = await store.saveMedia('som.mp3', new Uint8Array([1, 2, 3]))
assert.deepEqual([...readFileSync(store.mediaPath(m2))], [1, 2, 3], 'escrita por bytes')
assert.equal(path.extname(await store.saveMedia('sem-ext', new Uint8Array(1))), '', 'sem extensão não inventa')
assert.equal(store.mediaPath('../../state.json'), path.join(dir, 'media', 'state.json'), 'traversal barrado')

await rm(dir, { recursive: true, force: true })
console.log('store self-check OK')
