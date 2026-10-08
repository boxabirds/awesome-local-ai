/**
 * Nightly soak tests (task 3.9), provider level — no browser needed.
 *
 * The two long-running nightly contracts, run without a DOM so they also work
 * in a sandbox: idle connection stability (TC-29 analogue) and convergence at
 * capacity with a latency report (TC-30 analogue).  The Playwright versions in
 * `tests/e2e-nightly/` assert the same things through the real UI.
 *
 * They are skipped unless `VIDI6_NIGHTLY=1`, so `npm run test:live` stays fast:
 *
 *     npm run test:nightly          # ≈ 2 minutes
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  LatencyLog,
  boardContent,
  connectClients,
  sleep,
  startLiveServer,
  waitForConvergence,
  type LiveClient,
  type LiveServer,
} from './harness'
import { applyRandomOp, createRng } from '../integration/random-ops'
import { createSticky } from '../../src/shared/board-model'
import { newBoardId } from '../../src/shared/board-id'
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config'

const NIGHTLY = process.env.VIDI6_NIGHTLY === '1'

/** Four times the 10 s idle window y-websocket tolerates before it recycles a socket. */
const IDLE_MS = Number(process.env.NIGHTLY_IDLE_MS ?? 45_000)
const SOAK_MS = Number(process.env.NIGHTLY_SOAK_MS ?? 60_000)
const SEED = Number(process.env.NIGHTLY_SEED ?? 20261008)

let server: LiveServer
let clients: LiveClient[] = []
const latency = new LatencyLog()

beforeAll(async () => {
  server = await startLiveServer()
})

afterEach(() => {
  for (const client of clients) client.destroy()
  clients = []
})

afterAll(async () => {
  console.log(latency.report())
  await server?.close()
})

const describeNightly = describe.skipIf(!NIGHTLY)

describeNightly('idle connection stability (TC-29 analogue)', () => {
  it(`two clients sit idle for ${IDLE_MS / 1000}s and never leave the connected state`, async () => {
    clients = await connectClients(server, newBoardId(), 2)
    const [alex, sam] = clients as [LiveClient, LiveClient]
    await waitForConvergence(clients, 'initial sync')
    expect(alex.state()).toBe('connected')

    const states: string[] = []
    const sockets: number[] = []
    const deadline = Date.now() + IDLE_MS
    while (Date.now() < deadline) {
      await sleep(500)
      states.push(alex.state(), sam.state())
      sockets.push(alex.socketConnections(), sam.socketConnections())
    }

    // Never a `reconnecting` (or `confirmed` = a fresh connection) sample…
    expect(states.filter(state => state !== 'connected')).toEqual([])
    // …and exactly one WebSocket each for the whole quiet stretch.
    expect(Math.max(...sockets)).toBe(1)

    // The sockets really are still usable, in both directions.
    createSticky(alex.doc, { x: 120, y: 40 })
    await latency.record('create after the idle stretch', clients)
    expect(boardContent(sam.doc)).toBe(boardContent(alex.doc))

    createSticky(sam.doc, { x: -120, y: 40 })
    await latency.record('create back after the idle stretch', clients)
    expect(boardContent(sam.doc)).toBe(boardContent(alex.doc))
    expect(alex.state()).toBe('connected')
    expect(sam.state()).toBe('connected')
  })

  it('closing a client does not make the others reconnect', async () => {
    clients = await connectClients(server, newBoardId(), 3)
    await waitForConvergence(clients, 'initial sync')

    const [leaver] = clients as [LiveClient, LiveClient, LiveClient]
    const stayers = clients.slice(1)
    const socketsBefore = stayers.map(client => client.socketConnections())

    leaver.destroy()
    await sleep(5_000)

    // No reconnect attempts on the screens that stayed: still one socket each…
    expect(stayers.map(client => client.socketConnections())).toEqual(socketsBefore)
    // …no state change (a drop would show `reconnecting`)…
    expect(stayers.every(client => client.state() === 'connected')).toBe(true)
    // …and the room still relays for the two that remain.
    createSticky(stayers[0].doc, { x: 0, y: 40 })
    await latency.record('create after a participant left', stayers)
    expect(boardContent(stayers[1].doc)).toBe(boardContent(stayers[0].doc))
  })
})

describeNightly('convergence at capacity (TC-30 analogue)', () => {
  it(`${MAX_CONCURRENT_EDITORS} clients edit continuously for ${SOAK_MS / 1000}s and stay identical`, async () => {
    clients = await connectClients(server, newBoardId(), MAX_CONCURRENT_EDITORS)
    await waitForConvergence(clients, 'initial sync of five clients')

    // One seeded generator per client, plus a seed log for replaying a failure.
    const rngs = clients.map((_, index) => createRng(SEED + index))
    console.log(`[soak] seed=${SEED} clients=${MAX_CONCURRENT_EDITORS} duration=${SOAK_MS}ms`)

    const deadline = Date.now() + SOAK_MS
    let ops = 0
    let round = 0

    while (Date.now() < deadline) {
      round += 1
      // One concurrent round: every client applies one random operation
      // without waiting for the others (40 % typing, 30 % moves, 10 % each
      // create / recolour / delete).
      const labels: string[] = []
      for (const [index, client] of clients.entries()) {
        const applied = applyRandomOp(client.doc, rngs[index]!, ops)
        labels.push(`${client.name}:${applied.kind}`)
        ops += 1
      }
      await latency.record(`round ${round} (${labels.join(' ')})`, clients, 60_000)
      expect(clients.every(client => boardContent(client.doc) === boardContent(clients[0]!.doc))).toBe(true)
    }

    console.log(`[soak] ${ops} operations in ${round} concurrent rounds over ${SOAK_MS}ms`)
    expect(ops).toBeGreaterThan(0)
    expect(ops / MAX_CONCURRENT_EDITORS).toBeGreaterThanOrEqual(20)

    // The budget is reported by `latency.report()`, never asserted here.
    const overBudget = latency.samples.filter(sample => sample.ms > LIVE_UPDATE_LATENCY_BUDGET_MS)
    console.log(`[soak] ${overBudget.length}/${latency.samples.length} rounds over the ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget`)

    // A final quiet second: nothing may still be in flight.
    await sleep(1_000)
    const reference = boardContent(clients[0]!.doc)
    for (const client of clients) expect(boardContent(client.doc)).toBe(reference)
    expect(clients.every(client => client.provider.synced === true)).toBe(true)
    // Nobody silently dropped and came back during the soak.
    for (const client of clients) expect(client.socketConnections()).toBe(1)
  })
})

