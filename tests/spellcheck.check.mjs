// Prova que o corretor do Windows responde em pt-BR dentro deste Electron: digita palavra errada num
// textarea, dá botão direito e confere o que o evento context-menu entrega. `npx electron tests/spellcheck.check.mjs`
import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 400, height: 300 })
  win.webContents.session.setSpellCheckerLanguages(['pt-BR', 'en-US'])
  win.webContents.on('console-message', (_e, _l, m) => console.error('[pág]', m))
  await win.loadURL('data:text/html,<textarea autofocus style="width:300px;height:200px"></textarea>')
  const params = new Promise((res) => win.webContents.once('context-menu', (_e, p) => res(p)))
  win.webContents.focus()
  await win.webContents.executeJavaScript("document.querySelector('textarea').focus()")
  win.webContents.insertText('casa errrada ')
  console.error('digitado')
  await new Promise((r) => setTimeout(r, 3000)) // o corretor é assíncrono
  for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: 75, y: 12, button: 'right', clickCount: 1 })
  console.error('clicado')
  const p = await params
  console.log({ disponiveis: win.webContents.session.availableSpellCheckerLanguages, ligado: win.webContents.session.spellCheckerEnabled, langs: win.webContents.session.getSpellCheckerLanguages(), misspelledWord: p.misspelledWord, sugestoes: p.dictionarySuggestions })
  assert.equal(p.isEditable, true)
  assert.equal(p.misspelledWord, 'errrada')
  assert.ok(p.dictionarySuggestions.includes('errada'))
  console.log('ok')
  app.exit(0)
}).catch((e) => { console.error(e); app.exit(1) })
