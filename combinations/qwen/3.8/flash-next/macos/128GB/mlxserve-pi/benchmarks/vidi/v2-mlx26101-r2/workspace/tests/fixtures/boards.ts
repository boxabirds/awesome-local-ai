/**
 * Boards for the tests, built the way a client builds one.
 *
 * Every note here is created by `createSticky`, coloured by `setStickyColor` and
 * written by the note's own `Y.Text` — the model functions behind the client's
 * double-click, toolbar and textarea. That is the point: a fixture that hand-built
 * `Y.Map`s would test the storage layer against a shape no board is ever in, and
 * the row counts, byte totals and damage a test depends on would be invented.
 *
 * Because the boards are built with ordinary calls, a board comes out as a sequence
 * of updates, which is also how it reaches storage and the wire:
 *
 * - `updates` is what a room would append, one row each — the document's own change,
 *   then a creation and a piece of text per note, so a board of `n` notes is
 *   `2n + 1` rows;
 * - the same `updates` can be sent down a WebSocket by the integration tests, and by
 *   the e2e seeder that needs two thousand notes without a human clicking twice
 *   thousand times.
 *
 * Nothing in this file may reach for a Worker or a browser: it is imported by tests
 * that run in node, in jsdom, in workerd and in Playwright's node process.
 */

import * as Y from 'yjs';

import {
  createSticky,
  getStickyText,
  initDoc,
  setStickyColor,
  type StickySnapshot,
} from '../../src/shared/board-model.js';
import { PERSIST_TESTED_NOTES, STICKY_COLOR_NAMES } from '../../src/shared/config.js';

/** The notes of the PRD's retro board, in the order they were made. */
export const RETRO_BOARD_NOTES = 25;

/** A board, and the changes it was made of, oldest first. */
export interface BuiltBoard {
  doc: Y.Doc;
  /** One entry per change: the same bytes a room would write as one row. */
  updates: Uint8Array[];
}

/** How a note's text is chosen. */
export interface BoardOptions {
  /** The note's text. Multi-line strings are kept as they are. */
  text?: (index: number) => string;
  /** The note's colour. */
  color?: (index: number) => string;
  /** Where the note goes. Close-together values are an overlapping board. */
  at?: (index: number) => { x: number; y: number };
}

/**
 * Build a board of `notes` notes. The document is returned with the updates that
 * made it, so a test can hand the same board to a store, a socket or a second
 * document and know they hold the same thing.
 */
export function buildBoard(notes: number, options: BoardOptions = {}): BuiltBoard {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  // Every change this document makes is its own: nothing is ever applied to it from
  // outside. So every update is a row a board would have. It is worth knowing that
  // the model's own writes carry a local origin of its making (`createSticky`,
  // `initDoc`) while a bare write to a note's text carries none — a fixture that
  // filtered on the origin would silently drop one or the other, and a board whose
  // log holds only the texts is a board that does not load.
  doc.on('update', (update: Uint8Array) => {
    updates.push(update.slice());
  });

  initDoc(doc);
  for (let index = 0; index < notes; index += 1) {
    const at = options.at?.(index) ?? { x: 120 + (index % 6) * 240, y: 120 + Math.floor(index / 6) * 200 };
    const id = createSticky(doc, at);
    if (id === false) continue;
    const color = options.color?.(index);
    if (color !== undefined) setStickyColor(doc, id, color);
    const text = options.text?.(index) ?? phrase(index);
    if (text !== '') getStickyText(doc, id)?.insert(0, text);
  }
  return { doc, updates };
}

/**
 * The PRD's retro board: twenty-five notes in all six colours, several with more
 * than one line, laid out so that some of them overlap. Positions are on a 40-wide
 * step against a note that is wider than that, which is what an overlap is.
 */
export function retroBoard(): BuiltBoard {
  return buildBoard(RETRO_BOARD_NOTES, {
    text: (index) => RETRO_TEXT[index % RETRO_TEXT.length] ?? phrase(index),
    color: (index) => STICKY_COLOR_NAMES[index % STICKY_COLOR_NAMES.length],
    at: (index) => ({ x: (index % 5) * 40, y: Math.floor(index / 5) * 40 }),
  });
}

/**
 * The board the persistence tests open: `PERSIST_TESTED_NOTES` notes with text of
 * realistic length, clustered the way a real board is rather than spread over a
 * grid. This is the board whose open time is measured against the load budget.
 */
export function persistTestedBoard(): BuiltBoard {
  return buildBoard(PERSIST_TESTED_NOTES, {
    text: (index) => phrase(index, 10, 300),
    color: (index) => STICKY_COLOR_NAMES[index % STICKY_COLOR_NAMES.length],
    // A handful of clusters, notes on top of each other inside each of them.
    at: (index) => ({
      x: (index % 7) * 40 + Math.floor(index / 700) * 900,
      y: (index % 13) * 40,
    }),
  });
}

/**
 * The same two thousand notes with text at the long end of realistic, which is the
 * board that makes a snapshot bigger than one row may hold. Chunking is invisible on
 * a small board, and a test that only ever used a small board would not know.
 */
export function bigPersistTestedBoard(): BuiltBoard {
  return buildBoard(PERSIST_TESTED_NOTES, {
    text: (index) => phrase(index, 250, 300),
    color: (index) => STICKY_COLOR_NAMES[index % STICKY_COLOR_NAMES.length],
    at: (index) => ({ x: (index % 9) * 40, y: Math.floor(index / 9) * 40 }),
  });
}

/* ---------------------------------------------------------------------- damaged bytes */

/**
 * An update with its last ten bytes cut off: the shape a truncated write has. It
 * still starts like a real update, which is what makes it a fair test of what a
 * reader does with something that ends too soon.
 */
export function truncatedBytes(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(1, update.byteLength - 10));
}

/**
 * Junk the same length as the update it replaces — a row whose bytes were replaced
 * rather than cut. Deterministic, so a failure is reproducible.
 */
export function sameLengthRubbish(update: Uint8Array): Uint8Array {
  const rubbish = new Uint8Array(update.byteLength);
  for (let index = 0; index < rubbish.byteLength; index += 1) {
    rubbish[index] = (update[index]! * 31 + 161) % 251;
  }
  return rubbish;
}

/* ------------------------------------------------------------------------ the vocabulary */

/**
 * A phrase for note `index`, between `minChars` and `maxChars` long, made of the
 * words people actually write on a board. Deterministic: the same board comes out of
 * the same numbers every time, which is what makes a byte count a usable assertion.
 */
export function phrase(index: number, minChars = 10, maxChars = 60): string {
  let value = index * 2654435761;
  const next = (bound: number): number => {
    // A multiply-with-carry step: enough variety for layout, and reproducible.
    value = (value * 1103515245 + 12345) % 2147483648;
    return Math.abs(value) % bound;
  };
  const words = 3 + next(9);
  const parts: string[] = [];
  for (let word = 0; word < words; word += 1) {
    parts.push(WORDS[next(WORDS.length)]!);
  }
  let text = parts.join(' ');
  // A third of the notes have a second line: the board has notes with more than one
  // thought on them, and a reader that only handles one line would not notice.
  if (index % 3 === 0) text += `\n${parts.slice(0, 2).join(' ')}`;
  if (text.length < minChars) text = `${text} ${phrase(index + 1, minChars - text.length, maxChars)}`;
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

const WORDS = [
  'ship', 'the', 'release', 'retro', 'standup', 'blocked', 'caret', 'sync', 'durable',
  'snapshot', 'log', 'chunk', 'quarantine', 'board', 'note', 'colour', 'position',
  'stacking', 'nightly', 'soak', 'merge', 'latency', 'review', 'deploy', 'rollback',
  'socket', 'storage', 'reopen', 'restore', 'persist',
];

/** The PRD's retro board text: mixed lengths, mixed moods, a few multi-line. */
const RETRO_TEXT = [
  'Shipped the release on the Thursday',
  'The migration ran clean\nno rollback needed',
  'Too many meetings before lunch\nand they all start late',
  'Pairing on the caret bug paid for itself',
  'Deploys are boring now\nwhich is the highest praise',
  'The storage failure was found by the nightly test',
  'Wish we had written the load test first',
  'Colour choice took a whole day',
  'On-call rotation is fair now',
  'Docs are in one place again\ni found the migration notes without asking',
  'The board survived a restart',
  'Review turnaround is under a day',
  'Two of us were editing the same note and nothing broke',
  'Rollback drill went smoothly\nfive minutes from alarm to gone',
  'Standup runs short\nnobody is reading notes aloud any more',
  'The e2e suite is honest about what it skips',
  'Too much of the week went into a flaky test\nwhich turned out to be a real bug',
  'The zoom control is where people look for it',
  'Nobody argues about the grid any more',
  'Quarantine rows are small enough to read',
  'The persistence work was planned properly',
  'We should measure the board open time before it hurts',
  'Notes are where we left them',
  'The room reloaded everything after the crash',
  'Snapshot and log both fit in memory',
];

/** Two boards the same, as a client would compare them. */
export const sameBoard = (a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean =>
  describeDifference(a, b) === '';

/** Why two boards differ, or `''` when they do not. A test that fails says why. */
export function describeDifference(
  a: readonly StickySnapshot[],
  b: readonly StickySnapshot[],
): string {
  const byId = new Map(a.map((note) => [note.id, note]));
  if (a.length !== b.length) return `lengths differ: ${a.length} and ${b.length}`;
  for (const note of b) {
    const mine = byId.get(note.id);
    if (mine === undefined) return `note ${note.id} is missing from the first board`;
    for (const field of ['x', 'y', 'color', 'text', 'z'] as const) {
      if (mine[field] !== note[field]) {
        return `note ${note.id}.${field}: ${JSON.stringify(mine[field])} and ${JSON.stringify(note[field])}`;
      }
    }
  }
  return '';
}
