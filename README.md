# Excalidraw Ray

Versão desktop instalável do [Excalidraw](https://github.com/excalidraw/excalidraw) (Windows), com:

- **Autosave** — tudo salvo automaticamente em `Documentos\ExcalidrawRay\` (arquivos `.excalidraw` padrão, abrem no excalidraw.com).
- **Multi-projetos** — criar/alternar/renomear/excluir projetos pelo menu; sempre abre o último projeto usado.
- **Menu limpo** — sem Excalidraw+, GitHub, Discord, Sign up, redes sociais.
- Tema escuro por padrão, interface em pt-BR.

Construído com `@excalidraw/excalidraw` (pacote oficial) + Electron + Vite. Não é fork do monorepo — usa o pacote npm, o que mantém atualizações fáceis (`npm update`).

## Dev

```bash
npm install
npm run dev        # Vite + Electron com hot reload
```

## Build (instalador Windows)

```bash
npm run dist       # gera instalador NSIS em dist-electron/
```

## Web / nuvem (fase 2 — no ar)

Mesmo app buildado pra web (`npm run build:web`) + `server/server.mjs` (Node puro, porta 8050,
systemd `excalidraw-ray`, devilsworks) = `draw.raynathus.com.br`:

- Login = escolher nome (localStorage, sem senha). Cenas ilimitadas por usuário, salvas no servidor
  (escrita atômica, backup diário 7 dias).
- **Compartilhar** (menu): link de edição `/d/<id>`, link só-visualização `/v/<viewId>` e snippet
  `<iframe>` pra embed. Quem tem o link acessa (capability); viewId nunca escreve (403).
- Visitante com link não precisa de login; raiz `/` pede login.
- Sem colaboração ao vivo (edição simultânea = last-write-wins).

Deploy: `deploy/deploy.ps1`. Self-check: `node server/server.mjs --check`.

**Pendente (manual):** criar registro A `draw` → `147.15.30.202` no registrador; depois
`ssh devilsworks 'sudo certbot --nginx -d draw.raynathus.com.br --redirect'`.
