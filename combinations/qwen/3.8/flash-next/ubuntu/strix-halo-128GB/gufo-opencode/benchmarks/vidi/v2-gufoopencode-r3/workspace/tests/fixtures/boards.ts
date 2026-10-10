import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
  snapshot,
  type StickySnapshot
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';

// Deterministic PRNG (mulberry32) so fixtures are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'keep', 'drop', 'start', 'stop', 'idea', 'retro', 'board', 'team', 'sprint', 'ship',
  'blocker', 'win', 'learn', 'try', 'next', 'owner', 'demo', 'plan', 'goal', 'risk',
  'feedback', 'hypothesis', 'insight', 'action', 'follow', 'up', 'notes', 'sticky'
];

// Realistic 10–300 character phrase, occasionally multi-line.
export function randomPhrase(rand: () => number): string {
  const target = 10 + Math.floor(rand() * 291);
  const lines: string[] = [];
  let length = 0;
  const lineCount = rand() < 0.35 ? 1 + Math.floor(rand() * 3) : 1;
  for (let line = 0; line < lineCount; line += 1) {
    const words: string[] = [];
    let done = false;
    while (!done) {
      const word = WORDS[Math.floor(rand() * WORDS.length)];
      words.push(word);
      length += word.length + 1;
      if (length >= target / lineCount || length >= target) done = true;
    }
    lines.push(words.join(' '));
  }
  let phrase = lines.join('\n');
  if (phrase.length < 10) phrase = (phrase + ' ' + WORDS.join(' ')).slice(0, Math.max(10, target));
  if (phrase.length > 300) phrase = phrase.slice(0, 300);
  return phrase;
}

export interface BoardFixture {
  doc: Y.Doc;
  updates: Uint8Array[];
  expected: readonly StickySnapshot[];
}

interface BuildOptions {
  moves?: boolean;
  seed?: number;
}

// Builds a board with real board-model calls, recording one update per
// committed transaction (each note is created + filled in a single outer
// transaction, plus optional move/front transactions).
export function buildBoard(noteCount: number, options: BuildOptions = {}): BoardFixture {
  const seed = options.seed ?? 20261010;
  const withMoves = options.moves ?? true;
  const rand = mulberry32(seed);
  const colors = Object.keys(STICKY_COLORS) as StickyColor[];
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update) => {
    updates.push(update.slice());
  });
  initDoc(doc);
  const ids: string[] = [];
  const perRow = 50;
  for (let i = 0; i < noteCount; i += 1) {
    const x = (i % perRow) * 260 + Math.floor(rand() * 60);
    const y = Math.floor(i / perRow) * 260 + Math.floor(rand() * 60);
    const color = colors[Math.floor(rand() * colors.length)];
    const text = randomPhrase(rand);
    doc.transact(() => {
      const id = createSticky(doc, { x, y }, color);
      ids.push(id);
      getStickyText(doc, id)?.insert(0, text);
    });
    if (withMoves && i % 4 === 3 && ids.length > 1) {
      // deliberate overlaps with the previous note
      moveObject(doc, ids[ids.length - 1], x + 70, y + 70);
    }
    if (withMoves && i % 7 === 5 && ids.length > 1) {
      bringToFront(doc, ids[ids.length - 2]);
    }
  }
  return { doc, updates, expected: snapshot(doc) };
}

export const RETRO_NOTE_COUNT = 25;

export function buildRetroBoard(): BoardFixture {
  return buildBoard(RETRO_NOTE_COUNT);
}

export function buildLargeBoard(): BoardFixture {
  return buildBoard(PERSIST_TESTED_NOTES);
}

// One update per note, note text = `note-<i>`; used by quarantine tests that
// need to know exactly what a damaged row loses.
export function buildNoteUpdates(count: number): {
  doc: Y.Doc;
  updates: Uint8Array[];
  texts: string[];
} {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update) => {
    updates.push(update.slice());
  });
  initDoc(doc);
  const texts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const text = `note-${i}`;
    texts.push(text);
    doc.transact(() => {
      const id = createSticky(doc, { x: i * 40, y: 0 });
      getStickyText(doc, id)?.insert(0, text);
    });
  }
  return { doc, updates, texts };
}

// Damaged-bytes fixtures: a truncated update (decoding throws "Unexpected
// end of array") and same-length random bytes (also throws).
export function truncateLast(bytes: Uint8Array, cut = 10): Uint8Array {
  return bytes.slice(0, Math.max(0, bytes.length - cut));
}

export function randomSameLength(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  crypto.getRandomValues(out);
  return out;
}
