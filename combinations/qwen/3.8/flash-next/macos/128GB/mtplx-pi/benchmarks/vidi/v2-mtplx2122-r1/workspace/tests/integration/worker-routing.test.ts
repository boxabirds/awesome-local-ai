import { describe, it, expect, afterEach } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config'
import { createSticky, snapshot } from '../../src/shared/board-model'
import { connect, uniqueBoardId, waitFor, waitForConvergence, type TestClient } from './ws-client'

const VALID_ID = 'Ab3-_9xxxxxxxxxxxxxxxx' // 22 chars, base64url

/** Env of the Worker under test (only the DO binding is relevant here). */
interface TestEnv {
  BOARD_ROOM: DurableObjectNamespace
}

const testEnv = env as unknown as TestEnv

const clients: TestClient[] = []

afterEach(() => {
  while (clients.length > 0) clients.pop()!.destroy()
})

function track(client: TestClient): TestClient {
  clients.push(client)
  return client
}

// ── TC-04 malformed board id ─────────────────────────────────────────────────

describe('TC-04 malformed board id', () => {
  const badIds = ['bad!id', 'short', 'a'.repeat(23), 'Ab3+9xxxxxxxxxxxxxxxxxxxxx', 'with.space']

  it.each(badIds)('answers 400 for %s and never touches the DO namespace', async bad => {
    const touched: string[] = []
    const real = testEnv.BOARD_ROOM
    // Replace the binding so any namespace use becomes observable: a malformed
    // id must be rejected before a Durable Object is looked up.
    const spy = {
      idFromName(name: string) {
        touched.push(`idFromName:${name}`)
        return real.idFromName(name)
      },
      idFromString(id: string) {
        touched.push('idFromString')
        return real.idFromString(id)
      },
      newUniqueId() {
        touched.push('newUniqueId')
        return real.newUniqueId()
      },
      get(id: DurableObjectId) {
        touched.push(`get:${id.toString()}`)
        return real.get(id)
      },
    }
    ;(env as Record<string, unknown>).BOARD_ROOM = spy

    try {
      const response = await SELF.fetch(`http://localhost/api/rooms/${bad}`, {
        headers: { Upgrade: 'websocket' },
      })
      expect(response.status).toBe(400)
      expect(await response.text()).toContain('Invalid board id')
      expect(touched).toEqual([])
    } finally {
      ;(env as Record<string, unknown>).BOARD_ROOM = real
    }
  })
})

// ── TC-05 missing upgrade header ─────────────────────────────────────────────

describe('TC-05 missing Upgrade: websocket', () => {
  it('answers 426 for a plain GET on a valid room path', async () => {
    const response = await SELF.fetch(`http://localhost/api/rooms/${VALID_ID}`)
    expect(response.status).toBe(426)
  })

  it('answers 426 when the header is present but not "websocket"', async () => {
    const response = await SELF.fetch(`http://localhost/api/rooms/${VALID_ID}`, {
      headers: { Upgrade: 'h2c' },
    })
    expect(response.status).toBe(426)
  })

  it('upgrades a valid id when the header is there', async () => {
    const client = track(await connect(VALID_ID, { label: 'tc05' }))
    expect(client.isOpen).toBe(true)
    expect(client.synced).toBe(true)
  })
})

// ── TC-06 SPA fallback ───────────────────────────────────────────────────────

describe('TC-06 /b/<boardId> serves the app shell', () => {
  it('returns 200 with index.html for a deep board link', async () => {
    const response = await SELF.fetch(`http://localhost/b/${VALID_ID}`)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<div id="root">')
    expect(html).toContain('type="module"')
  })

  it('treats a room path without an id as a normal asset request', async () => {
    const response = await SELF.fetch('http://localhost/api/rooms')
    expect(response.status).toBe(200)
  })
})

// ── TC-13 soft capacity ──────────────────────────────────────────────────────

describe('TC-13 over-capacity join is never refused', () => {
  it(`opens ${MAX_CONCURRENT_EDITORS} + 1 sockets on one board and relays between all of them`, async () => {
    const boardId = uniqueBoardId('t13')
    const count = MAX_CONCURRENT_EDITORS + 1

    const all: TestClient[] = []
    for (let i = 0; i < count; i++) all.push(track(await connect(boardId, { label: `p${i}` })))

    expect(all).toHaveLength(count)
    expect(all.every(client => client.isOpen)).toBe(true)

    const last = all[count - 1]
    const others = all.slice(0, -1)
    const id = createSticky(last.doc, { x: 3, y: 4 })

    await waitFor(
      () => others.every(client => snapshot(client.doc).some(sticky => sticky.id === id)),
      5000,
      'the note reaches every other participant',
    )
  })
})

// ── TC-17 board isolation ────────────────────────────────────────────────────

describe('TC-17 boards are isolated', () => {
  it('a change on one board never reaches a client on another board', async () => {
    const boardA = uniqueBoardId('t17a')
    const boardB = uniqueBoardId('t17b')

    const onA = track(await connect(boardA, { label: 'A' }))
    const onB = track(await connect(boardB, { label: 'B' }))

    const id = createSticky(onA.doc, { x: 0, y: 0 })
    await waitFor(() => snapshot(onA.doc).some(sticky => sticky.id === id), 1000, 'A has the note')

    // Give the relay every chance to leak the update across boards.
    await waitForConvergence([onA], 1000)
    await new Promise(resolve => setTimeout(resolve, 500))

    expect(snapshot(onB.doc)).toHaveLength(0)
    expect(onB.inboundBroadcasts()).toHaveLength(0)
  })

  it('a socket on a second board stays open while the first one is busy', async () => {
    const boardA = uniqueBoardId('t17x')
    const boardB = uniqueBoardId('t17y')

    const onA = track(await connect(boardA, { label: 'A2' }))
    const onB = track(await connect(boardB, { label: 'B2' }))

    for (let i = 0; i < 5; i++) createSticky(onA.doc, { x: i, y: i })
    await new Promise(resolve => setTimeout(resolve, 500))

    expect(onB.isOpen).toBe(true)
    expect(snapshot(onB.doc)).toHaveLength(0)
  })
})
