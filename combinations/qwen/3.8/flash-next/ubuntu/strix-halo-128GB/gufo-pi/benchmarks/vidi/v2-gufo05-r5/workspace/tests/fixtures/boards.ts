/**
 * Test fixtures (all stories). Nothing here asserts; fixtures only construct things — the
 * rules about that are in `references/testing.md`.
 *
 * Story 4 adds the board generators the persistence tests need. They author boards with the
 * real `board-model` functions and simulate several authors - each with its own `Y.Doc`,
 * converging through the updates the way a room would - rather than encoding a board
 * somewhere else and pasting it in. The result is a log of changes that looks like real
 * traffic: one update per change, each applicable on its own, which is exactly what the
 * room's storage holds.
 *
 * Because the fixture knows what every change *was*, it records that alongside the bytes
 * (`entries`), so a test can damage "the third note's text" without arithmetic over encoded
 * lengths that would silently drift if the model changed.
 */
import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import {
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';

/** Origin marker for a change the simulated author made. */
const LOCAL = 'fixture-local';

/** Origin marker for updates applied because another author sent them. */
const REMOTE = 'fixture-remote';

/**
 * Client ids for the documents this file makes, unique for the whole run. Two documents that
 * share a client id look to Yjs like one author whose history contradicts itself, and the notes
 * they made together are lost - which is a thing that must never happen to a fixture, because it
 * looks exactly like a bug in the code under test. Ids follow creation order, so a run is still
 * reproducible.
 */
let nextClientId = 1;

/** The palette in a fixed order, so a generated board cycles colours identically each run. */
const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** What a logged change was, as far as a test needs to know. */
export type LogEntryKind = 'schema' | 'create' | 'type' | 'relayout';

/** One change, with the note it belongs to when there is one. */
export interface LogEntry {
  readonly bytes: Uint8Array;
  readonly kind: LogEntryKind;
  /** Index into `AuthoredSession.ids`, or null for a change that is not about a note. */
  readonly noteIndex: number | null;
}

/** A board as a simulated session left it. */
export interface AuthoredSession {
  /** The authors' documents, all converged onto the final board. */
  readonly docs: Y.Doc[];
  /** Every change in the order it happened, with what it was. */
  readonly entries: readonly LogEntry[];
  /**
   * The same changes as bytes - exactly the rows a room would write for this session, in
   * order. Applying them all to an empty document reproduces the board.
   */
  readonly updates: readonly Uint8Array[];
  /** The ids of the notes the session created, in creation order. */
  readonly ids: readonly string[];
  /** How many notes the session ended with. */
  readonly notes: number;
}

/** An empty document: what a room or a loader starts from before it reads storage. */
export function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = nextClientId;
  nextClientId += 1;
  return doc;
}

/** A board as a client tab starts it, with `meta.schemaVersion` written. */
export function makeBoardDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** A document holding exactly the given changes, the way a reloaded board does. */
export function docFromUpdates(updates: readonly Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const update of updates) Y.applyUpdate(doc, update);
  return doc;
}

/** The whole state of a document as one update: what a compacted snapshot holds. */
export function boardUpdate(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** Two documents that hold the same board encode to the same bytes. */
export function sameBoardState(a: Y.Doc, b: Y.Doc): boolean {
  const left = boardUpdate(a);
  const right = boardUpdate(b);
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** How a generator words, places and paces its notes. */
export interface AuthoringStyle {
  /** The text of note `index`, which may contain newlines. */
  readonly text?: (index: number) => string;
  /** Where note `index` goes. */
  readonly place?: (index: number) => { x: number; y: number };
  /** The colours to cycle through. */
  readonly colors?: readonly StickyColor[];
  /** Type each note in its own change (the default, because that is how people do it). */
  readonly typeSeparately?: boolean;
  /** Every nth note is dragged, re-coloured and raised, so stacking is part of the board. */
  readonly relayoutEvery?: number;
}

/**
 * Simulate `authors` authors creating `notes` notes between them, interleaved round-robin,
 * with every change relayed to everybody else before the next one is made - the way a room
 * behaves. The board's `meta.schemaVersion` write is the first logged change, as it is for a
 * real client.
 */
export function simulateAuthors(
  authors: number,
  notes: number,
  style: AuthoringStyle = {},
): AuthoredSession {
  if (authors < 1) throw new Error('simulate at least one author');
  const docs: Y.Doc[] = [];
  for (let index = 0; index < authors; index += 1) {
    const doc = new Y.Doc();
    doc.clientID = nextClientId;
    nextClientId += 1;
    docs.push(doc);
  }

  const entries: LogEntry[] = [];
  let pending: Pick<LogEntry, 'kind' | 'noteIndex'> = { kind: 'relayout', noteIndex: null };
  const record = (update: Uint8Array, origin: unknown): void => {
    if (origin === LOCAL) entries.push({ bytes: new Uint8Array(update), ...pending });
  };
  for (const doc of docs) doc.on('update', record);

  /** Send what `from` has just written to everybody else, as the room relays changes. */
  let relayed = 0;
  const relay = (from: Y.Doc): void => {
    while (relayed < entries.length) {
      const entry = entries[relayed];
      relayed += 1;
      if (!entry) continue;
      for (const doc of docs) {
        if (doc !== from) Y.applyUpdate(doc, entry.bytes, REMOTE);
      }
    }
  };

  /** One change by one author, then the relay every change gets. */
  const act = (
    doc: Y.Doc,
    kind: LogEntryKind,
    noteIndex: number | null,
    change: () => void,
  ): void => {
    pending = { kind, noteIndex };
    doc.transact(change, LOCAL);
    relay(doc);
  };

  const text = style.text ?? defaultText;
  const place = style.place ?? gridLayout;
  const colors = style.colors ?? COLOR_NAMES;
  const typeSeparately = style.typeSeparately ?? true;
  const ids: string[] = [];

  // every author writes the schema version when their tab opens, as the client does
  for (const doc of docs) {
    act(doc, 'schema', null, () => {
      initDoc(doc);
    });
  }

  for (let index = 0; index < notes; index += 1) {
    const doc = docs[index % authors];
    const at = place(index);
    const color = colors[index % colors.length] ?? 'yellow';
    if (!doc) throw new Error('the author round-robin always resolves');
    let created = '';
    act(doc, 'create', index, () => {
      created = createSticky(doc, at, color);
      if (!typeSeparately) getStickyText(doc, created)?.insert(0, text(index));
    });
    if (!created) throw new Error(`the fixture could not create note ${index}`);
    ids.push(created);
    if (typeSeparately) {
      act(doc, 'type', index, () => {
        getStickyText(doc, created)?.insert(0, text(index));
      });
    }

    // a lived-in board is not only creations: some notes get moved, re-coloured and raised
    const every = style.relayoutEvery ?? 0;
    const target = ids.length > 2 ? ids[ids.length - 3] : undefined;
    if (every > 0 && index % every === every - 1 && target) {
      const mover = docs[(index + 1) % authors];
      const raiser = docs[(index + 2) % authors];
      if (mover) {
        act(mover, 'relayout', null, () => {
          moveObject(mover, target, at.x + 40, at.y + 40);
        });
      }
      if (raiser) {
        const nextColor = colors[(index + 3) % colors.length] ?? 'yellow';
        act(raiser, 'relayout', null, () => {
          setStickyColor(raiser, target, nextColor);
          bringToFront(raiser, target);
        });
      }
    }
  }

  for (const doc of docs) doc.off('update', record);
  return { docs, entries, updates: entries.map((entry) => entry.bytes), ids, notes: ids.length };
}

/** The words the default generator types, long enough for byte sizes to mean something. */
function defaultText(index: number): string {
  return `note ${index}: ${PHRASES[index % PHRASES.length] ?? ''}`.trim();
}

/** Where a note goes by default: a roomy grid, no overlaps. */
function gridLayout(index: number): { x: number; y: number } {
  const columns = 8;
  return {
    x: 40 + (index % columns) * (STICKY_SIZE_WORLD + 40),
    y: 40 + Math.floor(index / columns) * (STICKY_SIZE_WORLD + 40),
  };
}

/**
 * The board the PRD's retro describes: 25 notes in all six colours, some with more than one
 * line, laid out close enough together that neighbours overlap, with notes moved and raised
 * along the way so that stacking order is part of what has to survive a reload.
 */
export function retroBoard(): AuthoredSession {
  return simulateAuthors(3, 25, {
    text: (index) => {
      const keep = `Keep doing: ${PHRASES[index % PHRASES.length] ?? ''}`;
      const tryIt = `Try: ${PHRASES[(index + 7) % PHRASES.length] ?? ''}`;
      return index % 3 === 0 ? `${keep}\n${tryIt}` : keep;
    },
    // notes step by less than their own width, so neighbours overlap and z matters
    place: (index) => ({
      x: 60 + (index % 5) * STICKY_SIZE_WORLD * 0.6,
      y: 60 + Math.floor(index / 5) * STICKY_SIZE_WORLD * 0.6,
    }),
    relayoutEvery: 5,
  });
}

/**
 * The biggest board this product is tested with: `PERSIST_TESTED_NOTES` notes with realistic
 * English phrases of 10 to 300 characters, laid out in clusters, written by several authors.
 * This is the board persist.large_board is about, so it is built here rather than in a test
 * that would then be tempted to use something smaller.
 */
export function phraseBoard(
  notes: number = PERSIST_TESTED_NOTES,
  authors = 4,
): AuthoredSession {
  return simulateAuthors(authors, notes, {
    text: phrase,
    place: clustered,
    // one change per note: at this size a board is worth its rows, and the log length is not
    // what this board is testing
    typeSeparately: false,
  });
}

/** A realistic note of between 10 and 300 characters, the same for a given index. */
function phrase(index: number): string {
  const target = 10 + ((index * 37) % 291);
  let out = '';
  for (let step = 0; out.length < target; step += 1) {
    const next = PHRASES[(index + step * 3) % PHRASES.length] ?? '';
    out = out.length === 0 ? next : `${out} ${next}`;
  }
  return out.slice(0, target);
}

/** Notes in clusters of forty, each cluster far from the others. */
function clustered(index: number): { x: number; y: number } {
  const cluster = Math.floor(index / 40);
  const within = index % 40;
  return {
    x: (cluster % 6) * 4000 + (within % 8) * (STICKY_SIZE_WORLD + 8),
    y: Math.floor(cluster / 6) * 4000 + Math.floor(within / 8) * (STICKY_SIZE_WORLD + 8),
  };
}

/**
 * A board of `notes` notes each carrying about a kilobyte of text, by one author.
 *
 * Snapshot chunking exists for boards like this one and nothing else produces them: the note
 * count is above the compaction threshold, and the encoded board is several snapshot chunks
 * across, so folding it has to split it into rows and reading it has to put them back.
 */
export function longTextBoard(notes = 1_200): AuthoredSession {
  const paragraph = PHRASES.join(' ');
  return simulateAuthors(1, notes, {
    text: (index) => {
      let out = '';
      while (out.length < 1024) out += paragraph;
      return `${out.slice(0, 1024)} (${index})`;
    },
    // one create and one type per note, because that is what a person does, and the log length
    // is part of what this board is testing
  });
}

/** How many snapshot rows a board of this encoded size is stored in. */
export function chunkCount(encodedBytes: number): number {
  return Math.ceil(encodedBytes / SNAPSHOT_CHUNK_BYTES);
}

/** Ordinary things people write on a board, used to build note text. */
const PHRASES: readonly string[] = [
  'Deploy on Thursday went smoothly, no rollbacks needed at all.',
  'The import tool is still the slowest thing in the app and people notice it every morning.',
  'Board search would save me ten minutes a day, honestly more when the board is old.',
  'Nobody could tell who had moved the note, which made the discussion about it strange.',
  'Loved the new colour palette, the pink one is easier to read on the projector than the yellow.',
  'We should stop starting standups at nine fifteen and mean nine thirty.',
  'The offline state is the one thing I did not know what to do about, so I left it alone.',
  'Exporting to PDF is worth doing before the quarter review, not after it.',
  'Somebody please tell me why the sticky note jumped back to the middle of the board.',
  'Pairing on the storage story was the most useful hour of the week by a distance.',
  'The loading state made me think my board was empty, and my heart went cold for a second.',
  'Ten thousand notes on one board is not a board, it is a filing cabinet.',
];

/**
 * A change a board's storage might hold but cannot read back: either a truncated update (the
 * last ten bytes removed) or the same number of bytes filled with a deterministic
 * pseudo-random pattern. Both are refused by `Y.applyUpdate`, which is what makes a row
 * holding them worth quarantining.
 */
export function damagedUpdate(kind: 'truncated' | 'random-bytes' = 'truncated'): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = nextClientId;
  nextClientId += 1;
  doc.transact(() => {
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)?.insert(0, 'a change that will not read back');
  }, LOCAL);
  const bytes = boardUpdate(doc);
  doc.destroy();
  if (kind === 'random-bytes') {
    // A linear congruential step, so "random" means these bytes on every run.
    const random = new Uint8Array(bytes.length);
    let state = 0x2545f491;
    for (let index = 0; index < random.length; index += 1) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      random[index] = state % 256;
    }
    return random;
  }
  return bytes.slice(0, Math.max(1, bytes.length - 10));
}

/**
 * A snapshot blob no Yjs decoder will accept: long enough to look like a real snapshot, full
 * of bytes that are not a valid update. Used for the board that cannot be loaded, which must
 * never be presented as an empty one.
 */
export function unreadableSnapshot(): Uint8Array {
  const bytes = new Uint8Array(4096);
  let state = 0x9e3779b9;
  for (let index = 0; index < bytes.length; index += 1) {
    state = (state * 1664525 + 1013904223) & 0x7fffffff;
    bytes[index] = state % 256;
  }
  return bytes;
}
