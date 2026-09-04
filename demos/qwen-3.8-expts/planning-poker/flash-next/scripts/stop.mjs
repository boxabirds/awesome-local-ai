import { execSync } from 'node:child_process'
import { WS_PORT, WEB_PORT, log } from './lib.mjs'

const MARKERS = ['server/server.js', 'server.js', 'vite']

function listeningPids(port) {
  try {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' })
    return out.split('\n').map((s) => s.trim()).filter(Boolean).map(Number)
  } catch {
    return []
  }
}

function commandOf(pid) {
  try {
    return execSync(`ps -o command= -p ${pid}`, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function freePort(port) {
  const pids = listeningPids(port)
  if (pids.length === 0) {
    log('stop', `:${port} is already free`)
    return
  }
  for (const pid of pids) {
    const cmd = commandOf(pid)
    if (MARKERS.some((m) => cmd.includes(m))) {
      try {
        process.kill(pid, 'SIGTERM')
        log('stop', `killed pid ${pid} on :${port} (${cmd.slice(0, 60)})`)
      } catch (e) {
        log('stop', `could not kill pid ${pid}: ${e.message}`)
      }
    } else if (cmd) {
      log('stop', `: leaving pid ${pid} on :${port} untouched — not our stack (${cmd.slice(0, 60)})`)
    }
  }
}

log('stop', 'freeing ports for our stack (leaves foreign services alone)…')
freePort(WS_PORT)
freePort(WEB_PORT)
log('stop', 'done.')
