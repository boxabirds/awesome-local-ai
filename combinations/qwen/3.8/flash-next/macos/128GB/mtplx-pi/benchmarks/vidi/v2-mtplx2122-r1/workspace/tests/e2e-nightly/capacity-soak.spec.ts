/**
 * Nightly e2e — TC-30: convergence at capacity, with a latency report.
 *
 * `MAX_CONCURRENT_EDITORS` contexts share one board and keep editing through
 * the real UI (double-click to create, drag to move, swatch to recolour,
 * keyboard to delete) for SOAK_MS, driven by a seeded RNG so a failure can be
 * replayed.  Two contracts are asserted:
 *
 *   • every change eventually appears on every other context (checked after
 *     every round: all five snapshots must be identical), and
 *   • the final board snapshots of all five contexts are identical.
 *
 * Per-change propagation time is measured and printed against
 * LIVE_UPDATE_LATENCY_BUDGET_MS.  It is reported, never asserted: model,
 * browsers and server all share this machine.
 *
 * Skipped when Playwright browsers are not installed.  The same contract
 * without a DOM runs in `tests/live/live-nightly.test.ts`.
 *
 * Run with `npm run test:e2e:nightly`.
 */
import { test, expect } from '@playwright/test'
import { hasBrowser } from '../e2e/helpers/browsers'
import { mouseDrag } from '../e2e/helpers/board'
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config'
import {
  createNote,
  expectEventually,
  makeBoardId,
  openSession,
  printLatencyReport,
  sameSnapshot,
  screenPointOf,
  snapshotOf,
  waitForConvergence,
  type Participant,
  type Session,
} from '../e2e/helpers/participants'

test.skip(!hasBrowser(), 'Playwright browsers not installed – skipping e2e')

/** Sixty seconds of continuous editing, as specified for the nightly soak. */
const SOAK_MS = Number(process.env.NIGHTLY_SOAK_MS ?? 60_000)
/** Replayable: change `NIGHTLY_SEED` to get a different but fixed workload. */
const SEED = Number(process.env.NIGHTLY_SEED ?? 20261008)

const NOTE_HALF = 100 // STICKY_SIZE_WORLD / 2

let session: Session | null = null

test.afterEach(async () => {
  if (session) {
    await session.close()
    session = null
  }
})

test.afterAll(() => {
  printLatencyReport()
})

// ── seeded randomness (mulberry32, same generator as the soak fixture) ──────

function createRng(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= (t >>> 7)
    t = Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
  }
}

type OpKind = 'create' | 'move' | 'recolour' | 'type' | 'delete'

const COLORS = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const
const WORDS = ['notes', 'idea', 'todo', 'spike', 'retry', 'paper', 'cloud', 'garden']

function pickOpKind(rng: ReturnType<typeof createRng>, noteCount: number): OpKind {
  if (noteCount === 0) return 'create'
  const roll = rng.next()
  if (roll < 0.4) return 'type'
  if (roll < 0.7) return 'move'
  if (roll < 0.8) return 'create'
  if (roll < 0.9) return 'recolour'
  return 'delete'
}

// ── the soak ─────────────────────────────────────────────────────────────────

test.describe('TC-30: capacity soak', () => {
  test(`${MAX_CONCURRENT_EDITORS} contexts edit one board for ${SOAK_MS / 1000}s and converge`, async ({
    browser,
  }) => {
    test.setTimeout(SOAK_MS + 180_000)
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, index) => `editor-${index}`)
    const session_ = await openSession(browser, makeBoardId(), names)
    session = session_
    const participants = session_.participants

    await waitForConvergence(participants)

    const rng = createRng(SEED)
    console.log(`[soak] seed=${SEED} editors=${MAX_CONCURRENT_EDITORS} duration=${SOAK_MS}ms`)

    const deadline = Date.now() + SOAK_MS
    let round = 0

    while (Date.now() < deadline) {
      round += 1
      // One concurrent round: every editor makes one random change, without
      // waiting for the others.
      const labels: string[] = []
      for (const participant of participants) {
        const label = await randomEdit(participant, rng)
        if (label) labels.push(`${participant.name}: ${label}`)
      }

      // Every change of this round must reach every other context; the wait
      // also records how long the round took (reported, never asserted).
      const label = `round ${round} (${labels.join(', ')})`
      await expectEventually(label, async () => {
        const snapshots = await Promise.all(participants.map(participant => snapshotOf(participant)))
        return snapshots.every(snapshot => sameSnapshot(snapshots[0]!, snapshot))
      })
    }

    // Quiet period: nothing may still be in flight.
    await new Promise(resolve => setTimeout(resolve, 2_000))
    const reference = await snapshotOf(participants[0])
    for (const participant of participants) {
      expect(await sameSnapshot(reference, await snapshotOf(participant))).toBe(true)
    }
    expect(reference.length).toBeGreaterThan(0)

    // No page errors during the soak.
    const errors = participants.flatMap(participant => participant.errors)
    expect(errors).toEqual([])

    console.log(`[soak] ${round} concurrent rounds over ${SOAK_MS}ms`)
  })
})

/** One random change, driven through the real UI.  Returns a description. */
async function randomEdit(participant: Participant, rng: ReturnType<typeof createRng>): Promise<string | null> {
  const page = participant.page
  const notes = await snapshotOf(participant)
  const kind = pickOpKind(rng, notes.length)

  if (kind === 'create') {
    const x = rng.int(900) + 150
    const y = rng.int(500) + 150
    await page.mouse.dblclick(x, y)
    // The new note opens in editing mode; type something into it.
    const editor = page.locator('[data-testid="sticky-textarea"]')
    if ((await editor.count()) > 0) {
      await editor.pressSequentially(`${rng.pick(WORDS)} `, { delay: 5 })
      await page.keyboard.press('Escape')
    }
    return `create at ${x},${y}`
  }

  const target = rng.pick(notes)
  const centre = await screenPointOf(participant, { x: target.x + NOTE_HALF, y: target.y + NOTE_HALF })

  switch (kind) {
    case 'move': {
      const dx = rng.int(320) - 160
      const dy = rng.int(240) - 120
      await mouseDrag(page, centre.x, centre.y, centre.x + dx, centre.y + dy)
      return `move ${target.id} by ${dx},${dy}`
    }
    case 'recolour': {
      await page.mouse.click(centre.x, centre.y)
      const color = rng.pick(COLORS)
      const swatch = page.locator(`[data-testid="color-swatch-${color}"]`)
      if ((await swatch.count()) === 0) return `move ${target.id} (no toolbar)`
      await swatch.click()
      return `recolour ${target.id} ${color}`
    }
    case 'delete': {
      await page.mouse.click(centre.x, centre.y)
      await page.keyboard.press('Delete')
      return `delete ${target.id}`
    }
    default: {
      await page.mouse.dblclick(centre.x, centre.y)
      const editor = page.locator('[data-testid="sticky-textarea"]')
      if ((await editor.count()) === 0) return `move ${target.id} (no editor)`
      await editor.click()
      await editor.press('End')
      await editor.pressSequentially(`${rng.pick(WORDS)} `, { delay: 5 })
      await page.keyboard.press('Escape')
      return `type in ${target.id}`
    }
  }
}
