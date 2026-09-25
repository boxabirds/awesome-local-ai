import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  hasObject,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { STICKY_COLORS } from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';

/**
 * Seeded random-op generator for the merging/soak tests (TC-12, TC-30).
 *
 * One `step` applies a single random operation to a doc, using the real
 * board-model mutations so the traffic is exactly what the client sends.
 * The mix (per the task sheet): 40% typing real words, 30% moves, 10%
 * creates, 10% recolours, 10% deletes.
 *
 * Note ids are random per replica (crypto.randomUUID), so ops target notes
 * by CREATION INDEX, not by id: replicas running the same seed create the
 * same logical notes in the same order, so index k is the same note on
 * every replica. (z stays unique per note, so snapshot order is identical
 * even though id strings differ.)
 */

/** Small, fast, deterministic PRNG (mulberry32). */
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

const WORDS = [
  'idea',
  'shipping',
  'launch',
  'bug',
  'metric',
  'north',
  'star',
  'rocket',
  'draft',
  'done',
];

const COLORS = Object.keys(STICKY_COLORS) as Array<keyof typeof STICKY_COLORS>;

export interface RandomOpContext {
  /** The doc to operate on. */
  doc: Y.Doc;
  /** Draw the next random value. */
  next: () => number;
  /** Ids of the notes this replica created, in creation order. */
  createdIds: string[];
}

/**
 * Apply one random operation. Returns a short description (for logging).
 * When no notes exist yet, the operation is always a create.
 */
export function randomStep(ctx: RandomOpContext): string {
  const { doc, next } = ctx;
  const roll = next();
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length) % arr.length];

  if (ctx.createdIds.length === 0 || roll < 0.1) {
    // 10% creates (and the only sane op on an empty board)
    const x = Math.floor(next() * 2000);
    const y = Math.floor(next() * 2000);
    const id = createSticky(doc, { x, y }, pick(COLORS));
    if (id !== '') ctx.createdIds.push(id);
    return `create@(${x},${y})`;
  }
  // Target the k-th created note: the same logical note on every replica.
  const index = Math.floor(next() * ctx.createdIds.length) % ctx.createdIds.length;
  const id = ctx.createdIds[index];
  if (roll < 0.4) {
    // 40% typing a real word
    if (hasObject(doc, id)) {
      const text = getStickyText(doc, id);
      if (text) {
        text.insert(text.length, `${pick(WORDS)} `);
        return `type in #${index}`;
      }
    }
    return `type skipped (#${index} gone)`;
  }
  if (roll < 0.7) {
    // 30% moves
    const x = Math.floor(next() * 2000);
    const y = Math.floor(next() * 2000);
    moveObject(doc, id, x, y);
    return `move #${index}@(${x},${y})`;
  }
  if (roll < 0.8) {
    // 10% recolours
    setStickyColor(doc, id, pick(COLORS));
    return `recolor #${index}`;
  }
  // 10% deletes
  if (hasObject(doc, id)) {
    deleteObject(doc, id);
    ctx.createdIds.splice(index, 1);
    return `delete #${index}`;
  }
  return `delete skipped (#${index} gone)`;
}

/**
 * Run `count` random steps against `doc`. Returns the ops applied, for
 * logging. Replicas must be run with the SAME seed to stay equivalent.
 */
export function runRandomOps(
  doc: Y.Doc,
  seed: number,
  count: number,
): { applied: string[]; createdIds: string[] } {
  const next = mulberry32(seed);
  const ctx: RandomOpContext = { doc, next, createdIds: [] };
  const applied: string[] = [];
  for (let i = 0; i < count; i++) {
    applied.push(randomStep(ctx));
  }
  return { applied, createdIds: ctx.createdIds };
}

/**
 * Two replicas running the same seed create different random ids but the
 * same logical notes: blank the id/createdAt fields before comparing.
 * z is unique per note, so the (z, id) sort order is identical anyway.
 */
export function erasureSnapshots(snap: readonly StickySnapshot[]): Array<Record<string, unknown>> {
  return snap.map(({ id, createdAt, ...rest }) => ({ ...rest, id: '', createdAt: 0 }));
}
