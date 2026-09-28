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
import { PERSIST_TESTED_NOTES, SNAPSHOT_CHUNK_BYTES, STICKY_COLORS } from '../../src/shared/config.ts';
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
