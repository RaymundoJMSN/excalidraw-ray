import { useEffect, useState } from 'react'
import './panel.css'

// Desktop: liga a sincronização dos projetos com a nuvem (mesmo usuário do site/celular).
export default function SyncDialog({ onClose }) {
  const [cfg, setCfg] = useState(null)
  const [user, setUser] = useState('')
  const [server, setServer] = useState('')
  const [erro, setErro] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    window.ray.syncGet().then((c) => { setCfg(c); setUser(c.user); setServer(c.server) })
    window.ray.onSync((type, c) => { if (type === 'status') setCfg(c) })
  }, [])

  const limpa = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  const rodar = async (fn) => {
    setErro(null); setOcupado(true)
    try { setCfg(await fn()) } catch (e) { setErro(limpa(e)) } finally { setOcupado(false) }
  }
  const ok = /^[a-z0-9-]{1,30}$/.test(user)
  const fmt = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')
  const cinza = { fontSize: 12, color: '#7d7c88' }

  if (!cfg) return null
  return (
    <div className="ray-backdrop" onClick={onClose}>
      <div className="ray-panel" style={{ width: 'min(420px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
        <header><h2>Sincronizar com a nuvem</h2></header>
        <p style={{ ...cinza, margin: '0 0 10px' }}>
          Use o mesmo nome que você usa no site/celular. Seus projetos daqui e de lá são mesclados e ficam iguais
          nos dois lados. Os arquivos locais continuam em Documentos (funciona offline).
        </p>
        <div style={{ ...cinza, marginBottom: 4 }}>Nome do usuário</div>
        <div style={{ display: 'flex', marginBottom: 8 }}>
          <input value={user} placeholder="ex: ray" onChange={(e) => setUser(e.target.value.toLowerCase().trim())} />
        </div>
        <div style={{ ...cinza, marginBottom: 4 }}>Servidor</div>
        <div style={{ display: 'flex', marginBottom: 12 }}>
          <input value={server} onChange={(e) => setServer(e.target.value.trim())} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button className="ray-new" disabled={!ok || ocupado} onClick={() => rodar(() => window.ray.syncEnable({ user, server }))}>
            {cfg.enabled ? 'Salvar' : 'Ativar sincronização'}
          </button>
          {cfg.enabled && <button className="ray-new" disabled={ocupado} onClick={() => rodar(() => window.ray.syncNow())}>Sincronizar agora</button>}
          {cfg.enabled && <button className="ray-new" disabled={ocupado} onClick={() => rodar(() => window.ray.syncDisable())}>Desativar</button>}
        </div>
        <div style={cinza}>
          {cfg.enabled
            ? (ocupado || cfg.busy ? 'Sincronizando…' : `Ativa · última sincronização: ${fmt(cfg.lastSync)}`)
            : 'Desativada'}
        </div>
        {(erro || (cfg.enabled && cfg.error)) && <div style={{ fontSize: 12, color: '#ff8383', marginTop: 6 }}>{erro || cfg.error}</div>}
      </div>
    </div>
  )
}
