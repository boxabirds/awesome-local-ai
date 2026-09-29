// Random board-operation sequences for the integration suite.
//
// The sequence is parameterized by a numeric seed (reproducible). In the test
// files the seed itself is sourced from `crypto.getRandomValues` when a fresh,
// non-reproducible run is wanted; a fixed seed keeps failures reproducible.

import type * as Y from 'yjs';
import type { StickyColor } from '../../../src/shared/config';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS } from '../../../src/shared/config';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  type StickySnapshot,
} from '../../../src/shared/board-model';

export type RandomOp =
  | { kind: 'create'; pendingKey: string; x: number; y: number; color: StickyColor }
  | { kind: 'setText'; id: string; text: string }
  | { kind: 'move'; id: string; x: number; y: number }
  | { kind: 'delete'; id: string };

/** Deterministic PRNG (mulberry32) — small, stable, good enough for tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateRandomOps(seed: number, count: number): RandomOp[] {
  const rand = seededRandom(seed);
  const liveIds: string[] = [];
  const ops: RandomOp[] = [];
  for (let i = 0; i < count; i++) {
    const roll = rand();
    if (roll < 0.55 || liveIds.length === 0) {
      const pendingKey = `__pending_${i}`;
      ops.push({
        kind: 'create',
        pendingKey,
        x: Math.round(rand() * 1000),
        y: Math.round(rand() * 600),
        color: (Object.keys(STICKY_COLORS) as StickyColor[])[Math.floor(rand() * Object.keys(STICKY_COLORS).length)] ?? DEFAULT_STICKY_COLOR,
      });
      liveIds.push(pendingKey);
    } else if (roll < 0.75) {
      const idx = Math.floor(rand() * liveIds.length);
      ops.push({ kind: 'setText', id: liveIds[idx], text: `edited ${i}` });
    } else if (roll < 0.92) {
      const idx = Math.floor(rand() * liveIds.length);
      ops.push({
        kind: 'move',
        id: liveIds[idx],
        x: Math.round(rand() * 800),
        y: Math.round(rand() * 500),
      });
    } else {
      const idx = Math.floor(rand() * liveIds.length);
      ops.push({ kind: 'delete', id: liveIds[idx] });
      liveIds.splice(idx, 1);
    }
  }
  return ops;
}

/**
 * Apply an op sequence to `doc` via the board-model API (which transacts with
 * the local origin). Yjs generates note ids at create time, so pending keys
 * from `generateRandomOps` are mapped to real ids here.
 */
export function applyOps(doc: Y.Doc, ops: RandomOp[]): void {
  const idMap = new Map<string, string>();
  for (const op of ops) {
    if (op.kind === 'create') {
      const id = createSticky(doc, { x: op.x, y: op.y }, op.color);
      idMap.set(op.pendingKey, id);
    } else if (op.kind === 'setText') {
      const realId = idMap.get(op.id) ?? op.id;
      const text = getStickyText(doc, realId);
      if (text) {
        text.delete(0, text.length);
        text.insert(0, op.text);
      }
    } else if (op.kind === 'move') {
      moveObject(doc, idMap.get(op.id) ?? op.id, op.x, op.y);
    } else if (op.kind === 'delete') {
      deleteObject(doc, idMap.get(op.id) ?? op.id);
    }
  }
}

/**
 * Compare two snapshots by content, excluding per-client ids and timestamps.
 * (ids come from `crypto.randomUUID` at create time, so they legitimately
 * differ between clients; content + stacking must match.)
 */
export function boardStatesEqual(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  const key = (n: StickySnapshot) => `${n.x}|${n.y}|${n.text}|${n.color}|${n.z}`;
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.length === kb.length && ka.every((v, i) => v === kb[i]);
}
