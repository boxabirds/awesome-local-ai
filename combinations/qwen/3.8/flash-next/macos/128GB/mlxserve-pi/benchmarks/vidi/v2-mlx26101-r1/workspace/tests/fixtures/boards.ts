// Realistic board fixtures for the persistence tests. Every byte is produced by
// the real board-model functions on a real Y.Doc, so a "stored board" here is
// byte-for-byte what a live room would have written — the same incremental updates
// in the same order, and the same render snapshot to compare reloads against.
//
// The fixtures hand back the *update log* (what `BoardStore.append` would receive,
// one entry per user action) plus the target snapshot, so an integration test can
// seed the store, reload into a fresh document and assert they are identical.

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
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Deterministic PRNG (mulberry32): same seed, same board, every run. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A board as a stored update log plus the snapshot it reconstructs to. */
export interface BoardFixture {
  /** Every Yjs update produced while building the board, in creation order. */
  updates: Uint8Array[];
  /** The board exactly as the original document renders it. */
  notes: readonly StickySnapshot[];
  /** The document the updates were produced from (for ad-hoc assertions). */
  doc: Y.Doc;
}

/** Start a document that records every update it produces. */
function recordingDoc(): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    updates.push(new Uint8Array(update));
  });
  return { doc, updates };
}

const RETRO_PROMPTS = [
  'What went well this sprint?',
  'What should we change next time?',
  'Anything that blocked you?',
  'A win to celebrate',
];

/**
 * A 25-note retrospective board: mixed colours, multi-line texts, deliberate
 * overlaps in position and a couple of bring-to-front raises so stacking is not
 * merely creation order. Generated with the real model calls.
 */
export function retroBoard25(seed = 20_260_214): BoardFixture {
  const rng = makeRng(seed);
  const { doc, updates } = recordingDoc();
  initDoc(doc);

  for (let i = 0; i < 25; i++) {
    // Cluster notes in a loose grid, but make many of them overlap on purpose.
    const col = i % 5;
    const row = Math.floor(i / 5);
    const jitter = Math.floor(rng() * 120) - 60;
    const at = { x: col * 220 + jitter, y: row * 220 + jitter };
    const color = COLOR_NAMES[i % COLOR_NAMES.length]!;
    const id = createSticky(doc, at, color);

    // Give it a realistic, sometimes multi-line, note.
    const text = getStickyText(doc, id);
    if (text) {
      const prompt = RETRO_PROMPTS[i % RETRO_PROMPTS.length]!;
      const body = i % 3 === 0 ? `${prompt}\nShipped the board early.\nEveryone stayed late together.` : prompt;
      text.insert(0, body);
    }

    // Roughly every other note is nudged, and a few are raised above the pile.
    if (i % 2 === 1) moveObject(doc, id, at.x + 15, at.y + 15);
    if (i % 7 === 0) bringToFront(doc, id);
  }

  return { updates, notes: snapshot(doc), doc };
}

// A plain, realistic English vocabulary so large boards read like real notes
// without shipping a corpus: sentences are assembled from these words.
const WORDS = (
  'the board notes ideas team sprint retro we should ship early feedback ' +
  'follow up blocker celebrate backlog refine estimate clarify owner sync ' +
  'doc review design build test deploy measure iterate gather discuss agree ' +
  'because while during after before with into over under and or not but ' +
  'action item parking lot decision risk question theme summary next time'
).split(' ');

/** A realistic English phrase of between 10 and 300 characters. */
function phrase(rng: () => number): string {
  const min = 10;
  const max = 300;
  const target = min + Math.floor(rng() * (max - min));
  const parts: string[] = [];
  let length = 0;
  while (length < target) {
    const words: string[] = [];
    const sentenceWords = 3 + Math.floor(rng() * 12);
    for (let w = 0; w < sentenceWords; w++) {
      words.push(WORDS[Math.floor(rng() * WORDS.length)]!);
    }
    const sentence = words.join(' ');
    const capitalised = sentence.charAt(0).toUpperCase() + sentence.slice(1);
    parts.push(capitalised + '.');
    length += capitalised.length + 2;
  }
  const out = parts.join(' ');
  return out.slice(0, max);
}

/**
 * A board of `count` notes (default `PERSIST_TESTED_NOTES`) with realistic text
 * laid out in clusters — the size the PRD guarantees to open. Every note is its
 * own create + write update, exactly as a person creating notes one by one.
 */
export function largeBoard(count: number = PERSIST_TESTED_NOTES, seed = 4_242_424): BoardFixture {
  const rng = makeRng(seed);
  const { doc, updates } = recordingDoc();
  initDoc(doc);

  const perRow = Math.max(1, Math.round(Math.sqrt(count)));
  for (let i = 0; i < count; i++) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    // Cluster into tight groups of notes with small jitter within a cell.
    const x = col * 260 + Math.floor(rng() * 40);
    const y = row * 260 + Math.floor(rng() * 40);
    const color = COLOR_NAMES[Math.floor(rng() * COLOR_NAMES.length)]!;
    const id = createSticky(doc, { x, y }, color);
    const text = getStickyText(doc, id);
    if (text) text.insert(0, phrase(rng));
  }

  return { updates, notes: snapshot(doc), doc };
}

// --- Damaged-byte fixtures --------------------------------------------------

/**
 * A truncated copy of `update` (the last `cut` bytes removed): applying it throws
 * (Yjs reports "Unexpected end of array"), which is what makes it a realistic
 * damaged log row for TC-09.
 */
export function damagedTruncated(update: Uint8Array, cut = 10): Uint8Array {
  const keep = Math.max(1, update.length - cut);
  return new Uint8Array(update.subarray(0, keep));
}

/**
 * Deterministic garbage of `length` bytes that reliably fails to apply (Yjs
 * reports "Integer out of Range"): used to corrupt a snapshot chunk for TC-10
 * without the nondeterminism of `Math.random` (which could, however rarely, be a
 * valid update).
 */
export function damagedGarbage(length: number): Uint8Array {
  return new Uint8Array(length).fill(0xff);
}
