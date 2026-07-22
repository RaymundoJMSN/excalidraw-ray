// 3 modos: Electron (IPC window.ray) · web (API HTTP, build --mode web) · fallback localStorage (preview dev).
export const isWeb = import.meta.env.MODE === 'web'
export const sceneMeta = {} // id → { readOnly, viewId, name } (só web)

const ls = {
  // ponytail: shim localStorage p/ preview no browser
  _index() { return JSON.parse(localStorage.rayIndex ?? '{"last":null,"projects":{}}') },
  _write(i) { localStorage.rayIndex = JSON.stringify(i) },
  async list() {
    const i = this._index()
    return Object.entries(i.projects)
      .map(([id, p]) => ({ id, name: p.name, updatedAt: p.updatedAt ?? 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
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
  async saveThumb(id, dataURL) { try { localStorage['rayThumb:' + id] = dataURL } catch {} },
  async thumb(id) { return localStorage['rayThumb:' + id] ?? null },
  async rename(id, name) { const i = this._index(); if (i.projects[id]) { i.projects[id].name = name; this._write(i) } },
  async remove(id) {
    const i = this._index()
    delete i.projects[id]
    if (i.last === id) i.last = Object.keys(i.projects)[0] ?? null
    this._write(i)
    delete localStorage['rayScene:' + id]
    delete localStorage['rayThumb:' + id]
  },
  async last() { return this._index().last },
  async setLast(id) { const i = this._index(); i.last = id; this._write(i) },
  async openFolder() {},
  onFlush() {},
  flushed() {},
}

const web = {
  user: () => localStorage.rayUser,
  async list() {
    const r = await fetch(`/api/u/${this.user()}/scenes`)
    if (!r.ok) return []
    return r.json()
  },
  async create(name) {
    const r = await fetch(`/api/u/${this.user()}/scenes`, { method: 'POST', body: JSON.stringify({ name }) })
    if (!r.ok) throw new Error('create falhou: ' + r.status)
    const { id, viewId } = await r.json()
    sceneMeta[id] = { readOnly: false, viewId, name }
    return id
  },
  async load(id) {
    const r = await fetch(`/api/scene/${id}`)
    if (!r.ok) return null
    const d = await r.json()
    sceneMeta[id] = { readOnly: d.readOnly, viewId: d.viewId, name: d.name }
    return JSON.stringify(d.scene)
  },
  async save(id, json) {
    const r = await fetch(`/api/scene/${id}`, { method: 'PUT', body: json })
    if (!r.ok) throw new Error('save falhou: ' + r.status) // App retém pending e re-tenta
  },
  saveBeacon(id, json) {
    // pagehide: fetch normal seria abortado; sendBeacon sobrevive ao unload (limite ~64KB, melhor esforço)
    return navigator.sendBeacon(`/api/scene/${id}`, new Blob([json], { type: 'application/json' }))
  },
  async saveThumb(id, dataURL) { try { await fetch(`/api/scene/${id}/thumb`, { method: 'PUT', body: dataURL }) } catch {} },
  async thumb(id) {
    try {
      const r = await fetch(`/api/scene/${id}/thumb`)
      return r.ok ? r.text() : null
    } catch { return null }
  },
  async rename(id, name) { await fetch(`/api/scene/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }) },
  async remove(id) { await fetch(`/api/scene/${id}`, { method: 'DELETE' }) },
  async last() { return localStorage['rayLast:' + this.user()] ?? null },
  async setLast(id) {
    if (id.startsWith('v-')) { history.replaceState(null, '', '/v/' + id); return } // link view: não vira "último"
    if (this.user()) localStorage['rayLast:' + this.user()] = id
    history.replaceState(null, '', '/d/' + id)
  },
  async openFolder() {},
  onFlush() {},
  flushed() {},
}

export const ray = window.ray ?? (isWeb ? web : ls)
