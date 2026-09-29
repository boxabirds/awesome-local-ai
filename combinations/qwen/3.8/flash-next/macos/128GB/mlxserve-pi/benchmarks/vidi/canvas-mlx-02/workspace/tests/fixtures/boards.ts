// Board fixtures for the persistence tests. Everything here builds a board with
// the same board-model functions the app uses (createSticky / moveObject /
// setStickyColor / Y.Text), so a "2 000 note board" in a test is the same shape
// of document the app produces - not a hand-written blob.
//
// Nothing in this file touches storage or the worker, so it is usable from the
// workerd integration tests and from Playwright (Node) alike.
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model.ts';
import {
  PERSIST_TESTED_NOTES,
  SNAPSHOT_CHUNK_BYTES,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config.ts';
import { RETRO_ITEM, SHORT_PHRASE } from './texts.ts';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as (keyof typeof STICKY_COLORS)[];
const TEXTS = [SHORT_PHRASE, RETRO_ITEM, 'Carry the snapshot across restarts'];

export interface BoardFixture {
  /** One Yjs update that contains the whole board. */
  update: Uint8Array;
  /** Number of notes in the board. */
  notes: number;
  /** Notes as the board model reports them. */
  snapshot: ReturnType<typeof snapshot>;
}

/**
 * Build a board of `count` notes in a throwaway document and encode it as a
 * single update. The text is realistic (see texts.ts) and positions and colours
 * vary, because the point of the large-board tests is the size of a real board,
 * not the size of an empty one.
 */
export function buildBoardUpdate(count: number): BoardFixture {
  const doc = new Y.Doc();
  initDoc(doc);
  for (let i = 0; i < count; i++) {
    const id = createSticky(doc, { x: (i % 40) * 260, y: Math.floor(i / 40) * 260 }, COLOR_NAMES[i % COLOR_NAMES.length]);
    const text = getStickyText(doc, id);
    if (text) text.insert(0, TEXTS[i % TEXTS.length]);
    // A move and a recolour make the document contain more than one operation
    // per note, which is what an edited board actually looks like.
    moveObject(doc, id, (i % 40) * 260 + 4, Math.floor(i / 40) * 260 + 4);
    setStickyColor(doc, id, COLOR_NAMES[(i + 1) % COLOR_NAMES.length]);
  }
  return {
    update: Y.encodeStateAsUpdate(doc),
    notes: count,
    snapshot: snapshot(doc),
  };
}

/** The sized board the design's cold-load budget is stated for. */
export function buildSizedBoard(count: number = PERSIST_TESTED_NOTES): BoardFixture {
  return buildBoardUpdate(count);
}

/**
 * Grow a board until its encoded update is comfortably bigger than `bytes`, so a
 * snapshot of it is guaranteed to need more than one chunk. Returns as soon as
 * the target is reached instead of guessing a note count.
 */
export function buildBoardUpdateLargerThan(bytes: number = SNAPSHOT_CHUNK_BYTES): BoardFixture {
  const doc = new Y.Doc();
  initDoc(doc);
  let count = 0;
  let size = 0;
  while (size <= bytes * 1.25) {
    for (let i = 0; i < 25; i++) {
      const id = createSticky(doc, { x: (count % 40) * 260, y: Math.floor(count / 40) * 260 }, COLOR_NAMES[count % COLOR_NAMES.length]);
      const text = getStickyText(doc, id);
      if (text) text.insert(0, TEXTS[count % TEXTS.length]);
      count++;
    }
    size = Y.encodeStateAsUpdate(doc).byteLength;
    if (count > 20000) break; // a runaway guard, not a limit the test relies on
  }
  return {
    update: Y.encodeStateAsUpdate(doc),
    notes: count,
    snapshot: snapshot(doc),
  };
}

/**
 * The damaged-bytes fixtures the design names: a truncated update (last 10 bytes
 * removed) and bytes of the same length that are not this document's. Each is
 * made from a real update so it parses as *a* Yjs update and then fails to apply
 * (truncated) or applies to nothing meaningful (scrambled), which is what a
 * corrupt row looks like from the inside.
 */
export function truncatedUpdate(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.length - 10));
}

export function scrambledUpdate(update: Uint8Array): Uint8Array {
  // The same length, the same header byte, a shuffled body: it decodes as a
  // Yjs update and is not the board's. `crypto.getRandomValues` is present in
  // workerd, node and the browser alike.
  const out = update.slice();
  const fill = new Uint8Array(out.length);
  crypto.getRandomValues(fill);
  for (let i = 1; i < out.length; i++) out[i] = fill[i];
  return out;
}

/**
 * The note count and id list of a fixture, for assertions after a reload:
 * comparing snapshots catches a reload that came back with the wrong board.
 */
export function sameBoard(a: readonly ReturnType<typeof snapshot>[number][], b: readonly ReturnType<typeof snapshot>[number][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].text !== b[i].text || a[i].x !== b[i].x || a[i].color !== b[i].color) {
      return false;
    }
  }
  return true;
}

/** One note of the retrospective board, in world units, top-left corner. */
export interface RetroNote {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface RetroBoard {
  /** The whole board as a single Yjs update, for the room's seed hook. */
  update: Uint8Array;
  /** The eight notes standing together in one cluster. */
  cluster: RetroNote[];
  /** The four standing away from it. */
  scattered: RetroNote[];
  /** All twelve, in the order they were pinned. */
  notes: RetroNote[];
}

// Twelve things a team pins to a retrospective board.
const RETRO_NOTES = [
  'What went well',
  'Ship the importer',
  'Export path slips',
  'Pair on the fix',
  'Time-box the sprint',
  'Clearer guidance',
  'Shorter onboarding',
  'Show the progress',
  'Ask the new users',
  'Fewer dashboards',
  'Write it down',
  'Review next week',
];

// World top-left of each note: eight in a cluster of three columns and three rows,
// one space short of full the way a cluster usually is, and four spread out to the
// right of it. The layout is meant for the camera the e2e helpers set - world (0,0)
// at the middle of a 1280x800 screen, notes 200 units square - and it is laid out so
// that every note lies WHOLLY inside that screen and no two of them overlap. Both
// matter: a note a click is aimed at must be a note the click can reach, which is
// what the undo scenarios are argued about.
const CLUSTER_SPOTS: Array<[number, number]> = [
  [-560, -360], [-340, -360], [-120, -360],
  [-560, -140], [-340, -140], [-120, -140],
  [-560, 80], [-340, 80],
];

const SCATTERED_SPOTS: Array<[number, number]> = [
  [200, -360], [420, -140], [200, 100], [420, 120],
];

/**
 * The board the undo scenarios are stated on: a retrospective board of twelve
 * notes in varied colours, eight of them in one cluster so that "select the eight
 * and delete them" is a thing a person can actually do, and four out of reach of
 * the cluster so that a note belonging to someone else is plainly still there when
 * the eight come back.
 *
 * It is built with the app's own model functions and handed over as one update,
 * which is how a board a person opens arrives: content they were given, none of it
 * something their own Undo could take back.
 */
export function buildRetroBoard(): RetroBoard {
  const doc = new Y.Doc();
  initDoc(doc);
  const spots = [...CLUSTER_SPOTS, ...SCATTERED_SPOTS];
  const notes: RetroNote[] = [];
  spots.forEach(([x, y], i) => {
    const id = createSticky(
      doc,
      { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 },
      COLOR_NAMES[i % COLOR_NAMES.length],
    );
    const text = RETRO_NOTES[i % RETRO_NOTES.length];
    getStickyText(doc, id)?.insert(0, text);
    notes.push({ id, x, y, text });
  });
  const cluster = notes.slice(0, CLUSTER_SPOTS.length);
  return {
    update: Y.encodeStateAsUpdate(doc),
    cluster,
    scattered: notes.slice(CLUSTER_SPOTS.length),
    notes,
  };
}
