# Excalidraw Ray

Versão desktop instalável do [Excalidraw](https://github.com/excalidraw/excalidraw) (Windows), com:

- **Autosave** — tudo salvo automaticamente em `Documentos\ExcalidrawRay\` (arquivos `.excalidraw` padrão, abrem no excalidraw.com).
- **Multi-projetos** — criar/alternar/renomear/excluir projetos pelo menu; sempre abre o último projeto usado.
- **Menu limpo** — sem Excalidraw+, GitHub, Discord, Sign up, redes sociais.
- **Vídeo e áudio no canvas** — arrasta ou cola mp4/webm/mov/mp3/wav/ogg… e vira um player que se comporta como
  foto: o corpo seleciona/arrasta/redimensiona, a barra embaixo (play, tempo, som) funciona sempre. O arquivo é copiado pra `Documentos\ExcalidrawRay\media\`
  (na web, sobe pro servidor); a cena guarda só o link. `npm run check:midia` prova no Electron real.
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

- Login = nome + senha (conta criada no primeiro acesso). Cenas ilimitadas por usuário, salvas no servidor
  (escrita atômica, backup diário 7 dias).
- **Compartilhar** (menu): link de edição `/d/<id>`, link só-visualização `/v/<viewId>` e snippet
  `<iframe>` pra embed. Quem tem o link acessa (capability); viewId nunca escreve (403).
- Visitante com link não precisa de login; raiz `/` pede login.
- Sem colaboração ao vivo (edição simultânea = last-write-wins).
- **App no celular (PWA)**: abrir o site no celular → menu do navegador → *Adicionar à tela inicial*
  (precisa HTTPS). Cena aberta confere a cada 15s / ao voltar pro app se mudou em outro aparelho.

## Conta e sincronização PC ⇄ nuvem/celular

Uma conta = nome + senha no servidor (`data/usuarios.json`, scrypt; sessão = token HMAC, cookie `ray` no site
e `Authorization: Bearer` no app). Nome que ainda não existe vira conta nova com a senha digitada. A lista de
cenas de um usuário exige a conta dele; cena por link (`/d/<id>`, `/v/<viewId>`) continua sendo capacidade.

No desktop: menu → **Entrar na conta…** (ou o chip 👤 no canto) → nome + senha → entra e já sincroniza.
No site/celular: mesmo nome e senha. Projetos locais e da nuvem são mesclados; depois disso cada save
sobe em ~2s e o app puxa mudanças a cada 20s e ao ganhar foco. "Sair da conta" desliga a sincronização
e esquece o token (os arquivos locais ficam). Arquivos locais continuam em Documentos (funciona offline; sobe quando voltar a rede).
Conflito na mesma cena = last-write-wins (edição local pendente vence). Estado em `Documentos\ExcalidrawRay\sync.json`.

Deploy: `deploy/deploy.ps1`. Self-check: `node server/server.mjs --check`.

**Pendente (manual):** criar registro A `draw` → `147.15.30.202` no registrador; depois
`ssh devilsworks 'sudo certbot --nginx -d draw.raynathus.com.br --redirect'`.
