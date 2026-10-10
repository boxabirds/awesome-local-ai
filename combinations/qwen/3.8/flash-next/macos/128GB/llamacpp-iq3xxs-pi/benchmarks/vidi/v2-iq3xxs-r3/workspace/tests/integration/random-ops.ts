/**
 * Seeded random edits for the convergence tests (TC-12, TC-30).
 *
 * Deterministic on purpose: when a snapshot ever differs, the seed in the log
 * rebuilds exactly the same 200 edits. The mix is the design's — 40 % typing,
 * 30 % moving, 10 % creating, 10 % recolouring, 10 % deleting — and every
 * operation goes through the real `src/shared/board-model.ts` functions, so what
 * converges is what the product does, not a test's idea of it.
 */
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

import { BoardClient, createNote, deleteNote, moveNote, recolourNote, typeInNote } from './ws-client';

/** Ordinary words: log-readable text, and nothing a merge rule treats specially. */
const WORDS = [
  'green', 'harbour', 'kite', 'signal', 'deck', 'marble', 'orange', 'quiet',
  'stair', 'walnut', 'anchor', 'ferry', 'lantern', 'meadow', 'cedar', 'vellum',
];

/** mulberry32: 32 bits of state, good enough to reproduce a run exactly. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a run of `randomEdit` did, so a failure can be read from the log. */
export interface OpReport {
  seed: number;
  typing: number;
  moves: number;
  creates: number;
  recolours: number;
  deletes: number;
  /** Requests that found no note to work on, and so created one instead. */
  fallbacks: number;
}

export function newReport(seed: number): OpReport {
  return { seed, typing: 0, moves: 0, creates: 0, recolours: 0, deletes: 0, fallbacks: 0 };
}

/** One-line summary for the test log (also the seed to re-run with). */
export function formatReport(report: OpReport): string {
  return `seed=${report.seed} typing=${report.typing} moves=${report.moves} creates=${report.creates} recolours=${report.recolours} deletes=${report.deletes} fallbacks=${report.fallbacks}`;
}

/** The colours the product offers, as the type sees them. */
export const STICKY_COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/**
 * One edit of the mix the design names. `rng` decides which one, so a test can
 * interleave the clients to force genuine concurrency.
 */
export function randomEdit(client: BoardClient, rng: () => number, report: OpReport): void {
  const roll = rng();
  const ids = [...client.objects().keys()];
  // Anything but creating needs a note to work on; with none left, create.
  if (ids.length === 0) {
    createNote(client, point(rng));
    report.creates += 1;
    report.fallbacks += 1;
    return;
  }
  const id = ids[Math.floor(rng() * ids.length)] as string;

  if (roll < 0.4) {
    const word = WORDS[Math.floor(rng() * WORDS.length)] as string;
    // A leading space keeps typed words separate, so a merged text is readable.
    typeInNote(client, id, ` ${word}`);
    report.typing += 1;
    return;
  }
  if (roll < 0.7) {
    const at = point(rng);
    moveNote(client, id, at.x, at.y);
    report.moves += 1;
    return;
  }
  if (roll < 0.8) {
    createNote(client, point(rng));
    report.creates += 1;
    return;
  }
  if (roll < 0.9) {
    recolourNote(client, id, pick(rng, STICKY_COLOR_NAMES));
    report.recolours += 1;
    return;
  }
  if (deleteNote(client, id)) report.deletes += 1;
  else report.fallbacks += 1;
}

/** A board position, and always a whole number so a diff is easy to read. */
function point(rng: () => number): { x: number; y: number } {
  return { x: Math.floor(rng() * 4000) - 2000, y: Math.floor(rng() * 4000) - 2000 };
}

/** One entry of `choices`, chosen by `rng`. */
function pick<T>(rng: () => number, choices: readonly T[]): T {
  return choices[Math.floor(rng() * choices.length)] as T;
}
