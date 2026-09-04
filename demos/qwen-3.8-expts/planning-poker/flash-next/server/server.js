import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import * as game from './game.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.PORT) || 8788
const EMPTY_ROOM_GRACE_MS = 5 * 60 * 1000
const MAX_ISSUE_TITLE = 500

const rooms = new Map()
const emptyTimers = new Map()

function getQuery(url) {
  return new URL(url, 'http://localhost').searchParams
}

function roomMembers(room) {
  return Object.values(room.members)
}

function broadcast(room) {
  for (const m of roomMembers(room)) {
    const conn = m._conn
    if (conn && conn.readyState === conn.OPEN) {
      conn.send(JSON.stringify({ type: 'state', state: game.publicView(room, m.id) }))
    }
  }
}

function touchEmptyTimer(roomId, room) {
  const anyConnected = roomMembers(room).some((m) => m.connected)
  if (anyConnected) return
  if (emptyTimers.has(roomId)) return
  const timer = setTimeout(() => {
    rooms.delete(roomId)
    emptyTimers.delete(roomId)
  }, EMPTY_ROOM_GRACE_MS)
  if (typeof timer.unref === 'function') timer.unref()
  emptyTimers.set(roomId, timer)
}

function handleAction(room, memberId, msg) {
  switch (msg.type) {
    case 'setVote':
      return game.setVote(room, memberId, msg.card)
    case 'reveal':
      if (room.members[memberId]?.role !== game.ROLE.FACILITATOR) return { error: 'not allowed' }
      return { room: game.revealRound(room) }
    case 'reset':
      if (room.members[memberId]?.role !== game.ROLE.FACILITATOR) return { error: 'not allowed' }
      return { room: game.resetRound(room) }
    case 'nextIssue':
      if (room.members[memberId]?.role !== game.ROLE.FACILITATOR) return { error: 'not allowed' }
      return { room: game.advanceIssue(room) }
    case 'selectIssue':
      if (room.members[memberId]?.role !== game.ROLE.FACILITATOR) return { error: 'not allowed' }
      if (typeof msg.index === 'number' && msg.index >= 0 && msg.index < room.issues.length) {
        room.currentIssueIndex = msg.index
        game.resetRound(room)
      }
      return { room }
    case 'addIssue': {
      if (room.members[memberId]?.role !== game.ROLE.FACILITATOR) return { error: 'not allowed' }
      const title = String(msg.title || '').slice(0, MAX_ISSUE_TITLE)
      return game.addIssue(room, title)
    }
    default:
      return { error: `unknown action ${msg.type}` }
  }
}

export function createApp() {
  const server = createServer(async (req, res) => {
    if (process.env.NODE_ENV !== 'production') {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('dev server: use vite')
      return
    }
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    let filePath = normalize(join(ROOT, 'dist', urlPath))
    if (!filePath.startsWith(join(ROOT, 'dist'))) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    try {
      const info = await stat(filePath)
      if (info.isDirectory()) filePath = join(filePath, 'index.html')
    } catch {
      filePath = join(ROOT, 'dist', 'index.html')
    }
    try {
      const body = await readFile(filePath)
      res.writeHead(200, { 'content-type': contentType(filePath) })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })

  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws, req) => {
    ws._alive = true
    ws.on('pong', () => { ws._alive = true })
    const q = getQuery(req.url)
    const roomId = q.get('room')
    const memberId = q.get('memberId')
    const name = (q.get('name') || 'Anonymous').slice(0, 40)
    const role = q.get('role') || game.ROLE.PLAYER
    const isHost = q.get('host') === '1'

    if (!roomId || !memberId) {
      ws.close(4000, 'missing room or member id')
      return
    }

    let room = rooms.get(roomId)
    if (!room) {
      if (!isHost) {
        ws.send(JSON.stringify({ type: 'error', message: 'room not found' }))
        ws.close(4004, 'room not found')
        return
      }
      room = game.createRoom({ id: roomId, hostId: memberId, hostName: name, deckId: q.get('deck') })
      rooms.set(roomId, room)
    } else if (!room.members[memberId]) {
      const roleAsGranted = memberId === room.hostId ? game.ROLE.FACILITATOR : role
      game.joinRoom(room, { id: memberId, name, role: roleAsGranted })
    }

    const member = room.members[memberId]
    if (!member) {
      ws.send(JSON.stringify({ type: 'error', message: 'cannot join' }))
      ws.close(4003, 'cannot join')
      return
    }
    member.connected = true
    if (room.phase === game.PHASE.REVEALED) member.vote = null
    member._conn = ws
    ws._ctx = { roomId, memberId }

    clearTimeout(emptyTimers.get(roomId))
    emptyTimers.delete(roomId)

    broadcast(room)

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      const current = rooms.get(roomId)
      if (!current) return
      const { error } = handleAction(current, memberId, msg)
      if (error) {
        ws.send(JSON.stringify({ type: 'error', message: error }))
        return
      }
      broadcast(current)
    })

    ws.on('close', () => {
      const current = rooms.get(roomId)
      if (!current) return
      const m = current.members[memberId]
      if (m && m._conn === ws) {
        m.connected = false
        if (current.phase === game.PHASE.REVEALED) m.vote = null
      }
      broadcast(current)
      touchEmptyTimer(roomId, current)
    })
  })

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws._alive) { ws.terminate(); continue }
      ws._alive = false
      ws.ping()
    }
  }, 30 * 1000).unref?.()

  return { server, wss, rooms, heartbeat }
}

function contentType(path) {
  const ext = extname(path)
  return ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream'
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const { server } = createApp()
  server.listen(PORT, () => {
    console.log(`server listening on ${PORT} (env=${process.env.NODE_ENV || 'development'})`)
  })
}
