// 화면 확인용 headless Chrome 캡처. 사용법: node scripts/shot.mjs --help
// 외부 의존성 없음 (node 내장 fetch·WebSocket). 띄운 Chrome(PID 트리)과 임시 프로필만 정리한다. 이름으로 끄지 않는다.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const HELP = `Usage: npm run shot -- <url> --out <png> [options]

  --out <png>          capture file (required)
  --phone              390x844 mobile, touch, hover:none
  --width <n> --height <n>   desktop viewport (default 1600x900)
  --wait <ms>          wait after load before steps/capture (default 6000)
  --allow-writes       do not stub non-GET /api requests (default: answered with fake 200 '{}')
  --port <n>           Chrome debugging port (default: a free port)
  --eval "<js>"        run in the page just before the final capture, print the result as JSON
  --steps <json file>  [{ "type": "click"|"drag"|"key"|"eval"|"wait"|"shot", ... }] run in order after the wait
      click  { "selector": "css" } or { "x": 10, "y": 20 }
      drag   { "from": "css" | [x,y] | {x,y}, "to": same }
      key    { "key": "Escape" }  modifiers: "Ctrl+Shift+F"
      eval   { "js": "document.title" }
      wait   { "ms": 500 }
      shot   { "out": "mid.png" }
Order: load -> wait -> steps -> --eval -> final capture.
Console errors and exceptions are listed at the end (exit code stays 0). Failures exit 1.`

function parseArgs(argv) {
  const o = { url: null, out: null, phone: false, width: 1600, height: 900, wait: 6000, allowWrites: false, port: 0, eval: null, steps: null, help: false }
  const need = (i, n) => {
    if (i + 1 >= argv.length) throw new Error(`${n} needs a value`)
    return argv[i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') o.help = true
    else if (a === '--phone') o.phone = true
    else if (a === '--allow-writes') o.allowWrites = true
    else if (a === '--out') o.out = need(i++, a)
    else if (a === '--width') o.width = Number(need(i++, a))
    else if (a === '--height') o.height = Number(need(i++, a))
    else if (a === '--wait') o.wait = Number(need(i++, a))
    else if (a === '--port') o.port = Number(need(i++, a))
    else if (a === '--eval') o.eval = need(i++, a)
    else if (a === '--steps') o.steps = need(i++, a)
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else if (!o.url) o.url = a
    else throw new Error(`unexpected argument ${a}`)
  }
  for (const k of ['width', 'height', 'wait', 'port']) if (!Number.isFinite(o[k]) || o[k] < 0) throw new Error(`--${k} must be a number`)
  return o
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })
}

// 정리: 띄운 Chrome PID 트리만 끄고 프로필 폴더를 지운다. 여러 번 불려도 한 번만 한다.
let chromePid = null
let profileDir = null
let cleaned = false
function cleanup() {
  if (cleaned) return
  cleaned = true
  if (chromePid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chromePid), '/T', '/F'], { stdio: 'ignore' })
    else {
      try {
        process.kill(chromePid, 'SIGKILL')
      } catch {}
    }
  }
  if (profileDir) {
    for (let i = 0; i < 15; i++) {
      try {
        rmSync(profileDir, { recursive: true, force: true })
      } catch {}
      if (!existsSync(profileDir)) break
      sleepSync(400)
    }
    if (existsSync(profileDir)) console.error(`warning: could not delete profile folder ${profileDir}`)
  }
}
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sig, () => {
    cleanup()
    process.exit(130)
  })
}
process.on('uncaughtException', (e) => {
  console.error(`error: ${e?.stack ?? e}`)
  cleanup()
  process.exit(1)
})
process.on('unhandledRejection', (e) => {
  console.error(`error: ${e?.stack ?? e}`)
  cleanup()
  process.exit(1)
})

function connectCdp(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = new Map()
    const handlers = new Map()
    const api = {
      send(method, params = {}) {
        return new Promise((ok, fail) => {
          const n = ++id
          pending.set(n, { ok, fail, method })
          ws.send(JSON.stringify({ id: n, method, params }))
        })
      },
      on(method, fn) {
        handlers.set(method, [...(handlers.get(method) ?? []), fn])
      },
    }
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data))
      if (m.id) {
        const p = pending.get(m.id)
        pending.delete(m.id)
        if (!p) return
        if (m.error) p.fail(new Error(`${p.method}: ${m.error.message}`))
        else p.ok(m.result)
      } else for (const fn of handlers.get(m.method) ?? []) fn(m.params)
    }
    ws.onopen = () => res(api)
    ws.onerror = () => rej(new Error('CDP websocket error'))
    ws.onclose = () => {
      for (const p of pending.values()) p.fail(new Error('CDP connection closed'))
      pending.clear()
    }
  })
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.help) {
    console.log(HELP)
    return
  }
  if (!o.url || !o.out) throw new Error('url and --out are required (see --help)')
  if (!existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`)
  const steps = o.steps ? JSON.parse(readFileSync(o.steps, 'utf8')) : []
  if (!Array.isArray(steps)) throw new Error('--steps file must be a JSON array')

  const port = o.port || (await freePort())
  profileDir = mkdtempSync(join(tmpdir(), 'pray-shot-'))
  const w = o.phone ? 390 : o.width
  const h = o.phone ? 844 : o.height
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      `--window-size=${w},${h}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  )
  chromePid = child.pid ?? null
  child.on('error', (e) => {
    console.error(`error: Chrome failed to start: ${e.message}`)
    cleanup()
    process.exit(1)
  })
  console.error(`chrome pid ${chromePid}, port ${port}, profile ${profileDir}`)

  // DevTools 가 뜰 때까지
  let target = null
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch {}
    if (!target) await sleep(150)
  }
  if (!target) throw new Error('Chrome DevTools did not start')

  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  const problems = []
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails
    problems.push(`exception: ${d.exception?.description ?? d.text} (${d.url ?? ''}:${d.lineNumber ?? ''})`)
  })
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') problems.push(`console.error: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`)
  })
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error') problems.push(`log: ${p.entry.text} ${p.entry.url ?? ''}`)
  })
  if (!o.allowWrites) {
    cdp.on('Fetch.requestPaused', (p) => {
      const stub = p.request.method !== 'GET' && new URL(p.request.url).pathname.startsWith('/api')
      const send = stub
        ? cdp.send('Fetch.fulfillRequest', {
            requestId: p.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from('{}').toString('base64'),
          })
        : cdp.send('Fetch.continueRequest', { requestId: p.requestId })
      send.catch(() => {})
      if (stub) console.error(`stubbed ${p.request.method} ${new URL(p.request.url).pathname}`)
    })
  }

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  if (!o.allowWrites) await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: o.phone ? 2 : 1, mobile: o.phone })
  if (o.phone) {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }] })
  }

  const nav = await cdp.send('Page.navigate', { url: o.url })
  if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText} (${o.url})`)
  await sleep(o.wait)

  const evalJs = async (js) => {
    const r = await cdp.send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result.value
  }
  const shoot = async (file) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const abs = resolve(file)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, Buffer.from(data, 'base64'))
    console.log(`saved ${abs}`)
  }
  const point = async (spec) => {
    if (typeof spec === 'string') spec = { selector: spec }
    if (Array.isArray(spec)) return { x: spec[0], y: spec[1] }
    if (spec.selector) {
      const p = await evalJs(
        `(()=>{const e=document.querySelector(${JSON.stringify(spec.selector)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
      )
      if (!p) throw new Error(`selector not found: ${spec.selector}`)
      return p
    }
    return { x: spec.x, y: spec.y }
  }
  const mouse = (type, p, extra = {}) =>
    cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1, ...extra })

  for (const [i, s] of steps.entries()) {
    const tag = `step ${i + 1} (${s.type})`
    if (s.type === 'click') {
      const p = await point(s.selector ? { selector: s.selector } : s)
      await mouse('mouseMoved', p, { button: 'none', clickCount: 0 })
      await mouse('mousePressed', p)
      await mouse('mouseReleased', p)
    } else if (s.type === 'drag') {
      const a = await point(s.from)
      const b = await point(s.to)
      await mouse('mouseMoved', a, { button: 'none', clickCount: 0 })
      await mouse('mousePressed', a)
      for (let k = 1; k <= 10; k++)
        await mouse('mouseMoved', { x: a.x + ((b.x - a.x) * k) / 10, y: a.y + ((b.y - a.y) * k) / 10 }, { buttons: 1 })
      await mouse('mouseReleased', b)
    } else if (s.type === 'key') {
      const parts = String(s.key).split('+')
      const key = parts.pop()
      const mods = parts.map((m) => m.toLowerCase())
      const modifiers = (mods.includes('alt') ? 1 : 0) | (mods.includes('ctrl') ? 2 : 0) | (mods.includes('meta') ? 4 : 0) | (mods.includes('shift') ? 8 : 0)
      const single = key.length === 1
      const text = single && !(modifiers & 6) ? key : undefined
      const base = { key, modifiers, ...(single ? { code: /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : undefined, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) } : {}) }
      await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    } else if (s.type === 'eval') {
      console.log(`${tag}: ${JSON.stringify(await evalJs(s.js))}`)
    } else if (s.type === 'wait') {
      await sleep(Number(s.ms) || 0)
    } else if (s.type === 'shot') {
      if (!s.out) throw new Error(`${tag}: out is required`)
      await shoot(s.out)
    } else throw new Error(`${tag}: unknown type`)
    await sleep(150)
  }

  if (o.eval) console.log(JSON.stringify(await evalJs(o.eval), null, 2))
  await shoot(o.out)

  if (problems.length) {
    console.error(`\nconsole errors (${problems.length}):`)
    for (const p of problems) console.error(`  ${p}`)
  } else console.error('\nno console errors')
}

const hardTimer = setTimeout(() => {
  console.error('error: timed out')
  cleanup()
  process.exit(1)
}, 180000)
hardTimer.unref()

main().then(
  () => {
    cleanup()
    process.exit(0)
  },
  (e) => {
    console.error(`error: ${e?.message ?? e}`)
    cleanup()
    process.exit(1)
  },
)
