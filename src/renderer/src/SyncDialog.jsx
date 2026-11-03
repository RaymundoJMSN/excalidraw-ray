import { useEffect, useState } from 'react'
import './panel.css'

// Desktop: a conta (nome + senha no servidor). Entrar = sincronizar: os projetos daqui e da nuvem viram um só
// conjunto, e o mesmo nome/senha abre tudo no site e no celular.
export default function SyncDialog({ onClose }) {
  const [cfg, setCfg] = useState(null)
  const [user, setUser] = useState('')
  const [senha, setSenha] = useState('')
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
  const ok = /^[a-z0-9-]{1,30}$/.test(user) && senha.length >= 4
  const fmt = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')
  const cinza = { fontSize: 12, color: '#7d7c88' }
  const site = (cfg?.server ?? '').replace(/^https?:\/\//, '')

  if (!cfg) return null
  return (
    <div className="ray-backdrop" onClick={onClose}>
      <div className="ray-panel" style={{ width: 'min(420px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
        <header><h2>Conta</h2></header>
        {cfg.enabled ? (
          <>
            <p style={{ margin: '0 0 6px', fontSize: 14 }}>Você está na conta <b>{cfg.user}</b>.</p>
            <p style={{ ...cinza, margin: '0 0 10px' }}>
              Seus projetos ficam iguais aqui e em <b>{site}</b>: entre lá (no navegador ou no celular) com este
              mesmo nome e senha. Os arquivos continuam em Documentos, então funciona offline e sobe quando voltar a rede.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <button className="ray-new" disabled={ocupado} onClick={() => rodar(() => window.ray.syncNow())}>Sincronizar agora</button>
              <button className="ray-new" disabled={ocupado} onClick={() => rodar(() => window.ray.syncDisable())}>Sair da conta</button>
            </div>
            <div style={cinza}>{ocupado || cfg.busy ? 'Sincronizando…' : `Última sincronização: ${fmt(cfg.lastSync)}`}</div>
          </>
        ) : (
          <>
            <p style={{ ...cinza, margin: '0 0 10px' }}>
              Entre com nome e senha. Nome que ainda não existe vira uma conta nova com essa senha. Depois disso
              os projetos daqui sobem pra nuvem e você abre tudo no site e no celular com os mesmos dados.
            </p>
            <div style={{ ...cinza, marginBottom: 4 }}>Nome</div>
            <div style={{ display: 'flex', marginBottom: 8 }}>
              <input autoFocus value={user} placeholder="ex: ray" onChange={(e) => setUser(e.target.value.toLowerCase().trim())} />
            </div>
            <div style={{ ...cinza, marginBottom: 4 }}>Senha</div>
            <div style={{ display: 'flex', marginBottom: 8 }}>
              <input type="password" value={senha} placeholder="pelo menos 4 caracteres" onChange={(e) => setSenha(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ok && rodar(() => window.ray.syncEnable({ user, senha, server }))} />
            </div>
            <div style={{ ...cinza, marginBottom: 4 }}>Servidor</div>
            <div style={{ display: 'flex', marginBottom: 12 }}>
              <input value={server} onChange={(e) => setServer(e.target.value.trim())} />
            </div>
            <button className="ray-new" disabled={!ok || ocupado} onClick={() => rodar(() => window.ray.syncEnable({ user, senha, server }))}>
              {ocupado ? 'Entrando…' : 'Entrar ou criar conta'}
            </button>
          </>
        )}
        {(erro || (cfg.enabled && cfg.error)) && <div style={{ fontSize: 12, color: '#ff8383', marginTop: 6 }}>{erro || cfg.error}</div>}
      </div>
    </div>
  )
}
