// Vídeo e áudio no canvas. O pacote só aceita imagem, então a mídia vira elemento "embeddable"
// cujo link aponta pro arquivo guardado (ray-media:// no desktop, /api/media/ na web) e o
// renderEmbeddable desenha <video>/<audio> no lugar do iframe.
import { restoreElements, CaptureUpdateAction, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw'
import { ray } from './storage'

const VIDEO = /\.(mp4|m4v|webm|mov|ogv|mkv)$/i
const AUDIO = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i
export const ehMidia = (f) => /^(video|audio)\//.test(f.type) || VIDEO.test(f.name) || AUDIO.test(f.name)
const ehAudio = (f) => f.type.startsWith('audio/') || AUDIO.test(f.name)
export const tipoMidia = (link) => (AUDIO.test(link) ? 'audio' : VIDEO.test(link) ? 'video' : null)

async function medir(f) { // vídeo: proporção real cabendo em 480 de largura; áudio: só a barra de controles
  if (ehAudio(f)) return { w: 320, h: 54 }
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

export function renderMidia(el) {
  const t = tipoMidia(el.link ?? '')
  if (t === 'video') return <video src={el.link} controls preload="metadata" style={{ width: '100%', height: '100%', display: 'block', background: '#000' }} />
  if (t === 'audio') return <audio src={el.link} controls preload="metadata" style={{ width: '100%' }} />
  return null // link comum segue no iframe do pacote
}
