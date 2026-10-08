/**
 * Story 3 — live collaboration e2e (TC-22 to TC-28).
 *
 * Participants live in separate browser contexts and talk to each other only
 * through the Worker + Durable Object room (`tools/e2e-server.mjs`, workerd).
 * Functional assertions use the generous E2E_EVENTUAL_TIMEOUT_MS; per-change
 * latency is measured and printed, never asserted (one shared machine).
 */
import { test, expect } from '@playwright/test'
import { hasBrowser } from './helpers/browsers'
import { mouseDrag, setCamera } from './helpers/board'
import {
  CATCH_UP_TEST_OUTAGE_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config'
import {
  badgeLog,
  connectionState,
  createNote,
  expectEventually,
  makeBoardId,
  noteCount,
  openSession,
  printLatencyReport,
  sameSnapshot,
  screenPointOf,
  snapshotOf,
  startBadgeSampler,
  waitForConvergence,
  type Participant,
  type Session,
} from './helpers/participants'

test.skip(!hasBrowser(), 'Playwright browsers not installed – skipping e2e')

// TC-27 contains a 30-second outage; everything else just needs sync headroom.
test.setTimeout(180_000)

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

// ── local helpers ────────────────────────────────────────────────────────────

const NOTE_HALF = 100 // STICKY_SIZE_WORLD / 2

async function noteById(participant: Participant, noteId: string) {
  return (await snapshotOf(participant)).find(entry => entry.id === noteId)
}

async function noteCentreOnScreen(participant: Participant, noteId: string) {
  const note = await noteById(participant, noteId)
  if (!note) throw new Error(`note ${noteId} is not on ${participant.name}'s board`)
  return screenPointOf(participant, { x: note.x + NOTE_HALF, y: note.y + NOTE_HALF })
}

/** Enter edit mode on the note under (x, y) and type at the given caret. */
async function typeIntoNote(
  participant: Participant,
  screen: { x: number; y: number },
  text: string,
  caret: 'start' | 'end' = 'end',
): Promise<void> {
  const page = participant.page
  await page.mouse.dblclick(screen.x, screen.y)
  const editor = page.locator('[data-testid="sticky-textarea"]')
  await editor.waitFor({ state: 'visible', timeout: 5_000 })
  await editor.click()
  await editor.press(caret === 'start' ? 'Home' : 'End')
  await editor.pressSequentially(text, { delay: 10 })
}

// ── TC-22: two-person workshop, one change of each kind ─────────────────────

test.describe('TC-22 every operation kind reaches the other person', () => {
  test('create, move, recolour, type and delete all propagate', async ({ browser }) => {
    const session_ = await openSession(browser, makeBoardId(), ['Alex', 'Sam'])
    session = session_
    const alex = session_.byName('Alex')
    const sam = session_.byName('Sam')

    // 1. CREATE — double-click on empty board space creates a note there.
    await alex.page.mouse.dblclick(400, 300)
    await expectEventually('TC-22 create → Sam', async () => (await noteCount(sam)) === 1)
    const [note] = await snapshotOf(alex)
    expect(note).toBeDefined()

    // 2. MOVE — drag the note somewhere else.
    const beforeMove = (await snapshotOf(alex))[0]
    const from = await noteCentreOnScreen(alex, note.id)
    await mouseDrag(alex.page, from.x, from.y, Math.min(from.x + 300, 1200), Math.max(from.y - 150, 60))
    await expectEventually('TC-22 move → Sam', async () => {
      const mine = await noteById(alex, note.id)
      const theirs = await noteById(sam, note.id)
      if (!mine || !theirs) return false
      const moved = Math.abs(mine.x - beforeMove.x) + Math.abs(mine.y - beforeMove.y) > 5
      return moved && Math.abs(mine.x - theirs.x) < 0.5 && Math.abs(mine.y - theirs.y) < 0.5
    })

    // 3. RECOLOUR — select, then pick the blue swatch.
    const centre = await noteCentreOnScreen(alex, note.id)
    await alex.page.mouse.click(centre.x, centre.y)
    const swatch = alex.page.locator('[data-testid="color-swatch-blue"]')
    await swatch.waitFor({ state: 'visible', timeout: 5_000 })
    await swatch.click()
    await expectEventually('TC-22 recolour → Sam', async () => {
      const mine = await noteById(alex, note.id)
      const theirs = await noteById(sam, note.id)
      return mine?.color === 'blue' && theirs?.color === 'blue'
    })

    // 4. TYPE — double-click into the note and type a sentence.
    const typed = 'hello from Alex'
    await typeIntoNote(alex, await noteCentreOnScreen(alex, note.id), typed)
    await expectEventually('TC-22 typing → Sam', async () => (await noteById(sam, note.id))?.text === typed)

    // 5. DELETE — Escape out of the editor (the note stays selected), then Delete.
    await alex.page.keyboard.press('Escape')
    await alex.page.waitForTimeout(150)
    await alex.page.keyboard.press('Delete')
    await expectEventually('TC-22 delete → Sam', async () => {
      return (await snapshotOf(alex)).length === 0 && (await snapshotOf(sam)).length === 0
    })

    const errors = [...alex.errors, ...sam.errors].filter(error => !error.includes('favicon'))
    expect(errors).toEqual([])
  })
})

// ── TC-23: concurrent typing in one note ────────────────────────────────────

test.describe('TC-23 both people type into the same note at the same time', () => {
  test('the merge keeps every typed character and both screens agree', async ({ browser }) => {
    const session_ = await openSession(browser, makeBoardId(), ['Alex', 'Sam'])
    session = session_
    const alex = session_.byName('Alex')
    const sam = session_.byName('Sam')

    // One shared note, seeded with 'green' and synced to both screens.
    await createNote(alex, 0, 0)
    await expectEventually('TC-23 seed note', async () => (await noteCount(sam)) === 1)
    await typeIntoNote(alex, await screenPointOf(alex, { x: 0, y: 0 }), 'green')
    await expectEventually('TC-23 seed text', async () => {
      const notes = await snapshotOf(sam)
      return notes.length === 1 && notes[0].text === 'green'
    })
    const noteId = (await snapshotOf(alex))[0].id
    const centre = await noteCentreOnScreen(alex, noteId)

    // Both open the same note and type without waiting for each other:
    // Alex at the start of the line, Sam at the end.
    await alex.page.mouse.dblclick(centre.x, centre.y)
    await sam.page.mouse.dblclick(centre.x, centre.y)
    const alexEditor = alex.page.locator('[data-testid="sticky-textarea"]')
    const samEditor = sam.page.locator('[data-testid="sticky-textarea"]')
    await alexEditor.waitFor({ state: 'visible', timeout: 5_000 })
    await samEditor.waitFor({ state: 'visible', timeout: 5_000 })

    await Promise.all([
      (async () => {
        await alexEditor.click()
        await alexEditor.press('Home')
        await alexEditor.pressSequentially('red ', { delay: 15 })
      })(),
      (async () => {
        await samEditor.click()
        await samEditor.press('End')
        await samEditor.pressSequentially(' blue', { delay: 15 })
      })(),
    ])

    // Both screens converge on identical text, with no keystroke lost.
    await expectEventually('TC-23 merged text on both screens', async () => {
      const mine = await noteById(alex, noteId)
      const theirs = await noteById(sam, noteId)
      return !!mine && !!theirs && mine.text === theirs.text && mine.text.length === 'red green blue'.length
    })
    expect((await noteById(alex, noteId))?.text).toBe('red green blue')
    expect((await noteById(sam, noteId))?.text).toBe('red green blue')
  })
})

// ── TC-24: concurrent dragging of one note ──────────────────────────────────

test.describe('TC-24 both people drag the same note', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'chromium-only: drag geometry')

  test('the note settles on one identical position on both screens', async ({ browser }) => {
    const session_ = await openSession(browser, makeBoardId(), ['Alex', 'Sam'])
    session = session_
    const alex = session_.byName('Alex')
    const sam = session_.byName('Sam')

    await createNote(alex, 0, 0)
    await expectEventually('TC-24 seed note', async () => (await noteCount(sam)) === 1)
    const noteId = (await snapshotOf(alex))[0].id
    const centre = await noteCentreOnScreen(alex, noteId)

    await Promise.all([
      mouseDrag(alex.page, centre.x, centre.y, centre.x - 250, centre.y + 120),
      mouseDrag(sam.page, centre.x, centre.y, centre.x + 250, centre.y - 120),
    ])

    const settleStarted = Date.now()
    await expectEventually('TC-24 drag settles on one position', async () => {
      const mine = await noteById(alex, noteId)
      const theirs = await noteById(sam, noteId)
      return !!mine && !!theirs && mine.x === theirs.x && mine.y === theirs.y
    })
    const settleMs = Date.now() - settleStarted
    console.log(`[latency] TC-24 drag settle (one position wins): ${settleMs}ms`)

    // Identical *and* stable: a second read after a quiet moment must not flip.
    await alex.page.waitForTimeout(600)
    const mine = await noteById(alex, noteId)
    const theirs = await noteById(sam, noteId)
    expect(mine?.x).toBe(theirs?.x)
    expect(mine?.y).toBe(theirs?.y)
    expect(await noteCount(sam)).toBe(1)
  })
})

// ── TC-25: delete while somebody else is editing ────────────────────────────

test.describe('TC-25 deleting a note that somebody else is editing', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'chromium-only: delete during edit')

  test('the note and its editor disappear on the editing screen, no errors', async ({ browser }) => {
    const session_ = await openSession(browser, makeBoardId(), ['Alex', 'Sam'])
    session = session_
    const alex = session_.byName('Alex')
    const sam = session_.byName('Sam')

    await createNote(alex, 0, 0)
    await expectEventually('TC-25 seed note', async () => (await noteCount(sam)) === 1)
    const centre = await screenPointOf(alex, { x: 0, y: 0 })

    // Sam starts typing in the note.
    await typeIntoNote(sam, centre, 'working on my ')

    // Alex deletes it while Sam is mid-edit.
    await alex.page.mouse.click(centre.x, centre.y)
    const toolbar = alex.page.locator('[data-testid="note-toolbar"]')
    await toolbar.waitFor({ state: 'visible', timeout: 5_000 })
    await alex.page.locator('[data-testid="delete-note-btn"]').click()

    await expectEventually('TC-25 note and editor gone for Sam', async () => {
      const notes = await sam.page.locator('[data-testid="sticky-note"]').count()
      const editors = await sam.page.locator('[data-testid="sticky-textarea"]').count()
      const toolbars = await sam.page.locator('[data-testid="note-toolbar"]').count()
      return notes === 0 && editors === 0 && toolbars === 0
    })

    const errors = [...alex.errors, ...sam.errors].filter(error => !error.includes('favicon'))
    expect(errors).toEqual([])
  })
})

// ── TC-26: full-capacity session ────────────────────────────────────────────

test.describe('TC-26 full-capacity session', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'chromium-only: capacity soak')

  test(`${MAX_CONCURRENT_EDITORS} editors create and move notes; all boards end up identical`, async ({ browser }) => {
    const NOTES_PER_EDITOR = 5
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, index) => `Editor${index}`)
    const session_ = await openSession(browser, makeBoardId(), names)
    session = session_

    // Zoom out so every note is on screen for every editor (world y −350…730).
    for (const participant of session_.participants) {
      await setCamera(participant.page, { x: -640, y: -400, zoom: 0.5 })
    }

    // Layout: editor i's notes in a row at y = −350 + i·220, spaced 220 apart,
    // so no two notes overlap and every drag hits exactly one note.
    const layout = names.map((_, index) =>
      Array.from({ length: NOTES_PER_EDITOR }, (_, col) => ({
        x: -500 + col * 220,
        y: -350 + index * 220,
      })),
    )

    // Every editor creates their five notes at once.
    await Promise.all(
      session_.participants.map(async (participant, index) => {
        for (const spot of layout[index]) await createNote(participant, spot.x, spot.y)
      }),
    )

    await expectEventually('TC-26 all 25 notes on every screen', async () => {
      const counts = await Promise.all(session_!.participants.map(participant => noteCount(participant)))
      return counts.every(count => count === MAX_CONCURRENT_EDITORS * NOTES_PER_EDITOR)
    }, { timeout: 40_000 })

    await waitForConvergence(session_.participants, 30_000)

    // Then every editor moves their own five notes.
    await Promise.all(
      session_.participants.map(async (participant, index) => {
        for (const spot of layout[index]) {
          const centre = await screenPointOf(participant, { x: spot.x, y: spot.y })
          await mouseDrag(participant.page, centre.x, centre.y, centre.x - 30, centre.y + 20)
        }
      }),
    )

    await expectEventually('TC-26 final documents identical', async () => {
      const snapshots = await Promise.all(session_!.participants.map(participant => snapshotOf(participant)))
      return snapshots.every(snapshot => sameSnapshot(snapshots[0], snapshot))
    }, { timeout: 40_000 })

    // …and the rendered DOM agrees, not just the document.
    const domSnapshots = await Promise.all(
      session_.participants.map(participant =>
        participant.page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-testid="sticky-note"]'))
            .map(element => {
              const style = getComputedStyle(element)
              return `${element.getAttribute('data-note-id')}@${style.left},${style.top}/${style.backgroundColor}`
            })
            .sort(),
        ),
      ),
    )
    expect(domSnapshots[0].length).toBe(MAX_CONCURRENT_EDITORS * NOTES_PER_EDITOR)
    expect(domSnapshots.every(entries => entries.join('|') === domSnapshots[0].join('|'))).toBe(true)

    const errors = session_.participants.flatMap(participant => participant.errors)
    expect(errors.filter(error => !error.includes('favicon'))).toEqual([])
  })
})

// ── TC-27: flaky Wi-Fi ──────────────────────────────────────────────────────

test.describe('TC-27 flaky Wi-Fi: a 30-second outage on one screen', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'chromium-only: offline emulation')

  test('badge goes Reconnecting → Connected and both screens catch up', async ({ browser }) => {
    const session_ = await openSession(browser, makeBoardId(), ['Alex', 'Sam'])
    session = session_
    const alex = session_.byName('Alex')
    const sam = session_.byName('Sam')
    await startBadgeSampler(alex.page)

    // Cut Alex's network for CATCH_UP_TEST_OUTAGE_MS; the page stays open.
    await alex.context.setOffline(true)

    await expectEventually('TC-27 Alex notices the outage', async () => {
      const state = await connectionState(alex)
      return state === 'reconnecting'
    }, { timeout: 45_000 })

    // Both keep working during the outage: three notes each, local edits only.
    for (const row of [0, 1, 2]) await createNote(alex, -300 + row * 60, -200)
    for (const row of [0, 1, 2]) await createNote(sam, 100 + row * 60, -200)

    const remaining = CATCH_UP_TEST_OUTAGE_MS - 6_000
    if (remaining > 0) await alex.page.waitForTimeout(remaining)

    await alex.context.setOffline(false)

    // Reconnected: green confirmation badge …
    await expectEventually('TC-27 Alex reconnects', async () => {
      const state = await connectionState(alex)
      return state === 'confirmed' || state === 'connected'
    }, { timeout: 30_000 })

    // … which disappears again once the confirmation window is over.
    await expectEventually('TC-27 badge hides after confirming', async () => {
      const log = await alex.page.evaluate(() => (window as unknown as { __badgeLog?: string[] }).__badgeLog ?? [])
      return log.length > 0 && log[log.length - 1] === null
    }, { timeout: 15_000 })

    const badgeSequence = await alex.page.evaluate(() => {
      const log = (window as unknown as { __badgeLog?: Array<string | null> }).__badgeLog ?? []
      // Collapse repeats into a transition sequence.
      return log.filter((value, index) => value !== log[index - 1])
    })
    console.log(`[badge] Alex: ${JSON.stringify(badgeSequence)}`)
    expect(badgeSequence).toContain('Reconnecting…')
    expect(badgeSequence).toContain('Connected')

    // Everyone ends up with all six notes.
    await expectEventually('TC-27 six notes on both screens', async () => {
      const counts = await Promise.all(session_!.participants.map(participant => noteCount(participant)))
      return counts.every(count => count === 6)
    }, { timeout: 30_000 })

    await waitForConvergence(session_.participants, 20_000)
    const errors = [...alex.errors, ...sam.errors].filter(error => !error.includes('favicon'))
    expect(errors).toEqual([])
  })
})

// ── TC-28: selection and editing stay personal ──────────────────────────────

test.describe('TC-28 selection never propagates', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'chromium-only: local selection')

  test("Alex selecting and editing a note changes nothing on Sam's screen", async ({ browser }) => {
    const session_ = await openSession(browser, makeBoardId(), ['Alex', 'Sam'])
    session = session_
    const alex = session_.byName('Alex')
    const sam = session_.byName('Sam')

    await createNote(alex, 0, 0)
    await expectEventually('TC-28 seed note', async () => (await noteCount(sam)) === 1)
    const centre = await screenPointOf(alex, { x: 0, y: 0 })

    // Alex selects the note, then edits it.
    await alex.page.mouse.click(centre.x, centre.y)
    await alex.page.waitForTimeout(200)
    await alex.page.mouse.dblclick(centre.x, centre.y)
    const editor = alex.page.locator('[data-testid="sticky-textarea"]')
    await editor.waitFor({ state: 'visible', timeout: 5_000 })
    await editor.pressSequentially('only mine', { delay: 10 })

    // Alex really is editing — otherwise Sam's silence would prove nothing.
    await expect(alex.page.locator('[data-testid="sticky-textarea"]')).toBeVisible()
    await expect(alex.page.locator('[data-testid="sticky-note"][data-selected="true"]')).toBeVisible()

    // The text propagates …
    await expectEventually('TC-28 text propagates to Sam', async () => {
      const notes = await snapshotOf(sam)
      return notes[0]?.text === 'only mine'
    })

    // … but Sam never gets a selection outline, an editor or a toolbar.
    await sam.page.waitForTimeout(500)
    expect(await sam.page.locator('[data-testid="sticky-textarea"]').count()).toBe(0)
    expect(await sam.page.locator('[data-testid="sticky-note"][data-selected="true"]').count()).toBe(0)
    expect(await sam.page.locator('[data-testid="note-toolbar"]').count()).toBe(0)
  })
})
