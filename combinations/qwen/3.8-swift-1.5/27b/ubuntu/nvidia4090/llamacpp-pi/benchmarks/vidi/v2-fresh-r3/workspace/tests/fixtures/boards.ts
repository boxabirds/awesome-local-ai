/**
 * Board fixtures for the story 4 persistence tests. Boards are built with real
 * board-model calls (`createSticky`, `getStickyText`) so the persisted updates
 * are exactly what the app would produce. Each fixture captures the
 * incremental Yjs updates (in order) so tests can replay them through
 * BoardStore.append and compare a fresh load against the source snapshot.
 */
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  snapshot,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, type StickyColor } from '../../src/shared/config';

export interface NoteSpec {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
}

export interface BuiltBoard {
  /** The source doc (used for snapshot comparison). */
  doc: Y.Doc;
  /** The incremental Yjs updates, in the order they were produced. */
  updates: Uint8Array[];
  /** The notes that were created, in creation order. */
  notes: NoteSpec[];
}

/** Runs `fn` against `doc`, capturing every update it produces, in order. */
function captureUpdates(doc: Y.Doc, fn: () => void): Uint8Array[] {
  const updates: Uint8Array[] = [];
  const handler = (u: Uint8Array) => updates.push(u);
  (doc as unknown as { on: (e: string, h: unknown) => void; off: (e: string, h: unknown) => void })
    .on('update', handler);
  fn();
  (doc as unknown as { off: (e: string, h: unknown) => void }).off('update', handler);
  return updates;
}

/**
 * A 25-note "retro" board: mixed colours, multi-line text, overlapping
 * positions. Each note produces two updates (create + text insert).
 */
export function buildRetroBoard(): BuiltBoard {
  const doc = new Y.Doc();
  const notes: NoteSpec[] = [];
  const colors: StickyColor[] = ['yellow', 'pink', 'blue', 'green'];
  const phrases = [
    'What went well\nthis sprint',
    'Action item:\nship the fix by Friday',
    'Blocker: waiting on API keys',
    'Idea: dark mode\nfor the editor',
    'Thanks for the review!',
  ];
  const updates = captureUpdates(doc, () => {
    for (let i = 0; i < 25; i++) {
      // Overlap: notes within a row share x; alternate rows shift right.
      const x = (i % 5) * 110 + (Math.floor(i / 5) % 2 === 1 ? 55 : 0);
      const y = Math.floor(i / 5) * 80;
      const color = colors[i % colors.length];
      const id = createSticky(doc, { x, y }, color);
      getStickyText(doc, id)!.insert(0, phrases[i % phrases.length]);
      notes.push({ id, text: phrases[i % phrases.length], color, x, y });
    }
  });
  return { doc, updates, notes };
}

/**
 * A `count`-note board with empty text: exactly one update per note. Each note
 * is created in its own Y.Doc so every update carries a distinct client id —
 * this keeps the updates independent, so quarantining one (TC-09) does not
 * invalidate the others via per-client clock ordering.
 */
export function buildSimpleBoard(count: number): BuiltBoard {
  const doc = new Y.Doc();
  const notes: NoteSpec[] = [];
  const updates: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i % 10) * 40;
    const y = Math.floor(i / 10) * 40;
    const tmp = new Y.Doc();
    const id = createSticky(tmp, { x, y }, 'yellow');
    const update = Y.encodeStateAsUpdate(tmp);
    updates.push(update);
    Y.applyUpdate(doc, update);
    notes.push({ id, text: '', color: 'yellow', x, y });
  }
  return { doc, updates, notes };
}

/**
 * A PERSIST_TESTED_NOTES-note board: realistic 10–300 char phrases, clustered
 * into four horizontal bands. Each note produces two updates (create + text).
 */
export function buildLargeBoard(): BuiltBoard {
  const doc = new Y.Doc();
  const notes: NoteSpec[] = [];
  const colors: StickyColor[] = ['yellow', 'pink', 'blue', 'green'];
  let seed = 987654321;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const words = [
    'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'board',
    'note', 'sticky', 'idea', 'action', 'blocker', 'review', 'sprint', 'ship',
    'fix', 'test', 'deploy', 'merge', 'release', 'candidate', 'rollback',
    'monitor', 'dashboard', 'incident', 'postmortem', 'scale', 'latency',
  ];
  const updates = captureUpdates(doc, () => {
    for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
      const targetLen = 10 + Math.floor(rand() * 290);
      let phrase = '';
      while (phrase.length < targetLen) {
        phrase += (phrase ? ' ' : '') + words[Math.floor(rand() * words.length)];
      }
      phrase = phrase.slice(0, Math.min(300, Math.max(10, targetLen)));
      // Clustered: four horizontal bands, staggered rows.
      const cluster = i % 4;
      const x = cluster * 320 + Math.floor(rand() * 120);
      const y = (Math.floor(i / 4) % 6) * 100 + Math.floor(rand() * 60);
      const color = colors[i % colors.length];
      const id = createSticky(doc, { x, y }, color);
      getStickyText(doc, id)!.insert(0, phrase);
      notes.push({ id, text: phrase, color, x, y });
    }
  });
  return { doc, updates, notes };
}

/** A single-note update (create + text) combined into one Yjs update. */
export function makeSingleNoteUpdate(): { update: Uint8Array; id: string } {
  const doc = new Y.Doc();
  const id = createSticky(doc, { x: 5, y: 5 }, 'yellow');
  getStickyText(doc, id)!.insert(0, 'single note');
  return { update: Y.encodeStateAsUpdate(doc), id };
}

/**
 * A valid update plus two damaged variants of the same length profile:
 * `truncated` (last 10 bytes cut) and `random` (same length, random bytes).
 * Both are expected to throw when applied to a Y.Doc.
 */
export function makeDamagedUpdates(): {
  valid: Uint8Array;
  truncated: Uint8Array;
  random: Uint8Array;
} {
  const { update } = makeSingleNoteUpdate();
  const truncated = update.slice(0, Math.max(0, update.length - 10));
  const random = new Uint8Array(update.length);
  for (let i = 0; i < random.length; i++) random[i] = (i * 131 + 17) & 0xff;
  return { valid: update, truncated, random };
}

/** id → text map of a doc's sticky notes (for equality assertions). */
export function textMap(doc: Y.Doc): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of snapshot(doc)) out[s.id] = s.text;
  return out;
}
