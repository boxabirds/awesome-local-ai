import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  bringToFront,
  getStickyText,
  type StickySnapshot,
} from '@shared/board-model';
import { STICKY_COLORS, PERSIST_TESTED_NOTES, type StickyColor } from '@shared/config';

export interface GeneratedBoard {
  doc: Y.Doc;
  /** Every Yjs update that built `doc`, in application order (each is one log row). */
  updates: Uint8Array[];
}

// Attach an update collector to a fresh doc. Returns the doc and a getter for the
// collected updates. Every mutation below produces one captured update.
function startCapture(): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u.slice()));
  initDoc(doc);
  return { doc, updates };
}

const COLOR_KEYS = Object.keys(STICKY_COLORS) as StickyColor[];

const RETRO_TEXTS = [
  'What went well this sprint?',
  'Shipped the exporter\nand the retry logic',
  'Too many meetings\non Tuesday',
  'Loved the pairing sessions',
  'Deploys are still slow',
  'Great onboarding doc',
  'Need clearer acceptance criteria',
  'Celebration of the release!',
  'Flaky tests cost us\ntwo days',
  'Async standup works well',
];

/**
 * A 25-note retrospective board with mixed colours, multi-line text and
 * overlapping notes (to exercise stacking order).
 */
export function generateRetroBoard(): GeneratedBoard {
  const { doc, updates } = startCapture();
  for (let i = 0; i < 25; i++) {
    const color = COLOR_KEYS[i % COLOR_KEYS.length];
    const text = RETRO_TEXTS[i % RETRO_TEXTS.length];
    // Overlap notes in pairs: even notes on a grid, odd notes nudged onto the previous.
    const gridX = (i % 5) * 210;
    const gridY = Math.floor(i / 5) * 230;
    const x = i % 2 === 1 ? gridX - 60 : gridX;
    const y = i % 2 === 1 ? gridY - 40 : gridY;
    const id = createSticky(doc, { x, y }, color);
    getStickyText(doc, id)?.insert(0, text);
    // Give every third note a deliberate z shuffle to create stacking variety.
    if (i % 3 === 0) bringToFront(doc, id);
    if (i % 7 === 5) moveObject(doc, id, x + 15, y + 15);
  }
  return { doc, updates };
}

// Deterministic PRNG so large boards are reproducible across runs.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  'the be to of and a in that have it for not on with he as you do at this but his ' +
  'by from they we say her she or an will my one all would there their what so up out ' +
  'if about who get which go me when make can like time no just him know take into ' +
  'year good some could them see other than then now look only come over think also ' +
  'back after use two how our work first well way even new want because any these give ' +
  'day most us idea design board note colour cluster sync review sprint backlog feature'
).split(' ');

// Build a realistic English-ish phrase of `len` characters (10..300).
function phrase(rng: () => number, len: number): string {
  let s = '';
  while (s.length < len) {
    const word = WORDS[Math.floor(rng() * WORDS.length)];
    s += (s.length ? ' ' : '') + word;
  }
  return s.slice(0, len);
}

/**
 * A large board of `count` notes with realistic 10-300 character phrases laid out
 * in clusters. Used to prove compaction chunks the snapshot (TC-08) and to seed the
 * large-board open test (TC-21).
 */
export function generateLargeBoard(count: number = PERSIST_TESTED_NOTES): GeneratedBoard {
  const { doc, updates } = startCapture();
  const rng = mulberry32(0x1a2b3c);
  const perCluster = 25;
  for (let i = 0; i < count; i++) {
    const cluster = Math.floor(i / perCluster);
    const inCluster = i % perCluster;
    const baseX = (cluster % 12) * 900;
    const baseY = Math.floor(cluster / 12) * 900;
    const x = baseX + (inCluster % 5) * 170 + Math.floor(rng() * 40);
    const y = baseY + Math.floor(inCluster / 5) * 170 + Math.floor(rng() * 40);
    const color = COLOR_KEYS[Math.floor(rng() * COLOR_KEYS.length)];
    const len = 10 + Math.floor(rng() * 291); // 10..300
    const id = createSticky(doc, { x, y }, color);
    getStickyText(doc, id)?.insert(0, phrase(rng, len));
  }
  return { doc, updates };
}

/**
 * Append `n` no-op-ish updates (distinct writes to the `meta` map) to an existing
 * doc so tests can drive the log to a target row count without changing notes.
 * Returns the newly produced updates (also applied to `doc`).
 */
export function padUpdates(doc: Y.Doc, n: number): Uint8Array[] {
  const extra: Uint8Array[] = [];
  const listener = (u: Uint8Array) => extra.push(u.slice());
  doc.on('update', listener);
  const meta = doc.getMap('meta');
  for (let i = 0; i < n; i++) {
    doc.transact(() => {
      meta.set('pad_' + i, i);
    });
  }
  doc.off('update', listener);
  return extra;
}

export const damagedBytes = {
  /** Remove the trailing `cut` bytes (default 10) so Yjs fails to decode. */
  truncate(u: Uint8Array, cut = 10): Uint8Array {
    return u.slice(0, Math.max(0, u.length - cut));
  },
  /** Random bytes of the same length as `u` (also fails to decode). */
  randomSameLength(u: Uint8Array): Uint8Array {
    const r = new Uint8Array(u.length);
    for (let i = 0; i < r.length; i++) r[i] = (Math.random() * 256) | 0;
    return r;
  },
};

export type { StickySnapshot };
