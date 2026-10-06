/**
 * Per-user undo history (TC-01 to TC-11).
 *
 * The contract under test is `createUndo` over a real `Y.Doc` with a real colleague document on
 * the other end of a simulated wire (see `peer.ts`): only this tab's own transactions may enter
 * the history, one step at a time, and an inverse must never damage somebody else's work.
 */
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObject,
  moveObjects,
  resizeObjects,
  setStickyColor,
  stickySnapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { UNDO_MAX_STEPS } from '../../src/shared/config';
import { applyAsLoad, createPeerDoc, link, peerChange, type PeerLink } from './peer';

interface Fixture {
  doc: Y.Doc;
  peer: Y.Doc;
  link: PeerLink;
  undo: UndoController;
}

function fixture(): Fixture {
  const doc = new Y.Doc();
  initDoc(doc);
  const peer = createPeerDoc();
  const linkHandle = link(peer, doc);
  const undo = createUndo(doc);
  return { doc, peer, link: linkHandle, undo };
}

/** A note built locally, as one undo step of its own. */
function addNote(
  doc: Y.Doc,
  undo: UndoController,
  at: { x: number; y: number },
  options: { text?: string; color?: 'yellow' | 'orange' | 'green' | 'blue' | 'pink' | 'violet' } = {},
): string {
  undo.boundary();
  const id = createSticky(doc, at, options.color);
  if (options.text) getStickyText(doc, id)?.insert(0, options.text);
  undo.boundary();
  return id;
}

function noteOf(doc: Y.Doc, id: string): StickySnapshot | undefined {
  return stickySnapshot(doc).find((note) => note.id === id);
}

describe('undo.history', () => {
  test('TC-01: undoing my move leaves a colleague create and recolour alone', () => {
    const { doc, peer, undo } = fixture();
    const idA = addNote(doc, undo, { x: 0, y: 0 });
    const idC = addNote(doc, undo, { x: 400, y: 0 });

    // my move
    moveObject(doc, idA, 250, 120);
    undo.boundary();

    // Raj creates a note and recolours mine, after I moved
    peerChange(peer, () => {
      createSticky(peer, { x: 800, y: 800 }, 'green');
    });
    peerChange(peer, () => {
      setStickyColor(peer, idC, 'blue');
    });

    expect(noteOf(doc, idA)!.x).toBe(250);
    expect(stickySnapshot(doc)).toHaveLength(3);

    expect(undo.undo()).toBe(true);

    expect(noteOf(doc, idA)!.x).toBe(-100); // createSticky centres the note
    expect(noteOf(doc, idA)!.y).toBe(-100);
    expect(stickySnapshot(doc)).toHaveLength(3); // Raj's note is still here
    expect(noteOf(doc, idC)!.color).toBe('blue'); // and keeps Raj's colour
  });

  test('TC-02: a board I never changed has nothing to undo', () => {
    const { doc, peer, undo } = fixture();
    peerChange(peer, () => {
      createSticky(peer, { x: 0, y: 0 });
    });
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(stickySnapshot(doc)).toHaveLength(1); // nothing was reversed
  });

  test('TC-03: updates applied with the load origin are not mine to undo', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const stored = createPeerDoc();
    createSticky(stored, { x: 0, y: 0 });
    createSticky(stored, { x: 300, y: 0 });

    applyAsLoad(stored, doc);

    const undo = createUndo(doc);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(stickySnapshot(doc)).toHaveLength(2);
  });

  test('TC-04: undoing one delete brings eight notes back exactly as they were', () => {
    const { doc, undo } = fixture();
    const ids: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      ids.push(
        addNote(doc, undo, { x: index * 250, y: index * 100 }, {
          text: `note ${index}`,
          color: (['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const)[index % 6],
        }),
      );
    }
    // give them distinct sizes, still before the delete
    undo.boundary();
    resizeObjects(
      doc,
      new Map(ids.map((id, index) => [id, { x: index * 250, y: index * 100, width: 120 + index, height: 90 + index }])),
    );
    undo.boundary();

    // the board exactly as it stands at the moment of the accidental Delete
    const atDelete = new Map(stickySnapshot(doc).map((note) => [note.id, note]));

    deleteObjects(doc, ids); // one action, eight objects
    undo.boundary();
    expect(stickySnapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);

    const restored = stickySnapshot(doc);
    expect(restored).toHaveLength(8);
    for (const note of restored) {
      const was = atDelete.get(note.id);
      expect(was, `note ${note.id} was on the board when I deleted`).toBeDefined();
      expect({
        x: note.x,
        y: note.y,
        width: note.width,
        height: note.height,
        color: note.color,
        text: note.text,
        z: note.z,
      }).toEqual({
        x: was!.x,
        y: was!.y,
        width: was!.width,
        height: was!.height,
        color: was!.color,
        text: was!.text,
        z: was!.z,
      });
    }
    // spelled out once, because this is the requirement the PRD is about
    const zero = restored.find((note) => note.id === ids[0])!;
    expect({ x: zero.x, y: zero.y, width: zero.width, height: zero.height, text: zero.text }).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 90,
      text: 'note 0',
    });
    const last = restored.find((note) => note.id === ids[7])!;
    expect({ x: last.x, y: last.y, width: last.width, height: last.height, text: last.text, color: last.color }).toEqual({
      x: 1750,
      y: 700,
      width: 127,
      height: 97,
      text: 'note 7',
      color: 'orange',
    });
  });

  test('TC-05: redo re-applies the undone move', () => {
    const { doc, undo } = fixture();
    const id = addNote(doc, undo, { x: 0, y: 0 });
    moveObject(doc, id, 300, 400);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(noteOf(doc, id)!.x).toBe(-100);
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect(noteOf(doc, id)!.x).toBe(300);
    expect(noteOf(doc, id)!.y).toBe(400);
  });

  test('TC-06: a new change after an undo clears redo', () => {
    const { doc, undo } = fixture();
    const id = addNote(doc, undo, { x: 0, y: 0 });
    moveObject(doc, id, 100, 100);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(undo.canRedo()).toBe(true);

    setStickyColor(doc, id, 'pink');
    undo.boundary();

    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  test('TC-07: undoing a move of a note a colleague deleted does nothing and throws nothing', () => {
    const { doc, peer, undo } = fixture();
    const id = addNote(doc, undo, { x: 0, y: 0 });
    addNote(doc, undo, { x: 500, y: 0 });

    // my move of the note Raj is about to remove
    moveObject(doc, id, 666, 666);
    undo.boundary();

    let rajNote = '';
    peerChange(peer, () => {
      rajNote = createSticky(peer, { x: 900, y: 0 });
      deleteObjects(peer, [id]);
    });
    expect(noteOf(doc, id)).toBeUndefined();

    // The inverse of my move has nowhere to land: Yjs consumes that step rather than claiming the
    // keypress did something. Either way the note Raj deleted stays deleted, nothing of Raj's is
    // reversed, and no error escapes.
    expect(() => undo.undo()).not.toThrow();
    expect(noteOf(doc, id)).toBeUndefined();
    expect(noteOf(doc, rajNote)).toBeDefined();

    // and the rest of the history keeps working
    expect(() => undo.undo()).not.toThrow();
    expect(noteOf(doc, rajNote)).toBeDefined();
    expect(() => undo.redo()).not.toThrow();
  });

  test('TC-08: undoing my delete restores a note a colleague had just edited', () => {
    const { doc, peer, undo } = fixture();
    const id = addNote(doc, undo, { x: 0, y: 0 }, { text: 'start' });

    peerChange(peer, () => {
      getStickyText(peer, id)?.insert(5, ' - edited by Raj');
    });
    expect(noteOf(doc, id)!.text).toBe('start - edited by Raj');

    deleteObjects(doc, [id]);
    undo.boundary();
    expect(noteOf(doc, id)).toBeUndefined();

    expect(undo.undo()).toBe(true);
    // the note comes back with its content at the time of my delete
    expect(noteOf(doc, id)!.text).toBe('start - edited by Raj');
  });

  test('TC-09: a 201st step keeps the history at 200 and drops the oldest', () => {
    const { doc, undo } = fixture();
    const ids: string[] = [];
    for (let step = 0; step < UNDO_MAX_STEPS + 1; step += 1) {
      ids.push(addNote(doc, undo, { x: step * 300, y: 0 }));
    }
    expect(stickySnapshot(doc)).toHaveLength(UNDO_MAX_STEPS + 1);

    let undone = 0;
    while (undo.undo()) undone += 1;
    expect(undone).toBe(UNDO_MAX_STEPS); // the oldest step had fallen off the front
    expect(stickySnapshot(doc)).toHaveLength(1);
    expect(noteOf(doc, ids[0]!)).toBeDefined(); // and it is the very first note
  });

  test('TC-10: exactly 200 steps are all still there', () => {
    const { doc, undo } = fixture();
    const ids: string[] = [];
    for (let step = 0; step < UNDO_MAX_STEPS - 1; step += 1) {
      ids.push(addNote(doc, undo, { x: step * 300, y: 0 }));
    }
    ids.push(addNote(doc, undo, { x: UNDO_MAX_STEPS * 300, y: 0 })); // the 200th
    expect(stickySnapshot(doc)).toHaveLength(UNDO_MAX_STEPS);

    let undone = 0;
    while (undo.undo()) undone += 1;
    expect(undone).toBe(UNDO_MAX_STEPS);
    expect(stickySnapshot(doc)).toHaveLength(0); // nothing was dropped
  });

  test('TC-11: a fresh controller starts empty, so a reload offers nothing', () => {
    const { doc, undo } = fixture();
    const id = addNote(doc, undo, { x: 0, y: 0 });
    moveObject(doc, id, 40, 40);
    undo.boundary();
    expect(undo.canUndo()).toBe(true);

    undo.destroy();
    const afterReload = createUndo(doc);
    expect(afterReload.canUndo()).toBe(false);
    expect(afterReload.canRedo()).toBe(false);
    expect(afterReload.undo()).toBe(false);
  });

  test('onChange reports stack changes, and unsubscribe stops them', () => {
    const { doc, undo } = fixture();
    let changes = 0;
    const stop = undo.onChange(() => {
      changes += 1;
    });

    const id = addNote(doc, undo, { x: 0, y: 0 });
    expect(changes).toBeGreaterThan(0);
    const seen = changes;

    undo.undo();
    expect(changes).toBeGreaterThan(seen);

    stop();
    moveObjects(doc, new Map([[id, { x: 10, y: 10 }]]));
    expect(changes).toBeGreaterThan(seen); // the move itself is a new step, but no listener fires
    const afterUnsubscribe = changes;
    undo.undo();
    expect(changes).toBe(afterUnsubscribe);
  });
});
