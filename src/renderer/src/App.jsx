import { useCallback, useEffect, useRef, useState } from 'react'
import { Excalidraw, MainMenu, serializeAsJSON, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { ray } from './storage'
import { IconNew, IconProjects, IconFolderOpen } from './icons'
import ProjectsPanel from './ProjectsPanel'

export default function App() {
  const [projects, setProjects] = useState([])
  const [current, setCurrent] = useState(null) // { id, data }
  const [showPanel, setShowPanel] = useState(false)
  const pending = useRef(null) // últimos (elements, appState, files) ainda não salvos
  const timer = useRef(null)
  const idRef = useRef(null)

  const refresh = async () => setProjects(await ray.list())

  function flush() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!pending.current || !idRef.current) return Promise.resolve()
    const [els, st, files] = pending.current
    pending.current = null
    return ray.save(idRef.current, serializeAsJSON(els, st, files, 'local'))
  }

  const open = useCallback(async (id) => {
    await flush()
    const raw = await ray.load(id)
    let data = null
    try {
      data = JSON.parse(raw)
      data.appState = { ...data.appState, theme: localStorage.rayTheme ?? data.appState?.theme ?? 'dark' }
    } catch {}
    idRef.current = id
    setCurrent({ id, data })
    ray.setLast(id)
    setShowPanel(false)
    refresh()
  }, [])

  useEffect(() => {
    (async () => {
      let id = await ray.last()
      const list = await ray.list()
      if (!id || !list.some((p) => p.id === id)) id = list[0]?.id
      if (!id) id = await ray.create('Projeto 1')
      await open(id)
    })()
    ray.onFlush(async () => { await flush(); ray.flushed() })
  }, [])

  const onChange = useCallback((els, st, files) => {
    localStorage.rayTheme = st.theme
    pending.current = [els, st, files]
    if (!timer.current) timer.current = setTimeout(() => { timer.current = null; flush() }, 800)
  }, [])

  const newProject = async () => {
    await flush()
    const id = await ray.create(`Projeto ${projects.length + 1}`)
    await open(id)
    setShowPanel(true) // já abre o painel pra renomear na hora
  }

  if (!current) return null
  return (
    <div style={{ height: '100%' }}>
      <Excalidraw key={current.id} initialData={current.data} langCode="pt-BR" onChange={onChange}
        excalidrawAPI={(a) => { if (import.meta.env.DEV) window.__rayTest = { api: a, convert: convertToExcalidrawElements } }}
        UIOptions={{ canvasActions: { export: { saveFileToDisk: true } } }}>
        <MainMenu>
          <MainMenu.Item onSelect={newProject} icon={<IconNew />}>Novo projeto</MainMenu.Item>
          <MainMenu.Item onSelect={() => setShowPanel(true)} icon={<IconProjects />}>Projetos…</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.CommandPalette />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.Item onSelect={() => ray.openFolder()} icon={<IconFolderOpen />}>Abrir pasta de projetos</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
      {showPanel && (
        <ProjectsPanel projects={projects} currentId={current.id}
          onOpen={open} onNew={newProject}
          onRename={async (id, name) => { await ray.rename(id, name); refresh() }}
          onDelete={async (id) => {
            if (!confirm('Excluir projeto? (vai pra Lixeira do Windows)')) return
            await ray.remove(id)
            if (id === idRef.current) location.reload()
            else refresh()
          }}
          onClose={() => setShowPanel(false)} />
      )}
    </div>
  )
}
