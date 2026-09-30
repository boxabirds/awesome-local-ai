// Seeded random operation generator using the real board-model functions.
// Mix: 40% typing real words, 30% moves, 10% creates, 10% recolours, 10% deletes.
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  objectsMap,
  setStickyColor,
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

const WORDS = ['pricing', 'onboarding', 'churn', 'roadmap', 'idea', 'customer', 'retro', 'launch', 'risk', 'goal'];
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** mulberry32: small, fast, deterministic PRNG. */
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

export type OpKind = 'type' | 'move' | 'create' | 'recolor' | 'delete';

export interface OpLog {
  created: Set<string>;
  deleted: Set<string>;
}

export function newOpLog(): OpLog {
  return { created: new Set(), deleted: new Set() };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

export function pickKind(rand: () => number): OpKind {
  const r = rand();
  if (r < 0.4) return 'type';
  if (r < 0.7) return 'move';
  if (r < 0.8) return 'create';
  if (r < 0.9) return 'recolor';
  return 'delete';
}

/** Applies one random operation to `doc`; creates a note when there is none to act on. */
export function randomOp(doc: Y.Doc, rand: () => number, log: OpLog): OpKind {
  const ids = [...objectsMap(doc).keys()].sort();
  let kind = pickKind(rand);
  if (ids.length === 0) kind = 'create';
  const at = () => ({ x: Math.round(rand() * 4000 - 2000), y: Math.round(rand() * 4000 - 2000) });
  switch (kind) {
    case 'create': {
      const id = createSticky(doc, at(), pick(rand, COLORS));
      if (id !== false) log.created.add(id);
      break;
    }
    case 'type': {
      const text = getStickyText(doc, pick(rand, ids));
      if (!text) break;
      const index = Math.floor(rand() * (text.length + 1));
      doc.transact(() => text.insert(index, `${pick(rand, WORDS)} `), LOCAL_ORIGIN);
      break;
    }
    case 'move': {
      const p = at();
      moveObject(doc, pick(rand, ids), p.x, p.y);
      break;
    }
    case 'recolor':
      setStickyColor(doc, pick(rand, ids), pick(rand, COLORS));
      break;
    case 'delete': {
      const id = pick(rand, ids);
      if (deleteObject(doc, id)) log.deleted.add(id);
      break;
    }
  }
  return kind;
}
