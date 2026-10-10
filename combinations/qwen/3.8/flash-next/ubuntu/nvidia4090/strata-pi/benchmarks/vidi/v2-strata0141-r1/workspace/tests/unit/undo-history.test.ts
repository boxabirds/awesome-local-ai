import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObject,
  objectBounds,
  resizeObjects,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, UNDO_MAX_STEPS, type StickyColor } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { LOCAL_ORIGIN, applyLoadUpdate, createPeer } from './helpers/peer';

/**
 * Story 8, `undo.history` (TC-01 to TC-11).
 *
 * The controller runs over a real `Y.Doc` and a real `Y.UndoManager`, and the
 * "other person" is a second real document exchanging real updates
 * (`tests/unit/helpers/peer.ts`). What is under test is the whole promise: my
 * steps only, one step per action, nothing ever thrown, and a history that
 * stays usable after a step whose object is gone.
 */

function board(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const note = (doc: Y.Doc, id: string): StickySnapshot => {
  const found = snapshot(doc).find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`note ${id} is not on the board`);
  }
  return found;
};

const has = (doc: Y.Doc, id: string): boolean =>
  snapshot(doc).some((entry) => entry.id === id);

/** A note whose stored position is exactly `at` (centre adds half a note). */
function noteAt(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = 'yellow',
  text = '',
): string {
  const id = createSticky(doc, { x: at.x + STICKY_SIZE_WORLD / 2, y: at.y + STICKY_SIZE_WORLD / 2 }, color);
  if (text !== '') {
    getStickyText(doc, id)?.insert(0, text);
  }
  return id;
}

/** The parts of a note undo must bring back unchanged. */
function signature(doc: Y.Doc, id: string): string {
  const entry = note(doc, id);
  const bounds = objectBounds(entry);
  return `${entry.text}|${entry.color}|${bounds.width}|${bounds.height}|${bounds.x}|${bounds.y}`;
}

describe('undo.history - only my own steps (TC-01 to TC-03)', () => {
  it('TC-01 undoes my move and leaves a colleague create and recolour alone', () => {
    const doc = board();
    const x = noteAt(doc, { x: 100, y: 100 }, 'yellow', 'first');
    const z = noteAt(doc, { x: 400, y: 100 }, 'yellow', 'third');
    const undo: UndoController = createUndo(doc);
    const peer = createPeer(doc);

    undo.boundary();
    moveObject(doc, x, 300, 250);

    // Raj works in the meantime: a new note, and a recolour of my third note.
    const peerNote = peer.change((peerDoc) => noteAt(peerDoc, { x: 700, y: 100 }, 'blue', 'raj'));
    peer.change((peerDoc) => setStickyColor(peerDoc, z, 'green'));

    expect(undo.canUndo()).toBe(true);
    expect(undo.canRedo()).toBe(false);
    expect(undo.undo()).toBe(true);

    expect(note(doc, x)).toMatchObject({ x: 100, y: 100 });
    expect(has(doc, peerNote)).toBe(true);
    expect(note(doc, peerNote).color).toBe('blue');
    expect(note(doc, peerNote).text).toBe('raj');
    expect(note(doc, z).color).toBe('green');
    // Nothing of Raj's is on my stacks: the only step I have left is the redo.
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(true);

    undo.destroy();
    peer.destroy();
  });

  it('TC-02 changes that came from someone else have nothing to undo', () => {
    const doc = board();
    const undo = createUndo(doc);
    const peer = createPeer(doc);

    peer.change((peerDoc) => noteAt(peerDoc, { x: 200, y: 200 }, 'pink', 'not mine'));
    peer.change((peerDoc) => moveObject(peerDoc, snapshot(peerDoc)[0]!.id, 500, 500));

    expect(snapshot(doc)).toHaveLength(1);
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);

    undo.destroy();
    peer.destroy();
  });

  it('TC-03 a board loaded out of storage is not something I did', () => {
    const written = board();
    noteAt(written, { x: 150, y: 150 }, 'violet', 'saved');
    noteAt(written, { x: 350, y: 150 }, 'green', 'saved too');
    const update = Y.encodeStateAsUpdate(written);

    const doc = board();
    const undo = createUndo(doc);
    applyLoadUpdate(doc, update);
    // Story 4 also replays the log row by row.
    applyLoadUpdate(doc, Y.encodeStateAsUpdate(written, Y.encodeStateVector(doc)));

    expect(snapshot(doc)).toHaveLength(2);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);

    undo.destroy();
  });
});

describe('undo.history - steps and their inverses (TC-04 to TC-08)', () => {
  it('TC-04 one undo brings back all eight deleted notes, exactly as they were', () => {
    const doc = board();
    const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    const ids: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      ids.push(noteAt(doc, { x: 120 + index * 250, y: 120 }, colors[index % colors.length]!, `note ${index}`));
    }
    // Two of them have been resized, so "as they were" includes a stored size.
    resizeObjects(
      doc,
      new Map([
        [ids[0]!, { x: 120, y: 120, width: 300, height: 160 }],
        [ids[1]!, { x: 370, y: 120, width: 120, height: 240 }],
      ]),
    );
    const undo = createUndo(doc);
    const before = ids.map((id) => signature(doc, id));

    undo.boundary();
    expect(deleteObjects(doc, ids)).toBe(8);
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(8);
    expect(ids.map((id) => signature(doc, id))).toEqual(before);
    // One delete was one step: nothing else is left to undo.
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);

    undo.destroy();
  });

  it('TC-05 redo re-applies the move that undo took away', () => {
    const doc = board();
    const id = noteAt(doc, { x: 200, y: 200 }, 'yellow', 'move me');
    const undo = createUndo(doc);

    undo.boundary();
    moveObject(doc, id, 640, 320);
    expect(undo.undo()).toBe(true);
    expect(note(doc, id)).toMatchObject({ x: 200, y: 200 });
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(note(doc, id)).toMatchObject({ x: 640, y: 320 });
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);

    undo.destroy();
  });

  it('TC-06 a new change after undoing discards the redo history', () => {
    const doc = board();
    const a = noteAt(doc, { x: 200, y: 200 }, 'yellow', 'a');
    const b = noteAt(doc, { x: 600, y: 200 }, 'yellow', 'b');
    const undo = createUndo(doc);

    undo.boundary();
    moveObject(doc, a, 300, 300);
    expect(undo.undo()).toBe(true);
    expect(undo.canRedo()).toBe(true);

    undo.boundary();
    moveObject(doc, b, 700, 700);
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);

    undo.destroy();
  });

  it('TC-07 undoing a move of a note someone else deleted changes nothing and keeps the history usable', () => {
    const doc = board();
    const a = noteAt(doc, { x: 100, y: 100 }, 'yellow', 'a');
    const b = noteAt(doc, { x: 500, y: 100 }, 'yellow', 'b');
    const undo = createUndo(doc);
    const peer = createPeer(doc);

    undo.boundary();
    moveObject(doc, a, 140, 140);
    undo.boundary();
    moveObject(doc, b, 560, 160);

    // Raj deletes the note my last step moved.
    peer.change((peerDoc) => deleteObjects(peerDoc, [b]));
    expect(has(doc, b)).toBe(false);

    // The step whose object is gone consumes itself: nothing visible, no error.
    expect(() => undo.undo()).not.toThrow();
    expect(has(doc, b)).toBe(false);
    expect(note(doc, a)).toMatchObject({ x: 140, y: 140 });
    expect(undo.canUndo()).toBe(true);

    // The next undo continues normally.
    expect(undo.undo()).toBe(true);
    expect(note(doc, a)).toMatchObject({ x: 100, y: 100 });

    undo.destroy();
    peer.destroy();
  });

  it('TC-08 undoing my delete brings the note back with the content it had then', () => {
    const doc = board();
    const id = noteAt(doc, { x: 300, y: 300 }, 'blue', 'draft');
    const undo = createUndo(doc);
    const peer = createPeer(doc);

    // Raj edits the note first, so it is on my screen when I delete it.
    peer.change((peerDoc) => getStickyText(peerDoc, id)?.insert(6, ' - reviewed by Raj'));
    expect(note(doc, id).text).toBe('draft - reviewed by Raj');

    undo.boundary();
    deleteObjects(doc, [id]);
    expect(has(doc, id)).toBe(false);

    expect(undo.undo()).toBe(true);
    expect(note(doc, id).text).toBe('draft - reviewed by Raj');
    expect(note(doc, id).color).toBe('blue');
    expect(note(doc, id)).toMatchObject({ x: 300, y: 300 });

    undo.destroy();
    peer.destroy();
  });
});

describe('undo.history - length and lifetime (TC-09 to TC-11)', () => {
  /** Do `count` separate one-step actions. */
  function createMany(doc: Y.Doc, undo: UndoController, count: number): string[] {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      undo.boundary();
      ids.push(noteAt(doc, { x: 100 + index * 100, y: 100 }, 'yellow', `step ${index}`));
    }
    return ids;
  }

  /** How many undo presses actually do something. */
  function pressUntilEmpty(undo: UndoController, limit = UNDO_MAX_STEPS + 20): number {
    let presses = 0;
    while (presses < limit && undo.undo()) {
      presses += 1;
    }
    return presses;
  }

  it('TC-09 past the limit the oldest step is dropped, and it is never undone', () => {
    const doc = board();
    const undo = createUndo(doc);
    const ids = createMany(doc, undo, UNDO_MAX_STEPS);
    const extra = createMany(doc, undo, 1);

    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS + 1);
    expect(pressUntilEmpty(undo)).toBe(UNDO_MAX_STEPS);
    // The dropped step is the very first one: its note is still where it was.
    expect(has(doc, ids[0]!)).toBe(true);
    expect(note(doc, ids[0]!).text).toBe('step 0');
    expect(extra.every((id) => has(doc, id) === false)).toBe(true);
    expect(snapshot(doc)).toHaveLength(1);
    expect(undo.undo()).toBe(false);

    undo.destroy();
  });

  it('TC-10 one step short of the limit nothing is dropped', () => {
    const doc = board();
    const undo = createUndo(doc);
    const ids = createMany(doc, undo, UNDO_MAX_STEPS - 1);
    createMany(doc, undo, 1);

    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS);
    expect(pressUntilEmpty(undo)).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(0);
    // Every step was still on the stack, the oldest one included.
    expect(ids.every((id) => has(doc, id) === false)).toBe(true);

    undo.destroy();
  });

  it('TC-11 the history belongs to this page only: a new controller starts empty', () => {
    const doc = board();
    const first = createUndo(doc);
    first.boundary();
    const id = noteAt(doc, { x: 100, y: 100 }, 'yellow', 'made before the reload');
    expect(first.canUndo()).toBe(true);
    first.destroy();

    // The note is still on the board (the document was kept), but the history is not.
    const reloaded = createUndo(doc);
    expect(reloaded.canUndo()).toBe(false);
    expect(reloaded.canRedo()).toBe(false);
    expect(reloaded.undo()).toBe(false);
    expect(has(doc, id)).toBe(true);
    reloaded.destroy();
  });
});

describe('undo.history - change notifications', () => {
  it('onChange fires when a step is captured or consumed, and stops after unsubscribing', () => {
    const doc = board();
    const undo = createUndo(doc);
    const seen: string[] = [];
    const off = undo.onChange(() => seen.push('change'));

    undo.boundary();
    noteAt(doc, { x: 100, y: 100 }, 'yellow', 'a');
    expect(seen.length).toBeGreaterThan(0);

    const before = seen.length;
    expect(undo.undo()).toBe(true);
    expect(seen.length).toBeGreaterThan(before);

    off();
    const quiet = seen.length;
    undo.boundary();
    noteAt(doc, { x: 400, y: 100 }, 'yellow', 'b');
    expect(seen.length).toBe(quiet);

    undo.destroy();
  });

  it('a local mutation that is not a document change opens no stack item', () => {
    const doc = board();
    const id = noteAt(doc, { x: 100, y: 100 }, 'yellow', 'a');
    const undo = createUndo(doc);
    // Story 4/7 rule: a no-op opens no transaction at all.
    expect(moveObject(doc, id, note(doc, id).x, note(doc, id).y)).toBe(false);
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  it('the history is scoped to this document (the origin filter is not global)', () => {
    const mine = board();
    const other = board();
    const undo = createUndo(mine);
    // Same LOCAL_ORIGIN, different document: nothing to capture.
    noteAt(other, { x: 100, y: 100 }, 'yellow', 'elsewhere');
    expect(undo.canUndo()).toBe(false);
    undo.boundary();
    noteAt(mine, { x: 100, y: 100 }, 'yellow', 'mine');
    expect(undo.canUndo()).toBe(true);
    undo.destroy();
  });
});

/** A reminder of which origin the board model writes with (story 2 rule). */
it('the board model writes with LOCAL_ORIGIN, which is what this history tracks', () => {
  const doc = board();
  let origin: unknown = 'nothing';
  doc.on('update', (_update: Uint8Array, transactionOrigin: unknown) => {
    origin = transactionOrigin;
  });
  createSticky(doc, { x: 10, y: 10 });
  expect(origin).toBe(LOCAL_ORIGIN);
});
