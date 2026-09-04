import { spawnSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tcpOpen, isWsServerUp, waitForWsServer, log } from './lib.mjs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const PORT = Number(process.env.PORT || 8788)
let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) { try { c.kill('SIGTERM') } catch {} }
  setTimeout(() => process.exit(code), 200)
}
const children = []
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

if (!existsSync(`${ROOT}/dist/index.html`) && process.env.SKIP_BUILD !== '1') {
  log('build', 'no dist/ found — running production build first…')
  const build = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' })
  if (build.status !== 0) {
    log('build', 'build failed')
    process.exit(build.status ?? 1)
  }
}

async function main() {
  if (await isWsServerUp(PORT)) {
    log('prod', `a compatible server already listens on :${PORT} — assuming it serves the app. Nothing to start.`)
    return
  }
  if (await tcpOpen(PORT)) {
    log('prod', `: port ${PORT} is occupied by a non-planning-poker service. Free it (npm run stop) or set PORT=<port>. Aborting.`)
    process.exit(1)
  }
  log('prod', `starting production server on :${PORT} (serves dist/ + WebSocket)`)
  const child = spawn('node', ['server/server.js'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: 'inherit',
  })
  children.push(child)
  child.on('exit', (code) => { if (!shuttingDown) { shuttingDown = true; process.exit(code ?? 0) } })

  if (!(await waitForWsServer(PORT, 8000))) {
    log('prod', 'server did not become ready in time. Aborting.')
    shutdown(1)
    return
  }
  console.log(`\n  App ready: http://localhost:${PORT}\n`)
}

main()
