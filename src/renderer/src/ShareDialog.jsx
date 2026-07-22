import { useState } from 'react'
import './panel.css'

export default function ShareDialog({ id, viewId, onClose }) {
  const [copied, setCopied] = useState(null)
  const base = location.origin
  const linhas = [
    { rot: 'Editar (quem tem o link edita)', valor: `${base}/d/${id}` },
    { rot: 'Só visualizar', valor: `${base}/v/${viewId}` },
    { rot: 'Embed (iframe)', valor: `<iframe src="${base}/v/${viewId}" width="800" height="600" style="border:0"></iframe>` },
  ]
  const copiar = async (v, i) => {
    await navigator.clipboard.writeText(v)
    setCopied(i)
    setTimeout(() => setCopied(null), 1500)
  }
  return (
    <div className="ray-backdrop" onClick={onClose}>
      <div className="ray-panel" onClick={(e) => e.stopPropagation()}>
        <header><h2>Compartilhar</h2></header>
        {linhas.map((l, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: '#7d7c88', marginBottom: 4 }}>{l.rot}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input readOnly value={l.valor} onFocus={(e) => e.target.select()} />
              <button className="ray-new" onClick={() => copiar(l.valor, i)}>{copied === i ? 'Copiado!' : 'Copiar'}</button>
            </div>
          </div>
        ))}
        <p style={{ margin: 0, fontSize: 12, color: '#7d7c88' }}>
          Quem tem o link de edição pode alterar a cena. O link de visualização é somente leitura.
        </p>
      </div>
    </div>
  )
}
