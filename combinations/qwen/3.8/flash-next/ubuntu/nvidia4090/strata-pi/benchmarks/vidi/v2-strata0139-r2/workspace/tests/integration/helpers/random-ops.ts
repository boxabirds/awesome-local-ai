/**
 * Seeded random board edits (`tests/integration/helpers/random-ops.ts`).
 *
 * Used by the multi-writer convergence tests (TC-12, and the nightly capacity
 * soak) so a failure is reproducible: every choice comes from a `mulberry32`
 * stream whose seed the test logs. The edits themselves are the real
 * `board-model` mutations, exactly as the client performs them.
 *
 * Mix, per the spec: 40% typing real words, 30% moves, 10% creates,
 * 10% recolours, 10% deletes.
 */

import type * as Y from "yjs";
import {
  createSticky,
  deleteObject,
  getStickyText,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
  snapshot,
} from "../../../src/shared/board-model";
import { STICKY_COLORS, STICKY_TEXT_MAX_CHARS, type StickyColor } from "../../../src/shared/config";

const WORDS = [
  "design",
  "ship",
  "budget",
  "spike",
  "review",
  "draft",
  "blocker",
  "metric",
  "demo",
  "follow-up",
];

const COLORS: readonly StickyColor[] = Object.keys(STICKY_COLORS) as StickyColor[];

/** Deterministic 32-bit PRNG: small, dependency-free and stable across runs. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RandomOpLog {
  /** Ids this generator created. */
  readonly created: string[];
  /** Ids this generator deleted. */
  readonly deleted: string[];
  /** How many edits actually changed the document. */
  readonly applied: number;
  readonly seed: number;
}

/**
 * One random edit against `doc`. Call it repeatedly for a session; the note it
 * acts on is whichever note the document currently holds.
 */
export function randomOp(doc: Y.Doc, random: () => number): Pick<RandomOpLog, "created" | "deleted"> & { applied: boolean } {
  const notes = snapshot(doc);
  const target = notes.length === 0 ? undefined : notes[Math.floor(random() * notes.length)!];
  const roll = random();

  if (target === undefined || roll < 0.1) {
    const x = Math.round(random() * 1_200) - 600;
    const y = Math.round(random() * 800) - 400;
    const color = COLORS[Math.floor(random() * COLORS.length)!]!;
    const id = createSticky(doc, { x, y }, color);
    return typeof id === "string" ? { created: [id], deleted: [], applied: true } : { created: [], deleted: [], applied: false };
  }

  if (roll < 0.5) {
    const text = getStickyText(doc, target.id);
    if (!text) return { created: [], deleted: [], applied: false };
    const word = `${WORDS[Math.floor(random() * WORDS.length)!]} `;
    const room = STICKY_TEXT_MAX_CHARS - text.toString().length;
    if (room <= 0) return { created: [], deleted: [], applied: false };
    const at = Math.min(Math.floor(random() * (text.toString().length + 1)), room);
    doc.transact(() => text.insert(at, word.slice(0, room)), LOCAL_ORIGIN);
    return { created: [], deleted: [], applied: true };
  }

  if (roll < 0.8) {
    const x = Math.round(random() * 1_200) - 600;
    const y = Math.round(random() * 800) - 400;
    return { created: [], deleted: [], applied: moveObject(doc, target.id, x, y) };
  }

  if (roll < 0.9) {
    const color = COLORS[Math.floor(random() * COLORS.length)!]!;
    return { created: [], deleted: [], applied: setStickyColor(doc, target.id, color) };
  }

  const removed = deleteObject(doc, target.id);
  return { created: [], deleted: removed ? [target.id] : [], applied: removed };
}

/** Applies `ops` random edits to `doc` from `seed`. */
export function runRandomOps(doc: Y.Doc, seed: number, ops: number): RandomOpLog {
  const random = seededRandom(seed);
  const created: string[] = [];
  const deleted: string[] = [];
  let applied = 0;

  for (let i = 0; i < ops; i += 1) {
    const result = randomOp(doc, random);
    created.push(...result.created);
    deleted.push(...result.deleted);
    if (result.applied) applied += 1;
  }

  return { created, deleted, applied, seed };
}
