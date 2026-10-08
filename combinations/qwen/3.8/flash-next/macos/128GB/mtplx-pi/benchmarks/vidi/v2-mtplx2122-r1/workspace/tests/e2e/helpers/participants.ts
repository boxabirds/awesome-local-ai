/**
 * Multi-participant helpers for the story 3 live-collaboration e2e tests.
 *
 * Each participant gets its own browser *context*, so nothing is shared
 * between them (storage, BroadcastChannel, sockets) except the board room on
 * the server.  Convergence is asserted with `expectEventually`, which is
 * `expect.poll` plus a latency measurement: the 1-second
 * LIVE_UPDATE_LATENCY_BUDGET_MS is reported at the end of the run, never
 * asserted — model, browsers and server share one machine here.
 */
import { Browser, BrowserContext, Page, expect } from '@playwright/test'
import { newBoardId } from '../../../src/shared/board-id'
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config'
import { getCamera, screenToWorld, worldToScreen } from './board'
import type { Camera } from '../../../src/client/canvas/camera'

export interface BoardSnapshotEntry {
  id: string
  x: number
  y: number
  color: string
  text: string
}

export interface Participant {
  name: string
  context: BrowserContext
  page: Page
  /** Console + page errors collected for this participant. */
  errors: string[]
}

export interface Session {
  boardId: string
  participants: Participant[]
  close(): Promise<void>
  byName(name: string): Participant
}

/** A fresh, collision-free board id (22-char base64url). */
export function makeBoardId(): string {
  return newBoardId()
}

const TEST_HOOK = '__vidi6'

/** Open one isolated context per name and wait until every client is synced. */
export async function openSession(
  browser: Browser,
  boardId: string,
  names: readonly string[],
  options: { waitForSync?: boolean } = {},
): Promise<Session> {
  const participants: Participant[] = []
  for (const name of names) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`[${name}] console: ${message.text()}`)
    })
    page.on('pageerror', error => errors.push(`[${name}] pageerror: ${String(error)}`))
    participants.push({ name, context, page, errors })
  }

  await Promise.all(
    participants.map(async participant => {
      await participant.page.goto(`/b/${boardId}`)
      if (options.waitForSync !== false) {
        await waitForSync(participant)
      }
    }),
  )

  return {
    boardId,
    participants,
    byName(name: string) {
      const found = participants.find(participant => participant.name === name)
      if (!found) throw new Error(`no participant called ${name}`)
      return found
    },
    async close() {
      await Promise.all(participants.map(participant => participant.context.close()))
    },
  }
}

/** True once the provider finished its first sync (`connected` hides the badge). */
export async function waitForSync(participant: Participant, timeout = 20_000): Promise<void> {
  await participant.page.waitForFunction(
    ({ hookName }: { hookName: string }) => {
      const hook = (window as unknown as Record<string, { connectionState?: string } | undefined>)[hookName]
      return hook?.connectionState === 'connected'
    },
    { hookName: '__vidi6' },
    { timeout },
  )
}

/**
 * Wait for every participant's board snapshot to be identical.
 * Returns the converged snapshot.
 */
export async function waitForConvergence(
  participants: readonly Participant[],
  timeout = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<BoardSnapshotEntry[]> {
  await expect
    .poll(
      async () => {
        const snapshots = await Promise.all(participants.map(participant => snapshotOf(participant)))
        return snapshots.every(snapshot => sameSnapshot(snapshots[0], snapshot))
      },
      { timeout },
    )
    .toBe(true)
  return snapshotOf(participants[0])
}

export function sameSnapshot(a: readonly BoardSnapshotEntry[], b: readonly BoardSnapshotEntry[]): boolean {
  if (a.length !== b.length) return false
  const key = (entry: BoardSnapshotEntry) => `${entry.id}|${entry.x}|${entry.y}|${entry.color}|${entry.text}`
  const left = [...a].map(key).sort()
  const right = [...b].map(key).sort()
  return left.every((value, index) => value === right[index])
}

/** The board snapshot each participant currently renders. */
export async function snapshotOf(participant: Participant): Promise<BoardSnapshotEntry[]> {
  const snapshot = await participant.page.evaluate(() => {
    const hook = (window as unknown as Record<string, { snapshot?(): BoardSnapshotEntry[] } | undefined>).__vidi6
    if (!hook?.snapshot) throw new Error(`${TEST_HOOK}.snapshot is not available in this build`)
    return hook.snapshot()
  })
  return snapshot
}

/** Note count rendered on a page (DOM, not doc). */
export async function noteCount(participant: Participant): Promise<number> {
  return participant.page.locator('[data-testid="sticky-note"]').count()
}

/** Badge text currently shown on a page (`null` when the badge is hidden). */
export async function badgeText(participant: Participant): Promise<string | null> {
  const badge = participant.page.locator('[data-testid="connection-status"]')
  if ((await badge.count()) === 0) return null
  return (await badge.textContent()) ?? null
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed'

export async function connectionState(participant: Participant): Promise<ConnectionState | 'unknown'> {
  return participant.page.evaluate(() => {
    const hook = (window as unknown as Record<string, { connectionState?: string } | undefined>).__vidi6
    return (hook?.connectionState as ConnectionState | undefined) ?? 'unknown'
  })
}

// ── eventual-assertion wrapper with latency reporting ────────────────────────

export interface LatencySample {
  label: string
  ms: number
}

const latencySamples_: LatencySample[] = []

export function latencySamples(): readonly LatencySample[] {
  return latencySamples_
}

/**
 * Poll `check` until it returns true, within the generous functional timeout.
 * Records how long the change took to appear; the budget is reported by
 * `printLatencyReport`, not asserted.
 */
export async function expectEventually(
  label: string,
  check: () => Promise<boolean> | boolean,
  options: { timeout?: number } = {},
): Promise<void> {
  const started = Date.now()
  await expect
    .poll(async () => check(), { timeout: options.timeout ?? E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(true)
  const ms = Date.now() - started
  latencySamples_.push({ label, ms })
}

export function printLatencyReport(): void {
  const samples = [...latencySamples_]
  if (samples.length === 0) {
    console.log('[latency] no samples recorded')
    return
  }
  const durations = samples.map(sample => sample.ms).sort((a, b) => a - b)
  const percentile = (fraction: number) =>
    durations[Math.min(durations.length - 1, Math.ceil(fraction * durations.length) - 1)]
  const overBudget = samples.filter(sample => sample.ms > LIVE_UPDATE_LATENCY_BUDGET_MS)
  console.log(
    `[latency] ${samples.length} changes; p50=${percentile(0.5)}ms p95=${percentile(0.95)}ms ` +
      `max=${durations[durations.length - 1]}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, reported only); ` +
      `${overBudget.length} over budget`,
  )
  for (const sample of overBudget) {
    console.log(`[latency]   over budget: ${sample.label} → ${sample.ms}ms`)
  }
}

// ── small UI conveniences ────────────────────────────────────────────────────

/** Screen position of a world point on a page (both pages share the camera). */
export async function screenPointOf(participant: Participant, world: { x: number; y: number }) {
  const camera = await getCamera(participant.page)
  return worldToScreen(camera as Camera, world)
}

/** World position of a point the participant clicked at (for drag assertions). */
export async function worldPointOfScreen(participant: Participant, screen: { x: number; y: number }) {
  const camera = await getCamera(participant.page)
  return screenToWorld(camera as Camera, screen)
}

/** Create a note through the page's own document (bypasses the pointer UI). */
export async function createNote(
  participant: Participant,
  x: number,
  y: number,
  color?: string,
): Promise<string> {
  return participant.page.evaluate(
    ({ x, y, color }) => {
      const hook = (
        window as unknown as Record<string, { createNote(x: number, y: number, color?: string): string } | undefined>
      ).__vidi6
      if (!hook?.createNote) throw new Error(`${TEST_HOOK}.createNote is not available in this build`)
      return hook.createNote(x, y, color)
    },
    { x, y, color },
  )
}

/**
 * Record the badge text every 50 ms so a test can assert the whole
 * Reconnecting → Connected → hidden sequence, not just one sample of it.
 */
export async function startBadgeSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __badgeLog?: Array<string | null>; __badgeTimer?: number }
    store.__badgeLog = []
    const read = () => {
      const element = document.querySelector('[data-testid="connection-status"]')
      store.__badgeLog?.push(element ? element.textContent : null)
    }
    read()
    store.__badgeTimer = window.setInterval(read, 50)
  })
}

/** Read (and stop) the badge sampler. */
export async function badgeLog(page: Page): Promise<Array<string | null>> {
  return page.evaluate(() => {
    const store = window as unknown as { __badgeLog?: Array<string | null>; __badgeTimer?: number }
    if (store.__badgeTimer !== undefined) window.clearInterval(store.__badgeTimer)
    return store.__badgeLog ?? []
  })
}
