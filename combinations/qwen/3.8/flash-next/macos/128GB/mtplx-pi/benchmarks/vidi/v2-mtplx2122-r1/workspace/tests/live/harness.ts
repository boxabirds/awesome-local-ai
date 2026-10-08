/**
 * Live-sync harness (story 3).
 *
 * Browsers are not required: these tests drive the *real* `WebsocketProvider`
 * (the one `connectBoard` uses) against the *real* Worker + `BoardRoom`
 * Durable Object running in workerd, started on an ephemeral port.  Same
 * runtime, same relay code and same client provider as the browser e2e run;
 * what is missing is the DOM.
 *
 * Outages are simulated at the transport level: every client connects through
 * its own raw TCP proxy, and `cutLink()` destroys the pipe while keeping the
 * proxy listening (it refuses connections while "offline").  From the
 * provider's point of view that is a network drop: `close` fires, the state
 * machine goes to `reconnecting`, and reconnection happens on its own once the
 * link is restored — the same shape as `context.setOffline(true)` in the
 * browser test.
 *
 * Everything is eventual: waits are time-bounded polls, and per-change
 * propagation time is recorded and reported (never asserted) because the model,
 * the runtime and the clocks share one machine.
 */
import { createServer, connect, type AddressInfo, type Socket } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Miniflare } from 'miniflare'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { connectBoard, ROOM_PATH, type BoardConnection, type ConnectionState } from '../../src/client/sync/connectBoard'
import { initDoc, snapshot } from '../../src/shared/board-model'
import { LIVE_UPDATE_LATENCY_BUDGET_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config'

const ROOT = path.resolve(import.meta.dirname, '../..')
const WORKER_BUNDLE = path.join(ROOT, '.tmp', 'e2e-worker', 'index.mjs')

/** Generous functional wait; latency is reported, never asserted. */
export const LIVE_TIMEOUT_MS = 20_000

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port)
    })
  })
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port
      probe.close(() => resolve(port))
    })
  })
}

// ── server ───────────────────────────────────────────────────────────────────

export interface Link {
  /** Proxy `ws://127.0.0.1:<proxyPort>/api/rooms` in front of the Worker.
   *  While `offline`, the proxy accepts nothing and drops every socket. */
  readonly proxyPort: number
  /** Accepted TCP connections so far (1 = the socket never reconnected). */
  connectionCount(): number
  isOffline(): boolean
  /** Cut the link and keep it cut (new connections are refused). */
  cut(): void
  /** Allow connections again (the provider reconnects on its own). */
  restore(): void
  /** One-shot drop: kill the current pipe, keep the port usable. */
  drop(): void
  close(): void
}

export interface LiveServer {
  readonly port: number
  /** The workerd origin, bypassing any proxy link. */
  readonly uri: string
  openLink(): Promise<Link>
  close(): Promise<void>
}

/** Start workerd with the bundled Worker + one BoardRoom namespace. */
export async function startLiveServer(): Promise<LiveServer> {
  if (!existsSync(WORKER_BUNDLE)) {
    throw new Error(`missing ${path.relative(ROOT, WORKER_BUNDLE)} — run \`node tools/build-e2e-worker.mjs\` first`)
  }
  const port = await freePort()
  const mf = new Miniflare({
    host: '127.0.0.1',
    port,
    verbose: false,
    modules: true,
    script: readFileSync(WORKER_BUNDLE, 'utf8'),
    compatibilityDate: '2025-02-14',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: {
      BOARD_ROOM: { className: 'BoardRoom', useSQLite: true },
    },
  })
  await mf.ready

  const links: Link[] = []
  return {
    port,
    uri: `ws://127.0.0.1:${port}/api/rooms`,
    async openLink() {
      const link = await startLink(port)
      links.push(link)
      return link
    },
    async close() {
      for (const link of links) link.close()
      await mf.dispose()
    },
  }
}

/** A raw TCP forwarder in front of `backendPort`, with an on/off switch. */
async function startLink(backendPort: number): Promise<Link> {
  const sockets = new Set<Socket>()
  let offline = false
  let connections = 0

  const listener = createServer(socket => {
    sockets.add(socket)
    if (offline) {
      socket.destroy()
      return
    }
    connections += 1
    // Pause first: the bytes of the HTTP Upgrade request that already arrived
    // must not be dropped before the upstream socket exists.
    socket.pause()
    const up = connect({ host: '127.0.0.1', port: backendPort }, () => {
      sockets.add(up)
      socket.pipe(up)
      up.pipe(socket)
    })
    up.on('error', () => socket.destroy())
    socket.on('error', () => up.destroy())
    socket.on('close', () => {
      sockets.delete(socket)
      sockets.delete(up)
    })
  })
  const proxyPort = await listen(listener)

  const destroyPipes = () => {
    for (const socket of sockets) socket.destroy()
    sockets.clear()
  }

  return {
    proxyPort,
    isOffline: () => offline,
    connectionCount: () => connections,
    cut() {
      offline = true
      destroyPipes()
    },
    restore() {
      offline = false
    },
    drop() {
      destroyPipes()
    },
    close() {
      destroyPipes()
      listener.close()
    },
  }
}

// ── clients ──────────────────────────────────────────────────────────────────

export interface LiveClient {
  readonly name: string
  readonly doc: Y.Doc
  /** The very provider `connectBoard` uses (one provider per client). */
  readonly provider: WebsocketProvider
  readonly connection: BoardConnection
  readonly link: Link
  /** WebSocket connections opened so far (1 = no reconnect happened). */
  socketConnections(): number
  /** Every `ConnectionState` this client has been in, oldest first. */
  readonly states: ConnectionState[]
  state(): ConnectionState
  /** Cut this client's network and keep it cut. */
  goOffline(): void
  /** Bring the network back; the provider reconnects on its own. */
  reconnect(): void
  /** One-shot drop: the socket dies, the way a flaky access point drops it. */
  dropLink(): void
  destroy(): void
}

export async function connectClient(
  server: LiveServer,
  boardId: string,
  name: string,
): Promise<LiveClient> {
  const link = await server.openLink()
  const uri = `ws://127.0.0.1:${link.proxyPort}${ROOM_PATH}`
  const doc = new Y.Doc()
  initDoc(doc)
  const provider = new WebsocketProvider(uri, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  })
  const states: ConnectionState[] = []
  const connection = connectBoard(doc, boardId, state => states.push(state), { provider })
  return {
    name,
    doc,
    provider,
    connection,
    link,
    states,
    socketConnections: () => link.connectionCount(),
    state: () => connection.getState(),
    goOffline() {
      link.cut()
    },
    reconnect() {
      link.restore()
      // Do not wait out the backoff clock for the first attempt.
      provider.connect()
    },
    dropLink() {
      link.drop()
    },
    destroy() {
      connection.destroy()
      provider.destroy()
      doc.destroy()
      link.close()
    },
  }
}

/** Open `count` clients on the same board (names `p0`…`pN`). */
export async function connectClients(
  server: LiveServer,
  boardId: string,
  count: number,
): Promise<LiveClient[]> {
  const clients: LiveClient[] = []
  for (let index = 0; index < count; index++) {
    clients.push(await connectClient(server, boardId, `p${index}`))
  }
  return clients
}

// ── waiting and converging ───────────────────────────────────────────────────

/** Poll `check` until it is true, or fail after `timeout` ms. */
export async function waitUntil(
  check: () => boolean,
  message: string,
  timeout = LIVE_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeout}ms waiting for ${message}`)
    await sleep(20)
  }
}

/** What the board looks like on one screen (id → position, colour, text). */
export function boardContent(doc: Y.Doc): string {
  return JSON.stringify(
    snapshot(doc)
      .map(note => [note.id, note.x, note.y, note.color, note.text])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  )
}

export function allSynced(clients: readonly LiveClient[]): boolean {
  return clients.every(client => client.provider.synced === true)
}

/** True when every client is synced *and* renders the same board. */
export function converged(clients: readonly LiveClient[]): boolean {
  if (!allSynced(clients)) return false
  const [first] = clients
  if (first === undefined) return true
  const reference = boardContent(first.doc)
  return clients.every(client => boardContent(client.doc) === reference)
}

/** Wait until every client is synced and shows the identical board. */
export async function waitForConvergence(
  clients: readonly LiveClient[],
  message = 'boards to converge',
  timeout = LIVE_TIMEOUT_MS,
): Promise<void> {
  await waitUntil(() => converged(clients), message, timeout)
}

// ── latency bookkeeping ──────────────────────────────────────────────────────

export interface LatencySample {
  label: string
  ms: number
}

export class LatencyLog {
  readonly samples: LatencySample[] = []

  /** Wait for `label` to be visible on every client, and record how long it took. */
  async record(label: string, clients: readonly LiveClient[], timeout = LIVE_TIMEOUT_MS): Promise<number> {
    const started = Date.now()
    await waitForConvergence(clients, label, timeout)
    const ms = Date.now() - started
    this.samples.push({ label, ms })
    return ms
  }

  /** Report p50/p95/max against the budget.  Reported, never asserted. */
  report(): string {
    if (this.samples.length === 0) return 'latency: no samples'
    const durations = this.samples.map(sample => sample.ms).sort((a, b) => a - b)
    const at = (fraction: number) =>
      durations[Math.min(durations.length - 1, Math.ceil(fraction * durations.length) - 1)]
    const over = this.samples.filter(sample => sample.ms > LIVE_UPDATE_LATENCY_BUDGET_MS)
    return (
      `latency: ${this.samples.length} changes; p50=${at(0.5)}ms p95=${at(0.95)}ms ` +
      `max=${durations[durations.length - 1]}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, reported only); ` +
      `${over.length} over budget` +
      (over.length === 0
        ? ''
        : `\n${over.map(sample => `  over budget: ${sample.label} → ${sample.ms}ms`).join('\n')}`)
    )
  }
}
