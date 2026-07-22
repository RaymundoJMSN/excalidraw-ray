import { useCallback, useEffect, useRef, useState } from 'react'
import { Excalidraw, MainMenu, serializeAsJSON, convertToExcalidrawElements, exportToBlob, useHandleLibrary } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { ray, isWeb, sceneMeta } from './storage'
import { IconNew, IconProjects, IconFolderOpen, IconShare } from './icons'
import { instalarTraducoes } from './i18n'
import ProjectsPanel from './ProjectsPanel'
import ShareDialog from './ShareDialog'
import Login from './Login'

const THUMB_MS = 10000 // regenera thumbnail no máximo a cada 10s

export default function App() {
  const [route] = useState(() => (isWeb ? location.pathname.match(/^\/(d|v)\/(.+)$/) : null))
  const [user, setUser] = useState(() => (isWeb ? localStorage.rayUser ?? null : 'local'))
  const guest = isWeb && !user // chegou por link compartilhado, sem login
  const [projects, setProjects] = useState([])
  const [current, setCurrent] = useState(null) // { id, data } | { id, missing: true }
  const [showPanel, setShowPanel] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [updateVersion, setUpdateVersion] = useState(null)
  const pending = useRef(null) // últimos (elements, appState, files) ainda não salvos
  const timer = useRef(null)
  const idRef = useRef(null)
  const apiRef = useRef(null)
  const lastThumb = useRef(0)
  const [excaliApi, setExcaliApi] = useState(null)
  useHandleLibrary({ excalidrawAPI: excaliApi }) // faz o "Add to Excalidraw" (#addLibrary) do site de bibliotecas funcionar

  const readOnly = !!(current && sceneMeta[current.id]?.readOnly)
  const refresh = async () => setProjects(await ray.list())

  async function makeThumb(id, els, st, files) {
    try {
      if (!els.length) { ray.saveThumb(id, ''); return }
      const blob = await exportToBlob({
        elements: els,
        appState: { ...st, exportBackground: true, exportWithDarkMode: st.theme === 'dark' },
        files, maxWidthOrHeight: 320, mimeType: 'image/webp', quality: 0.75, exportPadding: 12,
      })
      const dataURL = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob) })
      await ray.saveThumb(id, dataURL)
    } catch {}
  }

  function flush() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!pending.current || !idRef.current) return Promise.resolve()
    const snap = pending.current
    const id = idRef.current
    pending.current = null
    if (Date.now() - lastThumb.current > THUMB_MS) { lastThumb.current = Date.now(); makeThumb(id, ...snap) }
    return ray.save(id, serializeAsJSON(snap[0], snap[1], snap[2], 'local')).catch(() => {
      if (!pending.current) pending.current = snap // não perde: retém e re-tenta
      if (!timer.current) timer.current = setTimeout(() => { timer.current = null; flush() }, 3000)
      apiRef.current?.setToast({ message: 'Falha ao salvar — tentando de novo…', closable: true, duration: 2500 })
    })
  }

  const open = useCallback(async (id) => {
    await flush()
    const raw = await ray.load(id)
    if (isWeb && raw === null) { setCurrent({ id, missing: true }); return } // cena apagada/link errado: não vira editor fantasma
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
    window.ray?.onUpdate?.((v) => setUpdateVersion(v))
    return instalarTraducoes()
  }, [user])

  useEffect(() => {
    if (!isWeb) return
    const onHide = () => {
      // aba fechando/minimizada: fetch normal morre no unload — sendBeacon sobrevive
      if (!pending.current || !idRef.current || sceneMeta[idRef.current]?.readOnly) return
      const [els, st, files] = pending.current
      const ok = ray.saveBeacon?.(idRef.current, serializeAsJSON(els, st, files, 'local'))
      if (ok) pending.current = null
    }
    const onVis = () => { if (document.visibilityState === 'hidden') onHide() }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVis)
    return () => { window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onVis) }
  }, [])

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

  const openPanel = async () => {
    await flush()
    if (apiRef.current && idRef.current) { // thumbnail fresco do projeto atual, ignora o throttle
      lastThumb.current = Date.now()
      makeThumb(idRef.current, apiRef.current.getSceneElements(), apiRef.current.getAppState(), apiRef.current.getFiles())
    }
    await refresh()
    setShowPanel(true)
  }

  const instalarUpdate = async () => {
    await flush()
    await window.ray.runUpdate()
  }

  if (isWeb && !user && !route) return <Login onLogin={setUser} />
  if (!current) return null
  if (current.missing) {
    return (
      <div className="ray-backdrop">
        <div className="ray-panel" style={{ textAlign: 'center' }}>
          <header><h2>Cena não encontrada</h2></header>
          <p style={{ color: '#7d7c88', fontSize: 13 }}>Esse link não existe mais (a cena pode ter sido excluída).</p>
          <button className="ray-new" onClick={() => { location.href = '/' }}>Ir para meus projetos</button>
        </div>
      </div>
    )
  }
  return (
    <div style={{ height: '100%' }}>
      <Excalidraw key={current.id} initialData={current.data} langCode="pt-BR" onChange={onChange}
        viewModeEnabled={readOnly || undefined}
        excalidrawAPI={(a) => { apiRef.current = a; setExcaliApi(a); if (import.meta.env.DEV) window.__rayTest = { api: a, convert: convertToExcalidrawElements, exportToBlob, makeThumb, ray } }}
        UIOptions={{ canvasActions: { export: { saveFileToDisk: true } } }}
        renderTopRightUI={() => updateVersion && (
          <button className="ray-update" title={`Atualizar para a versão ${updateVersion} (baixa e reinstala sozinho)`}
            onClick={instalarUpdate}>⬇ Atualizar v{updateVersion}</button>
        )}>
        {readOnly ? (
          <MainMenu>
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.Help />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ToggleTheme />
          </MainMenu>
        ) : (
          <MainMenu>
            {!guest && <MainMenu.Item onSelect={newProject} icon={<IconNew />}>Novo projeto</MainMenu.Item>}
            {!guest && <MainMenu.Item onSelect={openPanel} icon={<IconProjects />}>Projetos…</MainMenu.Item>}
            {isWeb && <MainMenu.Item onSelect={() => setShowShare(true)} icon={<IconShare />}>Compartilhar…</MainMenu.Item>}
            <MainMenu.Separator />
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.SaveAsImage />
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
            if (id === idRef.current) { idRef.current = null; pending.current = null } // autosave póstumo não ressuscita o arquivo
            await ray.remove(id)
            if (!idRef.current) location.reload()
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
