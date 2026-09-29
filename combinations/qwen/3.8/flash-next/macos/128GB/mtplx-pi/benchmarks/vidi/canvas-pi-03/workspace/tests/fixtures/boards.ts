// Board fixtures for the storage tests. Built with the REAL board-model calls
// (createSticky / getStickyText / setStickyColor), because the tests are about
// what the storage layer does with genuine board documents: a fixture made of
// synthetic bytes would not exercise multi-line text, overlapping notes or the
// colour/text key layout that a 2 000-note board actually stores.

import * as Y from 'yjs';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

const COLOR_KEYS = Object.keys(STICKY_COLORS) as StickyColor[];

/** Deterministic pseudo-random (mulberry32): fixtures are reproducible. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PHRASES = [
  'Keep the daily stand-up under 10 minutes',
  'What slowed us down this sprint?',
  'Docs drifted from the code again — who owns the runbook?',
  'Ship the import fix behind a flag',
  'Pair on the flaky test before it bites again',
  'Too many hand-offs between design and eng',
  'Lunch-and-learn on the new sync layer?',
  'Car tyres worn unevenly; get an alignment check',
  'Refactor the storage helper before it grows another caller',
  'Great handover notes on Thursday — copy that pattern',
];

function phrase(rnd: () => number): string {
  const words = PHRASES[Math.floor(rnd() * PHRASES.length)].split(' ');
  const extra: string[] = [];
  const target = 10 + Math.floor(rnd() * 290);
  let text = '';
  for (const word of words) {
    if (text.length + word.length > target) break;
    text += (text ? ' ' : '') + word;
    extra.push(text);
  }
  // Multi-line text on some notes: line breaks exercise the text encoding.
  return rnd() < 0.35 ? extra.join('\n') : text;
}

export interface FixtureNote {
  x: number;
  y: number;
  color: StickyColor;
  text: string;
}

/** Build a board of `count` notes with mixed colours, multi-line text and
 * deliberate overlaps (clustered positions), one transaction per note — which
 * is also one stored update per note, the shape the update log sees. */
export function buildBoard(count: number, seed = 1): { doc: Y.Doc; notes: FixtureNote[] } {
  const doc = new Y.Doc();
  const rnd = random(seed);
  const notes: FixtureNote[] = [];
  for (let i = 0; i < count; i += 1) {
    // Clustered: every 6th note starts a new cluster, the rest overlap it.
    const cluster = Math.floor(i / 6);
    const x = (cluster % 12) * 260 + (i % 6) * 40 + Math.floor(rnd() * 20);
    const y = Math.floor(cluster / 12) * 260 + Math.floor(rnd() * 180);
    const color = COLOR_KEYS[Math.floor(rnd() * COLOR_KEYS.length)];
    const id = createSticky(doc, { x, y }, color);
    const text = phrase(rnd);
    const ytext = getStickyText(doc, id);
    if (ytext && text.length > 0) ytext.insert(0, text);
    notes.push({ x, y, color, text });
  }
  return { doc, notes };
}

/** The 25-note retro board used by the "Overnight return" workflow. */
export function buildRetroBoard(): { doc: Y.Doc; notes: FixtureNote[] } {
  return buildBoard(25, 42);
}

/** Raw bytes of a whole-document update (what the update log stores). */
export function encodeBoard(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** The last `n` bytes of an update, cut off — a truncated update. */
export function truncateUpdate(update: Uint8Array, n = 10): Uint8Array {
  return update.slice(0, Math.max(0, update.byteLength - n));
}

/** Same length as `update`, but random bytes: undecodable in a way that keeps
 * any length prefix intact, so the failure happens INSIDE Y.applyUpdate. */
export function damageLikeLength(update: Uint8Array, seed = 7): Uint8Array {
  const rnd = random(seed);
  const out = new Uint8Array(update.byteLength);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.floor(rnd() * 256);
  return out;
}

/** Flip bytes so a valid update becomes undecodable at a chosen offset. */
export function corruptAt(update: Uint8Array, offset = 2): Uint8Array {
  const out = update.slice();
  if (out.byteLength > offset) out[offset] = (out[offset] + 91) % 256;
  return out;
}

/** Build `count` notes, ONE transaction (and therefore one stored update) per
 * note, which is the shape the update log sees on a real board. Returns the
 * updates plus the board snapshot the fixture is expected to reproduce. */
export function buildBoardUpdates(count: number, seed = 1): {
  updates: Uint8Array[];
  expected: ReturnType<typeof snapshot>;
} {
  const doc = new Y.Doc({ gc: true });
  const rnd = random(seed);
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    if (update.byteLength > 2) updates.push(update.slice());
  });
  for (let i = 0; i < count; i += 1) {
    doc.transact(() => {
      const cluster = Math.floor(i / 6);
      const x = (cluster % 12) * 260 + (i % 6) * 40 + Math.floor(rnd() * 20);
      const y = Math.floor(cluster / 12) * 260 + Math.floor(rnd() * 180);
      const color = COLOR_KEYS[Math.floor(rnd() * COLOR_KEYS.length)];
      const id = createSticky(doc, { x, y }, color);
      const text = phrase(rnd);
      const ytext = getStickyText(doc, id);
      if (ytext && text.length > 0) ytext.insert(0, text);
    }, null);
  }
  return { updates, expected: snapshot(doc) };
}
