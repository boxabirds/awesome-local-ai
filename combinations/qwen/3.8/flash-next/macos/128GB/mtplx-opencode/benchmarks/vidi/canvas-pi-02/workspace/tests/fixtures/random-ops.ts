/**
 * Seeded random board operations (design "Fixtures").
 *
 * Used by the capacity tests (TC-12, TC-30): five participants each run a
 * couple of hundred operations and the end states have to be identical. For
 * that to mean anything the mix has to look like real use, so the generator
 * draws in the proportions the design names - 40% typing of real words, 30%
 * moves, 10% creates, 10% recolours, 10% deletes - and goes through the same
 * `board-model` functions the app uses, one transaction per operation.
 *
 * The generator is deterministic from its seed, and every run prints the seed
 * with it, so a failure can be replayed.
 */
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { STICKY_COLORS } from '../../src/shared/config';

/** The kinds of operation the generator can draw. */
export type OperationKind = 'type' | 'move' | 'create' | 'recolor' | 'delete';

/** One applied operation, kept so a failure can say what happened. */
export interface AppliedOperation {
  kind: OperationKind;
  /** The note acted on, or `''` for a create. */
  note: string;
  /** What was done, for the failure message. */
  detail: string;
}

/**
 * 32-bit xorshift generator.
 *
 * Small and reproducible; the tests only need a repeatable mix, not
 * cryptographic quality.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/** Real English words, so typed text lays out like a real note. */
const WORDS = [
  'board',
  'notes',
  'sync',
  'merge',
  'cursor',
  'owner',
  'column',
  'colour',
  'review',
  'idea',
  'draft',
  'choice',
  'handoff',
  'thread',
  'summary',
];

/** The shares named by the design, in draw order. */
const OPERATION_WEIGHTS: ReadonlyArray<[OperationKind, number]> = [
  ['type', 0.4],
  ['move', 0.3],
  ['create', 0.1],
  ['recolor', 0.1],
  ['delete', 0.1],
];

/** Where a move may land, in world units. */
const SPREAD_WORLD = 2_000;

function drawKind(random: () => number): OperationKind {
  const roll = random();
  let edge = 0;
  for (const [kind, weight] of OPERATION_WEIGHTS) {
    edge += weight;
    if (roll < edge) return kind;
  }
  return 'create';
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length) % items.length] as T;
}

function noteIds(doc: Y.Doc): string[] {
  const ids: string[] = [];
  doc.getMap<Y.Map<unknown>>('objects').forEach((value, id) => {
    if (value instanceof Y.Map && value.get('type') === 'sticky') ids.push(id);
  });
  return ids;
}

/**
 * Apply `count` random operations to `doc`.
 *
 * Operations that need a note pick one at random from the notes this document
 * currently holds; with none, the draw becomes a create. Operations that come
 * back `false` from `board-model` (a note deleted by somebody else in the
 * meantime) are recorded as skipped: the point of the fixture is the traffic
 * they generate, not the app's validation.
 */
export function runRandomOperations(
  doc: Y.Doc,
  options: { seed: number; count: number },
): AppliedOperation[] {
  const random = seededRandom(options.seed);
  const applied: AppliedOperation[] = [];
  for (let step = 0; step < options.count; step += 1) {
    let kind = drawKind(random);
    let ids = noteIds(doc);
    if (ids.length === 0 && kind !== 'create') kind = 'create';
    if (kind === 'create') {
      const x = (random() - 0.5) * SPREAD_WORLD;
      const y = (random() - 0.5) * SPREAD_WORLD;
      const id = createSticky(doc, { x, y }, pick(Object.keys(STICKY_COLORS), random));
      applied.push({ kind, note: id, detail: `created at ${x.toFixed(0)},${y.toFixed(0)}` });
      continue;
    }
    ids = noteIds(doc);
    const id = pick(ids, random);
    if (kind === 'move') {
      const x = (random() - 0.5) * SPREAD_WORLD;
      const y = (random() - 0.5) * SPREAD_WORLD;
      const done = moveObject(doc, id, x, y);
      applied.push({ kind, note: id, detail: `${done ? 'moved' : 'skipped'} to ${x.toFixed(0)},${y.toFixed(0)}` });
      continue;
    }
    if (kind === 'recolor') {
      const color = pick(Object.keys(STICKY_COLORS), random);
      const done = setStickyColor(doc, id, color);
      applied.push({ kind, note: id, detail: `${done ? 'recoloured' : 'skipped'} to ${color}` });
      continue;
    }
    if (kind === 'delete') {
      const done = deleteObject(doc, id);
      applied.push({ kind, note: id, detail: done ? 'deleted' : 'skipped' });
      continue;
    }
    const text = getStickyText(doc, id);
    if (text === undefined) continue;
    const word = ` ${pick(WORDS, random)}`;
    const position = Math.floor(random() * (text.length + 1));
    doc.transact(() => {
      text.insert(position, word);
    }, LOCAL_ORIGIN);
    applied.push({ kind, note: id, detail: `typed "${word}" at ${position}` });
  }
  return applied;
}

/** A one-line summary of a run, for printing with the seed. */
export function describeOperations(applied: readonly AppliedOperation[]): string {
  const counts = new Map<string, number>();
  for (const operation of applied) {
    counts.set(operation.kind, (counts.get(operation.kind) ?? 0) + 1);
  }
  return [...counts.entries()].map(([kind, count]) => `${kind}=${count}`).join(' ');
}
