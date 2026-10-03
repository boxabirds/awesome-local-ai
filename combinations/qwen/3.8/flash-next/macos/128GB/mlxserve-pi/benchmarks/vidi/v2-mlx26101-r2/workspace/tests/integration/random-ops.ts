/**
 * Seeded random board operations for the capacity tests (design "Fixtures"):
 * 40% typing real words, 30% moves, 10% creates, 10% recolours, 10% deletes, all
 * through the real `src/shared/board-model.ts` functions — the same calls the UI
 * makes, so a test that converges here converges in the browser too.
 *
 * The generator is seeded and the seed is printed, so a failure can be replayed
 * by pasting the seed back into the test.
 */
import * as Y from 'yjs';

import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model.js';
import { STICKY_COLOR_NAMES } from '../../src/shared/config.js';

/** Words people actually type, so a merged document reads like a board. */
export const WORDS = [
  'pricing',
  'onboarding',
  'follow-up',
  'cut',
  'scope',
  'risk',
  'demo',
  'budget',
  'handoff',
  'spike',
  'question',
  'parked',
];

/** A seed to log before a run; any number replays the same operations. */
export function newSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
}

/** mulberry32: a small deterministic PRNG, so a seed is enough to replay. */
export function randomFn(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(random: () => number, list: readonly T[]): T =>
  list[Math.floor(random() * list.length)] as T;

/**
 * One operation somebody might perform. The note is named by its position in the
 * board's note list, because a person - or a test driving the interface - picks
 * notes that way; the rest of the values are absolute so the same operation means
 * the same thing in the document and on the screen.
 *
 * `at` is a fraction of the note's text rather than an index: the generator does
 * not know how long the text is going to be by the time the operation is carried
 * out, and it must not care.
 */
export type RandomOp =
  | { kind: 'create'; x: number; y: number }
  | { kind: 'type'; noteIndex: number; text: string; at: number }
  | { kind: 'move'; noteIndex: number; x: number; y: number }
  | { kind: 'recolour'; noteIndex: number; color: (typeof STICKY_COLOR_NAMES)[number] }
  | { kind: 'delete'; noteIndex: number };

/** The board area the random operations work inside, in world units. */
export const RANDOM_FIELD_SIZE = 960;

/** The next operation of the mix: typing dominates, deletes are rare. */
export function nextRandomOp(random: () => number, noteCount: number): RandomOp {
  const roll = random();
  if (noteCount <= 0) {
    // Always something to work on: an empty board gets a note, whatever the roll.
    return {
      kind: 'create',
      x: Math.floor(random() * RANDOM_FIELD_SIZE),
      y: Math.floor(random() * RANDOM_FIELD_SIZE),
    };
  }
  const noteIndex = Math.floor(random() * noteCount);
  if (roll < 0.4) {
    // Typing: a real word into a random note, at a random point in it.
    return { kind: 'type', noteIndex, text: `${pick(random, WORDS)} `, at: random() };
  }
  if (roll < 0.7) {
    // A move, on the grid so it is a position a drag could really have left.
    return {
      kind: 'move',
      noteIndex,
      x: Math.floor(random() * 40) * 24,
      y: Math.floor(random() * 40) * 24,
    };
  }
  if (roll < 0.8) {
    return {
      kind: 'create',
      x: Math.floor(random() * RANDOM_FIELD_SIZE),
      y: Math.floor(random() * RANDOM_FIELD_SIZE),
    };
  }
  if (roll < 0.9) {
    return { kind: 'recolour', noteIndex, color: pick(random, STICKY_COLOR_NAMES) };
  }
  return { kind: 'delete', noteIndex };
}

/** Carry out one operation. False when the note it names is no longer there. */
export function applyRandomOp(doc: Y.Doc, op: RandomOp): boolean {
  if (op.kind === 'create') {
    return Boolean(createSticky(doc, { x: op.x, y: op.y }));
  }
  const notes = snapshot(doc);
  const note = notes[op.noteIndex % Math.max(1, notes.length)];
  if (!note) return false;
  switch (op.kind) {
    case 'type': {
      const text = getStickyText(doc, note.id);
      if (text === undefined) return false;
      const at = Math.floor(op.at * (text.length + 1));
      doc.transact(() => {
        text.insert(at, op.text);
      });
      return true;
    }
    case 'move':
      return moveObject(doc, note.id, op.x, op.y);
    case 'recolour':
      return setStickyColor(doc, note.id, op.color);
    case 'delete':
      return deleteObject(doc, note.id);
  }
}

/**
 * Perform `count` operations on `doc` and return how many of them changed
 * something. The mix is the design's: typing dominates, deletes are rare.
 */
export function applyRandomOps(doc: Y.Doc, count: number, seed: number): number {
  const random = randomFn(seed);
  let applied = 0;

  for (let index = 0; index < count; index++) {
    const op = nextRandomOp(random, snapshot(doc).length);
    if (applyRandomOp(doc, op)) applied++;
  }
  return applied;
}

/** Run `applyRandomOps` and say which seed produced this board. */
export function runSeededOps(doc: Y.Doc, count: number, seed: number): number {
  const applied = applyRandomOps(doc, count, seed);
  console.log(`random ops: seed ${seed}, ${count} requested, ${applied} applied`);
  return applied;
}

/**
 * Two documents are the same board: same notes, same positions, colours, text and
 * stacking. Compares the model snapshot, which is what a screen shows.
 */
export function sameBoard(a: readonly unknown[], b: readonly unknown[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A readable diff of two board snapshots, for a failing convergence test. */
export function describeDifference(a: readonly unknown[], b: readonly unknown[]): string {
  if (a.length !== b.length) return `sizes differ: ${a.length} vs ${b.length}`;
  for (let index = 0; index < a.length; index++) {
    const left = JSON.stringify(a[index]);
    const right = JSON.stringify(b[index]);
    if (left !== right) return `note ${index} differs:\n  ${left}\n  ${right}`;
  }
  return 'no difference found';
}
