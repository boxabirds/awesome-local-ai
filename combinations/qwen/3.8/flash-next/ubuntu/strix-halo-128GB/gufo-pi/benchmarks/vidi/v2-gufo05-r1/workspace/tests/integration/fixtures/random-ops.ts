/**
 * Seeded random board edits, so a run can be repeated from the seed it printed.
 *
 * The generator works through the same `board-model` functions the app uses, which
 * is the point: a test that merges hand-written Yjs structures would prove the
 * merge works for shapes nobody creates.
 *
 * The mix is the one the design asks for — typing most of the time, moving notes
 * often, and creating, recolouring and deleting occasionally — because those are
 * the operations whose concurrent versions have to converge, and deleting is the
 * one that must not come back.
 */
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';
import type * as Y from 'yjs';

/** Words, not `lorem ipsum N`: typed text is what the merge has to keep whole. */
export const WORDS: readonly string[] = [
  'pricing',
  'ship',
  'friday',
  'rename',
  'quota',
  'anchor',
  'budget',
  'follow-up',
  'owner',
  'blocked',
  'draft',
  'review',
];

const COLOURS = Object.keys(STICKY_COLORS) as StickyColor[];

/** mulberry32: small, deterministic, and good enough for a test's randomness. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type OpKind = 'create' | 'type' | 'move' | 'recolour' | 'delete';

export interface AppliedOp {
  kind: OpKind;
  /** The note the op touched; for `create`, the note it made. */
  noteId: string;
  /** What changed, in the terms the assertion will use. */
  detail: string;
  /** When it was applied, so a test can measure how long the others took to see it. */
  at: number;
}

export interface RandomOpOptions {
  /** Where new notes may appear. Defaults to a workspace-sized area. */
  area?: { x: number; y: number; width: number; height: number };
}

function noteIds(doc: Y.Doc): string[] {
  const objects = doc.getMap('objects');
  const ids: string[] = [];
  objects.forEach((_value: unknown, key: string) => ids.push(key));
  return ids;
}

function pick<T>(items: readonly T[], rng: () => number): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

/**
 * Apply one random edit and describe it.
 *
 * `rng` is the caller's, so a test can interleave two clients' edits in any order
 * it likes and still reproduce the whole run from one seed.
 */
export function applyRandomOp(
  doc: Y.Doc,
  rng: () => number,
  options: RandomOpOptions = {},
): AppliedOp {
  const existing = noteIds(doc);
  const roll = rng();
  // With nothing on the board every other kind of edit is impossible, so the
  // first edit is always a create; after that the mix is the intended one.
  const kind: OpKind =
    existing.length === 0 || roll < 0.1 ? 'create' : roll < 0.5 ? 'type' : roll < 0.8 ? 'move' : roll < 0.9 ? 'recolour' : 'delete';

  if (kind === 'create') {
    const area = options.area ?? { x: -2000, y: -2000, width: 4000, height: 4000 };
    const at = { x: area.x + rng() * area.width, y: area.y + rng() * area.height };
    const id = createSticky(doc, at);
    return { kind, noteId: id, detail: `at ${Math.round(at.x)},${Math.round(at.y)}`, at: Date.now() };
  }

  const noteId = pick(existing, rng) ?? '';
  if (kind === 'move') {
    const x = Math.round(-1000 + rng() * 2000);
    const y = Math.round(-1000 + rng() * 2000);
    moveObject(doc, noteId, x, y);
    return { kind, noteId, detail: `to ${x},${y}`, at: Date.now() };
  }

  if (kind === 'recolour') {
    const colour = pick(COLOURS, rng) ?? 'yellow';
    setStickyColor(doc, noteId, colour);
    return { kind, noteId, detail: colour, at: Date.now() };
  }

  if (kind === 'delete') {
    const gone = deleteObject(doc, noteId);
    return { kind, noteId, detail: gone ? 'removed' : 'already gone', at: Date.now() };
  }

  const ytext = getStickyText(doc, noteId);
  if (!ytext) {
    // The note went away between picking it and typing in it; say so and let the
    // caller roll again rather than pretending an edit happened.
    return { kind: 'type', noteId, detail: 'no text (gone)', at: Date.now() };
  }
  const word = ` ${pick(WORDS, rng) ?? 'note'}`;
  const length = ytext.length;
  const position = Math.floor(rng() * (length + 1));
  ytext.insert(position, word);
  return { kind: 'type', noteId, detail: `${word.trim()} @${position}`, at: Date.now() };
}

/** Apply `count` random edits and return what was applied, in order. */
export function applyRandomOps(
  doc: Y.Doc,
  rng: () => number,
  count: number,
  options: RandomOpOptions = {},
): AppliedOp[] {
  const applied: AppliedOp[] = [];
  for (let index = 0; index < count; index += 1) applied.push(applyRandomOp(doc, rng, options));
  return applied;
}
