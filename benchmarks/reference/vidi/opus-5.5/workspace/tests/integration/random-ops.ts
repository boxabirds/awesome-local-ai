/**
 * Seeded random operation generator using the real board-model functions: 40% typing real
 * words, 30% moves, 10% creates, 10% recolours, 10% deletes. Seeds are logged for replay.
 */
import type * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

const WORDS = ['pricing', 'launch', 'customer', 'roadmap', 'idea', 'risk', 'budget', 'team', 'ship', 'why'];
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];
const TYPE_SHARE = 0.4;
const MOVE_SHARE = 0.3;
const CREATE_SHARE = 0.1;
const RECOLOR_SHARE = 0.1;
/** Moves and creates land within this many world units of the origin. */
const SPREAD = 2000;
const UINT32 = 2 ** 32;
const MULBERRY_INC = 0x6d2b79f5;
const SHIFT_A = 15;
const SHIFT_B = 7;
const SHIFT_C = 14;
const MUL_OR = 1;
const MUL_OR_B = 61;

/** mulberry32: small, fast, deterministic PRNG in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + MULBERRY_INC) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> SHIFT_A), t | MUL_OR);
    t ^= t + Math.imul(t ^ (t >>> SHIFT_B), t | MUL_OR_B);
    return ((t ^ (t >>> SHIFT_C)) >>> 0) / UINT32;
  };
}

/** Types `text` into a note at `index` as one local transaction, like the note editor does. */
export function insertText(doc: Y.Doc, id: string, index: number, text: string): void {
  const ytext = getStickyText(doc, id);
  if (!ytext) return;
  doc.transact(() => ytext.insert(index, text), LOCAL_ORIGIN);
}

export interface OpLog {
  created: Set<string>;
  deleted: Set<string>;
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

/** Applies one random operation to `doc`, recording creates and successful deletes. */
export function randomOp(doc: Y.Doc, rand: () => number, log: OpLog): void {
  const notes = snapshot(doc);
  const roll = rand();
  if (notes.length === 0 || (roll >= TYPE_SHARE + MOVE_SHARE && roll < TYPE_SHARE + MOVE_SHARE + CREATE_SHARE)) {
    const id = createSticky(doc, { x: (rand() - 0.5) * SPREAD, y: (rand() - 0.5) * SPREAD }, pick(rand, COLORS));
    log.created.add(id);
    return;
  }
  const note = pick(rand, notes);
  if (roll < TYPE_SHARE) {
    const length = getStickyText(doc, note.id)?.length ?? 0;
    insertText(doc, note.id, Math.floor(rand() * (length + 1)), `${pick(rand, WORDS)} `);
  } else if (roll < TYPE_SHARE + MOVE_SHARE) {
    moveObject(doc, note.id, (rand() - 0.5) * SPREAD, (rand() - 0.5) * SPREAD);
  } else if (roll < TYPE_SHARE + MOVE_SHARE + CREATE_SHARE + RECOLOR_SHARE) {
    setStickyColor(doc, note.id, pick(rand, COLORS));
  } else if (deleteObject(doc, note.id)) {
    log.deleted.add(note.id);
  }
}
