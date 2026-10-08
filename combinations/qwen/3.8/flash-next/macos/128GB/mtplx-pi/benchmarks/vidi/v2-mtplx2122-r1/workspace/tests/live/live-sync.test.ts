/**
 * Live-sync tests (story 3, no browser needed).
 *
 * Same contracts as the browser suite in `tests/e2e/live-collaboration.spec.ts`
 * (TC-22 to TC-28), driven at the provider level: two or five real
 * `WebsocketProvider` clients, the real `connectBoard` state machine, and the
 * real Worker + BoardRoom relay in workerd.
 *
 * Run with `npm run test:live` (it bundles the Worker first).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  LatencyLog,
  boardContent,
  connectClients,
  converged,
  sleep,
  startLiveServer,
  waitForConvergence,
  waitUntil,
  type LiveClient,
  type LiveServer,
} from './harness'
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model'
import { newBoardId } from '../../src/shared/board-id'
import { CONNECTED_CONFIRMATION_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config'

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

async function open(boardId: string, count: number): Promise<LiveClient[]> {
  clients = await connectClients(server, boardId, count)
  return clients
}

describe('live propagation (TC-22 analogue)', () => {
  it('create, move, recolour, type and delete all reach the other screen', async () => {
    const [alex, sam] = await open(newBoardId(), 2)
    await waitForConvergence(clients, 'initial sync')
    expect(alex.provider.synced).toBe(true)
    expect(sam.provider.synced).toBe(true)

    // 1. create — `createSticky` centres the note on the given point.
    const id = createSticky(alex.doc, { x: 0, y: 0 }, 'yellow')
    await latency.record('create', clients)
    expect(snapshot(sam.doc).map(entry => entry.id)).toEqual([id])
    expect(snapshot(sam.doc)[0]).toMatchObject({ x: -100, y: -100, color: 'yellow' })

    // 2. move
    moveObject(alex.doc, id, 300, -120)
    await latency.record('move', clients)
    expect(snapshot(sam.doc).find(entry => entry.id === id)).toMatchObject({ x: 300, y: -120 })

    // 3. recolour
    setStickyColor(alex.doc, id, 'blue')
    await latency.record('recolour', clients)
    expect(snapshot(sam.doc).find(entry => entry.id === id)?.color).toBe('blue')

    // 4. type
    getStickyText(alex.doc, id)?.insert(0, 'hello from Alex')
    await latency.record('type', clients)
    expect(snapshot(sam.doc).find(entry => entry.id === id)?.text).toBe('hello from Alex')

    // 5. delete
    deleteObject(alex.doc, id)
    await latency.record('delete', clients)
    expect(snapshot(sam.doc)).toHaveLength(0)
    expect(boardContent(sam.doc)).toBe(boardContent(alex.doc))
  })

  it('a change made on either screen reaches the other (no one-way relay)', async () => {
    const [alex, sam] = await open(newBoardId(), 2)
    await waitForConvergence(clients, 'initial sync')

    const id = createSticky(sam.doc, { x: 40, y: 40 }, 'green')
    await latency.record('create by the second client', clients)
    expect(snapshot(alex.doc).map(entry => entry.id)).toEqual([id])

    moveObject(sam.doc, id, 500, 500)
    await latency.record('move by the second client', clients)
    expect(snapshot(alex.doc).find(entry => entry.id === id)).toMatchObject({ x: 500, y: 500 })
  })
})

describe('concurrent edits (TC-23 / TC-24 analogues)', () => {
  it('simultaneous typing in one note merges into identical text on both screens', async () => {
    const [alex, sam] = await open(newBoardId(), 2)
    await waitForConvergence(clients, 'initial sync')

    const id = createSticky(alex.doc, { x: 0, y: 0 })
    getStickyText(alex.doc, id)?.insert(0, 'green')
    await waitForConvergence(clients, 'seed text')
    expect(snapshot(sam.doc)[0].text).toBe('green')

    // Both type at the same time, without waiting for the other: Alex at the
    // start of the line, Sam at the end.  Neither sees the other's insert.
    alex.doc.transact(() => {
      getStickyText(alex.doc, id)?.insert(0, 'red ')
    })
    sam.doc.transact(() => {
      getStickyText(sam.doc, id)?.insert(5, ' blue')
    })
    await latency.record('concurrent typing', clients)

    const alexText = snapshot(alex.doc)[0].text
    const samText = snapshot(sam.doc)[0].text
    expect(alexText).toBe(samText)
    // Every typed character survived the merge.
    expect(alexText).toBe('red green blue')
  })

  it('simultaneous drags of one note settle on one identical position', async () => {
    const [alex, sam] = await open(newBoardId(), 2)
    await waitForConvergence(clients, 'initial sync')

    const id = createSticky(alex.doc, { x: 0, y: 0 })
    await waitForConvergence(clients, 'seed note')

    // Two separate transactions: the two writers really race.
    moveObject(alex.doc, id, -400, 250)
    moveObject(sam.doc, id, 640, -300)
    await latency.record('concurrent move', clients)

    const onAlex = snapshot(alex.doc).find(entry => entry.id === id)
    expect(snapshot(sam.doc).find(entry => entry.id === id)).toEqual(onAlex)

    // Identical *and* stable: nothing flips back after a quiet moment.
    await sleep(300)
    expect(boardContent(sam.doc)).toBe(boardContent(alex.doc))
  })

  it('deleting a note that the other screen is typing in leaves no half state', async () => {
    const [alex, sam] = await open(newBoardId(), 2)
    await waitForConvergence(clients, 'initial sync')

    const first = createSticky(alex.doc, { x: 0, y: 0 })
    const second = createSticky(alex.doc, { x: 300, y: 0 })
    getStickyText(sam.doc, second)?.insert(0, 'working on my ')
    await waitForConvergence(clients, 'seed notes')

    // Sam keeps typing in `second` while Alex deletes it.
    deleteObject(alex.doc, second)
    getStickyText(sam.doc, second)?.insert(14, 'idea')
    await latency.record('delete during editing', clients)

    expect(snapshot(alex.doc).map(entry => entry.id)).toEqual([first])
    expect(snapshot(sam.doc).map(entry => entry.id)).toEqual([first])
    expect(boardContent(sam.doc)).toBe(boardContent(alex.doc))
  })
})

describe('board isolation', () => {
  it('two board ids are two rooms: edits never cross', async () => {
    const left = await connectClients(server, newBoardId(), 2)
    const right = await connectClients(server, newBoardId(), 2)
    clients = [...left, ...right]
    await waitForConvergence(left, 'left sync')
    await waitForConvergence(right, 'right sync')

    createSticky(left[0].doc, { x: 0, y: 0 })
    await waitForConvergence(left, 'left convergence')
    await sleep(500)

    expect(snapshot(left[1].doc)).toHaveLength(1)
    expect(snapshot(right[0].doc)).toHaveLength(0)
    expect(snapshot(right[1].doc)).toHaveLength(0)
  })
})

describe('full-capacity session (TC-26 / TC-30 analogues)', () => {
  it(`${MAX_CONCURRENT_EDITORS} editors create and move notes; all boards end up identical`, async () => {
    const editors = await open(newBoardId(), MAX_CONCURRENT_EDITORS)
    await waitForConvergence(editors, 'initial sync of five editors')

    // Each editor creates five notes and moves them, all concurrently.
    for (let round = 0; round < 5; round++) {
      for (const editor of editors) {
        const id = createSticky(editor.doc, { x: 0, y: round * 260 + 130 })
        moveObject(editor.doc, id, round * 260, round * 260)
      }
      await latency.record(`round ${round}: ${MAX_CONCURRENT_EDITORS} editors`, editors, 30_000)
      expect(converged(editors)).toBe(true)
      expect(snapshot(editors[0].doc)).toHaveLength((round + 1) * 5)
    }

    const reference = boardContent(editors[0].doc)
    for (const editor of editors) expect(boardContent(editor.doc)).toBe(reference)
    expect(snapshot(editors[0].doc)).toHaveLength(MAX_CONCURRENT_EDITORS * 5)
  })

  it('a sixth editor joins a full board and still syncs (capacity is not enforced)', async () => {
    const boardId = newBoardId()
    const first = await connectClients(server, boardId, 5)
    await waitForConvergence(first, 'five editors synced')
    createSticky(first[0].doc, { x: 0, y: 0 })
    await waitForConvergence(first, 'note before the sixth joins')

    const sixth = (await connectClients(server, boardId, 1))[0]
    clients = [...first, sixth]
    await waitForConvergence(clients, 'six editors synced')
    expect(snapshot(sixth.doc)).toHaveLength(1)

    // And the late joiner can edit: the change spreads to everybody.
    setStickyColor(sixth.doc, snapshot(sixth.doc)[0].id, 'violet')
    await latency.record('sixth editor recolours', clients)
    for (const editor of first) {
      expect(snapshot(editor.doc)[0].color).toBe('violet')
    }
  })
})

describe('catch-up after an outage (TC-27 analogue)', () => {
  it('reconnecting restores both directions and the badge states', async () => {
    const [alex, sam] = await open(newBoardId(), 2)
    await waitForConvergence(clients, 'initial sync')
    expect(alex.state()).toBe('connected')

    // Cut Alex's link and keep it cut: local edits keep working on both sides.
    alex.goOffline()
    await waitUntil(() => alex.state() === 'reconnecting', 'Alex to notice the outage', 5_000)
    expect(alex.provider.synced).toBe(false)

    for (let round = 0; round < 3; round++) {
      createSticky(alex.doc, { x: -300 + round * 60, y: -200 })
      createSticky(sam.doc, { x: 100 + round * 60, y: -200 })
    }
    // The browser test stays offline for CATCH_UP_TEST_OUTAGE_MS (30 s); here
    // the link stays down for a shorter but still multi-second stretch.
    await sleep(4_000)
    expect(boardContent(alex.doc)).not.toBe(boardContent(sam.doc))

    alex.reconnect()
    await waitUntil(() => alex.state() === 'confirmed', 'Alex to re-sync', 15_000)
    await latency.record('catch-up after the outage', clients)

    expect(snapshot(alex.doc)).toHaveLength(6)
    expect(boardContent(alex.doc)).toBe(boardContent(sam.doc))

    // And the confirmation window ends in `connected` again.
    await sleep(CONNECTED_CONFIRMATION_MS + 100)
    expect(alex.state()).toBe('connected')

    // connecting → connected → reconnecting → confirmed → connected.
    expect(alex.states).toEqual(['connected', 'reconnecting', 'confirmed', 'connected'])
  })

  it('a dropped socket reconnects on its own and stays converged', async () => {
    const [alex, sam] = await open(newBoardId(), 2)
    await waitForConvergence(clients, 'initial sync')

    alex.dropLink()
    await waitUntil(() => alex.state() === 'reconnecting', 'drop detected', 5_000)
    createSticky(sam.doc, { x: 0, y: 0 })
    await sleep(500)

    // The provider reconnects by itself (backoff is capped at 2 s here).
    await waitUntil(() => alex.provider.synced === true, 'Alex to reconnect', 15_000)
    await waitForConvergence(clients, 'convergence after reconnecting')
    expect(snapshot(alex.doc)).toHaveLength(1)
    expect(alex.state()).toBe('confirmed')

    // Still editable afterwards.
    const id = snapshot(alex.doc)[0].id
    moveObject(alex.doc, id, 123, 45)
    await latency.record('edit after reconnecting', clients)
    expect(snapshot(sam.doc).find(entry => entry.id === id)).toMatchObject({ x: 123, y: 45 })
  })
})

describe('local-only state (TC-28 analogue)', () => {
  it('once converged, a quiet board stays quiet (no echo loop)', async () => {
    const [alex, sam] = await open(newBoardId(), 2)
    await waitForConvergence(clients, 'initial sync')

    const id = createSticky(alex.doc, { x: 0, y: 0 })
    await waitForConvergence(clients, 'seed note')

    // Selection and editing live in React state, so nothing is written to the
    // shared doc for them; and a converged board produces no further updates.
    let samUpdates = 0
    const countUpdate = () => {
      samUpdates += 1
    }
    sam.doc.on('update', countUpdate)
    await sleep(2_000)
    sam.doc.off('update', countUpdate)

    expect(samUpdates).toBe(0)
    expect(snapshot(sam.doc).map(entry => entry.id)).toEqual([id])
  })

  it('a client that joins late receives the whole board', async () => {
    const boardId = newBoardId()
    const early = await open(boardId, 2)
    await waitForConvergence(clients, 'initial sync')

    for (let round = 0; round < 4; round++) {
      const id = createSticky(early[0].doc, { x: round * 120, y: 0 })
      getStickyText(early[0].doc, id)?.insert(0, `note ${round}`)
      setStickyColor(early[0].doc, id, 'pink')
    }
    await waitForConvergence(clients, 'four notes on both screens')

    const late = (await connectClients(server, boardId, 1))[0]
    clients = [...clients, late]
    await waitForConvergence(clients, 'late joiner caught up')
    expect(snapshot(late.doc)).toHaveLength(4)
    expect(boardContent(late.doc)).toBe(boardContent(early[0].doc))
  })
})
