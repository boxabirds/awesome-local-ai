// Story 8 — per-user undo history contract (undo.history).
//
// Each case runs `createUndo` over real Y.Docs.  Remote work is authored on a
// second, linked `Y.Doc` so it reaches the local doc with a non-local origin
// (see `./peer`), proving the controller captures only this tab's own
// `LOCAL_ORIGIN` transactions.
import { describe, it, expect, afterEach } from 'vitest'
import * as Y from 'yjs'
import { createUndo, type UndoController } from '../../src/client/board/undo'
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model'
import { linkPeers, applyLoad, type PeerPair } from './peer'
import { UNDO_MAX_STEPS } from '../../src/shared/config'

// ── helpers ──────────────────────────────────────────────────────────────────

let controller: UndoController | null = null
let peer: PeerPair | null = null

afterEach(() => {
  controller?.destroy()
  controller = null
  peer?.disconnect()
  peer = null
})

/** Seed notes on `doc` and mirror them onto the linked peer (not tracked). */
function seed(doc: Y.Doc, spots: Array<{ x: number; y: number }>): string[] {
  return spots.map(s => createSticky(doc, s))
}

function pos(doc: Y.Doc, id: string): { x: number; y: number } {
  const entry = snapshot(doc).find(n => n.id === id)
  return entry ? { x: entry.x, y: entry.y } : { x: NaN, y: NaN }
}

function color(doc: Y.Doc, id: string): string | undefined {
  return snapshot(doc).find(n => n.id === id)?.color
}

function hasNote(doc: Y.Doc, id: string): boolean {
  return snapshot(doc).some(n => n.id === id)
}

// ── TC-01: only my own changes are undone ───────────────────────────────────

describe('TC-01 undo reverses my move but leaves remote work intact', () => {
  it('move X; peer creates Y and recolours Z; undo → X restored, Y present, Z keeps peer colour', () => {
    peer = linkPeers()
    const { local, peer: remote } = peer
    // Seed X and Z on both screens before the controller exists.
    const [x, z] = seed(local, [{ x: 110, y: 110 }, { x: 400, y: 200 }])
    const startOfX = pos(local, x)

    controller = createUndo(local)

    // My change: move X.
    moveObject(local, x, 300, 300)
    expect(pos(local, x)).not.toEqual(startOfX)

    // Peer work, applied with the provider origin.
    const y = createSticky(remote, { x: 600, y: 300 })
    setStickyColor(remote, z, 'blue')

    // Only my move is undoable; peer work never entered the stack.
    expect(controller.canUndo()).toBe(true)
    expect(controller.undoStackLength()).toBe(1)

    expect(controller.undo()).toBe(true)

    // X is back where it started …
    expect(pos(local, x)).toEqual(startOfX)
    // … peer's new note Y still exists …
    expect(hasNote(local, y)).toBe(true)
    // … and Z keeps the peer's recolour.
    expect(color(local, z)).toBe('blue')

    const errors: string[] = []
    expect(errors).toEqual([])
  })
})

// ── TC-02 / TC-03: remote and load updates are never captured ───────────────

describe('TC-02 remote-only changes leave the undo stack empty', () => {
  it('peer changes only → canUndo false', () => {
    peer = linkPeers()
    const { local, peer: remote } = peer
    const [z] = seed(local, [{ x: 110, y: 110 }])
    controller = createUndo(local)

    createSticky(remote, { x: 300, y: 300 })
    setStickyColor(remote, z, 'green')

    expect(controller.canUndo()).toBe(false)
    expect(controller.undo()).toBe(false)
  })
})

describe('TC-03 load-origin updates leave the undo stack empty', () => {
  it('board content applied with the LOAD origin → canUndo false', () => {
    const local = new Y.Doc()
    const source = new Y.Doc()
    createSticky(source, { x: 100, y: 100 })
    createSticky(source, { x: 300, y: 100 })

    controller = createUndo(local)
    applyLoad(local, Y.encodeStateAsUpdate(source))

    // The board now shows two notes, but none of it is mine to undo.
    expect(snapshot(local).length).toBe(2)
    expect(controller.canUndo()).toBe(false)
    expect(controller.undo()).toBe(false)
  })
})

// ── TC-04: undo a multi-object delete restores everything ───────────────────

describe('TC-04 undoing a delete restores all deleted notes intact', () => {
  it('delete 8 notes, undo → all restored with text, colour, size, position', () => {
    const local = new Y.Doc()
    const ids: string[] = []
    const created: Array<{ text: string; color: string; x: number; y: number }> = []
    const colors = ['yellow', 'blue', 'green', 'pink'] as const
    for (let i = 0; i < 8; i++) {
      const id = createSticky(local, { x: i * 50, y: (i % 3) * 40 }, colors[i % 4])
      getStickyText(local, id)?.insert(0, `note ${i}`)
      ids.push(id)
      const snap = snapshot(local).find(n => n.id === id)!
      created.push({ text: snap.text, color: snap.color, x: snap.x, y: snap.y })
    }

    controller = createUndo(local)
    controller.boundary()

    // One delete action of eight objects (each is its own LOCAL_ORIGIN call,
    // but they fall in one capture window → one step).
    for (const id of ids) deleteObject(local, id)
    expect(snapshot(local).length).toBe(0)
    expect(controller.undoStackLength()).toBe(1)

    expect(controller.undo()).toBe(true)

    const restored = snapshot(local)
    expect(restored.length).toBe(8)
    for (let i = 0; i < 8; i++) {
      const snap = restored.find(n => n.id === ids[i])!
      expect(snap.text).toBe(created[i].text)
      expect(snap.color).toBe(created[i].color)
      expect(snap.x).toBeCloseTo(created[i].x, 6)
      expect(snap.y).toBeCloseTo(created[i].y, 6)
    }
  })
})

// ── TC-05 / TC-06: redo and redo clearing ───────────────────────────────────

describe('TC-05 redo re-applies my undone move', () => {
  it('undo then redo → position re-applied', () => {
    const local = new Y.Doc()
    const [x] = seed(local, [{ x: 110, y: 110 }])
    const start = pos(local, x)
    controller = createUndo(local)

    moveObject(local, x, 300, 300)
    const moved = pos(local, x)

    expect(controller.undo()).toBe(true)
    expect(pos(local, x)).toEqual(start)
    expect(controller.canRedo()).toBe(true)

    expect(controller.redo()).toBe(true)
    expect(pos(local, x)).toEqual(moved)
    expect(controller.canRedo()).toBe(false)
  })
})

describe('TC-06 a new change after undo clears redo', () => {
  it('undo, then new change → canRedo false', () => {
    const local = new Y.Doc()
    const [x, y] = seed(local, [{ x: 110, y: 110 }, { x: 400, y: 400 }])
    controller = createUndo(local)

    moveObject(local, x, 300, 300)
    controller.boundary()
    expect(controller.undo()).toBe(true)
    expect(controller.canRedo()).toBe(true)

    // A brand-new change discards the redo stack.
    moveObject(local, y, 50, 50)
    expect(controller.canRedo()).toBe(false)
  })
})

// ── TC-07: undo never breaks on a remotely deleted object ───────────────────

describe('TC-07 undoing a move whose target was deleted remotely', () => {
  it('no throw, object stays deleted, next undo still works', () => {
    peer = linkPeers()
    const { local, peer: remote } = peer
    const [x, y] = seed(local, [{ x: 110, y: 110 }, { x: 400, y: 400 }])
    controller = createUndo(local)

    // I move X (one step).
    moveObject(local, x, 300, 300)
    controller.boundary()

    // Peer deletes X — arrives with the provider origin.
    deleteObject(remote, x)
    expect(hasNote(local, x)).toBe(false)

    // Undoing my move finds the note gone: nothing happens, no error thrown.
    let threw = false
    try {
      controller.undo()
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(hasNote(local, x)).toBe(false) // not recreated

    // The rest of the history is still usable.
    moveObject(local, y, 50, 50)
    controller.boundary()
    const before = pos(local, y)
    expect(controller.undo()).toBe(true)
    expect(pos(local, y)).not.toEqual(before)
  })
})

// ── TC-08: undo my delete of a note somebody else was editing ──────────────

describe('TC-08 undoing my delete restores the content as of the delete', () => {
  it('peer edits the text, I delete, undo → restored with content at delete time', () => {
    peer = linkPeers()
    const { local, peer: remote } = peer
    const [s] = seed(local, [{ x: 110, y: 110 }])
    controller = createUndo(local)

    // Peer types into the shared note; it reaches my screen with a remote origin.
    getStickyText(remote, s)?.insert(0, 'peer-text')
    expect(getStickyText(local, s)?.toString()).toBe('peer-text')

    // I delete it (one step).
    controller.boundary()
    deleteObject(local, s)
    expect(hasNote(local, s)).toBe(false)

    // Undo brings it back with the text as it was at the moment I deleted.
    expect(controller.undo()).toBe(true)
    expect(hasNote(local, s)).toBe(true)
    expect(getStickyText(local, s)?.toString()).toBe('peer-text')
  })
})

// ── TC-09 / TC-10: history length boundaries ────────────────────────────────

describe('TC-09 history caps at UNDO_MAX_STEPS and drops the oldest', () => {
  it('add UNDO_MAX_STEPS + 1 single-object creates → length stays at the cap', () => {
    const local = new Y.Doc()
    controller = createUndo(local)

    const ids: string[] = []
    for (let i = 0; i < UNDO_MAX_STEPS + 1; i++) {
      const id = createSticky(local, { x: i * 10, y: 0 })
      ids.push(id)
      controller.boundary() // each create is its own undo step
    }

    // The oldest step was discarded; the cap is exactly maintained.
    expect(controller.undoStackLength()).toBe(UNDO_MAX_STEPS)

    // Undoing every retained step removes 200 notes, leaving the very first
    // note whose step was dropped behind (it is no longer mine to undo).
    let guard = UNDO_MAX_STEPS + 5
    while (controller.canUndo() && guard-- > 0) controller.undo()
    expect(snapshot(local).length).toBe(1)
    expect(hasNote(local, ids[0])).toBe(true)
  })
})

describe('TC-10 adding one step below the cap drops nothing', () => {
  it('UNDO_MAX_STEPS − 1 + 1 → length reaches the cap, nothing dropped', () => {
    const local = new Y.Doc()
    controller = createUndo(local)

    // 199 single-object creates, each its own step, all tracked.
    for (let i = 0; i < UNDO_MAX_STEPS - 1; i++) {
      createSticky(local, { x: i * 10, y: 0 })
      controller.boundary()
    }
    expect(controller.undoStackLength()).toBe(UNDO_MAX_STEPS - 1)

    // One more step reaches the cap exactly; nothing is discarded yet.
    createSticky(local, { x: 9999, y: 9999 })
    controller.boundary()
    expect(controller.undoStackLength()).toBe(UNDO_MAX_STEPS)

    // Undoing all 200 steps empties the board → nothing was dropped.
    let guard = UNDO_MAX_STEPS + 5
    while (controller.canUndo() && guard-- > 0) controller.undo()
    expect(snapshot(local).length).toBe(0)
  })
})

// ── TC-11: history does not survive a controller swap (reload) ──────────────

describe('TC-11 a fresh controller starts with an empty history', () => {
  it('destroy then new controller → canUndo false', () => {
    const local = new Y.Doc()
    const [x] = seed(local, [{ x: 110, y: 110 }])
    controller = createUndo(local)
    moveObject(local, x, 300, 300)
    expect(controller.canUndo()).toBe(true)

    controller.destroy()
    const reloaded = createUndo(local)
    expect(reloaded.canUndo()).toBe(false)
    expect(reloaded.undo()).toBe(false)
    reloaded.destroy()
  })
})