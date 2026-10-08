/**
 * Seeded random board operations.
 *
 * Used by the convergence tests (TC-12) and the nightly capacity soak: the
 * generator is deterministic per seed, so a failure can be replayed from the
 * logged seed.  Ratios come from the story spec: 40% typing, 30% moves,
 * 10% creates, 10% recolours, 10% deletes — all through the real
 * `board-model` functions.
 */

import * as Y from 'yjs'
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model'
import { STICKY_COLORS } from '../../src/shared/config'
import type { StickyColor } from '../../src/shared/config'

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[]

/** Words that look like real note content (40% of generated ops type these). */
export const WORDS = [
  'notes',
  'idea',
  'todo',
  'spike',
  'retry',
  'paper',
  'cloud',
  'garden',
  'market',
  'cable',
  'anchor',
  'velvet',
  'signal',
  'rocket',
  'temple',
  'amber',
]

export interface Rng {
  /** Float in [0, 1). */
  next(): number
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number
  pick<T>(items: readonly T[]): T
}

/** mulberry32: small, fast, good enough for test data. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int(maxExclusive) {
      return Math.floor(next() * maxExclusive)
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)]
    },
  }
}

export type OpKind = 'type' | 'move' | 'create' | 'recolour' | 'delete'

/** 40% typing, 30% moves, 10% creates, 10% recolours, 10% deletes. */
export function nextOpKind(rng: Rng): OpKind {
  const roll = rng.next()
  if (roll < 0.4) return 'type'
  if (roll < 0.7) return 'move'
  if (roll < 0.8) return 'create'
  if (roll < 0.9) return 'recolour'
  return 'delete'
}

export interface AppliedOp {
  index: number
  kind: OpKind
  noteId: string
  /** Human readable, for the failure message. */
  describe: string
}

/**
 * Apply one random operation.  Ops that need an existing note fall back to a
 * create when the board is empty (or when everything has been deleted), which
 * keeps the board from dying out.
 */
export function applyRandomOp(doc: Y.Doc, rng: Rng, index: number): AppliedOp {
  const notes = snapshot(doc)
  let kind = nextOpKind(rng)
  if (notes.length === 0) kind = 'create'

  const target = notes.length === 0 ? undefined : rng.pick(notes)

  if (kind === 'create' || target === undefined) {
    const id = createSticky(doc, { x: rng.int(2000) - 1000, y: rng.int(2000) - 1000 }, rng.pick(COLOR_NAMES))
    return { index, kind: 'create', noteId: id, describe: `create at ${id}` }
  }

  switch (kind) {
    case 'move': {
      const x = rng.int(2000) - 1000
      const y = rng.int(2000) - 1000
      moveObject(doc, target.id, x, y)
      return { index, kind, noteId: target.id, describe: `move ${target.id} to ${x},${y}` }
    }
    case 'recolour': {
      const color = rng.pick(COLOR_NAMES)
      setStickyColor(doc, target.id, color)
      return { index, kind, noteId: target.id, describe: `recolour ${target.id} ${color}` }
    }
    case 'delete': {
      deleteObject(doc, target.id)
      return { index, kind, noteId: target.id, describe: `delete ${target.id}` }
    }
    default: {
      const text = getStickyText(doc, target.id)
      const word = `${rng.pick(WORDS)} `
      if (text === undefined) {
        moveObject(doc, target.id, rng.int(2000) - 1000, rng.int(2000) - 1000)
        return { index, kind: 'move', noteId: target.id, describe: `move ${target.id} (no text)` }
      }
      const at = rng.int(text.length + 1)
      text.insert(at, word)
      return { index, kind, noteId: target.id, describe: `type "${word.trim()}" in ${target.id} at ${at}` }
    }
  }
}

/** Apply `count` random operations and return them for logging. */
export function applyRandomOps(doc: Y.Doc, count: number, rng: Rng): AppliedOp[] {
  const applied: AppliedOp[] = []
  for (let i = 0; i < count; i++) applied.push(applyRandomOp(doc, rng, i))
  return applied
}
