// ponytail: a 0.18.1 tem chaves sem tradução pt-BR; MutationObserver troca os textos conhecidos.
// Some sozinho quando o pacote atualizar as traduções (strings deixam de bater).
const DICT = {
  'Command palette': 'Paleta de comandos',
  'Find on canvas': 'Procurar na tela',
  'Search': 'Buscar',
  'Recents': 'Recentes',
  'Mermaid to Excalidraw': 'Mermaid para Excalidraw',
  'Mermaid Syntax': 'Sintaxe Mermaid',
  'Insert': 'Inserir',
  'Preview': 'Pré-visualização',
  'Search commands…': 'Buscar comandos…',
  'Search commands...': 'Buscar comandos…',
  'No matching commands': 'Nenhum comando encontrado',
}

function fixNode(n) {
  if (n.nodeType === Node.TEXT_NODE) {
    const t = n.textContent.trim()
    if (DICT[t]) n.textContent = n.textContent.replace(t, DICT[t])
    return
  }
  if (n.nodeType !== Node.ELEMENT_NODE) return
  const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT)
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const s = t.textContent.trim()
    if (DICT[s]) t.textContent = t.textContent.replace(s, DICT[s])
  }
  for (const el of [n, ...n.querySelectorAll('[placeholder], [title], [aria-label]')]) {
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const v = el.getAttribute?.(attr)
      if (v && DICT[v]) el.setAttribute(attr, DICT[v])
    }
  }
}

export function instalarTraducoes() {
  fixNode(document.body)
  const mo = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) fixNode(n)
  })
  mo.observe(document.body, { childList: true, subtree: true })
  return () => mo.disconnect()
}
