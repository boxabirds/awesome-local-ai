import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';

/**
 * Boards for the persistence tests, made the way the product makes them.
 *
 * Everything here goes through the board model - `initDoc`, `createSticky`, the note's
 * `Y.Text` - because what the storage tests put into a database has to be the same shape of
 * update the product writes, not something invented for the test. The 2,000-note board the
 * PRD insists the product is tested at comes with real sentences on its notes, so that
 * "2,000 notes" is 2,000 notes with something written on them and not 2,000 blank ones.
 *
 * Nothing here asserts anything: a test asks for a board and compares what it gets back with
 * `snapshot`, which is what a person sees.
 */

/** The six colours, in the order the palette lists them. */
export const PALETTE = Object.keys(STICKY_COLORS) as StickyColor[];

/** The colour of the note at position `index`, cycling round the palette. */
function colourAt(index: number): StickyColor {
  const color = PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
  if (color === undefined) {
    throw new Error(`the palette has ${PALETTE.length} colours, so index ${index} should exist`);
  }
  return color;
}

/** The three lines of a note that has been thought about. */
const LINES = [
  'Handover between shifts misses the open tickets,',
  'so the next team redoes work that was already',
  'finished on the board last night.',
];

/** Sentences the boards are written from: real prose, so note text has a realistic length. */
const SENTENCES = [
  'Faster onboarding saves every new teammate an afternoon of guesswork.',
  'Notes should cluster by theme so the team can see the shape of the problem.',
  'We keep hitting the same three blockers in the handover between shifts.',
  'Rename the board after the retro so nobody loses their notes on reload.',
  'Colour separates who owns an idea from how urgent that idea feels.',
  'Double click the empty space and start typing before the thought escapes.',
  'The board stays where we left it, even when nobody is watching it.',
  'One idea per note keeps a crowded board readable.',
  'Group first, judge later; the ordering is a conversation of its own.',
  'Timebox the quiet writing period and nobody has to repeat themselves.',
  'Carry the last retro actions into this one so the list stays honest.',
  'A sticky that outlives three retros is either important or nobody dares move it.',
];

/** A small deterministic source of numbers, so a saved board is the same board tomorrow. */
function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** One note as it is written down: where it went, what colour, what it says. */
export interface NoteSeed {
  readonly x: number;
  readonly y: number;
  readonly color: StickyColor;
  readonly text: string;
}

/**
 * `count` notes laid out the way a team leaves them: closer together than their own width, so
 * they overlap; every colour in use; a third of them carrying more than one line.
 */
export function noteSeeds(count = 25, seed = 20260714): NoteSeed[] {
  // The seed decides which colour the first note is, so two boards of the same size are not
  // the same board in a different place.
  const colourShift = Math.floor(seeded(seed)() * PALETTE.length);
  const notes: NoteSeed[] = [];
  for (let index = 0; index < count; index += 1) {
    const text =
      index % 3 === 0
        ? LINES.join('\n')
        : index % 3 === 1
          ? 'Faster onboarding'
          : `${SENTENCES[index % SENTENCES.length]} ${SENTENCES[(index + 5) % SENTENCES.length]}`;
    notes.push({
      // Notes are 200 units wide and land 120 apart, so they overlap: a board that has been
      // used has notes on top of each other, and stacking is part of what has to come back.
      x: 140 + (index % 7) * 120,
      y: 140 + Math.floor(index / 7) * 120,
      color: colourAt(index + colourShift),
      text: text.length > 10 ? text.slice(0, 300) : text,
    });
  }
  return notes;
}

/**
 * The notes of a board of the size the product is tested at, with text between one sentence
 * and four, clustered in blocks of forty the way a large retro ends up looking.
 */
export function denseNoteSeeds(count = PERSIST_TESTED_NOTES, seed = 777): NoteSeed[] {
  const random = seeded(seed);
  const notes: NoteSeed[] = [];
  for (let index = 0; index < count; index += 1) {
    const sentences = 1 + Math.floor(random() * 4);
    let text = '';
    for (let added = 0; added < sentences; added += 1) {
      const sentence = SENTENCES[Math.floor(random() * SENTENCES.length)];
      text += text === '' ? sentence : ` ${sentence}`;
    }
    const cluster = Math.floor(index / 40);
    notes.push({
      x: 140 + (index % 40) * 120 + cluster * 20,
      y: 140 + cluster * 960 + Math.floor((index % 40) / 8) * 220,
      color: colourAt(Math.floor(random() * PALETTE.length)),
      text,
    });
  }
  return notes;
}

/** Write one note into `doc`, in one transaction: one note, one update. */
export function writeNote(doc: Y.Doc, note: NoteSeed): string {
  let id = '';
  // `createSticky` opens its own transaction; Yjs folds it into this one, so the note and its
  // text arrive as the single update a client's edit would have been.
  Y.transact(doc, () => {
    id = createSticky(doc, { x: note.x, y: note.y }, note.color);
    getStickyText(doc, id)?.insert(0, note.text);
  }, LOCAL_ORIGIN);
  return id;
}

/** An empty board, as a client leaves it on first open: the schema version and nothing else. */
export function emptyBoard(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** A whole board in one document, written by the model rather than poured in as bytes. */
export function boardOf(notes: readonly NoteSeed[]): Y.Doc {
  const doc = emptyBoard();
  for (const note of notes) {
    writeNote(doc, note);
  }
  return doc;
}

/** The 25-note retro board of the earlier stories. */
export function retroBoard(count = 25, seed = 20260714): Y.Doc {
  return boardOf(noteSeeds(count, seed));
}

/** The board the PRD wants the product tested at. */
export function denseBoard(count = PERSIST_TESTED_NOTES, seed = 777): Y.Doc {
  return boardOf(denseNoteSeeds(count, seed));
}

/** A document and the updates that made it, in the order they were made. */
export interface BoardBuild {
  doc: Y.Doc;
  /** One update per edit, including the one that wrote the schema version. */
  updates: Uint8Array[];
}

/**
 * A board built one edit at a time, which is what a room's log of updates looks like.
 *
 * `includeSchemaVersion` keeps the first update - the one `initDoc` writes - in the list, so a
 * test can count rows against the log a real board would have.
 */
export function boardBuiltInSteps(
  count = 25,
  seed = 20260714,
  notes: readonly NoteSeed[] = noteSeeds(count, seed),
): BoardBuild {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  const record = (update: Uint8Array): void => {
    updates.push(update);
  };
  doc.on('update', record);
  initDoc(doc);
  for (const note of notes) {
    writeNote(doc, note);
  }
  doc.off('update', record);
  return { doc, updates };
}

/**
 * The same board, written by a different person per note.
 *
 * This is the shape a shared board's log has: every row comes from whichever client made that
 * change, and each row is only what the board did not already have - one change per row, exactly
 * as `BoardRoom` stores it. It is what the damage tests need: a row that cannot be read from a
 * log like this costs the one change it holds, because no other client's changes are waiting
 * behind it. `boardBuiltInSteps` above is the other shape - one person, one client, all the rows
 * - and it is the harsher case.
 */
export function boardBuiltByWriters(
  notes: readonly NoteSeed[] = noteSeeds(25, 20260714),
): BoardBuild {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  for (const [index, note] of notes.entries()) {
    const writer = new Y.Doc();
    // The writer opens the board as everyone else left it.
    Y.applyUpdate(writer, Y.encodeStateAsUpdate(doc));
    if (index === 0) {
      initDoc(writer);
    }
    const before = Y.encodeStateVector(doc);
    writeNote(writer, note);
    // What the room would be sent, and would store: this writer's change and nothing else.
    const update = updateOfDocument(writer, before);
    Y.applyUpdate(doc, update);
    writer.destroy();
    updates.push(update);
  }
  return { doc, updates };
}

/** One note, in its own update: the shape of one person's edit. */
export function updateOfNote(text = 'Faster onboarding', x = 140, y = 140): Uint8Array {
  const { updates } = boardBuiltInSteps(1, 5, [{ x, y, color: 'yellow', text }]);
  const update = updates[1];
  if (update === undefined) {
    throw new Error('building one note produced no update');
  }
  return update;
}

/**
 * What Yjs handed back as the bytes of an update.
 *
 * Node gives a `Uint8Array`; the Worker runtime gives an `ArrayBuffer`. These fixtures are
 * imported both from tests that run in Node (the e2e setup seeding a dev server's storage) and
 * from tests that run inside a Durable Object, so the one place they differ is written once,
 * here, instead of in every builder.
 */
function toBytes(encoded: Uint8Array | ArrayBuffer): Uint8Array {
  return encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
}

/** What Yjs calls a state vector; it does not export a name for the type. */
type StateVector = ReturnType<typeof Y.encodeStateVector>;

/**
 * A whole board as the bytes a store holds - what a client's first sync of a board looks like.
 *
 * With `since`, the state vector the board was at beforehand, it is instead just what happened
 * since: the bytes one person's edit contributes, which is one row of a log.
 */
export function updateOfDocument(doc: Y.Doc, since?: StateVector): Uint8Array {
  return toBytes(Y.encodeStateAsUpdate(doc, since));
}

/** Move a note of an existing board: another update on top of the ones that made it. */
export function updateOfMove(doc: Y.Doc, note: StickySnapshot, x: number, y: number): Uint8Array {
  const updates: Uint8Array[] = [];
  const record = (update: Uint8Array): void => {
    updates.push(update);
  };
  doc.on('update', record);
  moveObject(doc, note.id, x, y);
  doc.off('update', record);
  const update = updates[0];
  if (update === undefined) {
    throw new Error(`moving ${note.id} to ${x},${y} wrote nothing`);
  }
  return update;
}

/** The same bytes, cut short: what one torn-off write looks like to Yjs. */
export function truncated(update: Uint8Array, keep = 0.9): Uint8Array {
  return update.slice(0, Math.max(1, Math.floor(update.byteLength * keep)));
}

/** The same length of bytes, none of them belonging to the update: what bit rot looks like. */
export function garbled(update: Uint8Array, seed = 4242): Uint8Array {
  const random = seeded(seed);
  const bytes = update.slice();
  for (let index = 0; index < bytes.byteLength; index += 1) {
    bytes[index] = Math.floor(random() * 256);
  }
  return bytes;
}

/** The notes of a board, as the product reads them. */
export function notesOf(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc);
}

/** Bytes as text, for comparing two documents' state vectors. */
function hex(bytes: Uint8Array): string {
  let text = '';
  for (const value of bytes) {
    text += value.toString(16).padStart(2, '0');
  }
  return text;
}

/** Which changes a document has seen, as text. */
export function stateVectorOf(doc: Y.Doc): string {
  return hex(toBytes(Y.encodeStateVector(doc)));
}

/**
 * Whether two documents hold the same board.
 *
 * Both halves are needed: the notes say what a person would see, the state vector says which
 * changes each document has seen - two boards can show the same notes and still disagree about
 * what happened next, which is exactly what a store that lost a row would produce. Written as a
 * plain `true`/`false` so it can be answered from inside a Durable Object, where the test's own
 * assertion functions are not.
 */
export function sameBoard(actual: Y.Doc, expected: Y.Doc): boolean {
  return (
    JSON.stringify(snapshot(actual)) === JSON.stringify(snapshot(expected)) &&
    stateVectorOf(actual) === stateVectorOf(expected)
  );
}

/**
 * Change a note's colour through the model, in its own update - the second and third edit a
 * test wants on top of a board it has already built.
 */
export function updateOfColour(doc: Y.Doc, note: StickySnapshot, color: StickyColor): Uint8Array {
  const updates: Uint8Array[] = [];
  const record = (update: Uint8Array): void => {
    updates.push(update);
  };
  doc.on('update', record);
  setStickyColor(doc, note.id, color);
  doc.off('update', record);
  const update = updates[0];
  if (update === undefined) {
    throw new Error(`recolouring ${note.id} to ${String(color)} wrote nothing`);
  }
  return update;
}
