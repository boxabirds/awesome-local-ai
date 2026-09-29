import * as Y from 'yjs';
import { StickyColor, STICKY_COLORS } from '@shared/config';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
} from '@shared/board-model';

// A deterministic PRNG so a capacity/soak run is reproducible from its seed.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Real words (object.live_collaboration: "typing real words").
const WORDS = [
  'buy', 'milk', 'coffee', 'standup', 'deploy', 'review', 'notes', 'ideas',
  'groceries', 'call', 'draft', 'design', 'fix', 'ship', 'plan', 'todo',
  'red', 'blue', 'green', 'yellow',
];

const COLOR_KEYS = Object.keys(STICKY_COLORS) as StickyColor[];

export interface OpCounts {
  create: number;
  move: number;
  type: number;
  recolour: number;
  delete: number;
}

/**
 * Apply `count` random board-model operations to `doc` using the seeded rng:
 * 40% typing, 30% moving, 10% creating, 10% recolouring, 10% deleting. Typing,
 * moving, recolouring and deleting target a note chosen from the current
 * snapshot, so the op stream is self-consistent with board state. Returns tallies.
 */
export function runRandomOps(doc: Y.Doc, count: number, rng: () => number): OpCounts {
  const counts: OpCounts = { create: 0, move: 0, type: 0, recolour: 0, delete: 0 };
  for (let i = 0; i < count; i++) {
    const roll = rng();
    if (roll < 0.1) {
      createSticky(doc, { x: Math.floor(rng() * 2000) - 1000, y: Math.floor(rng() * 2000) - 1000 });
      counts.create++;
      continue;
    }

    const notes = snapshot(doc);
    if (notes.length === 0) {
      createSticky(doc, { x: 0, y: 0 });
      counts.create++;
      continue;
    }
    const target = notes[Math.floor(rng() * notes.length)].id;

    if (roll < 0.2) {
      setStickyColor(doc, target, COLOR_KEYS[Math.floor(rng() * COLOR_KEYS.length)]);
      counts.recolour++;
    } else if (roll < 0.5) {
      moveObject(doc, target, Math.floor(rng() * 2000) - 1000, Math.floor(rng() * 2000) - 1000);
      counts.move++;
    } else {
      typeWord(doc, target, rng);
      counts.type++;
    }
  }
  return counts;
}

function typeWord(doc: Y.Doc, id: string, rng: () => number): void {
  const ytext = getStickyText(doc, id);
  if (!ytext) return;
  const word = WORDS[Math.floor(rng() * WORDS.length)] + ' ';
  const pos = Math.floor(rng() * (ytext.length + 1));
  doc.transact(() => ytext.insert(pos, word));
}
