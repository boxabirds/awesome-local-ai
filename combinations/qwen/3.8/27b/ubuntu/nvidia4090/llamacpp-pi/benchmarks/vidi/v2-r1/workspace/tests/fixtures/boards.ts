// Board fixtures for story 4 (and later stories): boards generated with the
// real board-model calls, plus damaged byte fixtures. Deterministic per seed.
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
  type StickySnapshot,
  snapshot,
} from '../../src/shared/board-model';
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';

/** Small fast deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

const WORDS = [
  'ship', 'before', 'the', 'demo', 'refactor', 'the', 'sync', 'code', 'because', 'it',
  'works', 'today', 'but', 'nobody', 'can', 'read', 'it', 'rename', 'this', 'file',
  'again', 'the', 'board', 'fills', 'up', 'fast', 'sticky', 'notes', 'are', 'cheap',
  'meetings', 'are', 'not', 'remember', 'who', 'owns', 'the', 'roadmap', 'deadline',
  'moved', 'to', 'friday', 'ask', 'legal', 'about', 'the', 'export', 'feature',
  'cache', 'invalidation', 'is', 'hard', 'user', 'stories', 'need', 'slices', 'that',
  'fit', 'in', 'one', 'afternoon', 'the', 'prototype', 'proved', 'the', 'gesture',
  'works', 'paint', 'the', 'flow', 'map', 'green', 'for', 'happy', 'paths', 'orange',
  'for', 'errors', 'mark', 'todo', 'where', 'the', 'spec', 'is', 'silent', 'measure',
  'twice', 'cut', 'once', 'ship', 'small', 'verify', 'often', 'the', 'grid', 'snaps',
  'notes', 'nicely', 'drag', 'handles', 'need', 'visible', 'affordances', 'keyboard',
  'access', 'first', 'screen', 'reader', 'labels', 'on', 'every', 'control',
];

/** A realistic English phrase of `minChars`–`maxChars` characters. */
export function phrase(rng: () => number, minChars = 10, maxChars = 300): string {
  const words: string[] = [];
  let length = 0;
  for (;;) {
    const word = WORDS[Math.floor(rng() * WORDS.length)];
    const addition = word.length + (words.length > 0 ? 1 : 0);
    if (length >= minChars && length + addition > maxChars) break;
    words.push(word);
    length += addition;
    if (length >= minChars && rng() < 0.35) break;
  }
  return words.join(' ');
}

/** One to three lines of phrase text (multi-line note content). */
export function multiLinePhrase(rng: () => number): string {
  const lines = 1 + Math.floor(rng() * 3);
  const out: string[] = [];
  for (let i = 0; i < lines; i += 1) out.push(phrase(rng, 10, 120));
  return out.join('\n');
}

/**
 * The 25-note "retro board": mixed colours, multi-line text and an overlapping
 * stack (5×5 grid with jitter, well under the 200-unit note size).
 */
export function createRetroBoard(doc: Y.Doc, seed = 7): void {
  const rng = mulberry32(seed);
  for (let i = 0; i < 25; i += 1) {
    const color = COLOR_NAMES[i % COLOR_NAMES.length];
    const col = i % 5;
    const row = Math.floor(i / 5);
    const at = {
      x: 400 + col * 80 + Math.round((rng() - 0.5) * 40),
      y: 300 + row * 80 + Math.round((rng() - 0.5) * 40),
    };
    const id = createSticky(doc, at, color);
    const text = id === null ? undefined : getStickyText(doc, id);
    text?.insert(0, multiLinePhrase(rng));
  }
}

/**
 * A `notes`-note board (default PERSIST_TESTED_NOTES) as a single Yjs state
 * update: realistic 10–300 char phrases, clustered layout (10×10 clusters,
 * notes jittered within ~±300 units of their cluster centre).
 */
export function generateLargeBoardUpdate(seed = 42, notes = PERSIST_TESTED_NOTES): Uint8Array {
  const doc = new Y.Doc();
  initDoc(doc);
  const rng = mulberry32(seed);
  const perSide = 10;
  const spacing = 2400;
  for (let i = 0; i < notes; i += 1) {
    const cluster = i % (perSide * perSide);
    const cx = Math.floor(cluster / perSide) * spacing;
    const cy = (cluster % perSide) * spacing;
    const at = {
      x: cx + Math.round((rng() - 0.5) * 600),
      y: cy + Math.round((rng() - 0.5) * 600),
    };
    const id = createSticky(doc, at, COLOR_NAMES[i % COLOR_NAMES.length]);
    const text = id === null ? undefined : getStickyText(doc, id);
    text?.insert(0, phrase(rng, 10, 300));
  }
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

/** The last 10 bytes removed: a plausibly-truncated update. */
export function truncatedUpdate(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.length - 10));
}

/** Random bytes of exactly `n` length (same length as a real update, wrong content). */
export function randomBytesOfLength(n: number, seed = 1): Uint8Array {
  const rng = mulberry32(seed);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.floor(rng() * 256);
  return out;
}

/** Deep-equality helper for board snapshots (frozen, sorted by the model). */
export function snapshotsEqual(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].id !== b[i].id ||
      a[i].x !== b[i].x ||
      a[i].y !== b[i].y ||
      a[i].z !== b[i].z ||
      a[i].color !== b[i].color ||
      a[i].text !== b[i].text ||
      a[i].createdAt !== b[i].createdAt
    ) {
      return false;
    }
  }
  return true;
}

/** A world point (centre of a note). */
export interface BoardCenter {
  x: number;
  y: number;
}

/**
 * Story 7 e2e fixture ("20-note retro board"): two overlapping-stacking
 * clusters of ten notes each — a 5 × 2 grid with 260-unit horizontal spacing
 * (60-unit gutters: no horizontal overlap) and 120-unit vertical spacing
 * (80-unit vertical overlap), centred on (0, 0) and (900, 600).
 *
 * `a[i]` is cluster A, row-major (top row left→right, then bottom row);
 * `b[i]` likewise for cluster B. Texts are deterministic realistic phrases.
 */
export function selectionBoardFixture(seed = 11): { a: { center: BoardCenter; text: string }[]; b: { center: BoardCenter; text: string }[] } {
  const rng = mulberry32(seed);
  const grid = (cx: number, cy: number) => {
    const cols = [-260 * 2, -260, 0, 260, 260 * 2];
    const rows = [-60, 60];
    const out: BoardCenter[] = [];
    for (const row of rows) {
      for (const col of cols) out.push({ x: cx + col, y: cy + row });
    }
    return out;
  };
  const mk = (centers: BoardCenter[]) =>
    centers.map((center) => ({ center, text: phrase(rng, 10, 60) }));
  return { a: mk(grid(0, 0)), b: mk(grid(900, 600)) };
}

/** The snapshot of a doc (imported here so tests need one import path). */
export { snapshot };
