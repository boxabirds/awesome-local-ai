// Board fixtures (story 4, persist.*): realistic boards generated through
// the REAL board-model functions, so every byte a test stores is a genuine
// Yjs update. Deterministic (no Math.random) so assertions and e2e seeds
// are reproducible.
//
// - applyRetroNote / RETRO_NOTE_COUNT: the 25 varied notes of the PRD, one
//   applied board operation at a time (so tests can store them as one log
//   row each).
// - applyLargeNote / PERSIST_TESTED_NOTES: the large board, one note per
//   operation.
// - damagedUpdateBytes: truncated update (last 10 bytes removed) and
//   random bytes of the same length.

import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  getStickyText,
  moveObject,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';

export const RETRO_NOTE_COUNT = 25;

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** Workshop-style phrases; some are multi-line. */
const PHRASES = [
  'What did we ship this sprint?',
  'Biggest risk for launch\nis the data migration',
  'Ask sales about the\nonboarding drop-off',
  'Idea: async standup thread',
  'Follow up with Priya\nabout the API review',
  'Customers love the board,\nthey hate the export',
  'Parking lot: mobile\noffline mode',
  'Decision needed:\nkeep or cut the widget',
  'Nice: the drag feels\ninstant now',
  'Action: prototype the\nshared cursors',
  'Why did the latency\nspike on Tuesday?',
  'We should measure\nhow often people return',
  'The grid helps people\nplace notes faster',
  'Retro: what surprised us?',
  'Blocker: no test data\nfor the big board',
  'Try clustering by\ncolour next time',
  'The 3am deploy caused\nthe duplicate notes',
  'Let us ship the badge\nto all workspaces',
  'Note: support tickets\nmention slow load',
  'We agree: keep autosave,\ndrop the save button',
  'Next: prototype the\npresence cursors',
  'Who owns the export\nstory this quarter?',
  'The empty board feels\ndead on first open',
  'Great: colours are easy\nto tell apart',
  'Remember to check the\nz-order after a drag',
];

const WORDS = [
  'the', 'board', 'stays', 'exactly', 'as', 'it', 'was', 'left', 'when',
  'people', 'come', 'back', 'notes', 'keep', 'their', 'colour', 'position',
  'and', 'stacking', 'work', 'flows', 'between', 'time', 'zones', 'without',
  'losing', 'anything', 'autosave', 'means', 'nobody', 'remembers', 'to',
  'close', 'the', 'tab', 'afraid', 'of', 'a', 'restart', 'because', 'the',
  'storage', 'is', 'durable', 'a', 'fresh', 'morning', 'opens', 'the', 'same',
  'canvas', 'with', 'every', 'idea', 'from', 'yesterday', 'intact', 'large',
  'boards', 'load', 'quickly', 'so', 'the', 'whole', 'workshop', 'can', 'see',
  'it', 'all', 'at', 'once', 'damage', 'to', 'one', 'change', 'cannot', 'wipe',
  'out', 'the', 'rest', 'of', 'the', 'session',
];

/** Deterministic pseudo-random in [0, 1) from an index and salt. */
function rand(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** A realistic phrase of 10-300 characters for note `i`. */
export function phraseFor(i: number): string {
  const target = 10 + Math.floor(rand(i, 7) * 291); // 10..300 chars
  let text = '';
  let k = i % WORDS.length;
  while (text.length < target) {
    const word = WORDS[k++ % WORDS.length];
    if (text.length === 0) {
      text = word.charAt(0).toUpperCase() + word.slice(1);
    } else if (text.length + word.length + 1 > target) {
      text += ' ' + word.slice(0, Math.max(1, target - text.length - 1));
    } else {
      text += ' ' + word;
    }
    if (k % 5 === 0 && text.length < target - 10) text += ',';
  }
  return text.slice(0, target);
}

/** Applies retro board note `i` (create + text + optional overlap move). */
export function applyRetroNote(doc: Y.Doc, i: number): string {
  const x = Math.round(rand(i, 1) * 1600) - 400;
  const y = Math.round(rand(i, 2) * 1000) - 300;
  const id = createSticky(doc, { x, y }, COLORS[i % COLORS.length]);
  if (id === '') throw new Error('fixture: createSticky failed');
  getStickyText(doc, id)?.insert(0, PHRASES[i % PHRASES.length]);
  if (i % 4 === 3) moveObject(doc, id, x + 40, y + 30);
  return id;
}

/** Brings every fifth note to the front (the stacking re-order). */
export function retroStackingPass(doc: Y.Doc, ids: string[]): void {
  for (let i = 0; i < ids.length; i += 5) bringToFront(doc, ids[i]);
}

/** The 25-note retro board applied all at once; returns note ids. */
export function buildRetroBoard(doc: Y.Doc): string[] {
  const ids: string[] = [];
  for (let i = 0; i < RETRO_NOTE_COUNT; i++) ids.push(applyRetroNote(doc, i));
  retroStackingPass(doc, ids);
  return ids;
}

/** Applies large-board note `i` (create + realistic phrase). */
export function applyLargeNote(doc: Y.Doc, i: number): string {
  const c = i % 10;
  const x = c * 3200 + Math.round(rand(i, 3) * 500) - 250;
  const y = Math.floor(i / 10) * 400 - 3000 + Math.round(rand(i, 4) * 500) - 250;
  const id = createSticky(doc, { x, y }, COLORS[i % COLORS.length]);
  if (id === '') throw new Error('fixture: createSticky failed');
  getStickyText(doc, id)?.insert(0, phraseFor(i));
  return id;
}

/** The PERSIST_TESTED_NOTES-note large board applied all at once. */
export function buildLargeBoard(doc: Y.Doc, count: number = PERSIST_TESTED_NOTES): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(applyLargeNote(doc, i));
  return ids;
}

/** Damage fixture 1: `original` with its last 10 bytes removed. */
export function truncatedUpdate(original: Uint8Array): Uint8Array {
  return original.slice(0, Math.max(0, original.length - 10));
}

/** Damage fixture 2: random bytes of the same length as `original`. */
export function randomBytesLike(original: Uint8Array, seed: number): Uint8Array {
  const out = new Uint8Array(original.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(rand(i, seed) * 256);
  return out;
}

/** Snapshot of `doc` as a plain (serialisable) array for assertions. */
export function notesOf(doc: Y.Doc): StickySnapshot[] {
  return [...snapshot(doc)];
}
