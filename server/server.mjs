// server.mjs — Excalidraw Ray na nuvem: estáticos + cenas por usuário + share view/edit.
// Uso: node server.mjs [--check]   (PORT env, default 8050)
// Padrão manduu-apps: Node stdlib puro, escrita atômica, backup diário 7 dias.
import http from 'node:http'
import crypto from 'node:crypto'
import { readFile, writeFile, rename, mkdir, copyFile, stat, readdir, unlink } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PUB = path.join(ROOT, 'public')
let DATA = process.env.RAY_DATA ?? path.join(ROOT, 'data') // check() repõe pra um tmpdir
const MAX_BODY = 512 * 1024 * 1024 // cena com imagens embutidas chega a 112 MB (medido); igual ao client_max_body_size do nginx
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' }
const ID = /^[a-zA-Z0-9-]{8,40}$/
const USER = /^[a-z0-9-]{1,30}$/

const MAX_SCENES = 300 // por usuário — trava DoS de criação em loop
const idxFile = () => path.join(DATA, 'index.json')
const sceneFile = (id) => path.join(DATA, 'scenes', id + '.excalidraw')
const thumbFile = (id) => path.join(DATA, 'scenes', id + '.thumb')

// vídeo/áudio do canvas: sobe atrelado a uma cena editável (precisa do id de edição, como o PUT), fica em
// media/<uuid>.<ext> e a cena guarda só o link. shortcut: apagar a cena não apaga a mídia; limpar quando pesar.
let MEDIA_MAX = 500 * 1024 * 1024 // check() baixa pra testar o 413

// ---- contas: nome + senha (scrypt) em usuarios.json; sessão = token HMAC sem tabela (como o hub-t20).
// O site manda cookie `ray`, o app do PC manda `Authorization: Bearer`. Cena por id/viewId continua sendo
// capacidade (quem tem o link acessa) — é o compartilhar; só a LISTA de cenas de um usuário exige a conta dele.
const usersFile = () => path.join(DATA, 'usuarios.json')
function segredo() {
  const f = path.join(DATA, 'segredo')
  try { return readFileSync(f, 'utf8').trim() } catch { mkdirSync(DATA, { recursive: true }); const x = crypto.randomBytes(32).toString('hex'); writeFileSync(f, x); return x }
}
function readUsers() { try { return JSON.parse(readFileSync(usersFile(), 'utf8')) } catch { return {} } }
function writeUsers(u) { mkdirSync(DATA, { recursive: true }); writeFileSync(usersFile() + '.tmp', JSON.stringify(u, null, 2)); renameSync(usersFile() + '.tmp', usersFile()) }
const hashSenha = (senha, sal) => crypto.scryptSync(senha, sal, 32).toString('hex')
const token = (nome) => nome + '.' + crypto.createHmac('sha256', segredo()).update(nome).digest('base64url')
function quem(req) { // nome da conta da requisição, ou null
  const t = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1] ?? req.headers.cookie?.match(/(?:^|;\s*)ray=([^;]+)/)?.[1]
  const nome = t?.split('.')[0]
  if (!nome || !USER.test(nome)) return null
  const certo = token(nome)
  return certo.length === t.length && crypto.timingSafeEqual(Buffer.from(certo), Buffer.from(t)) ? nome : null
}
let FREIO_MAX = 8 // senhas erradas por IP antes de 60 s de espera (check() baixa)
const freio = new Map()
const MEDIA_MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/ogg', '.weba': 'audio/webm', '.mpeg': 'audio/mpeg', '.mpg': 'audio/mpeg', '.mpga': 'audio/mpeg' }
const mediaFile = (nome) => path.join(DATA, 'media', path.basename(nome))

async function servirMedia(req, res, nome) { // Range obrigatório: sem 206 o <video> não busca posição
  let size
  try { size = (await stat(mediaFile(nome))).size } catch { res.writeHead(404).end(); return }
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  let start = 0, end = size - 1
  if (m) {
    start = m[1] ? +m[1] : Math.max(0, size - +m[2])
    end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return }
  }
  res.writeHead(m ? 206 : 200, {
    'Content-Type': MEDIA_MIME[path.extname(nome)] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1, 'Cache-Control': 'public, max-age=31536000, immutable', // nome é uuid: nunca muda
    ...(m && { 'Content-Range': `bytes ${start}-${end}/${size}` }),
  })
  createReadStream(mediaFile(nome), { start, end }).pipe(res)
}

function readIndex() {
  try { return JSON.parse(readFileSync(idxFile(), 'utf8')) } catch { return { scenes: {} } }
}
function writeIndex(i) {
  mkdirSync(DATA, { recursive: true })
  writeFileSync(idxFile() + '.tmp', JSON.stringify(i, null, 2))
  renameSync(idxFile() + '.tmp', idxFile())
}

async function backupDaily(file) {
  // 1 backup por dia, mantém 7. ponytail: glob+sort resolve
  const day = new Date().toISOString().slice(0, 10)
  const bak = `${file}.${day}.bak`
  if (!existsSync(bak) && existsSync(file)) {
    await copyFile(file, bak)
    const dir = path.dirname(file), base = path.basename(file)
    const baks = (await readdir(dir)).filter((f) => f.startsWith(base + '.') && f.endsWith('.bak')).sort()
    for (const old of baks.slice(0, -7)) await unlink(path.join(dir, old))
  }
}

async function readBody(req, res) {
  let chunks = [], size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) { res.writeHead(413).end(); return null }
    chunks.push(c)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const json = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj))

async function handleApi(req, res, url) {
  const idx = readIndex()

  if (url.pathname === '/api/entrar' && req.method === 'POST') { // conta nova ou login
    const ip = req.headers['x-real-ip'] ?? req.socket.remoteAddress
    const f = freio.get(ip)
    if (f && f.n >= FREIO_MAX && Date.now() < f.ate) { res.writeHead(429).end('muitas tentativas; espere 1 minuto'); return }
    const raw = await readBody(req, res); if (raw === null) return
    let nome = '', senha = ''
    try { const b = JSON.parse(raw); nome = String(b.nome ?? '').trim().toLowerCase(); senha = String(b.senha ?? '') } catch {}
    if (!USER.test(nome)) { json(res, 400, { error: 'nome inválido (minúsculas, números e hífen)' }); return }
    if (senha.length < 4) { json(res, 400, { error: 'senha com pelo menos 4 caracteres' }); return }
    const users = readUsers()
    let novo = false
    if (!users[nome]) {
      const sal = crypto.randomBytes(16).toString('hex')
      users[nome] = { sal, hash: hashSenha(senha, sal), criado: Date.now() }
      writeUsers(users); novo = true
    } else if (users[nome].hash !== hashSenha(senha, users[nome].sal)) {
      const g = freio.get(ip) ?? { n: 0, ate: 0 }; g.n++; g.ate = Date.now() + 60000; freio.set(ip, g)
      json(res, 401, { error: 'senha errada' }); return
    }
    freio.delete(ip)
    const t = token(nome)
    res.setHeader('Set-Cookie', `ray=${t}; Path=/; Max-Age=15552000; SameSite=Lax; HttpOnly`)
    json(res, 200, { nome, token: t, novo })
    return
  }
  if (url.pathname === '/api/sair' && req.method === 'POST') { res.setHeader('Set-Cookie', 'ray=; Path=/; Max-Age=0'); res.writeHead(204).end(); return }
  if (url.pathname === '/api/eu') { const n = quem(req); if (n) json(res, 200, { nome: n }); else json(res, 401, { error: 'entre na conta' }); return }

  let m = url.pathname.match(/^\/api\/u\/([^/]+)\/scenes$/)
  if (m) {
    const user = m[1]
    if (!USER.test(user)) { json(res, 400, { error: 'usuário inválido' }); return }
    if (quem(req) !== user) { json(res, 401, { error: 'entre na conta' }); return }
    if (req.method === 'GET') {
      const list = Object.entries(idx.scenes).filter(([, s]) => s.owner === user)
        .map(([id, s]) => ({ id, name: s.name, updatedAt: s.updatedAt ?? 0 }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      json(res, 200, list)
      return
    }
    if (req.method === 'POST') {
      if (Object.values(idx.scenes).filter((s) => s.owner === user).length >= MAX_SCENES) { res.writeHead(429).end('limite de cenas'); return }
      const raw = await readBody(req, res); if (raw === null) return
      let name = 'Sem nome'
      try { name = String(JSON.parse(raw).name || name).slice(0, 80) } catch {}
      const id = crypto.randomUUID()
      const viewId = 'v-' + crypto.randomUUID()
      await mkdir(path.join(DATA, 'scenes'), { recursive: true })
      await writeFile(sceneFile(id), JSON.stringify({ type: 'excalidraw', version: 2, source: 'excalidraw-ray', elements: [], appState: { theme: 'dark' }, files: {} }))
      idx.scenes[id] = { name, owner: user, viewId, updatedAt: Date.now() }
      writeIndex(idx)
      json(res, 200, { id, viewId })
      return
    }
    res.writeHead(405).end()
    return
  }

  m = url.pathname.match(/^\/api\/media\/([0-9a-f-]+\.[a-z0-9]+)$/)
  if (m) {
    if (req.method === 'GET') await servirMedia(req, res, m[1])
    else res.writeHead(405).end()
    return
  }

  m = url.pathname.match(/^\/api\/scene\/([^/]+)(\/thumb|\/media)?$/)
  if (m) {
    const ref = m[1]
    const isThumb = m[2] === '/thumb'
    const isMedia = m[2] === '/media'
    if (!ID.test(ref.replace(/^v-/, ''))) { res.writeHead(404).end(); return }
    const viewOf = Object.entries(idx.scenes).find(([, s]) => s.viewId === ref)?.[0]
    const id = idx.scenes[ref] ? ref : viewOf
    const meta = idx.scenes[id]
    if (!meta) { res.writeHead(404).end(); return }
    const readOnly = !idx.scenes[ref] // chegou pelo viewId

    if (isMedia) {
      if (readOnly) { res.writeHead(403).end(); return }
      if (req.method !== 'POST') { res.writeHead(405).end(); return }
      const ext = path.extname(url.searchParams.get('nome') ?? '').toLowerCase()
      if (!MEDIA_MIME[ext]) { res.writeHead(415).end('tipo não aceito'); return }
      const len = Number(req.headers['content-length'])
      if (!len) { res.writeHead(411).end(); return } // sem tamanho não dá pra barrar antes de gravar
      if (len > MEDIA_MAX) { res.writeHead(413).end(); return }
      const nome = crypto.randomUUID() + ext
      await mkdir(path.join(DATA, 'media'), { recursive: true })
      const tmp = mediaFile(nome) + '.tmp'
      try { await pipeline(req, createWriteStream(tmp)); await rename(tmp, mediaFile(nome)) } // streaming: nada de 500 MB em memória
      catch (e) { await unlink(tmp).catch(() => {}); throw e }
      json(res, 200, { url: '/api/media/' + nome })
      return
    }

    if (isThumb) {
      if (req.method === 'GET') {
        let t // lê antes do writeHead: thumb inexistente derrubava o processo (headers já enviados)
        try { t = await readFile(thumbFile(id), 'utf8') } catch { res.writeHead(404).end(); return }
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end(t)
      } else if (readOnly) res.writeHead(403).end()
      else if (req.method === 'PUT' || req.method === 'POST') {
        const raw = await readBody(req, res); if (raw === null) return
        await mkdir(path.join(DATA, 'scenes'), { recursive: true })
        await writeFile(thumbFile(id), raw)
        res.writeHead(204).end()
      } else res.writeHead(405).end()
      return
    }

    if (req.method === 'GET' && url.searchParams.has('meta')) { // poll leve: só a versão, sem baixar a cena
      json(res, 200, { updatedAt: meta.updatedAt ?? 0, name: meta.name })
      return
    }
    if (req.method === 'GET') {
      try {
        const scene = JSON.parse(await readFile(sceneFile(id), 'utf8'))
        json(res, 200, { readOnly, name: meta.name, viewId: readOnly ? undefined : meta.viewId, updatedAt: meta.updatedAt ?? 0, scene })
      } catch { res.writeHead(404).end() }
      return
    }
    if (readOnly) { res.writeHead(403).end() } // viewId nunca escreve
    else if (req.method === 'PUT' || req.method === 'POST') { // POST = alias p/ navigator.sendBeacon no pagehide
      const raw = await readBody(req, res); if (raw === null) return
      try { JSON.parse(raw) } catch { res.writeHead(400).end('invalid json'); return }
      const f = sceneFile(id)
      await backupDaily(f)
      const tmp = f + '.' + crypto.randomUUID() + '.tmp' // tmp único: PUTs concorrentes não se corrompem
      await writeFile(tmp, raw)
      await rename(tmp, f) // escrita atômica
      meta.updatedAt = Math.max(Date.now(), (meta.updatedAt ?? 0) + 1) // estritamente crescente: clientes comparam versões
      writeIndex(idx)
      json(res, 200, { updatedAt: meta.updatedAt })
    } else if (req.method === 'PATCH') {
      const raw = await readBody(req, res); if (raw === null) return
      try { meta.name = String(JSON.parse(raw).name).slice(0, 80) } catch { res.writeHead(400).end(); return }
      writeIndex(idx)
      res.writeHead(204).end()
    } else if (req.method === 'DELETE') {
      delete idx.scenes[id]
      writeIndex(idx)
      await mkdir(path.join(DATA, 'trash'), { recursive: true })
      try { await rename(sceneFile(id), path.join(DATA, 'trash', id + '.excalidraw')) } catch {}
      try { await unlink(thumbFile(id)) } catch {}
      res.writeHead(204).end()
    } else res.writeHead(405).end()
    return
  }

  res.writeHead(404).end()
}

async function handleStatic(req, res, urlPath) {
  // rotas de app (/d/:id, /v/:viewId) servem o shell
  if (/^\/(d|v)\//.test(urlPath)) urlPath = '/index.html'
  let dec
  try { dec = decodeURIComponent(urlPath) } catch { res.writeHead(404).end(); return } // %zz malformado
  let p = path.normalize(path.join(PUB, dec))
  if (p !== PUB && !p.startsWith(PUB + path.sep)) { res.writeHead(404).end(); return } // path traversal
  try {
    if ((await stat(p)).isDirectory()) p = path.join(p, 'index.html')
  } catch { /* cai no readFile 404 */ }
  try {
    const body = await readFile(p)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream', 'Cache-Control': p.includes(`${path.sep}assets${path.sep}`) || p.includes(`${path.sep}fonts${path.sep}`) ? 'public, max-age=604800' : 'no-cache' }).end(body)
  } catch { res.writeHead(404).end('não achei :(') }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x')
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url)
      else if (req.method === 'GET') await handleStatic(req, res, url.pathname)
      else res.writeHead(405).end()
    } catch (e) { console.error(e); res.writeHead(500).end() }
  })
}

async function check() {
  DATA = await mkdtemp(path.join(tmpdir(), 'ray-server-check-')) // nunca toca ./data/
  const srv = createServer()
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${srv.address().port}`
  const j = (r) => r.json()

  // contas
  assert.equal((await fetch(`${base}/api/u/ray/scenes`)).status, 401, 'lista exige conta')
  assert.equal((await fetch(`${base}/api/entrar`, { method: 'POST', body: JSON.stringify({ nome: 'Ray Inválido', senha: '1234' }) })).status, 400, 'nome inválido')
  assert.equal((await fetch(`${base}/api/entrar`, { method: 'POST', body: JSON.stringify({ nome: 'ray', senha: '123' }) })).status, 400, 'senha curta')
  const entrou = await fetch(`${base}/api/entrar`, { method: 'POST', body: JSON.stringify({ nome: 'ray', senha: 'segredo1' }) })
  const conta = await entrou.json()
  assert.deepEqual([conta.nome, conta.novo, !!conta.token], ['ray', true, true], 'nome novo cria a conta')
  assert.match(entrou.headers.get('set-cookie') ?? '', /^ray=ray\.[A-Za-z0-9_-]+; Path=\/; Max-Age=\d+; SameSite=Lax; HttpOnly$/, 'cookie de sessão')
  assert.equal((await fetch(`${base}/api/entrar`, { method: 'POST', body: JSON.stringify({ nome: 'ray', senha: 'errada1' }) })).status, 401, 'senha errada')
  const deNovo = await fetch(`${base}/api/entrar`, { method: 'POST', body: JSON.stringify({ nome: 'ray', senha: 'segredo1' }) }).then(j)
  assert.deepEqual([deNovo.nome, deNovo.novo, deNovo.token], ['ray', false, conta.token], 'login de novo: mesma conta, mesmo token')
  const H = { Authorization: 'Bearer ' + conta.token }, C = { Cookie: 'ray=' + conta.token }
  assert.deepEqual(await fetch(`${base}/api/eu`, { headers: C }).then(j), { nome: 'ray' }, '/api/eu pelo cookie')
  assert.equal((await fetch(`${base}/api/eu`, { headers: { Cookie: 'ray=ray.adulterado' } })).status, 401, 'token adulterado')
  assert.equal((await fetch(`${base}/api/u/outro/scenes`, { headers: H })).status, 401, 'conta de um não lista a do outro')
  FREIO_MAX = 2
  for (let i = 0; i < 2; i++) await fetch(`${base}/api/entrar`, { method: 'POST', body: JSON.stringify({ nome: 'ray', senha: 'errada2' }) })
  assert.equal((await fetch(`${base}/api/entrar`, { method: 'POST', body: JSON.stringify({ nome: 'ray', senha: 'segredo1' }) })).status, 429, 'freio depois de N senhas erradas')
  freio.clear(); FREIO_MAX = 8

  assert.deepEqual(await fetch(`${base}/api/u/ray/scenes`, { headers: H }).then(j), [], 'lista vazia')
  const { id, viewId } = await fetch(`${base}/api/u/ray/scenes`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Teste' }) }).then(j)
  assert.ok(id && viewId, 'create devolve id+viewId')
  assert.equal((await fetch(`${base}/api/u/ray/scenes`, { headers: C }).then(j)).length, 1, 'lista com 1 (pelo cookie também)')

  const scene = { type: 'excalidraw', version: 2, elements: [{ type: 'rectangle', id: 'r1' }], appState: {}, files: {} }
  const put = await fetch(`${base}/api/scene/${id}`, { method: 'PUT', body: JSON.stringify(scene) })
  assert.equal(put.status, 200, 'PUT ok')
  const { updatedAt } = await put.json()
  assert.ok(updatedAt > 0, 'PUT devolve updatedAt')
  assert.equal((await fetch(`${base}/api/scene/${id}?meta=1`).then(j)).updatedAt, updatedAt, 'meta devolve updatedAt')
  const got = await fetch(`${base}/api/scene/${id}`).then(j)
  assert.equal(got.readOnly, false, 'edit id não é readOnly')
  assert.deepEqual(got.scene, scene, 'round-trip')
  assert.equal(got.viewId, viewId, 'edit devolve viewId')

  const view = await fetch(`${base}/api/scene/${viewId}`).then(j)
  assert.equal(view.readOnly, true, 'viewId é readOnly')
  assert.deepEqual(view.scene, scene, 'viewId lê a mesma cena')
  assert.equal(view.viewId, undefined, 'viewId não vaza na resposta view')
  assert.equal((await fetch(`${base}/api/scene/${viewId}`, { method: 'PUT', body: JSON.stringify(scene) })).status, 403, 'viewId nunca escreve')

  assert.equal((await fetch(`${base}/api/scene/${id}`, { method: 'POST', body: JSON.stringify(scene) })).status, 200, 'POST alias de PUT (sendBeacon)')

  assert.equal((await fetch(`${base}/api/scene/${id}/thumb`)).status, 404, 'thumb inexistente 404 (sem derrubar)')
  assert.equal((await fetch(`${base}/api/scene/${id}/thumb`, { method: 'PUT', body: 'data:image/webp;base64,xyz' })).status, 204, 'thumb PUT')
  assert.equal(await fetch(`${base}/api/scene/${id}/thumb`).then((r) => r.text()), 'data:image/webp;base64,xyz', 'thumb round-trip')
  assert.equal(await fetch(`${base}/api/scene/${viewId}/thumb`).then((r) => r.status), 200, 'thumb legível pelo viewId')
  assert.equal((await fetch(`${base}/api/scene/${viewId}/thumb`, { method: 'PUT', body: 'x' })).status, 403, 'viewId não escreve thumb')

  const grande = JSON.stringify({ ...scene, files: { f1: { dataURL: 'x'.repeat(25 * 1024 * 1024) } } }) // acima dos 20 MB antigos
  assert.equal((await fetch(`${base}/api/scene/${id}`, { method: 'PUT', body: grande })).status, 200, 'cena de 25 MB entra')
  assert.equal((await fetch(`${base}/api/scene/${id}`, { method: 'PUT', body: 'lixo' })).status, 400, 'json inválido 400')
  assert.deepEqual((await fetch(`${base}/api/scene/${id}`).then(j)).scene, scene, 'inválido não corrompe')

  assert.equal((await fetch(`${base}/api/scene/${id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Novo nome' }) })).status, 204, 'rename')
  assert.equal((await fetch(`${base}/api/u/ray/scenes`, { headers: H }).then(j))[0].name, 'Novo nome')

  assert.equal((await fetch(`${base}/api/u/Traversal..%2F/scenes`)).status, 400, 'usuário inválido 400')
  assert.equal((await fetch(`${base}/api/scene/..%2F..%2Fetc`)).status, 404, 'id inválido 404')
  assert.equal((await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).status, 404, 'traversal estático 404')

  // mídia: upload atrelado à cena editável; GET com Range (vídeo buscando posição)
  const bytes = Buffer.from('0123456789abcdef')
  const up = (ref, nome, body = bytes) => fetch(`${base}/api/scene/${ref}/media?nome=${nome}`, { method: 'POST', body })
  assert.equal((await up(viewId, 'a.mp4')).status, 403, 'viewId não sobe mídia')
  assert.equal((await up(id, 'a.exe')).status, 415, 'extensão fora da lista')
  MEDIA_MAX = 8
  assert.equal((await up(id, 'a.mp4')).status, 413, 'maior que o limite')
  MEDIA_MAX = 500 * 1024 * 1024
  const { url: murl } = await up(id, 'Filme.MP4').then(j)
  assert.match(murl, /^\/api\/media\/[0-9a-f-]+\.mp4$/, 'url com uuid + extensão minúscula')
  const g = await fetch(base + murl)
  assert.equal(g.status, 200)
  assert.equal(g.headers.get('content-type'), 'video/mp4')
  assert.equal(Buffer.compare(Buffer.from(await g.arrayBuffer()), bytes), 0, 'round-trip dos bytes')
  const rg = await fetch(base + murl, { headers: { Range: 'bytes=4-7' } })
  assert.equal(rg.status, 206)
  assert.equal(rg.headers.get('content-range'), 'bytes 4-7/16')
  assert.equal(await rg.text(), '4567', 'range do meio')
  assert.equal(await fetch(base + murl, { headers: { Range: 'bytes=-3' } }).then((r) => r.text()), 'def', 'range sufixo')
  assert.equal(await fetch(base + murl, { headers: { Range: 'bytes=14-99' } }).then((r) => r.text()), 'ef', 'fim além do arquivo é cortado')
  assert.equal((await fetch(base + murl, { headers: { Range: 'bytes=99-' } })).status, 416)
  assert.equal((await fetch(`${base}/api/media/nao-existe.mp4`)).status, 404)
  assert.equal((await fetch(`${base}/api/media/..%2Findex.json`)).status, 404, 'nome fora do padrão')

  assert.equal((await fetch(`${base}/api/scene/${id}`, { method: 'DELETE' })).status, 204, 'delete')
  assert.deepEqual(await fetch(`${base}/api/u/ray/scenes`, { headers: H }).then(j), [], 'lista vazia após delete')
  assert.equal((await fetch(`${base}/api/scene/${id}`)).status, 404, 'cena deletada 404')

  srv.close()
  await rm(DATA, { recursive: true, force: true })
  console.log('server self-check OK')
}

if (process.argv.includes('--check')) check()
else {
  const port = Number(process.env.PORT ?? 8050)
  createServer().listen(port, () => console.log(`excalidraw-ray na porta ${port}`))
}
