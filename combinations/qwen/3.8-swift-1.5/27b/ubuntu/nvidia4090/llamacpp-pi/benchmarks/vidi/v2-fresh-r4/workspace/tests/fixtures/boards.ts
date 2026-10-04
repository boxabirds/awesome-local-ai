/**
 * Realistic board fixtures for story 4 persistence tests.
 *
 * Boards are generated with the real `board-model` functions so the Yjs
 * update bytes are real. Deterministic (seeded) so tests are reproducible.
 *
 * IMPORTANT — self-contained rows:
 * Yjs `update` events are *diffs*: an item at per-client clock N only applies
 * to a doc that already has that client's clocks 0..N-1. A log of such diffs
 * therefore cannot survive quarantining a middle row (every later row from the
 * same client is lost). To satisfy persist.partial_damage ("the loaded board
 * is missing only the damaged row"), each stored log row must be a
 * *self-contained* update — the full state of a fresh Y.Doc (a fresh Yjs
 * client) containing just that one edit. Such rows apply cleanly to any doc,
 * including one missing a neighbour.
 *
 * Each fixture therefore emits one self-contained update per edit:
 *   row 0        = baseline (initDoc only)
 *   rows 1..N    = initDoc + one note each
 * Applying all rows to a fresh doc reconstructs the board; dropping any single
 * note row loses exactly that note.
 */
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
} from '../../src/shared/board-model';
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

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

const WORDS = [
  'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'retro',
  'board', 'sprint', 'goal', 'idea', 'note', 'team', 'plan', 'launch',
  'review', 'sync', 'ship', 'user', 'flow', 'metric', 'target', 'scope',
  'draft', 'final', 'action', 'item', 'question', 'answer', 'brainstorm',
  'workshop', 'agenda', 'follow', 'next', 'week', 'today', 'main', 'track',
  'value', 'insight', 'pattern', 'system', 'process', 'tool', 'design',
  'build', 'test', 'fix', 'improve', 'grow', 'learn', 'share', 'focus',
  'momentum', 'vision', 'story', 'map', 'path', 'route', 'simple', 'clear',
  'strong', 'steady', 'weekly', 'summary', 'decision', 'owner', 'date',
];

/**
 * A realistic English phrase of 10–300 characters (random target length).
 */
export function realisticPhrase(rand: () => number, minChars = 10, maxChars = 300): string {
  const target = minChars + Math.floor(rand() * (maxChars - minChars + 1));
  let phrase = '';
  while (phrase.length < target) {
    const word = WORDS[Math.floor(rand() * WORDS.length)];
    phrase = phrase === '' ? word : `${phrase} ${word}`;
  }
  return phrase.slice(0, maxChars);
}

/**
 * Create a sticky note with its initial text. Returns the note id.
 * (Used inside a fresh doc to build a self-contained update.)
 */
export function createStickyWithText(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor,
  text: string,
): string {
  let id = '';
  doc.transact(() => {
    id = createSticky(doc, at, color);
    const t = getStickyText(doc, id);
    if (t) t.insert(0, text);
  });
  return id;
}

/** Full-state (self-contained) update of a doc. */
function encodeFull(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** Apply a list of self-contained updates to a fresh doc. */
export function applyUpdates(updates: Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const u of updates) Y.applyUpdate(doc, u);
  return doc;
}

export interface BoardFixture {
  /** Self-contained updates: row 0 = baseline initDoc, then one per note. */
  updates: Uint8Array[];
  /** Note ids in creation order (updates[1..N]). */
  noteIds: string[];
  noteCount: number;
  /** Reconstruct the board doc by applying all updates. */
  build: () => Y.Doc;
}

function baselineUpdate(): Uint8Array {
  const d = new Y.Doc();
  initDoc(d);
  return encodeFull(d);
}

/**
 * A 25-note retro board: mixed colours, multi-line texts, overlapping
 * positions. Each note is one self-contained update.
 */
export function createRetroBoardFixture(seed = 7): BoardFixture {
  const rand = mulberry32(seed);
  const updates: Uint8Array[] = [baselineUpdate()];
  const noteIds: string[] = [];
  for (let i = 0; i < 25; i++) {
    const d = new Y.Doc();
    initDoc(d);
    const color = COLOR_NAMES[i % COLOR_NAMES.length];
    // 5 columns × 5 rows of 150-unit cells with jitter → overlapping notes
    const x = 100 + (i % 5) * 150 + Math.floor(rand() * 80);
    const y = 100 + Math.floor(i / 5) * 150 + Math.floor(rand() * 80);
    const lines = 1 + Math.floor(rand() * 3);
    const text = Array.from({ length: lines }, () => realisticPhrase(rand, 10, 120)).join('\n');
    noteIds.push(createStickyWithText(d, { x, y }, color, text));
    updates.push(encodeFull(d));
  }
  return { updates, noteIds, noteCount: 25, build: () => applyUpdates(updates) };
}

/**
 * A PERSIST_TESTED_NOTES-note board with realistic phrases (10–300 chars)
 * laid out in clusters. Each note is one self-contained update. The encoded
 * state exceeds SNAPSHOT_CHUNK_BYTES so compaction produces multiple chunks.
 */
export function createLargeBoardFixture(seed = 99): BoardFixture {
  const rand = mulberry32(seed);
  const updates: Uint8Array[] = [baselineUpdate()];
  const noteIds: string[] = [];
  const perCluster = 50;
  for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
    const d = new Y.Doc();
    initDoc(d);
    const cluster = Math.floor(i / perCluster);
    const inCluster = i % perCluster;
    const cx = (cluster % 20) * 900;
    const cy = Math.floor(cluster / 20) * 900;
    const angle = (inCluster / perCluster) * Math.PI * 2;
    const radius = 40 + (inCluster % 10) * 28;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const color = COLOR_NAMES[Math.floor(rand() * COLOR_NAMES.length)];
    noteIds.push(createStickyWithText(d, { x, y }, color, realisticPhrase(rand)));
    updates.push(encodeFull(d));
  }
  return { updates, noteIds, noteCount: PERSIST_TESTED_NOTES, build: () => applyUpdates(updates) };
}

/**
 * Damaged update fixtures:
 *  - 'truncated': last 10 bytes removed
 *  - 'random':    random bytes of the same length
 */
export function damagedUpdate(update: Uint8Array, mode: 'truncated' | 'random' = 'truncated'): Uint8Array {
  if (mode === 'truncated') {
    return update.slice(0, Math.max(0, update.length - 10));
  }
  const rand = mulberry32(42);
  const out = new Uint8Array(update.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}
