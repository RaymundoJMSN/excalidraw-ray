// ponytail: shim localStorage p/ preview no browser — vira cliente HTTP na fase 2 (web)
const ls = {
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
