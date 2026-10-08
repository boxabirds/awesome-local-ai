/**
 * Nightly e2e — TC-29: idle connection stability.
 *
 * Two contexts share one board and nobody touches them for 45 s.  The
 * connection must not flap: the status badge never shows "Reconnecting…", the
 * mapped `ConnectionState` never leaves `connected`, and no second WebSocket
 * connection is ever opened (a reconnect would create one).  Afterwards a
 * change must still propagate, both ways.
 *
 * Skipped when Playwright browsers are not installed (`playwright.nightly
 * .config.ts` creates no real project either).  The same contract, minus the
 * DOM, is checked on every commit by the first block of
 * `tests/live/live-nightly.test.ts`.
 *
 * Run with `npm run test:e2e:nightly`.
 */
import { test, expect } from '@playwright/test'
import { hasBrowser } from '../e2e/helpers/browsers'
import {
  badgeLog,
  connectionState,
  createNote,
  makeBoardId,
  openSession,
  sameSnapshot,
  snapshotOf,
  startBadgeSampler,
  waitForConvergence,
  type Participant,
  type Session,
} from '../e2e/helpers/participants'

test.skip(!hasBrowser(), 'Playwright browsers not installed – skipping e2e')

/** Four times the 10 s idle window y-websocket tolerates before it recycles a socket. */
const IDLE_MS = Number(process.env.NIGHTLY_IDLE_MS ?? 45_000)

let session: Session | null = null

test.afterEach(async () => {
  if (session) {
    await session.close()
    session = null
  }
})

/** Count the WebSockets a page opens (a reconnect opens a second one). */
function trackSockets(participant: Participant): string[] {
  const urls: string[] = []
  participant.page.on('websocket', socket => urls.push(socket.url()))
  return urls
}

test.describe('TC-29: an idle board stays connected', () => {
  test(`two contexts sit idle for ${IDLE_MS / 1000}s and never leave "connected"`, async ({ browser }) => {
    test.setTimeout(IDLE_MS + 90_000)

    const session_ = await openSession(browser, makeBoardId(), ['Alex', 'Sam'])
    session = session_
    const alex = session_.byName('Alex')
    const sam = session_.byName('Sam')

    // Both start from the same board: nothing to sync any more.
    await waitForConvergence([alex, sam])
    expect(await connectionState(alex)).toBe('connected')
    expect(await connectionState(sam)).toBe('connected')

    const alexSockets = trackSockets(alex)
    const samSockets = trackSockets(sam)

    // Record the badge text every 50 ms so nothing that flashes by is missed.
    await startBadgeSampler(alex.page)
    await startBadgeSampler(sam.page)

    // Sample the mapped state (and the badge) throughout the quiet stretch.
    const states: string[] = []
    const deadline = Date.now() + IDLE_MS
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500))
      states.push(await connectionState(alex), await connectionState(sam))
    }

    const alexLog = await badgeLog(alex.page)
    const samLog = await badgeLog(sam.page)

    // Never a "Reconnecting…" frame, at any point, on either screen.
    expect(alexLog.filter(text => text === 'Reconnecting…')).toEqual([])
    expect(samLog.filter(text => text === 'Reconnecting…')).toEqual([])
    // …and never a badge at all after the first sync.
    expect(alexLog.filter(text => text !== null)).toEqual([])
    expect(samLog.filter(text => text !== null)).toEqual([])

    // The state never left `connected` (no `reconnecting`, no second `confirmed`).
    expect(states.every(state => state === 'connected')).toBe(true)

    // One WebSocket per participant for the whole run: no reconnect happened.
    expect(alexSockets).toHaveLength(1)
    expect(samSockets).toHaveLength(1)
    expect(alexSockets[0]).toContain('/api/rooms/')

    // Still alive: a change made now reaches the other side.
    await createNote(alex, 240, -120, 'blue')
    await waitForConvergence([alex, sam])
    expect(await sameSnapshot(await snapshotOf(alex), await snapshotOf(sam))).toBe(true)

    // …and the other way round.
    await createNote(sam, -240, 120, 'orange')
    await waitForConvergence([alex, sam])
    expect(await sameSnapshot(await snapshotOf(alex), await snapshotOf(sam))).toBe(true)

    expect([...alex.errors, ...sam.errors]).toEqual([])
  })
})
