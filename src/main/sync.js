// src/main/sync.js — sincroniza os projetos locais com o servidor web (draw.raynathus.com.br).
// Sem deps de electron (testável com node puro). Arquivos locais continuam sendo a fonte offline;
// a nuvem é espelho. Conflito = last-write-wins por cena (edição local pendente vence).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const DEFAULT_SERVER = 'https://draw.raynathus.com.br'
const USER = /^[a-z0-9-]{1,30}$/
const INTERVAL = 20000

let FILE, store, notify, S
let running = null, again = false, timer = null, interval = null

// assinatura do que importa na cena: muda só quando o desenho muda (scroll/seleção não contam).
// Evita ping-pong PC⇄celular: re-salvar uma cena recém-baixada não marca como "sujo".
export function sig(json) {
  try {
    const d = JSON.parse(json)
    const key = JSON.stringify([
      (d.elements ?? []).map((e) => [e.id, e.version, e.isDeleted ? 1 : 0]),
      Object.keys(d.files ?? {}).sort(),
      d.appState?.viewBackgroundColor ?? null,
    ])
    return crypto.createHash('sha1').update(key).digest('hex')
  } catch { return null }
}

export function init(opts) {
  FILE = path.join(opts.dir, 'sync.json')
  store = opts.store
  notify = opts.notify ?? (() => {})
  try { S = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { S = {} }
  S.server ??= DEFAULT_SERVER
  S.map ??= {} // localId → { remoteId, syncedAt, sig, dirty, nameDirty, thumbDirty }
  S.tomb ??= [] // remoteIds apagados localmente, falta apagar na nuvem
  if (S.enabled) start()
}

function persist() {
  try {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(S, null, 2))
    fs.renameSync(FILE + '.tmp', FILE)
  } catch {}
}

export const config = () => ({ enabled: !!S.enabled, user: S.user ?? '', server: S.server, lastSync: S.lastSync ?? null, error: S.error ?? null, busy: !!running })

function start() {
  clearInterval(interval)
  interval = setInterval(() => syncNow(), INTERVAL)
  interval.unref?.()
  schedule(500)
}

function schedule(ms) {
  if (!S.enabled) return
  clearTimeout(timer)
  timer = setTimeout(() => syncNow(), ms)
  timer.unref?.()
}

async function api(p, opts = {}) {
  return fetch(S.server.replace(/\/+$/, '') + p, { ...opts, signal: AbortSignal.timeout(30000) })
}

export async function enable({ user, server }) {
  user = String(user ?? '').trim().toLowerCase()
  server = String(server || DEFAULT_SERVER).trim().replace(/\/+$/, '')
  if (!USER.test(user)) throw new Error('Nome inválido (minúsculas, números e hífen)')
  if (!/^https?:\/\//.test(server)) throw new Error('Servidor deve começar com https://')
  const prev = { user: S.user, server: S.server }
  S.user = user; S.server = server
  try {
    const r = await api(`/api/u/${user}/scenes`)
    if (!r.ok) throw new Error('servidor respondeu ' + r.status)
  } catch (e) {
    Object.assign(S, prev)
    throw new Error('Não consegui falar com o servidor: ' + (e.message || e))
  }
  if (prev.user !== user || prev.server !== server) { S.map = {}; S.tomb = [] } // outra conta: começa do zero (mescla tudo)
  S.enabled = true
  S.error = null
  persist()
  start()
  await syncNow()
  return config()
}

export function disable() {
  S.enabled = false
  clearInterval(interval); clearTimeout(timer)
  persist()
  return config()
}

// ---- ganchos chamados pelo main depois de cada operação local
export function localSaved(id, json) {
  if (!S.enabled) return
  const e = S.map[id]
  if (!e) { schedule(1500); return } // projeto novo: o ciclo cria na nuvem
  if (sig(json) === e.sig) return
  if (!e.dirty) { e.dirty = true; persist() }
  schedule(1500)
}
export function localCreated() { schedule(1000) }
export function localRenamed(id) {
  const e = S.map[id]
  if (e) { e.nameDirty = true; persist() }
  schedule(1000)
}
export function localThumb(id) {
  const e = S.map[id]
  if (e) e.thumbDirty = true
}
export function localRemoved(id) {
  const e = S.map[id]
  if (!e) return
  delete S.map[id]
  if (S.enabled) S.tomb.push(e.remoteId)
  persist()
  schedule(500)
}

export function syncNow() {
  if (!S.enabled) return Promise.resolve(config())
  if (running) { again = true; return running }
  running = (async () => {
    try {
      do { again = false; await cycle() } while (again)
      S.error = null
      S.lastSync = Date.now()
    } catch (e) {
      S.error = String(e?.message || e)
    } finally {
      running = null
      persist()
      notify('status', config())
    }
    return config()
  })()
  notify('status', config())
  return running
}

async function createRemote(lid, name) {
  const r = await api(`/api/u/${S.user}/scenes`, { method: 'POST', body: JSON.stringify({ name }) })
  if (!r.ok) throw new Error('criar na nuvem falhou: ' + r.status)
  const { id } = await r.json()
  const e = S.map[lid] = { remoteId: id, syncedAt: 0, sig: null, dirty: true, nameDirty: false, thumbDirty: true }
  persist()
  return e
}

async function push(lid, e) {
  e.dirty = false // antes de ler: um save que chegar durante o upload volta a sujar
  const json = store.load(lid)
  if (json == null) return
  const r = await api(`/api/scene/${e.remoteId}`, { method: 'PUT', body: json })
  if (!r.ok) { e.dirty = true; throw new Error('upload falhou: ' + r.status) }
  const body = await r.json().catch(() => ({}))
  if (body.updatedAt) e.syncedAt = body.updatedAt // servidor antigo (204) → o próximo pull vê sig igual e só alinha
  e.sig = sig(json)
  persist()
}

async function pull(lid, e, updatedAt) {
  const r = await api(`/api/scene/${e.remoteId}`)
  if (!r.ok) throw new Error('download falhou: ' + r.status)
  const d = await r.json()
  const json = JSON.stringify(d.scene)
  const s = sig(json)
  e.syncedAt = d.updatedAt ?? updatedAt
  if (s === e.sig || e.dirty) return false // nada novo, ou editado aqui enquanto baixava (local vence)
  await store.save(lid, json)
  e.sig = s
  await pullThumb(lid, e.remoteId)
  persist()
  return true
}

async function pullThumb(lid, rid) {
  try {
    const t = await api(`/api/scene/${rid}/thumb`)
    if (t.ok) store.saveThumb(lid, await t.text())
  } catch {}
}

async function cycle() {
  for (const rid of [...S.tomb]) {
    const r = await api(`/api/scene/${rid}`, { method: 'DELETE' })
    if (r.ok || r.status === 404) { S.tomb = S.tomb.filter((x) => x !== rid); persist() }
  }

  const r = await api(`/api/u/${S.user}/scenes`)
  if (!r.ok) throw new Error('servidor respondeu ' + r.status)
  const remote = new Map((await r.json()).map((s) => [s.id, s]))
  const locals = store.list()
  const localIds = new Set(locals.map((p) => p.id))
  let listChanged = false

  for (const p of locals) {
    let e = S.map[p.id]
    if (e && !remote.has(e.remoteId)) {
      if (e.dirty) { delete S.map[p.id]; e = null } // apagado na nuvem mas editado aqui: recria
      else { // apagado em outro aparelho
        delete S.map[p.id]
        await store.remove(p.id)
        notify('changed', { id: p.id, deleted: true })
        listChanged = true
        continue
      }
    }
    if (!e) {
      e = await createRemote(p.id, p.name)
      await push(p.id, e)
    } else if (e.dirty) {
      await push(p.id, e)
    } else if (remote.get(e.remoteId).updatedAt > e.syncedAt) {
      if (await pull(p.id, e, remote.get(e.remoteId).updatedAt)) { notify('changed', { id: p.id }); listChanged = true }
    }
    const rs = remote.get(e.remoteId)
    if (e.nameDirty || !rs) {
      const pr = await api(`/api/scene/${e.remoteId}`, { method: 'PATCH', body: JSON.stringify({ name: p.name }) })
      if (pr.ok) e.nameDirty = false
    } else if (rs.name !== p.name) {
      store.rename(p.id, rs.name)
      listChanged = true
    }
    if (e.thumbDirty) {
      const t = await api(`/api/scene/${e.remoteId}/thumb`, { method: 'PUT', body: store.thumb(p.id) ?? '' })
      if (t.ok) e.thumbDirty = false
    }
  }

  const mapped = new Map(Object.entries(S.map).map(([lid, e]) => [e.remoteId, lid]))
  for (const [rid, rs] of remote) {
    if (S.tomb.includes(rid)) continue
    const lid = mapped.get(rid)
    if (lid && localIds.has(lid)) continue
    if (lid) delete S.map[lid] // arquivo local sumiu na mão: baixa de novo
    const g = await api(`/api/scene/${rid}`)
    if (!g.ok) continue
    const d = await g.json()
    const json = JSON.stringify(d.scene)
    store.createFrom(rid, rs.name, json)
    S.map[rid] = { remoteId: rid, syncedAt: d.updatedAt ?? rs.updatedAt, sig: sig(json), dirty: false, nameDirty: false, thumbDirty: false }
    await pullThumb(rid, rid)
    persist()
    listChanged = true
  }

  if (listChanged) notify('list')
}
