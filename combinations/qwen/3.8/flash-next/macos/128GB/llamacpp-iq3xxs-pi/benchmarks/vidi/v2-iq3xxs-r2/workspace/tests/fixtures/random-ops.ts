import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

/**
 * Seeded random board editing (design "Fixtures"), shared by the integration soak
 * (TC-12) and the nightly capacity soak (TC-30). Deterministic per seed, so a failure
 * can be re-run by logging `seed` alone.
 *
 * The weights are the ones the design asks for: 40% typing, 30% moves, and 10% each of
 * creates, recolours and deletes. Ops address notes by position in `live`, which is how
 * a DOM snapshot sees them too.
 */

/** Words typed into notes: real English words, never repeated single characters. */
export const NOTE_WORDS = [
  'onboarding',
  'release',
  'handoff',
  'checklist',
  'theme',
  'risk',
  'question',
  'follow-up',
  'pace',
  'wall',
  'column',
  'retrospective',
  'quarter',
  'measure',
  'conversation',
];

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Deterministic 32-bit generator (mulberry32). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type RandomOp =
  | { kind: 'create'; x: number; y: number }
  | { kind: 'move'; index: number; x: number; y: number }
  /** `at` is a fraction of the note's current length, so it stays deterministic. */
  | { kind: 'type'; index: number; text: string; at: number }
  | { kind: 'recolour'; index: number; color: StickyColor }
  | { kind: 'delete'; index: number };

/** `count` ops as seen by a board that already has notes to work on. */
export function randomOps(count: number, seed = 1): RandomOp[] {
  const rng = mulberry32(seed);
  const ops: RandomOp[] = [];
  // Notes the generator believes exist; `index` always addresses this list, which the
  // applier keeps in the same order.
  let live = 0;
  for (let step = 0; step < count; step += 1) {
    const roll = rng();
    if (live === 0 || roll < 0.1) {
      ops.push({ kind: 'create', x: Math.round(rng() * 2000), y: Math.round(rng() * 1200) });
      live += 1;
      continue;
    }
    if (roll < 0.5) {
      ops.push({
        kind: 'type',
        index: Math.floor(rng() * live),
        text: NOTE_WORDS[Math.floor(rng() * NOTE_WORDS.length)],
        at: rng(),
      });
      continue;
    }
    if (roll < 0.8) {
      ops.push({
        kind: 'move',
        index: Math.floor(rng() * live),
        x: Math.round(rng() * 2000),
        y: Math.round(rng() * 1200),
      });
      continue;
    }
    if (roll < 0.9) {
      ops.push({
        kind: 'recolour',
        index: Math.floor(rng() * live),
        color: COLOR_NAMES[Math.floor(rng() * COLOR_NAMES.length)],
      });
      continue;
    }
    ops.push({ kind: 'delete', index: Math.floor(rng() * live) });
    live = Math.max(0, live - 1);
  }
  return ops;
}

/**
 * Run `ops` against `doc` through the very board-model functions the client uses, and
 * return one line per op so a failure can be read out of the log. `ids` is the running
 * list of note ids the `index` fields address.
 */
export function applyRandomOps(doc: Y.Doc, ops: RandomOp[], ids: string[]): string[] {
  const log: string[] = [];
  for (const op of ops) {
    if (op.kind === 'create') {
      const id = createSticky(doc, { x: op.x, y: op.y });
      if (typeof id !== 'string') {
        log.push('create rejected');
        continue;
      }
      ids.push(id);
      log.push(`create ${short(id)} at ${op.x},${op.y}`);
      continue;
    }
    const id = ids[op.index];
    if (id === undefined) {
      log.push(`${op.kind} skipped: no note at ${op.index}`);
      continue;
    }
    if (op.kind === 'move') {
      moveObject(doc, id, op.x, op.y);
      log.push(`move ${short(id)} to ${op.x},${op.y}`);
    } else if (op.kind === 'recolour') {
      setStickyColor(doc, id, op.color);
      log.push(`recolour ${short(id)} ${op.color}`);
    } else if (op.kind === 'delete') {
      deleteObject(doc, id);
      ids.splice(op.index, 1);
      log.push(`delete ${short(id)}`);
    } else {
      const text = getStickyText(doc, id);
      if (!(text instanceof Y.Text)) {
        log.push(`type skipped: ${short(id)} has no text`);
        continue;
      }
      const at = Math.floor(op.at * (text.toString().length + 1));
      text.insert(at, ` ${op.text}`);
      log.push(`type ${short(id)} +${op.text}`);
    }
  }
  return log;
}

/** Run `ops` and report both the log and the resulting ids. */
export function runRandomOps(doc: Y.Doc, ops: RandomOp[]): { ids: string[]; log: string[] } {
  const ids: string[] = [];
  const log = applyRandomOps(doc, ops, ids);
  return { ids, log };
}

function short(id: string): string {
  return id.slice(0, 8);
}
