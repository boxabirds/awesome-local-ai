import * as Y from 'yjs';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
} from '../../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';

/** Small deterministic PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS: StickyColor[] = Object.keys(STICKY_COLORS) as StickyColor[];

/**
 * Apply `count` random board operations to `doc` (create / text / move /
 * color / delete). Deterministic for a given seed. Returns the ids created.
 *
 * Async: yields to the event loop every `yieldEvery` ops so the room's
 * WebSocket frames drain and converge promptly under load (a large
 * synchronous send backlog can starve incoming-message delivery).
 */
export async function applyRandomOps(
  doc: Y.Doc,
  count: number,
  seed: number,
  yieldEvery = 20,
): Promise<string[]> {
  const rng = makeRng(seed);
  const created: string[] = [];
  for (let i = 0; i < count; i++) {
    const ops = snapshot(doc).map((n) => n.id);
    const roll = rng();
    if (roll < 0.45 || ops.length === 0) {
      const x = Math.floor(rng() * 2000) - 1000;
      const y = Math.floor(rng() * 2000) - 1000;
      const color = COLORS[Math.floor(rng() * COLORS.length)];
      const id = createSticky(doc, { x, y }, color);
      created.push(id);
    } else if (roll < 0.7) {
      const id = ops[Math.floor(rng() * ops.length)];
      const text = getStickyText(doc, id);
      if (text) {
        const len = Math.floor(rng() * 24);
        let s = '';
        for (let j = 0; j < len; j++) s += String.fromCharCode(97 + Math.floor(rng() * 26));
        text.insert(0, s);
      }
    } else if (roll < 0.85) {
      const id = ops[Math.floor(rng() * ops.length)];
      moveObject(doc, id, Math.floor(rng() * 2000) - 1000, Math.floor(rng() * 2000) - 1000);
    } else if (roll < 0.95) {
      const id = ops[Math.floor(rng() * ops.length)];
      setStickyColor(doc, id, COLORS[Math.floor(rng() * COLORS.length)]);
    } else {
      // Delete at most half the notes so the board never empties out fully.
      if (ops.length > 1) {
        const id = ops[Math.floor(rng() * ops.length)];
        deleteObject(doc, id);
      }
    }
    if (yieldEvery > 0 && (i + 1) % yieldEvery === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return created;
}
