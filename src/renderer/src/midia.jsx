// Vídeo e áudio no canvas. O pacote só aceita imagem, então a mídia vira elemento "embeddable"
// cujo link aponta pro arquivo guardado (ray-media:// no desktop, /api/media/ na web) e o
// renderEmbeddable desenha <video>/<audio> no lugar do iframe.
import { useRef, useState } from 'react'
import { restoreElements, CaptureUpdateAction, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw'
import { ray } from './storage'
import './midia.css'

const VIDEO = /\.(mp4|m4v|webm|mov|ogv|mkv)$/i
const AUDIO = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i
export const ehMidia = (f) => /^(video|audio)\//.test(f.type) || VIDEO.test(f.name) || AUDIO.test(f.name)
const ehAudio = (f) => f.type.startsWith('audio/') || AUDIO.test(f.name)
export const tipoMidia = (link) => (AUDIO.test(link) ? 'audio' : VIDEO.test(link) ? 'video' : null)

async function medir(f) { // vídeo: proporção real cabendo em 480 de largura; áudio: só a barra de controles
  if (ehAudio(f)) return { w: 320, h: 64 } // barra de 28 px embaixo + corpo pra arrastar
  const url = URL.createObjectURL(f), v = document.createElement('video')
  try {
    v.preload = 'metadata'; v.src = url
    await new Promise((ok, erro) => { v.onloadedmetadata = ok; v.onerror = erro })
    return { w: 480, h: Math.round(480 * v.videoHeight / v.videoWidth) || 270 }
  } catch { return { w: 480, h: 270 } } finally { URL.revokeObjectURL(url) }
}

// ponto = {clientX, clientY} do drop; sem ponto (colar) entra no centro da vista. Vários arquivos empilham.
export async function inserirMidia(api, arquivos, ponto, sceneId) {
  const st = api.getAppState()
  let { x, y } = ponto ? viewportCoordsToSceneCoords(ponto, st)
    : { x: -st.scrollX + st.width / 2 / st.zoom.value, y: -st.scrollY + st.height / 2 / st.zoom.value }
  const novos = []
  for (const f of arquivos) {
    const { w, h } = await medir(f)
    let link
    try { link = await ray.saveMedia(f, sceneId) } catch (e) {
      console.error(e); api.setToast({ message: `Não consegui guardar ${f.name}`, closable: true }); continue
    }
    novos.push(...restoreElements([{ type: 'embeddable', x: x - w / 2, y: y - h / 2, width: w, height: h, link }], null))
    y += h + 16
  }
  if (!novos.length) return
  api.updateScene({
    elements: [...api.getSceneElements(), ...novos],
    appState: { selectedElementIds: Object.fromEntries(novos.map((e) => [e.id, true])) },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY, // entra no desfazer
  })
  api.setActiveTool({ type: 'selection' })
}

// Player próprio: controles nativos vivem no shadow DOM e não dá pra liberar só a barra deles — e o pacote exige
// "ativar" o embed antes de qualquer clique. Aqui o corpo passa o clique pro canvas (midia.css) e a barra funciona sempre.
function Player({ src, audio }) {
  const ref = useRef(null)
  const [t, setT] = useState(0), [dur, setDur] = useState(0), [tocando, setTocando] = useState(false), [mudo, setMudo] = useState(false)
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const Tag = audio ? 'audio' : 'video'
  return (
    <div className="ray-player">
      <Tag ref={ref} src={src} preload="metadata"
        onLoadedMetadata={() => setDur(ref.current.duration)} onTimeUpdate={() => setT(ref.current.currentTime)}
        onPlay={() => setTocando(true)} onPause={() => setTocando(false)} />
      <div className="ray-player-barra" onPointerUp={(e) => e.target.blur?.()}>{/* sem foco: setas/Delete seguem sendo do canvas */}
        <button title={tocando ? 'Pausar' : 'Tocar'} onClick={() => (tocando ? ref.current.pause() : ref.current.play())}>{tocando ? '❚❚' : '▶'}</button>
        <input type="range" min={0} max={dur || 0} step={0.1} value={t} onChange={(e) => { ref.current.currentTime = +e.target.value; setT(+e.target.value) }} />
        <span>{fmt(t)}{dur ? ' / ' + fmt(dur) : ''}</span>
        <button title={mudo ? 'Som' : 'Mudo'} onClick={() => { ref.current.muted = !mudo; setMudo(!mudo) }}>{mudo ? '🔇' : '🔊'}</button>
      </div>
    </div>
  )
}

export function renderMidia(el) {
  const t = tipoMidia(el.link ?? '')
  return t ? <Player src={el.link} audio={t === 'audio'} /> : null // link comum segue no iframe do pacote
}
