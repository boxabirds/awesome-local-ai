// Seeded random board operations through the real board-model functions.
// Mix: 40% typing real words, 30% moves, 10% creates, 10% recolours, 10% deletes.
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
import { STICKY_COLORS } from '../../src/shared/config';

const WORDS = ['pricing', 'launch', 'retro', 'idea', 'customer', 'risk', 'roadmap', 'why', 'next', 'blocked', 'ship'];
const COLORS = Object.keys(STICKY_COLORS);

/** mulberry32: small, fast, deterministic. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type OpKind = 'type' | 'move' | 'create' | 'recolour' | 'delete';

export interface OpLog {
  created: string[];
  deleted: string[];
}

export function randomOp(doc: Y.Doc, rand: () => number, log: OpLog): OpKind {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const notes = snapshot(doc);
  const r = rand();
  if (notes.length === 0 || (r >= 0.8 && r < 0.9)) {
    const id = createSticky(doc, { x: Math.round(rand() * 4000 - 2000), y: Math.round(rand() * 4000 - 2000) });
    log.created.push(id);
    return 'create';
  }
  const target = pick(notes);
  if (r < 0.4) {
    const text = getStickyText(doc, target.id);
    if (text) {
      const at = Math.floor(rand() * (text.length + 1));
      doc.transact(() => text.insert(at, `${pick(WORDS)} `), LOCAL_ORIGIN);
    }
    return 'type';
  }
  if (r < 0.7) {
    moveObject(doc, target.id, Math.round(rand() * 4000 - 2000), Math.round(rand() * 4000 - 2000));
    return 'move';
  }
  if (r < 0.9) {
    setStickyColor(doc, target.id, pick(COLORS));
    return 'recolour';
  }
  deleteObject(doc, target.id);
  log.deleted.push(target.id);
  return 'delete';
}
