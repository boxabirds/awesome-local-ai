/**
 * Real boards for the persistence tests.
 *
 * These are not hard-coded blobs. Boards are built by *using* them — the same model
 * functions the client calls — so a test that passes here would pass with whatever
 * the board happens to contain, including multi-line texts, overlapping stacking
 * and deletions that "create in order" never produces.
 *
 * The shape that matters for storage is the one a board room actually holds: a
 * sequence of Yjs updates arriving from several browsers in a row. So a session here
 * gives each author a real `Y.Doc` of their own (its own client id, syncing from the
 * board before it edits), performs the edits, and hands back the bytes exactly as the
 * room would have stored them — in arrival order.
 *
 * That is not decoration. Yjs replays one author's changes in order, so on a board
 * written by one author a hole in the log loses everything after it, while on a board
 * written by six it loses only what that author did next. Both are tested; the
 * fixture makes both.
 */

import * as Y from 'yjs';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot
} from '../../src/shared/board-model';

/** Every colour a note can be, in the order the palette lists them. */
const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** 24 notes is a real retrospective, not a toy. */
export const RETRO_BOARD_NOTES = 24;

export interface BoardOptions {
  notes?: number;
  authors?: number;
  /**
   * Notes per stored update. A workshop sends one update per transaction, which is 1;
   * a board somebody pasted in arrives in a handful of large ones, and building 2,000
   * notes one row at a time would take longer than the storage being tested.
   */
  batch?: number;
  /** Keep making small changes until the log holds this many rows. */
  rows?: number;
  /** Delete one note at the end, the way a theme gets abandoned. Default true. */
  deleteOne?: boolean;
  seed?: number;
}

export interface BoardSession {
  /** The board as it stands after everything in `updates`. */
  readonly room: Y.Doc;
  /** What the board room stored, oldest first. */
  readonly updates: readonly Uint8Array[];
  /** Who sent each stored update, in the same order. */
  readonly senders: readonly string[];
  /** Who made each note that survives the session, by id. */
  readonly owners: ReadonlyMap<string, string>;
}

/** Deterministic PRNG (mulberry32) — fixtures must not drift between runs. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STARTERS = ['What slowed us down', 'Ship blockers', 'Wins this week'];
const MIDDLES = ['waiting on review', 'the flaky test suite', 'unclear acceptance criteria', 'too much WIP'];
const ENDERS = ['pairing helped', 'the rollback was quick', 'writing it down helped', 'morning check-in'];

/** Text that varies, including multi-line and punctuation. */
function retroText(index: number): string {
  const starter = STARTERS[index % STARTERS.length];
  const middle = MIDDLES[(index * 7 + 3) % MIDDLES.length];
  const ender = ENDERS[(index * 5 + 1) % ENDERS.length];
  return index % 4 === 0 ? `${starter}\n${middle}\n${ender}` : `${starter}: ${middle} (${ender})`;
}

/** A phrase long enough that 2,000 notes are a real amount of text. */
function realisticPhrase(random: () => number): string {
  const words = [
    'checkout',
    'latency',
    'runbook',
    'on-call',
    'regression',
    'queue',
    'cache',
    'handoff',
    'follow-up',
    'spike',
    'contract',
    'drift',
    'rollback',
    'budget',
    'migration',
    'notebook',
    'sign-off',
    'sample'
  ];
  const parts: string[] = [];
  const length = 6 + Math.floor(random() * 12);
  for (let index = 0; index < length; index += 1) parts.push(words[Math.floor(random() * words.length)]);
  return parts.join(' ');
}

/** Spread notes over clusters, so positions are not on a grid. */
function clusterPosition(index: number, random: () => number): { x: number; y: number } {
  const cluster = index % 7;
  return {
    x: cluster * 900 + Math.floor(random() * 620) - 30,
    y: Math.floor(index / 7) * 340 + Math.floor(random() * 240) - 20
  };
}

function typeInto(doc: Y.Doc, id: string, text: string): void {
  const shared = getStickyText(doc, id);
  if (!shared) return;
  doc.transact(() => {
    shared.insert(0, text);
  });
}

/**
 * Play a session and record the log a board room would store from it.
 *
 * Each author is a document of their own that syncs from the board before editing,
 * so the recorded bytes are what a real browser would put on the wire, and the order
 * is the order the room received them — which is the only order storage has.
 */
export function playSession(options: BoardOptions = {}): BoardSession {
  const random = createRandom(options.seed ?? 20_240_517);
  const room = new Y.Doc();
  initDoc(room);

  const updates: Uint8Array[] = [Y.encodeStateAsUpdate(room)];
  const senders: string[] = ['init'];
  const owners = new Map<string, string>();
  const authors = new Map<string, Y.Doc>();
  const authorCount = Math.max(1, options.authors ?? 1);
  const batch = Math.max(1, options.batch ?? 1);
  const count = options.notes ?? RETRO_BOARD_NOTES;

  const author = (index: number): string => `author-${index % authorCount}`;

  /** Bring an author's document up to date with the board. */
  const sync = (name: string): Y.Doc => {
    let doc = authors.get(name);
    if (!doc) {
      doc = new Y.Doc();
      // A browser starts from the board as it is now. Not stored: this is the
      // room-to-client direction.
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(room), 'sync');
      authors.set(name, doc);
    } else {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(room, Y.encodeStateVector(doc)), 'broadcast');
    }
    return doc;
  };

  /** Store whatever this author wrote while `write` ran. */
  const record = (name: string, doc: Y.Doc, write: () => void): void => {
    const before = Y.encodeStateVector(doc);
    write();
    const update = Y.encodeStateAsUpdate(doc, before);
    if (update.byteLength === 0) return;
    Y.applyUpdate(room, update, name);
    updates.push(update);
    senders.push(name);
  };

  for (let start = 0; start < count; start += batch) {
    const name = author(start);
    const doc = sync(name);
    record(name, doc, () => {
      for (let index = start; index < Math.min(start + batch, count); index += 1) {
        const at = clusterPosition(index, random);
        const id = createSticky(doc, at, COLOR_NAMES[index % COLOR_NAMES.length]);
        if (!id) throw new Error('the fixture made an invalid note');
        owners.set(id, name);
        typeInto(doc, id, index % 4 === 0 ? retroText(index) : realisticPhrase(random));
        if (index % 2 === 0) moveObject(doc, id, at.x + 40, at.y + 25);
        if (index % 7 === 0) setStickyColor(doc, id, COLOR_NAMES[(index + 2) % COLOR_NAMES.length]);
      }
    });
  }

  // Stacking a plain "create in order" board never produces.
  const shuffler = authorCount > 0 ? sync('author-0') : null;
  if (shuffler) {
    const ids = snapshot(room)
      .map((note) => note.id)
      .slice(0, Math.max(1, Math.floor(count / 5)));
    record('author-0', shuffler, () => {
      for (const id of ids) bringToFront(shuffler, id);
    });
  }

  // One theme that was abandoned and deleted: deleted content must not come back,
  // and must not come back after a restart either.
  const abandoning = author(count - 1);
  const lastNote = options.deleteOne === false ? undefined : snapshot(room).at(-1);
  if (lastNote) {
    const doc = sync(abandoning);
    record(abandoning, doc, () => {
      deleteObject(doc, lastNote.id);
      owners.delete(lastNote.id);
    });
  }

  // Small changes until the log is long enough to be worth compacting.
  let index = count;
  while (options.rows !== undefined && updates.length < options.rows) {
    const name = author(index);
    const doc = sync(name);
    const notes = snapshot(room);
    const note = notes[index % Math.max(1, notes.length)];
    if (!note) break;
    record(name, doc, () => {
      moveObject(doc, note.id, note.x + 1, note.y + 1);
    });
    index += 1;
  }

  return { room, updates, senders, owners };
}

/**
 * A retrospective board and the log it produced: mixed colours, multi-line texts,
 * re-stacked notes, deletions, and six authors by default because that is what a
 * retrospective is.
 */
export function retroBoard(options: BoardOptions = {}): BoardSession {
  return playSession({ notes: RETRO_BOARD_NOTES, authors: 6, ...options });
}

/** A board of `PERSIST_TESTED_NOTES` notes in clusters, arriving in large pieces. */
export function largeBoard(options: BoardOptions = {}): BoardSession {
  return playSession({
    notes: PERSIST_TESTED_NOTES,
    authors: 1,
    batch: 25,
    // A board this size is counted exactly: nothing is deleted from it.
    deleteOne: false,
    ...options
  });
}

/** Build a board straight into a document, for tests that only need the content. */
export function buildRetroBoard(doc: Y.Doc, options: BoardOptions = {}): void {
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(retroBoard(options).room));
}

/** Build the large board straight into a document. */
export function buildLargeBoard(doc: Y.Doc, options: BoardOptions = {}): void {
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(largeBoard(options).room));
}

/**
 * Bytes that are a prefix of a real update: what a write that stopped halfway leaves
 * behind. Applied on its own it throws, which is the point.
 */
export function truncatedBytes(update: Uint8Array, ratio = 0.55): Uint8Array {
  const keep = Math.max(1, Math.floor(update.byteLength * ratio));
  return update.subarray(0, keep);
}

/** Random bytes of the same length: the other way a row stops being an update. */
export function randomBytesLike(update: Uint8Array, seed = 4242): Uint8Array {
  const random = createRandom(seed);
  const bytes = new Uint8Array(update.byteLength);
  for (let index = 0; index < bytes.byteLength; index += 1) bytes[index] = Math.floor(random() * 256);
  return bytes;
}
