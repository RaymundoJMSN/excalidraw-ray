// dados.js — expressões de dados: 2d20kh + 10*1d8, 4d6dl, min(1d6,3), d%.
// Roda no navegador (window.rolarDados) e em node (`node dados.js --check`).
;(function (global) {
  const FN = { min: Math.min, max: Math.max, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round }

  function rolar(src, rnd = Math.random) {
    const limpo = String(src).toLowerCase().replace(/\s+/g, '')
    const toks = limpo.match(/\d*d(?:\d+|%)(?:(?:kh|kl|dh|dl)\d*)?|\d+(?:\.\d+)?|[a-z]+|[-+*/(),]/g) || []
    if (!limpo || toks.join('') !== limpo) throw new Error('expressão inválida')
    let i = 0
    const partes = []
    const peek = () => toks[i]
    const next = () => toks[i++]
    const esperar = (t) => { if (next() !== t) throw new Error('faltou ' + t) }

    function expr() {
      let v = termo()
      while (peek() === '+' || peek() === '-') { const op = next(), r = termo(); v = op === '+' ? v + r : v - r }
      return v
    }
    function termo() {
      let v = unario()
      while (peek() === '*' || peek() === '/') { const op = next(), r = unario(); v = op === '*' ? v * r : v / r }
      return v
    }
    function unario() {
      if (peek() === '-') { next(); return -unario() }
      if (peek() === '+') next()
      return primario()
    }
    function primario() {
      const t = next()
      if (t === undefined) throw new Error('expressão incompleta')
      if (t === '(') { const v = expr(); esperar(')'); return v }
      if (/^[a-z]+$/.test(t)) {
        if (!FN[t]) throw new Error('não conheço ' + t)
        esperar('(')
        const args = [expr()]
        while (peek() === ',') { next(); args.push(expr()) }
        esperar(')')
        return FN[t](...args)
      }
      const m = t.match(/^(\d*)d(\d+|%)(?:(kh|kl|dh|dl)(\d*))?$/)
      if (!m) return parseFloat(t)
      const n = +(m[1] || 1), lados = m[2] === '%' ? 100 : +m[2]
      if (n < 1 || n > 1000 || lados < 1) throw new Error('dado inválido: ' + t)
      const rs = Array.from({ length: n }, () => 1 + Math.floor(rnd() * lados))
      let usados = rs.map((_, k) => k)
      if (m[3]) {
        const q = Math.min(n, +(m[4] || 1))
        const ord = [...rs.keys()].sort((a, b) => rs[b] - rs[a]) // índices do maior pro menor
        usados = { kh: ord.slice(0, q), kl: ord.slice(n - q), dh: ord.slice(q), dl: ord.slice(0, n - q) }[m[3]]
      }
      const set = new Set(usados)
      partes.push({ dado: t, lados, rolagens: rs.map((v, k) => ({ v, usado: set.has(k) })) })
      return rs.reduce((s, v, k) => s + (set.has(k) ? v : 0), 0)
    }

    const total = expr()
    if (i < toks.length) throw new Error('sobrou: ' + toks.slice(i).join(''))
    return { total, partes }
  }

  global.rolarDados = rolar

  if (typeof process !== 'undefined' && process.argv && process.argv.includes('--check')) {
    const assert = require('node:assert/strict')
    const seq = (...vs) => { let k = 0; return () => vs[k++ % vs.length] } // rnd determinístico
    const d = (f, ...vs) => rolar(f, seq(...vs))
    assert.equal(d('1d20', 0.5).total, 11)
    assert.equal(d('d20', 0.99).total, 20)
    assert.equal(d('2d6+3', 0, 0.99).total, 1 + 6 + 3)
    assert.equal(d('2d20kh', 0.1, 0.9).total, 19) // 3 e 19, fica o 19
    assert.equal(d('2d20kl', 0.1, 0.9).total, 3)
    assert.equal(d('4d6kh3', 0, 0.5, 0.99, 0.5).total, 4 + 6 + 4) // 1,4,6,4 → tira o 1
    assert.equal(d('4d6dl', 0, 0.5, 0.99, 0.5).total, 14) // mesmo que kh3
    assert.equal(d('3d6dh2', 0, 0.5, 0.99).total, 1)
    assert.equal(d('2d20kh + 10*1d8', 0.1, 0.9, 0.5).total, 19 + 10 * 5)
    assert.equal(d('min(1d6, 3)', 0.99).total, 3)
    assert.equal(d('max(1d6, 3) * 2', 0).total, 6)
    assert.equal(d('-1d4 + 10', 0.5).total, 7)
    assert.equal(d('(1d6+1)*2', 0.5).total, 10)
    assert.equal(d('d%', 0.5).total, 51)
    assert.equal(d('3 + 4 * 2', 0).total, 11)
    assert.equal(d('2d20kh', 0.1, 0.9).partes[0].rolagens.filter((r) => r.usado).length, 1)
    for (const ruim of ['', 'abc', '1d', '2d6+', 'foo(1)', '1d6)', '(1d6', '1d0', 'rm -rf'])
      assert.throws(() => d(ruim, 0.5), ruim || '(vazio)')
    console.log('dados.js: ok')
  }
})(typeof window !== 'undefined' ? window : globalThis)
