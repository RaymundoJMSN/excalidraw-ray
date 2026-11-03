import { useState } from 'react'
import { LS } from './storage'
import './panel.css'

// Site: mesma conta do app do PC (nome + senha). Nome novo cria a conta.
export default function Login({ onLogin }) {
  const [name, setName] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const ok = /^[a-z0-9-]{1,30}$/.test(name) && senha.length >= 4
  const entrar = async () => {
    if (!ok || ocupado) return
    setErro(null); setOcupado(true)
    try {
      const r = await fetch('/api/entrar', { method: 'POST', body: JSON.stringify({ nome: name, senha }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(d.error || `servidor respondeu ${r.status}`); return }
      LS.rayUser = d.nome
      onLogin(d.nome)
    } catch { setErro('Não consegui falar com o servidor') } finally { setOcupado(false) }
  }
  return (
    <div className="ray-backdrop">
      <div className="ray-panel" style={{ width: 'min(360px, 90vw)' }}>
        <header><h2>Entrar</h2></header>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: '#7d7c88' }}>
          Mesmo nome e senha do app do PC (menu → Conta…). Nome que ainda não existe vira uma conta nova com essa senha.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input autoFocus value={name} placeholder="nome (minúsculas, números e hífen)"
            onChange={(e) => setName(e.target.value.toLowerCase().trim())} onKeyDown={(e) => e.key === 'Enter' && entrar()} />
          <input type="password" value={senha} placeholder="senha"
            onChange={(e) => setSenha(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && entrar()} />
          <button className="ray-new" disabled={!ok || ocupado} onClick={entrar}>{ocupado ? 'Entrando…' : 'Entrar ou criar conta'}</button>
        </div>
        {erro && <div style={{ fontSize: 12, color: '#ff8383', marginTop: 8 }}>{erro}</div>}
      </div>
    </div>
  )
}
