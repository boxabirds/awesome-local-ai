import type { SyncClient } from './sync-client';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';

/**
 * Seeded random operation fixture (design "Fixtures").
 *
 * Deterministic so a failure can be replayed: the seed is logged, the same
 * seed always produces the same sequence of operations.
 */

export const OP_MIX: ReadonlyArray<{ kind: OpKind; weight: number }> = [
  { kind: 'text', weight: 0.4 },
  { kind: 'move', weight: 0.3 },
  { kind: 'create', weight: 0.1 },
  { kind: 'recolour', weight: 0.1 },
  { kind: 'delete', weight: 0.1 },
];

export type OpKind = 'text' | 'move' | 'create' | 'recolour' | 'delete';

/** Colour names as the document stores them (STICKY_COLORS is keyed by name). */
export const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Words people actually type, so text operations look like real typing. */
export const WORDS = [
  'idea',
  'ship',
  'blocked',
  'follow',
  'budget',
  'launch',
  'testing',
  'handoff',
  'question',
  'tomorrow',
];

/** 32-bit linear congruential generator: small, portable, reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

export function opSequence(seed: number, count: number): OpKind[] {
  const random = seededRandom(seed);
  const ops: OpKind[] = [];
  for (let index = 0; index < count; index += 1) {
    const roll = random();
    let acc = 0;
    for (const entry of OP_MIX) {
      acc += entry.weight;
      if (roll < acc) {
        ops.push(entry.kind);
        break;
      }
    }
  }
  return ops;
}

export interface OpReport {
  readonly seed: number;
  readonly requested: number;
  readonly applied: Record<OpKind, number>;
  /** Ids this client created that are still on the board. */
  readonly surviving: string[];
}

/**
 * Runs `count` random operations on one client and reports what happened.
 * A mutation the model rejects (a note deleted by someone else in the middle
 * of this client's own plan) is skipped rather than forced.
 */
export function runRandomOps(client: SyncClient, seed: number, count: number): OpReport {
  const random = seededRandom(seed);
  const applied: Record<OpKind, number> = { text: 0, move: 0, create: 0, recolour: 0, delete: 0 };
  let mine: string[] = [];

  for (const kind of opSequence(seed, count)) {
    if (kind === 'create' || mine.length === 0) {
      const id = client.createNote(
        { x: Math.round((random() - 0.5) * 2_000), y: Math.round((random() - 0.5) * 2_000) },
        COLOR_NAMES[Math.floor(random() * COLOR_NAMES.length)],
      );
      if (id !== null) {
        mine.push(id);
        applied.create += 1;
      }
      continue;
    }

    const id = mine[Math.floor(random() * mine.length)];
    if (kind === 'move') {
      if (client.move(id, Math.round((random() - 0.5) * 2_000), Math.round((random() - 0.5) * 2_000))) {
        applied.move += 1;
      }
    } else if (kind === 'recolour') {
      if (client.recolour(id, COLOR_NAMES[Math.floor(random() * COLOR_NAMES.length)])) {
        applied.recolour += 1;
      }
    } else if (kind === 'text') {
      const text = client.textOf(id) ?? '';
      const at = Math.floor(random() * (text.length + 1));
      client.type(id, at, `${WORDS[Math.floor(random() * WORDS.length)]} `);
      applied.text += 1;
    } else {
      if (client.remove(id)) {
        applied.delete += 1;
        mine = mine.filter((entry) => entry !== id);
      }
    }
  }

  const present = new Set(client.board.map((note) => note.id));
  return { seed, requested: count, applied, surviving: mine.filter((id) => present.has(id)) };
}

export function logSeed(scope: string, seed: number): void {
  // Seeds are logged so a failing run can be replayed exactly.
  console.log(`[seed] ${scope}: ${seed}`);
}
