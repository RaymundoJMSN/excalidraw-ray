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
