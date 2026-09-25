/**
 * Reusable board fixture for persistence tests (story 4, task 3).
 *
 * Builds a board of `count` sticky notes (diverse text, colour, position,
 * z-order) in a plain `Y.Doc` and captures every Yjs update a client would
 * have sent (meta init + one per note mutation), so tests can append them
 * to a real board store byte-for-byte.
 */
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

/** The colour names in a stable order (for cycling in the fixture). */
const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

export interface NoteBoardFixture {
  /** The board id this fixture is built for (stable across runs). */
  boardId: string;
  /** Every update the client would have sent, in order. */
  updates: Uint8Array[];
  /** The client's final document (source of truth for assertions). */
  doc: Y.Doc;
  /** `snapshot(doc)` at the end of the build. */
  notes: readonly StickySnapshot[];
  /** The note ids in creation order. */
  ids: string[];
}

/** Deterministic layout: a 20-column grid with wrapped rows. */
function position(i: number): { x: number; y: number } {
  return { x: 200 + (i % 20) * 220, y: 150 + Math.floor(i / 20) * 160 };
}

/**
 * Build a board with `count` notes. Each note gets a distinct text, a
 * cycling colour, a grid position, and an increasing z-order.
 */
export function buildNoteBoard(boardId: string, count: number): NoteBoardFixture {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  const capture = (update: Uint8Array): void => {
    updates.push(update as Uint8Array);
  };
  doc.on('update', capture);

  initDoc(doc);
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = createSticky(doc, position(i), COLOR_NAMES[i % COLOR_NAMES.length]);
    getStickyText(doc, id)?.insert(0, `note ${i + 1}`);
    ids.push(id);
  }
  // Yjs fires 'update' synchronously per transaction; detach so later
  // mutations (e.g. extraMoveUpdate) are not captured twice.
  doc.off('update', capture);
  return { boardId, updates, doc, notes: snapshot(doc), ids };
}

/**
 * Build a board and then move note `moveId` to a new position, returning the
 * one extra update the move produces (for exact-count threshold tests).
 */
export function extraMoveUpdate(
  fixture: NoteBoardFixture,
  noteIndex: number,
): Uint8Array {
  const id = fixture.ids[noteIndex];
  if (id === undefined) throw new Error(`no note at index ${noteIndex}`);
  let captured: Uint8Array | undefined;
  const off = (update: Uint8Array): void => {
    captured = update as Uint8Array;
    fixture.doc.off('update', off);
  };
  fixture.doc.on('update', off);
  moveObject(fixture.doc, id, position(noteIndex).x + 7, position(noteIndex).y + 7);
  if (captured === undefined) throw new Error('moveObject produced no update');
  return captured;
}
