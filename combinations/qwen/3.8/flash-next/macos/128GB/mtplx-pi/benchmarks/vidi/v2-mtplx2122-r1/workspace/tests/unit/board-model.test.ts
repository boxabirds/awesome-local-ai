import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import {
  initDoc,
  createSticky,
  moveObject,
  bringToFront,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
} from '../../src/shared/board-model'
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from '../../src/shared/config'

// ── helpers ──────────────────────────────────────────────────────────────────

function freshDoc(): Y.Doc {
  const d = new Y.Doc()
  initDoc(d)
  return d
}

function countUpdates(doc: Y.Doc): () => number {
  let n = 0
  doc.on('update', () => { n++ })
  return () => n
}

// ── TC-01 ─────────────────────────────────────────────────────────────────────

describe('TC-01 createSticky on empty doc', () => {
  it('adds one object with correct fields', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    const half = STICKY_SIZE_WORLD / 2
    const id = createSticky(doc, { x: 0, y: 0 })

    expect(id).toBeTruthy()
    const snap = snapshot(doc)
    expect(snap).toHaveLength(1)
    const note = snap[0]
    expect(note.type).toBe('sticky')
    expect(note.color).toBe(DEFAULT_STICKY_COLOR)
    expect(note.text).toBe('')
    expect(note.z).toBe(1)
    expect(note.x).toBeCloseTo(0 - half, 10)
    expect(note.y).toBeCloseTo(0 - half, 10)
    expect(updates()).toBe(1)
  })
})

// ── TC-02 ─────────────────────────────────────────────────────────────────────

describe('TC-02 createSticky with existing z 1,2 → new z = 3', () => {
  it('new note z is one higher than the maximum', () => {
    const doc = freshDoc()
    createSticky(doc, { x: 0, y: 0 })
    createSticky(doc, { x: 200, y: 200 })
    const updates = countUpdates(doc)

    const id3 = createSticky(doc, { x: 400, y: 400 })
    expect(id3).toBeTruthy()
    const snap = snapshot(doc)
    expect(snap).toHaveLength(3)
    expect(snap[2].z).toBe(3)
    expect(updates()).toBe(1)
  })
})

// ── TC-03 ─────────────────────────────────────────────────────────────────────

describe('TC-03 moveObject updates x, y only', () => {
  it('other fields unchanged', () => {
    const doc = freshDoc()
    const id = createSticky(doc, { x: 0, y: 0 })
    const before = snapshot(doc)[0]
    const updates = countUpdates(doc)

    const ok = moveObject(doc, id, 10, -20)
    expect(ok).toBe(true)

    const after = snapshot(doc)[0]
    expect(after.x).toBeCloseTo(10, 10)
    expect(after.y).toBeCloseTo(-20, 10)
    expect(after.text).toBe(before.text)
    expect(after.color).toBe(before.color)
    expect(after.z).toBe(before.z)
    expect(updates()).toBe(1)
  })
})

// ── TC-04 (negative) ──────────────────────────────────────────────────────────

describe('TC-04 moveObject on a stale id', () => {
  it('returns false and emits 0 updates', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    const ok = moveObject(doc, 'does-not-exist', 1, 2)
    expect(ok).toBe(false)
    expect(updates()).toBe(0)
  })
})

// ── TC-05 ─────────────────────────────────────────────────────────────────────

describe('TC-05 setStickyColor applies a valid colour', () => {
  it('text, x, y, z unchanged', () => {
    const doc = freshDoc()
    const id = createSticky(doc, { x: 10, y: 20 })
    const before = snapshot(doc)[0]
    const updates = countUpdates(doc)

    const ok = setStickyColor(doc, id, 'green')
    expect(ok).toBe(true)

    const after = snapshot(doc)[0]
    expect(after.color).toBe('green')
    expect(after.text).toBe(before.text)
    expect(after.x).toBeCloseTo(before.x, 10)
    expect(after.y).toBeCloseTo(before.y, 10)
    expect(after.z).toBe(before.z)
    expect(updates()).toBe(1)
  })
})

// ── TC-06 (negative) ──────────────────────────────────────────────────────────

describe('TC-06 setStickyColor with unknown colour', () => {
  it('returns false, colour unchanged, 0 updates', () => {
    const doc = freshDoc()
    const id = createSticky(doc, { x: 0, y: 0 })
    const updates = countUpdates(doc)

    const ok = setStickyColor(doc, id, 'teal')
    expect(ok).toBe(false)
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR)
    expect(updates()).toBe(0)
  })
})

// ── TC-07 ─────────────────────────────────────────────────────────────────────

describe('TC-07 deleteObject removes the note', () => {
  it('size goes from 1 → 0; 1 update', () => {
    const doc = freshDoc()
    const id = createSticky(doc, { x: 0, y: 0 })
    const updates = countUpdates(doc)

    const ok = deleteObject(doc, id)
    expect(ok).toBe(true)
    expect(snapshot(doc)).toHaveLength(0)
    expect(updates()).toBe(1)
  })
})

// ── TC-08 (negative) ──────────────────────────────────────────────────────────

describe('TC-08 deleteObject on a stale id', () => {
  it('returns false and emits 0 updates', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    const ok = deleteObject(doc, 'does-not-exist')
    expect(ok).toBe(false)
    expect(updates()).toBe(0)
  })
})

// ── TC-09 ─────────────────────────────────────────────────────────────────────

describe('TC-09 bringToFront on z=1 of 3 notes', () => {
  it('z goes from 1 → 4', () => {
    const doc = freshDoc()
    const id1 = createSticky(doc, { x: 0, y: 0 })
    createSticky(doc, { x: 200, y: 200 })
    createSticky(doc, { x: 400, y: 400 })

    const updates = countUpdates(doc)
    const ok = bringToFront(doc, id1)
    expect(ok).toBe(true)

    const snap = snapshot(doc)
    const moved = snap.find(s => s.id === id1)!
    expect(moved.z).toBe(4)
    expect(updates()).toBe(1)
  })
})

// ── TC-10 (negative) ──────────────────────────────────────────────────────────

describe('TC-10 bringToFront on the topmost note', () => {
  it('returns false; emits 0 updates', () => {
    const doc = freshDoc()
    createSticky(doc, { x: 0, y: 0 })
    const id2 = createSticky(doc, { x: 200, y: 200 }) // z=2, already topmost

    const updates = countUpdates(doc)
    const ok = bringToFront(doc, id2)
    expect(ok).toBe(false)
    expect(updates()).toBe(0)
  })
})

// ── TC-11 ─────────────────────────────────────────────────────────────────────

describe('TC-11 two notes with equal z', () => {
  it('snapshot sorts by id as tie-break; stable across calls', () => {
    const doc = freshDoc()
    const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<unknown>>

    const mkNote = (x: number, y: number, z: number, createdAt: number) => {
      const m = new Y.Map<unknown>()
      m.set('type', 'sticky'); m.set('x', x); m.set('y', y)
      m.set('color', 'yellow'); m.set('text', new Y.Text())
      m.set('z', z); m.set('createdAt', createdAt)
      return m
    }

    doc.transact(() => {
      objectsMap.set('id-aaa', mkNote(0, 0, 1, 1000))
      objectsMap.set('id-bbb', mkNote(100, 100, 1, 2000))
    })

    const snap1 = snapshot(doc)
    const snap2 = snapshot(doc)

    expect(snap1).toHaveLength(2)
    // id-aaa < id-bbb lexically → aaa first
    expect(snap1[0].id).toBe('id-aaa')
    expect(snap1[1].id).toBe('id-bbb')
    expect(snap2.map(s => s.id)).toEqual(snap1.map(s => s.id))
  })
})

// ── TC-12 ─────────────────────────────────────────────────────────────────────

describe('TC-12 unknown object type in doc', () => {
  it('snapshot skips it without throwing', () => {
    const doc = freshDoc()
    const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<unknown>>

    const shape = new Y.Map<unknown>()
    shape.set('type', 'shape') // not a sticky

    doc.transact(() => { objectsMap.set('shape-1', shape) })

    expect(() => snapshot(doc)).not.toThrow()
    expect(snapshot(doc)).toHaveLength(0)
  })
})

// ── TC-39 (negative) ──────────────────────────────────────────────────────────

describe('TC-39 non-finite coordinates', () => {
  it('createSticky with NaN → empty string; 0 updates', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    expect(createSticky(doc, { x: NaN, y: 0 })).toBe('')
    expect(updates()).toBe(0)
  })

  it('createSticky with Infinity → empty string; 0 updates', () => {
    const doc = freshDoc()
    const updates = countUpdates(doc)
    expect(createSticky(doc, { x: 0, y: Infinity })).toBe('')
    expect(updates()).toBe(0)
  })

  it('moveObject with NaN → false; 0 updates', () => {
    const doc = freshDoc()
    const id = createSticky(doc, { x: 0, y: 0 })
    const updates = countUpdates(doc)
    expect(moveObject(doc, id, NaN, 0)).toBe(false)
    expect(updates()).toBe(0)
  })

  it('moveObject with Infinity → false; 0 updates', () => {
    const doc = freshDoc()
    const id = createSticky(doc, { x: 0, y: 0 })
    const updates = countUpdates(doc)
    expect(moveObject(doc, id, 0, -Infinity)).toBe(false)
    expect(updates()).toBe(0)
  })
})

// ── Extra: initDoc sets schemaVersion once ────────────────────────────────────

describe('initDoc', () => {
  it('sets meta.schemaVersion to 1 once; second call is a no-op', () => {
    const doc = new Y.Doc()
    initDoc(doc)
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1)
    const updates = countUpdates(doc)
    initDoc(doc)
    expect(updates()).toBe(0)
  })
})

// ── getStickyText ─────────────────────────────────────────────────────────────

describe('getStickyText', () => {
  it('returns the Y.Text for a valid id', () => {
    const doc = freshDoc()
    const id = createSticky(doc, { x: 0, y: 0 })
    const ytext = getStickyText(doc, id)
    expect(ytext).toBeDefined()
    expect((ytext as Y.Text).toString()).toBe('')
  })

  it('returns undefined for stale id', () => {
    const doc = freshDoc()
    expect(getStickyText(doc, 'stale')).toBeUndefined()
  })
})
