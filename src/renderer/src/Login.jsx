import { useState } from 'react'
import './panel.css'

export default function Login({ onLogin }) {
  const [name, setName] = useState('')
  const ok = /^[a-z0-9-]{1,30}$/.test(name)
  const entrar = () => {
    if (!ok) return
    localStorage.rayUser = name
    onLogin(name)
  }
  return (
    <div className="ray-backdrop">
      <div className="ray-panel" style={{ width: 'min(340px, 90vw)' }}>
        <header><h2>Quem é você?</h2></header>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: '#7d7c88' }}>
          Escolha um nome (letras minúsculas, números e hífen). Suas cenas ficam ligadas a ele.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input autoFocus value={name} placeholder="ex: ray"
            onChange={(e) => setName(e.target.value.toLowerCase().trim())}
            onKeyDown={(e) => e.key === 'Enter' && entrar()} />
          <button className="ray-new" disabled={!ok} onClick={entrar}>Entrar</button>
        </div>
      </div>
    </div>
  )
}
