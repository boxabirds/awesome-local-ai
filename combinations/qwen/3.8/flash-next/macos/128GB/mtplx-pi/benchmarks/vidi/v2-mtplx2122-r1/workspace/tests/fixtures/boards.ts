/**
 * Board fixtures (story 4).
 *
 * Everything here is produced through the real `board-model` functions, so the
 * bytes are real Yjs updates — the same bytes a room writes. Two shapes are
 * needed by the persistence tests:
 *
 * - `retroBoard`: 25 notes with mixed colours, multi-line text and deliberate
 *   overlap, i.e. enough variety that "identical" has to mean identical
 *   (PRD `persist.reopen`).
 * - `clusteredBoard`: `PERSIST_TESTED_NOTES` notes of realistic English text
 *   laid out in clusters (PRD `persist.large_board`).
 *
 * Both come with the update stream that created them, because the storage tests
 * need to write *several* log rows, not one.
 */

import * as Y from 'yjs'
import { PERSIST_TESTED_NOTES, STICKY_COLORS } from '../../src/shared/config'
import type { StickyColor } from '../../src/shared/config'
import {
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model'

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[]

/** Deterministic PRNG (mulberry32): a fixture is reproducible from its seed. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Sentence fragments used to build note text that reads like real English. */
const PHRASES = [
  'the onboarding docs assume a working local environment, which nobody has',
  'standup moved to 09:45 so the west-coast teammates can join before nine',
  'we keep losing the thread of review comments between the ticket and the diff',
  'retro action: write down who decides when two people disagree on a name',
  'the import path for the shared types is longer than the module it imports',
  'somebody should own the flaky date test before it trains everyone to ignore red',
  'clustering by team hides the fact that three teams share one queue',
  'the sticky sizes are all identical, which makes the important one invisible',
  'we agreed on a naming scheme in spring and then wrote two different ones',
  'nobody can tell which arrows are decided and which are still arguments',
  'the archive is six megabytes of screenshots nobody will open again',
  'if a decision needs a meeting it needs a place to live afterwards',
  'two people maintain the same checklist and neither knows about the other',
  'the demo worked because it was the only board with real data on it',
  'half the notes are questions that were answered somewhere else entirely',
  'the board is a photograph of a room, not a record of a decision',
  'we should be able to reopen last quarter without asking the vendor for a dump',
  'the export only contains what fits on one screen, which is nobody board',
  'colours currently mean nothing, but everyone thinks they mean priority',
  'there are four ways to leave a comment and none of them are linked together',
]

/** Build a plausible note body of `length` characters (10–300 in practice). */
export function phrase(rng: () => number, length: number): string {
  let text = ''
  while (text.length < length) {
    const fragment = PHRASES[Math.floor(rng() * PHRASES.length)] ?? PHRASES[0]
    text += (text.length === 0 ? '' : ' ') + fragment
  }
  return text.slice(0, length)
}

export interface BoardFixture {
  doc: Y.Doc
  /** Every update that created the board, in the order it was produced. */
  updates: Uint8Array[]
  /** Note ids in creation order (used to check "identical" after a reload). */
  noteIds: string[]
}

/**
 * Build a doc while recording each transaction as its own update.
 * `record` is handed a push function so the builder can report note ids in the
 * order it creates them.
 */
function capture(build: (doc: Y.Doc, record: (id: string) => void) => void): BoardFixture {
  const doc = new Y.Doc()
  const updates: Uint8Array[] = []
  const noteIds: string[] = []
  // Recorded from the very first transaction: replaying `updates` into an empty
  // doc has to reproduce the fixture byte for byte.
  doc.on('update', (update: Uint8Array) => {
    updates.push(new Uint8Array(update))
  })
  initDoc(doc)
  build(doc, id => noteIds.push(id))
  return { doc, updates, noteIds }
}

/**
 * 25 notes: mixed colours, multi-line bodies, overlapping positions so the
 * stacking order (z) matters, plus one create/delete pair.
 */
export function retroBoard(seed = 20261008): BoardFixture {
  const rng = createRng(seed)
  const lines = [
    'keep this\nand this',
    'what broke\nlast week?',
    'owner: nobody',
    'done\n(or deleted)',
    'needs a name',
    'two people, one list',
  ]
  return capture((doc, record) => {
    for (let i = 0; i < 25; i++) {
      const x = (i % 5) * 170 + (i >= 15 ? 40 : 0) // deliberate overlap
      const y = Math.floor(i / 5) * 150
      const color = COLOR_NAMES[i % COLOR_NAMES.length]
      const id = createSticky(doc, { x, y }, color)
      record(id)
      if (i % 3 === 0) setStickyColor(doc, id, COLOR_NAMES[(i + 2) % COLOR_NAMES.length])
      if (i % 2 === 0) moveObject(doc, id, x + 10 + rng(), y - 4)
      const text = `${lines[i % lines.length]}\n${phrase(rng, 20 + Math.floor(rng() * 60))}`
      getStickyText(doc, id)?.insert(0, text)
    }
    // One deletion, so the fixture also exercises "deletions are saved like any
    // other change" (PRD empty state).
    const doomed = createSticky(doc, { x: 900, y: 900 })
    deleteObject(doc, doomed)
  })
}

/**
 * A `count`-note board with realistic text, laid out in clusters of five.
 * Defaults to `PERSIST_TESTED_NOTES`, the size the PRD guarantees.
 */
export function clusteredBoard(count: number = PERSIST_TESTED_NOTES, seed = 4242): BoardFixture {
  const rng = createRng(seed)
  return capture((doc, record) => {
    for (let i = 0; i < count; i++) {
      const cluster = Math.floor(i / 5)
      const within = i % 5
      const x = cluster * 460 + (within % 2) * 210
      const y = Math.floor(within / 2) * 230 + (cluster % 3) * 40
      const color = COLOR_NAMES[Math.floor(rng() * COLOR_NAMES.length)]
      const id = createSticky(doc, { x, y }, color)
      record(id)
      const length = 10 + Math.floor(rng() * 290)
      getStickyText(doc, id)?.insert(0, phrase(rng, length))
    }
  })
}

/** A board of `count` notes with short bodies, for quick multi-row log tests. */
export function smallBoard(count: number, seed = 77): BoardFixture {
  const rng = createRng(seed)
  return capture((doc, record) => {
    for (let i = 0; i < count; i++) {
      const id = createSticky(doc, { x: i * 40, y: (i % 7) * 60 })
      record(id)
      getStickyText(doc, id)?.insert(0, phrase(rng, 12 + Math.floor(rng() * 40)))
    }
  })
}

/** Two docs hold byte-identical state, including delete sets. */
export function sameState(a: Y.Doc, b: Y.Doc): boolean {
  const left = Y.encodeStateAsUpdate(a)
  const right = Y.encodeStateAsUpdate(b)
  if (left.byteLength !== right.byteLength) return false
  for (let i = 0; i < left.byteLength; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}

/** Human-comparable board content (what "identical" means for a user). */
export function boardContent(doc: Y.Doc): string {
  return JSON.stringify(snapshot(doc))
}

export { snapshot }
