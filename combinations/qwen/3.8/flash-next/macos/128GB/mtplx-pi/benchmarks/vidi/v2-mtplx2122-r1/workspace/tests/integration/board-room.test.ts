/**
 * BoardRoom tests (TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31).
 *
 * Real Durable Object, real WebSockets, real Yjs: two `TestClient`s share one
 * board through the room, and assertions are made on what arrived on the wire
 * and on the resulting documents.
 */

import { describe, it, expect, afterEach } from 'vitest'
import * as Y from 'yjs'
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config'
import { CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol'
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model'
import {
  TestClient,
  connect,
  hex,
  uniqueBoardId,
  waitFor,
  waitForConvergence,
} from './ws-client'
import { applyRandomOp, createRng } from './random-ops'

const clients: TestClient[] = []

afterEach(() => {
  while (clients.length > 0) clients.pop()!.destroy()
})

function track(client: TestClient): TestClient {
  clients.push(client)
  return client
}

/** Two clients on a fresh board, both synced, with empty frame logs. */
async function pair(label: string): Promise<[TestClient, TestClient, string]> {
  const boardId = uniqueBoardId(label)
  const a = track(await connect(boardId, { label: `${label}-A` }))
  const b = track(await connect(boardId, { label: `${label}-B` }))
  await waitForConvergence([a, b])
  a.log.length = 0
  b.log.length = 0
  return [a, b, boardId]
}

function textOf(client: TestClient, noteId: string): string {
  return getStickyText(client.doc, noteId)?.toString() ?? ''
}

function snapshotsOf(clients: readonly TestClient[]): string[] {
  return clients.map(client => JSON.stringify(snapshot(client.doc)))
}

/** One shared starting point: a board holding `id` with the given text. */
function seededDoc(noteId: string, text: string): Y.Doc {
  const doc = new Y.Doc()
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
  const note = new Y.Map<unknown>()
  note.set('type', 'sticky')
  note.set('x', 0)
  note.set('y', 0)
  note.set('color', 'yellow')
  note.set('text', new Y.Text(text))
  note.set('z', 1)
  objects.set(noteId, note)
  return doc
}

// ── TC-07 single change reaches the other participant ────────────────────────

describe('TC-07 create propagates', () => {
  it("B ends up with A's note and received exactly one update", async () => {
    const [a, b] = await pair('t07')

    const id = createSticky(a.doc, { x: 10, y: 20 })

    await waitFor(() => snapshot(b.doc).some(note => note.id === id), 3000, 'B sees the note')

    expect(snapshot(b.doc)).toEqual(snapshot(a.doc))
    expect(b.inboundBroadcasts()).toHaveLength(1)
  })
})

// ── TC-08 every edit kind propagates without echoing ─────────────────────────

describe('TC-08 edit kinds', () => {
  it('moves', async () => {
    const [a, b] = await pair('t08-move')
    const id = createSticky(a.doc, { x: 0, y: 0 })
    await waitFor(() => snapshot(b.doc).length === 1, 3000, 'seed synced')
    a.log.length = 0
    b.log.length = 0

    moveObject(a.doc, id, 400, -250)

    await waitForConvergence([a, b])
    expect(snapshot(b.doc)).toEqual(snapshot(a.doc))
    expect(snapshot(b.doc)[0].x).toBe(400)
    expect(a.inboundBroadcasts()).toHaveLength(0) // no echo to the sender
  })

  it('recolours', async () => {
    const [a, b] = await pair('t08-color')
    const id = createSticky(a.doc, { x: 0, y: 0 })
    await waitFor(() => snapshot(b.doc).length === 1, 3000, 'seed synced')

    setStickyColor(a.doc, id, 'violet')

    await waitForConvergence([a, b])
    expect(snapshot(b.doc)[0].color).toBe('violet')
    expect(snapshot(b.doc)).toEqual(snapshot(a.doc))
    expect(a.inboundBroadcasts()).toHaveLength(0)
  })

  it('text inserts', async () => {
    const [a, b] = await pair('t08-text')
    const id = createSticky(a.doc, { x: 0, y: 0 })
    await waitFor(() => snapshot(b.doc).length === 1, 3000, 'seed synced')
    getStickyText(a.doc, id)!.insert(0, 'hello')
    await waitForConvergence([a, b])

    getStickyText(a.doc, id)!.insert(5, ' world')

    await waitForConvergence([a, b])
    expect(textOf(b, id)).toBe('hello world')
    expect(textOf(a, id)).toBe('hello world')
    expect(a.inboundBroadcasts()).toHaveLength(0)
  })

  it('deletes', async () => {
    const [a, b] = await pair('t08-delete')
    const id = createSticky(a.doc, { x: 0, y: 0 })
    await waitFor(() => snapshot(b.doc).length === 1, 3000, 'seed synced')
    a.log.length = 0
    b.log.length = 0

    deleteObject(a.doc, id)

    await waitForConvergence([a, b])
    expect(snapshot(a.doc)).toHaveLength(0)
    expect(snapshot(b.doc)).toHaveLength(0)
    expect(a.inboundBroadcasts()).toHaveLength(0)
  })
})

// ── TC-09 concurrent text edits ──────────────────────────────────────────────

describe('TC-09 concurrent text', () => {
  it('keeps both concurrent inserts, on both screens', async () => {
    const boardId = uniqueBoardId('t09')
    const noteId = 'concurrent-note'

    // Genuinely concurrent: each side starts from the same seeded state and
    // edits before it has seen anything from the other side.
    const seed = seededDoc(noteId, 'green')
    const seedUpdate = Y.encodeStateAsUpdate(seed)

    const docA = new Y.Doc()
    const docB = new Y.Doc()
    Y.applyUpdate(docA, seedUpdate)
    Y.applyUpdate(docB, seedUpdate)

    const noteText = (doc: Y.Doc): Y.Text =>
      (doc.getMap('objects').get(noteId) as Y.Map<unknown>).get('text') as Y.Text

    noteText(docA).insert(0, 'red ')
    noteText(docB).insert(5, ' blue')

    const a = track(await connect(boardId, { label: 'T09-A', doc: docA, waitForSync: false }))
    const b = track(await connect(boardId, { label: 'T09-B', doc: docB, waitForSync: false }))

    await waitForConvergence([a, b], 5000)

    expect(noteText(a.doc).toString()).toBe('red green blue')
    expect(noteText(b.doc).toString()).toBe('red green blue')
  })
})

// ── TC-10 concurrent moves of the same note ──────────────────────────────────

describe('TC-10 concurrent moves', () => {
  it('converges to one identical position', async () => {
    const [a, b] = await pair('t10')
    const id = createSticky(a.doc, { x: 0, y: 0 })
    await waitFor(() => snapshot(b.doc).length === 1, 3000, 'seed synced')

    // Both move the same note before either has seen the other's move.
    moveObject(a.doc, id, 100, 0)
    moveObject(b.doc, id, 300, 0)

    await waitForConvergence([a, b], 5000)

    const [noteA, noteB] = [snapshot(a.doc)[0], snapshot(b.doc)[0]]
    // Last-write-wins: both screens land on the *same* position, whichever of
    // the two competing moves happened to win.
    expect(noteB.x).toBe(noteA.x)
    expect(noteB.y).toBe(noteA.y)
    expect([100, 300]).toContain(noteA.x)
    expect(snapshotsOf([a, b])[0]).toBe(snapshotsOf([a, b])[1])
  })
})

// ── TC-11 delete during edit ─────────────────────────────────────────────────

describe('TC-11 delete wins over a concurrent insert', () => {
  it('removes the note everywhere without resurrecting the text', async () => {
    const [a, b] = await pair('t11')
    const id = createSticky(a.doc, { x: 0, y: 0 })
    await waitFor(() => snapshot(b.doc).length === 1, 3000, 'seed synced')
    getStickyText(b.doc, id)!.insert(0, 'green')
    await waitForConvergence([a, b])

    // A deletes the note while B is typing into it.
    deleteObject(a.doc, id)
    getStickyText(b.doc, id)!.insert(5, ' blue')

    await waitForConvergence([a, b], 5000)

    expect(snapshot(a.doc)).toHaveLength(0)
    expect(snapshot(b.doc)).toHaveLength(0)
    // No exception anywhere: nothing thrown in the room, nothing failed here.
    expect(a.errors).toEqual([])
    expect(b.errors).toEqual([])
    expect(a.closed).toBeNull()
    expect(b.closed).toBeNull()
  })

  it('a delete and a concurrent insert on the same board do not resurrect the note', async () => {
    const boardId = uniqueBoardId('t11b')
    const noteId = 'doomed-note'

    const seed = seededDoc(noteId, 'green')
    const seedUpdate = Y.encodeStateAsUpdate(seed)

    const docA = new Y.Doc()
    const docB = new Y.Doc()
    Y.applyUpdate(docA, seedUpdate)
    Y.applyUpdate(docB, seedUpdate)

    const noteOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap('objects').get(noteId) as Y.Map<unknown>

    deleteObject(docA, noteId)
    ;(noteOf(docB).get('text') as Y.Text).insert(5, ' blue')

    const a = track(await connect(boardId, { label: 'T11b-A', doc: docA, waitForSync: false }))
    const b = track(await connect(boardId, { label: 'T11b-B', doc: docB, waitForSync: false }))

    await waitForConvergence([a, b], 5000)

    expect(snapshot(a.doc)).toHaveLength(0)
    expect(snapshot(b.doc)).toHaveLength(0)

    const late = track(await connect(boardId, { label: 'T11b-C' }))
    await waitForConvergence([a, b, late], 5000)
    expect(snapshot(late.doc)).toHaveLength(0)
  })
})

// ── TC-12 convergence under continuous random edits ──────────────────────────

describe('TC-12 random ops converge', () => {
  const SEED = 20261008
  const OPS_PER_CLIENT = 200

  it(`${MAX_CONCURRENT_EDITORS} clients × ${OPS_PER_CLIENT} seeded ops end with identical snapshots`, async () => {
    const boardId = uniqueBoardId('t12')

    const all: TestClient[] = []
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      all.push(track(await connect(boardId, { label: `r${i}` })))
    }
    await waitForConvergence(all)

    console.log(`TC-12 seed: ${SEED} (per-client seeds: ${SEED}..${SEED + MAX_CONCURRENT_EDITORS - 1})`)

    // Every client applies its own seeded stream, round by round, with no sync
    // in between: the streams genuinely interleave on the wire.
    const streams = all.map((_, i) => createRng(SEED + i))
    for (let round = 0; round < OPS_PER_CLIENT; round++) {
      for (let i = 0; i < all.length; i++) applyRandomOp(all[i].doc, streams[i], round)
    }

    await waitForConvergence(all, 30_000)

    const reference = snapshotsOf(all)[0]
    for (const [index, json] of snapshotsOf(all).entries()) {
      expect(JSON.parse(json)).toEqual(JSON.parse(reference))
      expect(json, `client ${index} differs from client 0`).toBe(reference)
    }
  }, 90_000)
})

// ── TC-14 late joiner ────────────────────────────────────────────────────────

describe('TC-14 late joiner', () => {
  it('a client that joins after 40 notes gets the whole board', async () => {
    const boardId = uniqueBoardId('t14')
    const a = track(await connect(boardId, { label: 'T14-A' }))
    const b = track(await connect(boardId, { label: 'T14-B' }))

    for (let i = 0; i < 20; i++) createSticky(a.doc, { x: i * 10, y: 0 })
    for (let i = 0; i < 20; i++) createSticky(b.doc, { x: -i * 10, y: 5 })
    await waitForConvergence([a, b], 10_000)

    const late = track(await connect(boardId, { label: 'T14-C' }))
    await waitForConvergence([a, b, late], 10_000)

    expect(snapshot(late.doc)).toHaveLength(40)
    expect(snapshot(late.doc)).toEqual(snapshot(a.doc))
    expect(snapshot(late.doc)).toEqual(snapshot(b.doc))
  })
})

// ── TC-15 malformed traffic ──────────────────────────────────────────────────

describe('TC-15 malformed traffic', () => {
  const cases: { name: string; frame: () => Uint8Array | string }[] = [
    { name: 'text frame', frame: () => 'hello' },
    { name: 'empty frame', frame: () => new Uint8Array(0) },
    { name: 'sync frame without payload', frame: () => new Uint8Array([0]) },
    { name: 'truncated sync update', frame: () => new Uint8Array([0, 2, 5, 0xaa, 0xbb]) },
    { name: 'unknown message type', frame: () => new Uint8Array([9, 1, 2, 3]) },
    { name: 'truncated awareness frame', frame: () => new Uint8Array([1, 10, 1, 2]) },
    {
      name: 'invalid Yjs update',
      frame: () => new Uint8Array([0, 2, 6, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    },
  ]

  it.each(cases)('$name closes only the sender with 1003', async ({ frame }) => {
    const [a, b, boardId] = await pair('t15')
    const id = createSticky(a.doc, { x: 0, y: 0 })
    await waitFor(() => snapshot(b.doc).length === 1, 3000, 'seed synced')

    a.sendRaw(frame())

    await waitFor(() => a.closed !== null, 3000, 'A got closed')
    expect(a.closed?.code).toBe(CLOSE_UNSUPPORTED_DATA)

    // The room stays healthy for everyone else, and the bad frame changed
    // nothing: B still holds exactly the seed note.
    expect(b.closed).toBeNull()
    expect(b.isOpen).toBe(true)
    expect(snapshot(b.doc)).toHaveLength(1)

    // …and it still relays: a note created after the bad frame converges.
    createSticky(b.doc, { x: 50, y: 50 })
    const late = track(await connect(boardId, { label: 'late' }))
    await waitForConvergence([b, late], 5000)

    expect(snapshot(late.doc)).toHaveLength(2)
    expect(snapshotsOf([b, late])[0]).toBe(snapshotsOf([b, late])[1])
    expect(late.isOpen).toBe(true)
  })

  it('a query-awareness frame is ignored, not treated as malformed', async () => {
    const [a, b, boardId] = await pair('t15q')

    a.sendRaw(new Uint8Array([3]))
    await new Promise(resolve => setTimeout(resolve, 200))

    expect(a.closed).toBeNull()
    expect(a.isOpen).toBe(true)

    // The room carries on relaying for everybody.
    const id = createSticky(a.doc, { x: 5, y: 5 })
    await waitFor(() => snapshot(b.doc).some(note => note.id === id), 3000, 'B sees the note')
    const late = track(await connect(boardId, { label: 'late-query' }))
    await waitForConvergence([b, late], 5000)
    expect(snapshot(late.doc)).toHaveLength(1)
  })
})

// ── TC-16 awareness relay ────────────────────────────────────────────────────

describe('TC-16 awareness', () => {
  it('A and B receive the same awareness bytes', async () => {
    const [a, b] = await pair('t16')

    a.awareness.setLocalStateField('user', { name: 'Ada' })
    a.publishAwareness()

    await waitFor(
      () => b.awareness.getStates().has(a.doc.clientID) && a.log.some(e => e.dir === 'in' && e.type === 1),
      3000,
      'awareness on both sides',
    )

    const inbound = (client: TestClient): string[] =>
      client.log.filter(e => e.dir === 'in' && e.type === 1).map(e => hex(e.bytes))

    expect(inbound(b).length).toBeGreaterThan(0)
    // Identical bytes, including the echo back to A.
    expect(inbound(a)).toEqual(inbound(b))
    expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({ user: { name: 'Ada' } })
  })
})

// ── TC-18 restarted room ─────────────────────────────────────────────────────

describe('TC-18 room restart', () => {
  it('a reconnecting client repopulates a fresh room, and B converges', async () => {
    // One doc with history, kept outside any room: this is "the client that
    // reconnects after the room was evicted".
    const history = seededDoc('restart-note', 'before the restart')
    const boardId = uniqueBoardId('t18')

    const a = track(await connect(boardId, { label: 'T18-A', doc: history, waitForSync: false }))
    // The room asks for state, and A answers with everything it knows.
    await waitFor(
      () => a.log.some(e => e.dir === 'in' && e.bytes[0] === 0 && e.bytes[1] === 0),
      3000,
      'SyncStep1 from the room',
    )
    await waitFor(
      () => a.log.some(e => e.dir === 'out' && e.bytes[0] === 0 && e.bytes[1] === 1),
      3000,
      'SyncStep2 from A',
    )

    // The fresh room doc now equals A: a second client converges on the note.
    const b = track(await connect(boardId, { label: 'T18-B' }))
    await waitForConvergence([a, b], 5000)

    expect(snapshot(b.doc)).toEqual(snapshot(a.doc))
    expect(snapshot(b.doc)).toHaveLength(1)
    expect(textOf(b, 'restart-note')).toBe('before the restart')
  })
})

// ── TC-31 dead socket ────────────────────────────────────────────────────────

describe('TC-31 dead socket', () => {
  it('an update after an abrupt close does not break the room', async () => {
    const boardId = uniqueBoardId('t31')
    const a = track(await connect(boardId, { label: 'T31-A' }))
    const b = track(await connect(boardId, { label: 'T31-B' }))
    await waitForConvergence([a, b])

    // B goes away, and A edits in the same tick: the room still holds B's
    // socket in its set (CLOSING at best) when it broadcasts the update.
    b.close()
    const during = createSticky(a.doc, { x: 0, y: 0 })
    await waitFor(() => b.closed !== null || !b.isOpen, 2000, 'B socket went away')
    const after = createSticky(a.doc, { x: 40, y: 40 })

    const later = track(await connect(boardId, { label: 'T31-C' }))
    await waitFor(
      () => snapshot(later.doc).some(note => note.id === after),
      5000,
      'late socket sees both notes',
    )

    expect(snapshot(later.doc).some(note => note.id === during)).toBe(true)
    expect(snapshot(later.doc)).toHaveLength(2)
    expect(a.isOpen).toBe(true)
    expect(a.errors).toEqual([])
    expect(later.errors).toEqual([])
    // Nothing was thrown for the dead socket.
    expect(b.errors).toEqual([])
  })
})