import { useState } from 'react'
import './panel.css'

export default function ProjectsPanel({ projects, currentId, onOpen, onNew, onRename, onDelete, onClose }) {
  const [editing, setEditing] = useState(null) // id em edição (window.prompt não existe no Electron)
  const fmt = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
  return (
    <div className="ray-backdrop" onClick={onClose}>
      <div className="ray-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Projetos</h2>
          <button className="ray-new" onClick={onNew}>+ Novo projeto</button>
        </header>
        <ul>
          {projects.map((p) => (
            <li key={p.id} className={p.id === currentId ? 'atual' : ''}>
              {editing === p.id ? (
                <input autoFocus defaultValue={p.name}
                  onBlur={(e) => { onRename(p.id, e.target.value.trim() || p.name); setEditing(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(null) }} />
              ) : (
                <button className="ray-name" onClick={() => onOpen(p.id)} onDoubleClick={() => setEditing(p.id)}
                  title="Clique abre · duplo-clique renomeia">
                  {p.name} {p.id === currentId && <span className="ray-badge">atual</span>}
                </button>
              )}
              <span className="ray-date">{fmt(p.updatedAt)}</span>
              <button className="ray-edit" title="Renomear" onClick={() => setEditing(p.id)}>✎</button>
              <button className="ray-del" title="Excluir (Lixeira)" onClick={() => onDelete(p.id)}>🗑</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
