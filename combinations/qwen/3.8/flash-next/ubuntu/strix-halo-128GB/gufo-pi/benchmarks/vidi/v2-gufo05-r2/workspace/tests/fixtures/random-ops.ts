/**
 * Seeded random operation generator for the capacity and convergence tests.
 *
 * The mix is the design's: 40% typing real words, 30% moves, 10% creates,
 * 10% recolours, 10% deletes. Every mutation goes through the real
 * `board-model` functions, and every seed is logged by the caller so a failing
 * run can be replayed exactly.
 */

import * as Y from 'yjs';

import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

export const OP_KINDS = ['text', 'move', 'create', 'recolor', 'delete'] as const;
export type OpKind = (typeof OP_KINDS)[number];

/** Share of each kind, in the order of OP_KINDS (sums to 1). */
export const OP_WEIGHTS: readonly number[] = [0.4, 0.3, 0.1, 0.1, 0.1];

/** Real English words, so generated note text looks like note text. */
export const WORDS: readonly string[] = [
  'pricing',
  'onboarding',
  'empty',
  'states',
  'shipping',
  'research',
  'backlog',
  'insight',
  'workflow',
  'handoff',
  'retro',
  'spike',
  'prototype',
  'feedback',
  'loop',
  'roadmap',
];

/** Deterministic PRNG (mulberry32): same seed, same run. */
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

/** Pick an operation kind with the configured weights. */
export function nextOpKind(rng: () => number): OpKind {
  const roll = rng();
  let cumulative = 0;
  for (let i = 0; i < OP_KINDS.length; i++) {
    cumulative += OP_WEIGHTS[i] ?? 0;
    if (roll < cumulative) return OP_KINDS[i] as OpKind;
  }
  return OP_KINDS[OP_KINDS.length - 1] as OpKind;
}

/**
 * Apply one random operation to `doc` through the real model functions.
 * Ops that need a note act on a note chosen from the current snapshot; when the
 * board is empty the op becomes a create, so a run always makes progress.
 */
export function applyRandomOp(doc: Y.Doc, rng: () => number): OpKind {
  const kind = nextOpKind(rng);
  const notes = snapshot(doc);
  if (kind !== 'create' && notes.length === 0) {
    createSticky(doc, point(rng));
    return 'create';
  }
  switch (kind) {
    case 'create': {
      createSticky(doc, point(rng));
      return 'create';
    }
    case 'move': {
      moveObject(doc, pick(notes, rng)!.id, rng() * 4000 - 2000, rng() * 4000 - 2000);
      return 'move';
    }
    case 'recolor': {
      const colors = Object.keys(STICKY_COLORS) as StickyColor[];
      setStickyColor(doc, pick(notes, rng)!.id, pick(colors, rng) as StickyColor);
      return 'recolor';
    }
    case 'delete': {
      deleteObject(doc, pick(notes, rng)!.id);
      return 'delete';
    }
    case 'text': {
      const target = pick(notes, rng)!;
      const text = getStickyText(doc, target.id);
      if (!text) return 'text';
      const word = `${pick(WORDS, rng) as string} `;
      const at = Math.min(Math.floor(rng() * (text.length + 1)), text.length);
      doc.transact(() => text.insert(at, word));
      return 'text';
    }
  }
}

/** Run `count` random operations, returning the kinds applied. */
export function runRandomOps(doc: Y.Doc, rng: () => number, count: number): OpKind[] {
  const kinds: OpKind[] = [];
  for (let i = 0; i < count; i++) kinds.push(applyRandomOp(doc, rng));
  return kinds;
}

function point(rng: () => number): { x: number; y: number } {
  return { x: rng() * 4000 - 2000, y: rng() * 4000 - 2000 };
}

function pick<T>(items: readonly T[], rng: () => number): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)] as T;
}
