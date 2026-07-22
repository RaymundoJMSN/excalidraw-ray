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

## Fase 2 (planejado)

Servidor `draw.raynathus.com.br`: cenas na nuvem, compartilhamento com direitos view/edit, links read-only e embeds. Ver `docs/plans/`.
