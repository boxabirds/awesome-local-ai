// Story 8 — typing-burst capture window (undo.boundaries).
//
// `Y.UndoManager` decides whether a transaction merges into the current step by
// comparing `Date.now()` deltas against `captureTimeout` (500 ms).  To exercise
// the exact boundary values deterministically we replace `lib0/time`'s
// `getUnixTime` (the clock the bundle reads) with a controllable one via
// `vi.mock`, then advance it by the precise gap each case needs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vi } from 'vitest'

// The mocked `getUnixTime` is read by lib0/yjs during module *import*, before
// this file's own top-level code runs, so the mutable clock lives inside the
// mock factory (hoisted above the imports) and is reached through a global
// handle.  Tests advance it with `advanceClock`.
// The mocked `getUnixTime` is read by lib0/yjs during module *import*, before
// this file's own top-level code runs, so the mutable clock lives inside the
// mock factory (a self-contained closure, hoisted above the imports) and is
// reached through a global handle.  Tests advance it with `advanceClock`.
vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lib0/time')>()
  const clock = { ms: 100_000 }
  ;(globalThis as any).__undoClock = clock
  return {
    ...actual,
    getUnixTime: () => clock.ms,
  }
})

const advanceClock = (ms: number) => {
  ;(globalThis as any).__undoClock.ms += ms
}

import * as Y from 'yjs'
import { createUndo, type UndoController } from '../../src/client/board/undo'
import { createSticky, getStickyText, LOCAL_ORIGIN } from '../../src/shared/board-model'
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config'

let controller: UndoController | null = null

beforeEach(() => {
  ;(globalThis as any).__undoClock.ms = 100_000
})

afterEach(() => {
  controller?.destroy()
  controller = null
})

/** A doc with one pre-seeded sticky (its create predates the controller). */
function docWithNote(text = '') {
  const doc = new Y.Doc()
  const id = createSticky(doc, { x: 0, y: 0 })
  if (text) getStickyText(doc, id)?.insert(0, text)
  return { doc, id }
}

function typeChunk(doc: Y.Doc, id: string, chunk: string) {
  const text = getStickyText(doc, id)
  doc.transact(() => {
    text!.insert(text!.length, chunk)
  }, LOCAL_ORIGIN)
}

// ── TC-12: a continuous burst is one step ───────────────────────────────────

describe('TC-12 keystrokes 100 ms apart form one undo step', () => {
  it('inserts 100 ms apart between two boundaries → one step; undo removes the burst', () => {
    const { doc, id } = docWithNote()
    controller = createUndo(doc)
    controller.boundary() // start a fresh capture window

    for (const chunk of ['a', 'b', 'c', 'd', 'e']) {
      typeChunk(doc, id, chunk)
      advanceClock(100)
    }
    controller.boundary()

    // Five inserts 100 ms apart (< 500 ms) collapsed into a single step.
    expect(controller.undoStackLength()).toBe(1)
    expect(getStickyText(doc, id)?.toString()).toBe('abcde')

    // One undo removes the whole burst at once.
    expect(controller.undo()).toBe(true)
    expect(getStickyText(doc, id)?.toString()).toBe('')
    expect(controller.canUndo()).toBe(false)
  })
})

// ── TC-13: the capture boundary value splits or merges a burst ──────────────

describe('TC-13 the pause length at UNDO_CAPTURE_TIMEOUT_MS decides the step count', () => {
  it('a pause of exactly the timeout → two steps', () => {
    const { doc, id } = docWithNote()
    controller = createUndo(doc)
    controller.boundary()

    typeChunk(doc, id, 'foo')
    advanceClock(UNDO_CAPTURE_TIMEOUT_MS) // exactly the window → next insert is a new step
    typeChunk(doc, id, 'bar')
    controller.boundary()

    expect(controller.undoStackLength()).toBe(2)

    // Undo peels the steps back one at a time.
    expect(controller.undo()).toBe(true)
    expect(getStickyText(doc, id)?.toString()).toBe('foo')
    expect(controller.undo()).toBe(true)
    expect(getStickyText(doc, id)?.toString()).toBe('')
  })

  it('a pause of one ms below the timeout → one step', () => {
    const { doc, id } = docWithNote()
    controller = createUndo(doc)
    controller.boundary()

    typeChunk(doc, id, 'foo')
    advanceClock(UNDO_CAPTURE_TIMEOUT_MS - 1) // just inside the window → merges
    typeChunk(doc, id, 'bar')
    controller.boundary()

    expect(controller.undoStackLength()).toBe(1)

    // The whole merged burst comes back as one step.
    expect(controller.undo()).toBe(true)
    expect(getStickyText(doc, id)?.toString()).toBe('')
  })

  it('boundary() on an empty stack is a no-op (error path)', () => {
    const { doc } = docWithNote('seeded before the controller existed')
    controller = createUndo(doc)
    expect(controller.canUndo()).toBe(false)
    expect(() => controller!.boundary()).not.toThrow()
    expect(controller.canUndo()).toBe(false)
    expect(controller.undo()).toBe(false)
  })
})
