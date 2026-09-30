// Realistic boards built with the real board-model functions, so their bytes are
// real Yjs updates (story 4 persistence tests).
import * as Y from 'yjs';
import { bringToFront, createSticky, getStickyText, initDoc, moveObject, resizeObjects } from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

const RETRO_TEXTS = [
  'Went well:\nshipping on Friday',
  'Standups ran long',
  'Pairing on the parser\nhelped a lot',
  'Too many meetings',
  'Try: async demo videos',
  'Flaky CI 😬',
  'Great onboarding docs',
  'Unclear ownership of billing',
  'More customer calls',
  '',
  'Celebrate the launch!',
  'Release checklist\n- tests\n- changelog\n- tag',
  'Design review earlier',
  'Hard to find the staging URL',
  'Kudos to Sam',
  'Retro action items were forgotten',
  'Limit WIP to 3',
  'Deploys are fast now',
  'Monitoring gaps at night',
  'Keep Friday demos',
  'Document the on-call rota',
  'Café-style planning worked',
  'Scope creep in sprint 2',
  'Fewer Slack pings',
  'Start: weekly tech talk',
];

/** A 25-note retro board: mixed colours, multi-line texts and overlapping notes with explicit stacking. */
export function retroBoard(doc: Y.Doc = new Y.Doc()): Y.Doc {
  initDoc(doc);
  const ids: string[] = [];
  RETRO_TEXTS.forEach((text, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const id = createSticky(doc, { x: col * 230 - 460, y: row * 230 - 460 }, COLORS[i % COLORS.length]);
    if (text) getStickyText(doc, id)!.insert(0, text);
    ids.push(id);
  });
  // Overlaps: pull a few notes onto their neighbours and restack them.
  moveObject(doc, ids[1], -300, -520);
  moveObject(doc, ids[7], -120, -200);
  bringToFront(doc, ids[0]);
  bringToFront(doc, ids[6]);
  return doc;
}

const WORDS = (
  'we should try customer interview roadmap pricing feedback onboarding team launch quarter goal metric ' +
  'retention churn design review sprint backlog story bug release support ticket growth idea question risk ' +
  'dependency api mobile web search dashboard export report budget hiring meeting workshop decision'
).split(' ');

/** Deterministic pseudo-random generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An English-looking phrase of 10–300 characters. */
function phrase(rand: () => number): string {
  const target = 10 + Math.floor(rand() * 291);
  let s = '';
  while (s.length < target) {
    const w = WORDS[Math.floor(rand() * WORDS.length)];
    s += s ? ` ${w}` : w[0].toUpperCase() + w.slice(1);
    if (rand() < 0.08) s += '.';
  }
  return s.slice(0, target);
}

/** A board with `count` notes of realistic text laid out in clusters. */
export function largeBoard(count: number = PERSIST_TESTED_NOTES, seed = 42, doc: Y.Doc = new Y.Doc()): Y.Doc {
  initDoc(doc);
  const rand = rng(seed);
  const CLUSTER = 50;
  const PER_ROW = 8;
  doc.transact(() => {
    for (let i = 0; i < count; i++) {
      const cluster = Math.floor(i / CLUSTER);
      const cx = (cluster % 8) * 2400;
      const cy = Math.floor(cluster / 8) * 1800;
      const k = i % CLUSTER;
      const at = { x: cx + (k % PER_ROW) * 210 + rand() * 20, y: cy + Math.floor(k / PER_ROW) * 210 + rand() * 20 };
      const id = createSticky(doc, at, COLORS[Math.floor(rand() * COLORS.length)]);
      getStickyText(doc, id)!.insert(0, phrase(rand));
    }
  });
  return doc;
}

/** Every update `build` makes to a fresh doc, one entry per transaction. */
export function recordUpdates(build: (doc: Y.Doc) => void): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  build(doc);
  return { doc, updates };
}

/** Damaged-data fixtures: the last 10 bytes removed. */
export function truncated(bytes: Uint8Array): Uint8Array {
  return bytes.slice(0, Math.max(0, bytes.length - 10));
}

/** Damaged-data fixtures: deterministic random bytes of the same length. */
export function randomBytesLike(bytes: Uint8Array, seed = 7): Uint8Array {
  const rand = rng(seed);
  return Uint8Array.from(bytes, () => Math.floor(rand() * 256));
}

const SELECTION_TEXTS_A = [
  'Went well: shipping on Friday', 'Pairing helped', 'Great onboarding docs', 'Deploys are fast now',
  'Kudos to Sam', 'Keep Friday demos', 'Celebrate the launch!', 'Café-style planning worked',
  'More customer calls', 'Limit WIP to 3', 'Design review earlier', 'Start: weekly tech talk',
];
const SELECTION_TEXTS_B = [
  'Standups ran long', 'Too many meetings', 'Flaky CI 😬', 'Unclear ownership of billing',
  'Scope creep in sprint 2', 'Monitoring gaps at night', 'Hard to find the staging URL', 'Fewer Slack pings',
];

/** Top-left corners (world units) of the story 7 selection board's cluster A: 4 columns × 3 rows. */
export const CLUSTER_A_COLUMNS = [0, 250, 500, 750];
export const CLUSTER_A_ROWS = [0, 250, 500];

/**
 * The story 7 retro board: 20 notes in two clusters. Cluster A is a 4×3 grid
 * of 200-unit notes 50 apart (top-lefts CLUSTER_A_COLUMNS × CLUSTER_A_ROWS);
 * cluster B (8 notes from x = 1400) overlaps its neighbours with explicit stacking.
 * `a[row][col]` and `b[i]` are the note ids.
 */
export function selectionBoard(doc: Y.Doc = new Y.Doc()): { doc: Y.Doc; a: string[][]; b: string[] } {
  initDoc(doc);
  const half = 100;
  const a = CLUSTER_A_ROWS.map((y, row) =>
    CLUSTER_A_COLUMNS.map((x, col) => {
      const id = createSticky(doc, { x: x + half, y: y + half }, COLORS[(row + col) % COLORS.length]);
      getStickyText(doc, id)!.insert(0, SELECTION_TEXTS_A[row * CLUSTER_A_COLUMNS.length + col]);
      return id;
    }),
  );
  const b = SELECTION_TEXTS_B.map((text, i) => {
    const id = createSticky(doc, { x: 1400 + (i % 4) * 150 + half, y: Math.floor(i / 4) * 150 + half }, COLORS[i % COLORS.length]);
    getStickyText(doc, id)!.insert(0, text);
    return id;
  });
  bringToFront(doc, b[1]);
  bringToFront(doc, b[5]);
  return { doc, a, b };
}

// Story 8 — undo: a retro board with 12 notes in varied colours and sizes;
// the 8 in cluster (0..~1000, 0..~500) are the ones deleted in TC-22.
export const UNDO_CLUSTER_COLUMNS = [0, 260, 520, 780];
export const UNDO_CLUSTER_ROWS = [0, 280];

export function undoBoard(doc: Y.Doc = new Y.Doc()): { doc: Y.Doc; cluster: string[]; others: string[] } {
  initDoc(doc);
  const sizes = [200, 160, 240, 180];
  const cluster = UNDO_CLUSTER_ROWS.flatMap((y, row) =>
    UNDO_CLUSTER_COLUMNS.map((x, col) => {
      const i = row * UNDO_CLUSTER_COLUMNS.length + col;
      const id = createSticky(doc, { x: x + 100, y: y + 100 }, COLORS[i % COLORS.length]);
      const size = sizes[(row + col) % sizes.length];
      resizeObjects(doc, new Map([[id, { x, y, width: size, height: size }]]));
      getStickyText(doc, id)!.insert(0, RETRO_TEXTS[i]);
      return id;
    }),
  );
  const others = [0, 1, 2, 3].map((i) => {
    const id = createSticky(doc, { x: 1500 + i * 260 + 100, y: 100 }, COLORS[(i + 3) % COLORS.length]);
    getStickyText(doc, id)!.insert(0, RETRO_TEXTS[8 + i]);
    return id;
  });
  return { doc, cluster, others };
}
