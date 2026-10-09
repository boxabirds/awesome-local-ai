import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  UNDO_MAX_STEPS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  moveObjects,
  objectExists,
  objectSnapshots,
  resizeObjects,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { applyLoadUpdate, connectPeer, type Peer } from './peer';

/**
 * `undo.history` (TC-01 to TC-11): one `UndoController` over a real `Y.Doc`, and a second
 * real `Y.Doc` exchanging updates with it through an origin the controller does not track.
 *
 * Everything the local client does goes through the shared board model, so every local
 * change carries `LOCAL_ORIGIN` and everything the peer does arrives as somebody else's
 * work — which is the whole of `undo.own`, checked at the level it is implemented.
 */

const COLORS: readonly StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

function board(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function sticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  options: { color?: StickyColor; text?: string; width?: number; height?: number } = {},
): string {
  const created = createSticky(doc, at, options.color ?? 'yellow');
  if (created === false) throw new Error('sticky note rejected by the model');
  if (options.text) {
    const ytext = getStickyText(doc, created);
    if (!ytext) throw new Error('sticky has no text');
    doc.transact(() => ytext.insert(0, options.text ?? ''), LOCAL_ORIGIN);
  }
  if (options.width !== undefined || options.height !== undefined) {
    resizeObjects(
      doc,
      new Map([
        [
          created,
          {
            x: at.x,
            y: at.y,
            width: options.width ?? STICKY_SIZE_WORLD,
            height: options.height ?? STICKY_SIZE_WORLD,
          },
        ],
      ]),
    );
  }
  return created;
}

function positionOf(doc: Y.Doc, id: string): { x: number; y: number } {
  const object = objectSnapshots(doc).find((entry) => entry.id === id);
  if (!object) throw new Error(`object ${id} is not on the board`);
  return { x: object.x, y: object.y };
}

function colorOf(doc: Y.Doc, id: string): string {
  const object = objectSnapshots(doc).find((entry) => entry.id === id);
  return (object as StickySnapshot | undefined)?.color ?? '(gone)';
}

function textOf(doc: Y.Doc, id: string): string {
  return getStickyText(doc, id)?.toString() ?? '(gone)';
}

/** The notes with these ids, sorted by id, so two boards can be compared field by field. */
function notesById(doc: Y.Doc, ids: readonly string[]): StickySnapshot[] {
  return snapshot(doc)
    .filter((note) => ids.includes(note.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Undo until the history says it is finished, and report how many steps it took. */
function undoAll(undo: UndoController, limit = UNDO_MAX_STEPS + 10): number {
  let steps = 0;
  while (undo.undo()) {
    steps += 1;
    if (steps > limit) throw new Error(`undo never ran out of steps (>${limit})`);
  }
  return steps;
}

describe('undo.history: only my own changes (TC-01 to TC-03)', () => {
  it('TC-01: undo reverses my move and nobody else’s change', () => {
    const doc = board();
    const moved = sticky(doc, { x: 100, y: 100 });
    const recoloured = sticky(doc, { x: 400, y: 100 }, { color: 'blue' });
    const peer: Peer = connectPeer(doc);
    const undo = createUndo(doc);

    // Mia moves note X.
    expect(moveObjects(doc, new Map([[moved, { x: 300, y: 250 }]]))).toBe(1);
    // Raj creates a note and recolours note Z in the meantime.
    const peerNote = peer.transact((peerDoc) => sticky(peerDoc, { x: 10, y: 10 }));
    peer.transact((peerDoc) => setStickyColor(peerDoc, recoloured, 'green'));
    expect(objectExists(doc, peerNote)).toBe(true);
    expect(colorOf(doc, recoloured)).toBe('green');

    expect(undo.undo()).toBe(true);

    // X is back where Mia moved it from…
    expect(positionOf(doc, moved)).toEqual({ x: 0, y: 0 });
    // …and none of Raj's work was reversed.
    expect(objectExists(doc, peerNote)).toBe(true);
    expect(colorOf(doc, recoloured)).toBe('green');
    peer.destroy();
  });

  it('TC-02: changes that were never mine leave nothing to undo', () => {
    const doc = board();
    const undo = createUndo(doc);
    const peer = connectPeer(doc);

    const theirs = peer.transact((peerDoc) => sticky(peerDoc, { x: 100, y: 100 }));
    peer.transact((peerDoc) => moveObjects(peerDoc, new Map([[theirs, { x: 20, y: 20 }]])));

    expect(snapshot(doc)).toHaveLength(1);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    peer.destroy();
  });

  it('TC-03: a board that was loaded rather than edited leaves nothing to undo', () => {
    const doc = board();
    const undo = createUndo(doc);

    // Story 4: the room's updates arrive with the load origin, not this client's.
    const source = board();
    sticky(source, { x: 0, y: 0 }, { text: 'loaded' });
    sticky(source, { x: 200, y: 0 });
    applyLoadUpdate(doc, Y.encodeStateAsUpdate(source));

    expect(snapshot(doc)).toHaveLength(2);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });
});

describe('undo.history: the steps themselves (TC-04 to TC-06)', () => {
  it('TC-04: one undo brings eight deleted notes back with text, colour, size and position', () => {
    const doc = board();
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      ids.push(
        sticky(doc, { x: i * 60, y: 40 }, {
          color: COLORS[i % COLORS.length],
          text: `note ${i}`,
          width: i % 2 === 0 ? 160 : undefined,
          height: i % 2 === 0 ? 120 : undefined,
        }),
      );
    }
    const undo = createUndo(doc);
    const before = notesById(doc, ids);
    expect(before).toHaveLength(8);

    // One Delete on a selection of eight (story 7) is one transaction.
    expect(deleteObjects(doc, ids)).toBe(8);
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    const after = notesById(doc, ids);
    expect(after).toHaveLength(8);
    expect(after.map((note) => ({ text: note.text, color: note.color, x: note.x, y: note.y, width: note.width, height: note.height }))).toEqual(
      before.map((note) => ({
        text: note.text,
        color: note.color,
        x: note.x,
        y: note.y,
        width: note.width,
        height: note.height,
      })),
    );
  });

  it('TC-05: redo re-applies the step I just undid', () => {
    const doc = board();
    const id = sticky(doc, { x: 100, y: 100 });
    const undo = createUndo(doc);

    moveObjects(doc, new Map([[id, { x: 420, y: -60 }]]));
    expect(undo.undo()).toBe(true);
    expect(positionOf(doc, id)).toEqual({ x: 0, y: 0 });
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect(positionOf(doc, id)).toEqual({ x: 420, y: -60 });
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-06: a new change after an undo throws the redo history away', () => {
    const doc = board();
    const first = sticky(doc, { x: 0, y: 0 });
    const undo = createUndo(doc);

    const second = sticky(doc, { x: 40, y: 40 });
    expect(undo.undo()).toBe(true);
    expect(undo.canRedo()).toBe(true);

    setStickyColor(doc, first, 'pink');
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(objectExists(doc, second)).toBe(false);
  });
});

describe('undo.history: an undo never breaks (TC-07, TC-08)', () => {
  it('TC-07: undoing a move of a note somebody else deleted throws nothing, and the history keeps working', () => {
    const doc = board();
    const a = sticky(doc, { x: 0, y: 0 });
    const b = sticky(doc, { x: 200, y: 0 });
    const undo = createUndo(doc);
    const bStart = positionOf(doc, b);

    moveObjects(doc, new Map([[b, { x: 260, y: 40 }]]));
    undo.boundary();
    moveObjects(doc, new Map([[a, { x: 30, y: 70 }]]));
    // Raj deletes A while Mia is not looking.
    const peer = connectPeer(doc);
    peer.transact((peerDoc) => deleteObjects(peerDoc, [a]));
    expect(objectExists(doc, a)).toBe(false);

    // Mia undoes her last step, which belongs to a note that is gone: nothing is applied to
    // it, nothing is thrown, and Raj's delete stands.
    expect(() => expect(undo.undo()).toBe(true)).not.toThrow();
    expect(objectExists(doc, a)).toBe(false);

    // Her history stayed usable. `Y.UndoManager` throws away a step it cannot apply instead
    // of leaving it in the way, so that one Ctrl+Z went on to the step before it: B is back
    // where Mia found it, and she can redo it.
    expect(positionOf(doc, b)).toEqual(bStart);
    expect(undo.canRedo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(positionOf(doc, b)).toEqual({ x: 260, y: 40 });
    peer.destroy();
  });

  it('TC-08: undoing my delete brings back the text as it was when I deleted', () => {
    const doc = board();
    const id = sticky(doc, { x: 0, y: 0 }, { text: 'draft' });
    const peer = connectPeer(doc);
    const undo = createUndo(doc);

    // Raj types into the note…
    peer.transact((peerDoc) => {
      const ytext = getStickyText(peerDoc, id);
      if (!ytext) throw new Error('peer cannot see the note');
      peerDoc.transact(() => ytext.insert(0, 'Raj: '), LOCAL_ORIGIN);
    });
    expect(textOf(doc, id)).toBe('Raj: draft');
    // …and Mia deletes it.
    deleteObjects(doc, [id]);
    expect(objectExists(doc, id)).toBe(false);

    expect(undo.undo()).toBe(true);
    expect(textOf(doc, id)).toBe('Raj: draft');
    peer.destroy();
  });
});

describe('undo.history: 200 steps, and no more (TC-09, TC-10)', () => {
  /** `steps` separate creation steps, each its own undo step. */
  function createNotes(doc: Y.Doc, steps: number, undo: UndoController): string[] {
    const ids: string[] = [];
    for (let i = 0; i < steps; i += 1) {
      ids.push(sticky(doc, { x: i * 10, y: 0 }));
      undo.boundary();
    }
    return ids;
  }

  it('TC-09: one step past the limit drops the oldest and keeps exactly UNDO_MAX_STEPS', () => {
    const doc = board();
    const undo = createUndo(doc);
    const ids = createNotes(doc, UNDO_MAX_STEPS + 1, undo);
    expect(snapshot(doc)).toHaveLength(UNDO_MAX_STEPS + 1);

    expect(undoAll(undo)).toBe(UNDO_MAX_STEPS);

    // The oldest step was discarded, so its note is the one still on the board.
    const left = snapshot(doc);
    expect(left).toHaveLength(1);
    expect(left[0]?.id).toBe(ids[0]);
    expect(undo.canUndo()).toBe(false);
    expect(undoAll(undo)).toBe(0);
  });

  it('TC-10: exactly the limit keeps every step', () => {
    const doc = board();
    const undo = createUndo(doc);
    createNotes(doc, UNDO_MAX_STEPS - 1, undo);
    // The last note is the boundary value: the UNDO_MAX_STEPS-th step is kept, nothing dropped.
    sticky(doc, { x: UNDO_MAX_STEPS * 10, y: 0 });
    undo.boundary();

    expect(undoAll(undo)).toBe(UNDO_MAX_STEPS);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe('undo.history: the history is this tab’s, for this session (TC-11)', () => {
  it('TC-11: a fresh controller after a reload has nothing to undo', () => {
    const doc = board();
    const undo = createUndo(doc);
    sticky(doc, { x: 0, y: 0 });
    undo.boundary();
    expect(undo.canUndo()).toBe(true);

    undo.destroy();
    const reloaded = createUndo(doc);
    expect(reloaded.canUndo()).toBe(false);
    expect(reloaded.canRedo()).toBe(false);
    expect(reloaded.undo()).toBe(false);
    expect(reloaded.redo()).toBe(false);
  });
});
