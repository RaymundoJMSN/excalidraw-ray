import { useCallback, useEffect, useRef, useState } from 'react'
import { Excalidraw, MainMenu, serializeAsJSON, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { ray, isWeb, sceneMeta } from './storage'
import { IconNew, IconProjects, IconFolderOpen, IconShare } from './icons'
import ProjectsPanel from './ProjectsPanel'
import ShareDialog from './ShareDialog'
import Login from './Login'

export default function App() {
  const [route] = useState(() => (isWeb ? location.pathname.match(/^\/(d|v)\/(.+)$/) : null))
  const [user, setUser] = useState(() => (isWeb ? localStorage.rayUser ?? null : 'local'))
  const guest = isWeb && !user // chegou por link compartilhado, sem login
  const [projects, setProjects] = useState([])
  const [current, setCurrent] = useState(null) // { id, data }
  const [showPanel, setShowPanel] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const pending = useRef(null) // últimos (elements, appState, files) ainda não salvos
  const timer = useRef(null)
  const idRef = useRef(null)

  const readOnly = !!(current && sceneMeta[current.id]?.readOnly)
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
    if (!sceneMeta[id]?.readOnly) refresh()
  }, [])

  useEffect(() => {
    if (!user && !route) return
    ;(async () => {
      if (route) { await open(route[2]); return }
      let id = await ray.last()
      const list = await ray.list()
      if (!id || !list.some((p) => p.id === id)) id = list[0]?.id
      if (!id) id = await ray.create('Projeto 1')
      await open(id)
    })()
    ray.onFlush(async () => { await flush(); ray.flushed() })
  }, [user])

  const onChange = useCallback((els, st, files) => {
    localStorage.rayTheme = st.theme
    if (sceneMeta[idRef.current]?.readOnly) return // view nunca salva
    pending.current = [els, st, files]
    if (!timer.current) timer.current = setTimeout(() => { timer.current = null; flush() }, 800)
  }, [])

  const newProject = async () => {
    await flush()
    const id = await ray.create(`Projeto ${projects.length + 1}`)
    await open(id)
    setShowPanel(true) // já abre o painel pra renomear na hora
  }

  if (isWeb && !user && !route) return <Login onLogin={setUser} />
  if (!current) return null
  return (
    <div style={{ height: '100%' }}>
      <Excalidraw key={current.id} initialData={current.data} langCode="pt-BR" onChange={onChange}
        viewModeEnabled={readOnly || undefined}
        excalidrawAPI={(a) => { if (import.meta.env.DEV) window.__rayTest = { api: a, convert: convertToExcalidrawElements } }}
        UIOptions={{ canvasActions: { export: { saveFileToDisk: true } } }}>
        {readOnly ? (
          <MainMenu>
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.CommandPalette />
            <MainMenu.DefaultItems.Help />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ToggleTheme />
          </MainMenu>
        ) : (
          <MainMenu>
            {!guest && <MainMenu.Item onSelect={newProject} icon={<IconNew />}>Novo projeto</MainMenu.Item>}
            {!guest && <MainMenu.Item onSelect={() => setShowPanel(true)} icon={<IconProjects />}>Projetos…</MainMenu.Item>}
            {isWeb && <MainMenu.Item onSelect={() => setShowShare(true)} icon={<IconShare />}>Compartilhar…</MainMenu.Item>}
            <MainMenu.Separator />
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.CommandPalette />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.Separator />
            {!isWeb && <MainMenu.Item onSelect={() => ray.openFolder()} icon={<IconFolderOpen />}>Abrir pasta de projetos</MainMenu.Item>}
            {!isWeb && <MainMenu.Separator />}
            <MainMenu.DefaultItems.ToggleTheme />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
        )}
      </Excalidraw>
      {showPanel && !readOnly && (
        <ProjectsPanel projects={projects} currentId={current.id}
          onOpen={open} onNew={newProject}
          onRename={async (id, name) => { await ray.rename(id, name); refresh() }}
          onDelete={async (id) => {
            if (!confirm(isWeb ? 'Excluir cena da nuvem?' : 'Excluir projeto? (vai pra Lixeira do Windows)')) return
            await ray.remove(id)
            if (id === idRef.current) location.reload()
            else refresh()
          }}
          onClose={() => setShowPanel(false)} />
      )}
      {showShare && current && sceneMeta[current.id] && (
        <ShareDialog id={current.id} viewId={sceneMeta[current.id].viewId} onClose={() => setShowShare(false)} />
      )}
    </div>
  )
}
