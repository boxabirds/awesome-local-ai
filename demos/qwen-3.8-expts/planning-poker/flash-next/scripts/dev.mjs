import { spawn } from 'node:child_process'
import { WS_PORT, WEB_PORT, tcpOpen, isWsServerUp, httpGet, waitForWsServer, log } from './lib.mjs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const children = []

function run(name, cmd, args, { pipe = false, env = {} } = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: pipe ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  children.push(child)
  child.on('exit', (code) => {
    if (!shuttingDown) {
      log('orchestrator', `${name} exited (code ${code}) — shutting everything down`)
      shutdown(code ?? 0)
    }
  })
  return child
}

let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) { try { c.kill('SIGTERM') } catch {} }
  setTimeout(() => process.exit(code), 200)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

async function main() {
  // Children (server + Vite proxy) read these; make sure the defaults the
  // orchestrator probed against are the same ones the children bind/use.
  process.env.WS_PORT = String(WS_PORT)
  process.env.WEB_PORT = String(WEB_PORT)

  // 1. WebSocket game server.
  let serverReused = false
  if (await isWsServerUp(WS_PORT)) {
    log('ws', `a compatible game server is already listening on :${WS_PORT} — reusing it`)
    serverReused = true
  } else if (await tcpOpen(WS_PORT)) {
    log('ws', `: port ${WS_PORT} is occupied by a non-planning-poker service.`)
    log('ws', `  free it (npm run stop) or pick another with WS_PORT=<port> npm run dev. Aborting.`)
    process.exit(1)
  } else {
    log('ws', `starting game server on :${WS_PORT}`)
    run('ws-server', 'node', ['server/server.js'], { pipe: true, env: { PORT: String(WS_PORT) } })
    if (!(await waitForWsServer(WS_PORT))) {
      log('ws', 'server did not become ready in time. Aborting.')
      shutdown(1)
      return
    }
    log('ws', 'game server is up.')
  }

  // 2. Vite dev server (client) — proxy /ws -> WS_PORT.
  const probe = await httpGet(`http://127.0.0.1:${WEB_PORT}/`)
  if (probe && probe.status === 200 && probe.body.includes('id="root"')) {
    log('client', `a Vite client is already serving on :${WEB_PORT} — reusing it`)
    report(`http://localhost:${WEB_PORT}`, serverReused)
    return
  }

  log('client', `starting Vite on :${WEB_PORT} (auto-picks the next free port if busy)`)
  const vite = run('vite', 'npx', ['vite', '--port', String(WEB_PORT)], { pipe: true })
  let announced = false
  const onData = (chunk) => {
    const text = chunk.toString()
    process.stdout.write(text)
    if (!announced) {
      const m = text.match(/http:\/\/localhost:(\d+)/)
      if (m) {
        announced = true
        report(`http://localhost:${m[1]}`, serverReused)
      }
    }
  }
  vite.stdout.on('data', onData)
  vite.stderr.on('data', (c) => process.stderr.write(c.toString()))
}

function report(url, serverReused) {
  const suffix = serverReused ? ' (reusing existing game server)' : ''
  console.log('\n  Dev ready: open ' + url + suffix)
  console.log('  Tip: open a second incognito window and Join with the game code to test multiplayer.\n')
}

main()
