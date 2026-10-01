// Widget de dados: embed do /dados.html inserido pela opção "Widget de dados" em "Mais ferramentas".
import { restoreElements, CaptureUpdateAction } from '@excalidraw/excalidraw'

// ponytail: sempre a URL pública (e não file://) pra cena compartilhada/web abrir o mesmo widget.
export const DADOS_URL = 'https://draw.raynathus.com.br/dados.html'

const ICONE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="4" width="16" height="16" rx="3"/>
  <circle cx="8.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="8.5" r=".9" fill="currentColor"/>
  <circle cx="12" cy="12" r=".9" fill="currentColor"/>
  <circle cx="8.5" cy="15.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="15.5" r=".9" fill="currentColor"/>
</svg>`

export function inserirWidgetDados(api) {
  if (!api) return
  const st = api.getAppState()
  const w = 320, h = 300
  const x = -st.scrollX + st.width / 2 / st.zoom.value - w / 2
  const y = -st.scrollY + st.height / 2 / st.zoom.value - h / 2
  const [el] = restoreElements([{ type: 'embeddable', x, y, width: w, height: h, link: `${DADOS_URL}?theme=${st.theme}` }], null)
  api.updateScene({
    elements: [...api.getSceneElements(), el],
    appState: { selectedElementIds: { [el.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY, // entra no desfazer
  })
  api.setActiveTool({ type: 'selection' })
}

// ponytail: o menu "Mais ferramentas" do pacote não é extensível — clonamos o item "Web Embed"
// quando o dropdown aparece (mesmo truque do i18n.js). Some sozinho se o pacote mudar as classes.
export function instalarMenuDados(getApi) {
  const mo = new MutationObserver(() => {
    const menu = document.querySelector('.App-toolbar__extra-tools-dropdown')
    if (!menu || menu.querySelector('[data-ray-dados]')) return
    const itens = [...menu.querySelectorAll('.dropdown-menu-item')]
    const modelo = itens.find((b) => /embed/i.test(b.textContent)) ?? itens[0]
    if (!modelo) return
    const b = modelo.cloneNode(true)
    b.dataset.rayDados = '1'
    b.classList.remove('dropdown-menu-item--selected')
    b.querySelector('.dropdown-menu-item__icon').innerHTML = ICONE
    b.querySelector('.dropdown-menu-item__text').textContent = 'Widget de dados'
    b.querySelector('.dropdown-menu-item__shortcut')?.remove()
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      inserirWidgetDados(getApi())
      document.querySelector('.App-toolbar__extra-tools-trigger')?.click() // fecha o dropdown
    })
    modelo.after(b)
  })
  mo.observe(document.body, { childList: true, subtree: true })
  return () => mo.disconnect()
}
