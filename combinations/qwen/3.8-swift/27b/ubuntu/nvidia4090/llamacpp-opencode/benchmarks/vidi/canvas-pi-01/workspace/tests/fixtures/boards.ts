// Board fixtures for persistence tests (spec: persist.board_store / persist.room
// Fixtures). Boards are generated through the real board-model functions so the
// captured bytes are real Yjs updates. All generators are deterministic
// (seeded PRNG) so repeated runs produce identical boards.

import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Multi-line retro items (the 25-note board cycles through these). */
const RETRO_TEXTS = [
  'Went well: the new signup flow\nshipped on schedule with no\nblocking issues.',
  'Could improve: onboarding drops\noff after step 2 — the form\nfeels like a wall.',
  'Action: split the billing form\ninto two shorter steps and\nadd a progress bar.',
  'Went well: support tickets\nstayed flat through the\nlaunch week.',
  'Could improve: search results\nare slow on mobile (p95\nover 2 s).',
  'Action: prototype the empty\nstate for a new workspace.',
  'Went well: the whiteboard\nfinally felt fast enough for\nthe whole workshop.',
  'Risk: the export feature is\nslipping — we promised it\nfor next sprint.',
  'Action: write down the five\nmost confusing onboarding\nscreens from user testing.',
  'Could improve: colour\ncontrast on the violet note\nfails the accessibility check.',
];

function makeRetroBoardInto(doc: Y.Doc, out: string[]): void {
  const rand = mulberry32(42);
  for (let i = 0; i < 25; i++) {
    // 5 x 5 grid at 180 spacing: notes (200 x 200) overlap their neighbours.
    const col = i % 5;
    const row = Math.floor(i / 5);
    const centreX = col * 180 + 100 + Math.floor(rand() * 40) - 20;
    const centreY = row * 180 + 100 + Math.floor(rand() * 40) - 20;
    const id = createSticky(doc, { x: centreX, y: centreY }, COLOR_NAMES[i % COLOR_NAMES.length]);
    getStickyText(doc, id)!.insert(0, RETRO_TEXTS[i % RETRO_TEXTS.length]!);
    out.push(id);
    // Vary the stacking order: every 4th note is raised above the rest.
    if (i > 0 && i % 4 === 3) bringToFront(doc, id);
  }
}

/**
 * A 25-note "retro" board: mixed colours, multi-line texts, overlapping
 * positions and a non-trivial stacking order. Returns the notes in
 * rendering order and records creation ids in `creationIds`.
 */
export function makeRetroBoard(doc: Y.Doc, creationIds?: string[]): readonly StickySnapshot[] {
  initDoc(doc);
  const ids: string[] = [];
  makeRetroBoardInto(doc, ids);
  if (creationIds !== undefined) creationIds.push(...ids);
  return snapshot(doc);
}

const WORDS = [
  'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'near', 'the',
  'old', 'bridge', 'where', 'the', 'river', 'bends', 'slowly', 'toward', 'a', 'quiet',
  'village', 'full', 'of', 'bakeries', 'and', 'small', 'gardens', 'behind', 'tiled',
  'walls', 'some', 'notes', 'about', 'onboarding', 'billing', 'search', 'exports',
  'latency', 'contrast', 'empty', 'states', 'progress', 'bars', 'workshops', 'prototypes',
  'sprint', 'planning', 'release', 'tickets', 'customers', 'meet', 'first', 'then',
  'again', 'later', 'together', 'every', 'morning', 'before', 'the', 'coffee', 'runs',
  'out', 'completely', 'and', 'someone', 'always', 'refills', 'the', 'shared', 'kettle',
];

/** A realistic English phrase of 10–300 characters. */
export function realisticPhrase(rand: () => number): string {
  const minChars = 10;
  const maxChars = 300;
  let words: string[] = [];
  let text = '';
  // Bias toward the long end so 2,000 notes comfortably exceed one snapshot
  // chunk (persist.large_board fixtures).
  const target = minChars + Math.floor(rand() * (maxChars - minChars));
  while (text.length < target && words.length < 80) {
    const word = WORDS[Math.floor(rand() * WORDS.length)]!;
    words.push(word);
    text = words.join(' ');
  }
  if (text.length > maxChars) text = text.slice(0, maxChars);
  return text;
}

/**
 * A board of `notes` realistic notes (default PERSIST_TESTED_NOTES) laid out
 * in clusters. Returns the notes in rendering order.
 */
export function makeLargeBoard(doc: Y.Doc, notes: number = PERSIST_TESTED_NOTES): readonly StickySnapshot[] {
  initDoc(doc);
  const rand = mulberry32(7);
  const perCluster = 100;
  const clusters = Math.ceil(notes / perCluster);
  const cols = 5;
  const clusterSpacing = 1600;
  let n = 0;
  for (let c = 0; c < clusters && n < notes; c++) {
    const cx = (c % cols) * clusterSpacing - ((cols - 1) * clusterSpacing) / 2;
    const cy = Math.floor(c / cols) * clusterSpacing - ((Math.ceil(clusters / cols) - 1) * clusterSpacing) / 2;
    for (let k = 0; k < perCluster && n < notes; k++, n++) {
      const centreX = cx + (rand() - 0.5) * 1200;
      const centreY = cy + (rand() - 0.5) * 1200;
      const id = createSticky(doc, { x: centreX, y: centreY }, COLOR_NAMES[Math.floor(rand() * COLOR_NAMES.length)]);
      getStickyText(doc, id)!.insert(0, realisticPhrase(rand));
    }
  }
  return snapshot(doc);
}

/**
 * Run `build` on a fresh doc and capture every update it produces (plus the
 * finished doc). The updates, applied in order to an empty doc, rebuild the
 * board exactly.
 */
export function buildWithUpdates(build: (doc: Y.Doc) => unknown): {
  doc: Y.Doc;
  updates: Uint8Array[];
  state: readonly StickySnapshot[];
} {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  const handler = (update: Uint8Array) => {
    updates.push(update);
  };
  doc.on('update', handler);
  build(doc);
  doc.off('update', handler);
  return { doc, updates, state: snapshot(doc) };
}

/** Append every update of `built` to the store, one row each, in order. */
export function appendAll(store: { append(update: Uint8Array): void }, built: { updates: Uint8Array[] }): void {
  for (const update of built.updates) store.append(update);
}

/** Extra single-update ops (moves / recolours) to pad a log to an exact size. */
export function padWithMoves(doc: Y.Doc, ids: string[], count: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  const handler = (update: Uint8Array) => {
    out.push(update);
  };
  doc.on('update', handler);
  for (let i = 0; i < count; i++) {
    moveObject(doc, ids[i % ids.length]!, 1000 + i, 1000 + i);
  }
  doc.off('update', handler);
  return out;
}

/** Damaged data: the last 10 bytes removed (spec Fixtures). */
export function truncatedUpdate(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.length - 10));
}

/** Damaged data: random bytes of the given length (spec Fixtures). */
export function randomBytes(length: number, seed = 1234): Uint8Array {
  const rand = mulberry32(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

/** True when two board snapshots are identical (including ids and z order). */
export function sameState(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
