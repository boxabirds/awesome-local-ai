// Story 8, undo.history — a per-person undo controller over a real Y.Doc, with a
// real colleague doc exchanging updates through the real Yjs encoding (task 6).
//
// The controller's whole promise is stated as "what the person sees": after their
// undo, their own action is reversed and every colleague's work is where they
// left it. Everything is therefore read back out of the documents, and the
// colleague's copy is checked too, because an undo that only fixed the local
// screen has not undone anything anyone else will see.
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo.ts';
import {
  applyLoadUpdate,
  createPeer,
  loadBoard,
  notesById,
  PROVIDER_ORIGIN,
  type Peer,
} from './helpers/peer.ts';
import { LOAD_ORIGIN } from '../../src/worker/board-store.ts';
import {
  createSticky,
  deleteObjects,
  moveObjects,
  setStickyColor,
  type ObjectSnapshot,
} from '../../src/shared/board-model.ts';
import { UNDO_MAX_STEPS } from '../../src/shared/config.ts';

interface Rig {
  doc: Y.Doc;
  peer: Peer;
  undo: UndoController;
}

/** A board already holding `n` loaded notes, a colleague attached, and a history. */
function rig(notes: number): Rig {
  const doc = loadBoard(
    Array.from({ length: notes }, (_unused, i) => ({ x: i * 220, y: 0, text: `t${i}` })),
  );
  const peer = createPeer(doc);
  const undo = createUndo(doc);
  return { doc, peer, undo };
}

/**
 * One user action: the boundaries an app puts around a single gesture, delete,
 * colour change or creation, so it is captured as one step.
 */
function step(undo: UndoController, action: () => void): void {
  undo.boundary();
  action();
  undo.boundary();
}

function objectById(doc: Y.Doc, id: string): ObjectSnapshot | undefined {
  return notesById(doc).get(id);
}

/** Ids on the board that are not the loaded fixture's. */
function freshIds(doc: Y.Doc, loaded: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < loaded; i++) out.push(`note-${i}`);
  return [...notesById(doc).keys()].filter((id) => !out.includes(id));
}

/** Undo until the history is empty and report how many steps it took. */
function undoAll(undo: UndoController): number {
  let n = 0;
  while (undo.undo()) {
    n += 1;
    if (n > 5_000) throw new Error('undo did not terminate');
  }
  return n;
}

describe('undo history of one person (undo.history)', () => {
  // TC-01: her own move is reversed; the note a colleague created in the
  // meantime is still there and the note they recoloured keeps that colour.
  it('TC-01 undoes my move and no colleague change', () => {
    const { doc, peer, undo } = rig(2);
    const changed = 'note-0';
    const recoloured = 'note-1';

    step(undo, () => {
      moveObjects(doc, new Map([[changed, { x: 250, y: 120 }]]));
    });

    // The colleague works while she is not looking: a new note, and a colour.
    let created = '';
    peer.transact(() => {
      created = createSticky(peer.doc, { x: 0, y: 600 }, 'green');
    });
    peer.transact(() => {
      setStickyColor(peer.doc, recoloured, 'blue');
    });
    peer.sync();

    expect(undo.canUndo()).toBe(true);
    expect(undo.canRedo()).toBe(false);
    expect(undo.undo()).toBe(true);

    expect(objectById(doc, changed)!.x).toBeCloseTo(0, 6);
    expect(objectById(doc, changed)!.y).toBeCloseTo(0, 6);
    expect(objectById(doc, created)).toBeDefined();
    expect(objectById(doc, created)!.color).toBe('green');
    expect(objectById(doc, recoloured)!.color).toBe('blue');

    // The reversal reaches the colleague's screen like any other change.
    peer.sync();
    expect(objectById(peer.doc, changed)!.x).toBeCloseTo(0, 6);
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(true);
  });

  // TC-02 (empty stack): a board only other people changed has nothing for this
  // person to undo, and undo says so rather than throwing.
  it('TC-02 cannot undo changes only a colleague made', () => {
    const { doc, peer, undo } = rig(1);
    expect(undo.canUndo()).toBe(false);

    peer.transact(() => {
      createSticky(peer.doc, { x: 500, y: 500 }, 'pink');
    });
    peer.transact(() => {
      setStickyColor(peer.doc, 'note-0', 'violet');
    });

    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(notesById(doc).size).toBe(2);
    expect(objectById(doc, 'note-0')!.color).toBe('violet');
  });

  // TC-03: the board arriving from storage is not something this person did.
  it('TC-03 cannot undo what the board was loaded with', () => {
    const { doc, undo } = rig(1);
    const elsewhere = loadBoard([{ x: 900, y: 900, text: 'from storage' }]);

    applyLoadUpdate(doc, Y.encodeStateAsUpdate(elsewhere));

    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(notesById(doc).has('note-0')).toBe(true);
  });

  // TC-04: the accidental delete of eight notes comes back as one action, with
  // text, colour, size and position as they were.
  it('TC-04 restores everything one delete removed', () => {
    const { doc, undo } = rig(12);
    const cluster = [...notesById(doc).keys()].slice(0, 8);
    const before = new Map<string, ObjectSnapshot | undefined>();
    for (const id of cluster) before.set(id, objectById(doc, id));

    step(undo, () => {
      deleteObjects(doc, cluster);
    });
    expect(notesById(doc).size).toBe(4);
    expect(undo.canUndo()).toBe(true);

    expect(undo.undo()).toBe(true);
    for (const id of cluster) {
      const was = before.get(id)!;
      const now = objectById(doc, id);
      expect(now).toBeDefined();
      expect(now!.x).toBeCloseTo(was.x, 6);
      expect(now!.y).toBeCloseTo(was.y, 6);
      expect(now!.color).toBe(was.color);
      expect(now!.text).toBe(was.text);
    }
    // Undoing the delete is itself redoable and leaves nothing else behind.
    expect(undo.canRedo()).toBe(true);
    expect(notesById(doc).size).toBe(12);
  });

  // TC-05: redo re-applies the change that was just undone.
  it('TC-05 redoes the change it undid', () => {
    const { doc, peer, undo } = rig(1);
    const moved = 'note-0';

    step(undo, () => {
      moveObjects(doc, new Map([[moved, { x: 640, y: -300 }]]));
    });
    expect(undo.undo()).toBe(true);
    expect(objectById(doc, moved)!.x).toBeCloseTo(0, 6);
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect(objectById(doc, moved)!.x).toBeCloseTo(640, 6);
    expect(objectById(doc, moved)!.y).toBeCloseTo(-300, 6);
    expect(undo.canRedo()).toBe(false);
    expect(undo.canUndo()).toBe(true);

    peer.sync();
    expect(objectById(peer.doc, moved)!.x).toBeCloseTo(640, 6);
  });

  // TC-06: a new mistake clears the redo history — you cannot walk back into it.
  it('TC-06 clears redo when a new change is made', () => {
    const { doc, undo } = rig(2);

    step(undo, () => {
      moveObjects(doc, new Map([['note-0', { x: 300, y: 300 }]]));
    });
    expect(undo.undo()).toBe(true);
    expect(undo.canRedo()).toBe(true);

    step(undo, () => {
      setStickyColor(doc, 'note-1', 'orange');
    });

    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(objectById(doc, 'note-0')!.x).toBeCloseTo(0, 6);
  });

  // TC-07 (error path): the note she moved was deleted by someone else in the
  // meantime. Undoing must not error and must not resurrect anyone's object.
  // Yjs walks past a step whose inverse can do nothing and reverses the next step
  // of hers that still can - the history continuing to work rather than jamming.
  it('TC-07 survives undoing a move of a note someone else deleted', () => {
    const { doc, peer, undo } = rig(1);
    const moved = 'note-0';

    step(undo, () => {
      createSticky(doc, { x: 100, y: 400 }, 'blue');
    });
    const created = freshIds(doc, 1)[0];
    step(undo, () => {
      moveObjects(doc, new Map([[moved, { x: 700, y: 700 }]]));
    });

    peer.transact(() => {
      deleteObjects(peer.doc, [moved]);
    });
    expect(objectById(doc, moved)).toBeUndefined();

    expect(undo.canUndo()).toBe(true);
    expect(() => undo.undo()).not.toThrow();
    // Nobody's deleted note came back, on either screen.
    peer.sync();
    expect(objectById(doc, moved)).toBeUndefined();
    expect(objectById(peer.doc, moved)).toBeUndefined();
    // Her own earlier step is the one that got reversed, and the history is not
    // left in a state where undo or redo throws.
    expect(objectById(doc, created)).toBeUndefined();
    expect(undo.canUndo()).toBe(false);
    expect(() => undo.undo()).not.toThrow();
    expect(() => undo.redo()).not.toThrow();
  });

  // The step that found nowhere to land is a step the history no longer holds, and
  // the buttons are only honest if somebody tells them. yjs announces a step when it
  // performs one and says nothing at all when it consumed the last of them finding
  // there was nowhere left to land - so a button that hears nothing goes on offering
  // a step that is already gone, which is a lie a person can press.
  it('tells its listeners about the undo that found nowhere to land', () => {
    const { doc, peer, undo } = rig(1);
    const seen = vi.fn();
    undo.onChange(seen);

    step(undo, () => {
      moveObjects(doc, new Map([['note-0', { x: 300, y: 300 }]]));
    });
    peer.transact(() => {
      deleteObjects(peer.doc, ['note-0']);
    });
    expect(undo.canUndo()).toBe(true);

    seen.mockClear();
    expect(undo.undo()).toBe(false); // the note is gone: the inverse performed nothing
    expect(seen).toHaveBeenCalledTimes(1);
    expect(undo.canUndo()).toBe(false);

    seen.mockClear();
    expect(undo.redo()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  // TC-08: deleting a note a colleague was editing brings it back with the text
  // as it was at the moment of the delete - not older, not newer.
  it('TC-08 restores a deleted note with the content it had when deleted', () => {
    const doc = loadBoard([{ x: 0, y: 0, text: '' }]);
    const peer = createPeer(doc);
    const undo = createUndo(doc);
    const doomed = 'note-0';

    peer.transact(() => {
      (doc.getMap<Y.Map<unknown>>('objects').get(doomed)!.get('text') as Y.Text).insert(0, 'colleague words');
    });

    step(undo, () => {
      deleteObjects(doc, [doomed]);
    });
    expect(objectById(doc, doomed)).toBeUndefined();

    expect(undo.undo()).toBe(true);
    expect(objectById(doc, doomed)!.text).toBe('colleague words');
  });

  // TC-09 (boundary, at the limit): a history full of UNDO_MAX_STEPS steps plus
  // one more is still UNDO_MAX_STEPS long, and the oldest step is the one gone.
  it('TC-09 drops the oldest step beyond UNDO_MAX_STEPS', () => {
    const { doc, undo } = rig(0);
    const ids: string[] = [];

    for (let i = 0; i < UNDO_MAX_STEPS; i++) {
      step(undo, () => {
        ids.push(createSticky(doc, { x: i * 10, y: 0 }));
      });
    }
    expect(notesById(doc).size).toBe(UNDO_MAX_STEPS);

    step(undo, () => {
      ids.push(createSticky(doc, { x: UNDO_MAX_STEPS * 10, y: 0 }));
    });

    expect(undoAll(undo)).toBe(UNDO_MAX_STEPS);
    expect(undo.canUndo()).toBe(false);
    // The first note's creation was discarded, so the note is still there; every
    // note made after it was undone.
    expect(objectById(doc, ids[0])).toBeDefined();
    expect(objectById(doc, ids[1])).toBeUndefined();
    expect(objectById(doc, ids[ids.length - 1])).toBeUndefined();
  });

  // TC-10 (boundary, one below the limit): the step that fills the history
  // discards nothing.
  it('TC-10 discards nothing until the limit is crossed', () => {
    const { doc, undo } = rig(0);
    const ids: string[] = [];

    for (let i = 0; i < UNDO_MAX_STEPS - 1; i++) {
      step(undo, () => {
        ids.push(createSticky(doc, { x: i * 10, y: 0 }));
      });
    }
    step(undo, () => {
      ids.push(createSticky(doc, { x: UNDO_MAX_STEPS * 10, y: 0 }));
    });
    expect(notesById(doc).size).toBe(UNDO_MAX_STEPS);

    expect(undoAll(undo)).toBe(UNDO_MAX_STEPS);
    expect(undo.canUndo()).toBe(false);
    expect(notesById(doc).size).toBe(0);
  });

  // TC-11: the history belongs to this visit. A new controller — what a reload
  // or a different board gives you — starts with nothing to undo.
  it('TC-11 forgets everything when the controller is destroyed', () => {
    const { doc, undo } = rig(1);
    step(undo, () => {
      moveObjects(doc, new Map([['note-0', { x: 55, y: 66 }]]));
    });
    expect(undo.canUndo()).toBe(true);

    undo.destroy();

    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);

    // The same board, a fresh history (a page reload): nothing is offered.
    const reloaded = createUndo(doc);
    expect(reloaded.canUndo()).toBe(false);
    expect(reloaded.undo()).toBe(false);

    // and the old one's changes are still on the board, un-undoable
    expect(objectById(doc, 'note-0')!.x).toBeCloseTo(55, 6);
    reloaded.destroy();
  });

  // The buttons must know the state without polling: every stack change is
  // announced to whoever asked.
  it('reports stack changes to its subscribers and stops when asked', () => {
    const { doc, peer, undo } = rig(1);
    const seen = vi.fn();
    const unsubscribe = undo.onChange(seen);

    step(undo, () => {
      moveObjects(doc, new Map([['note-0', { x: 10, y: 0 }]]));
    });
    expect(seen).toHaveBeenCalled();

    seen.mockClear();
    peer.transact(() => {
      setStickyColor(peer.doc, 'note-0', 'green');
    });
    expect(seen).not.toHaveBeenCalled();

    unsubscribe();
    seen.mockClear();
    step(undo, () => {
      moveObjects(doc, new Map([['note-0', { x: 20, y: 0 }]]));
    });
    expect(seen).not.toHaveBeenCalled();
  });

  // Nothing in the fixture is an accident: the origins the controller must ignore
  // are the ones the app really uses.
  it('ignores the provider and load origins it is given', () => {
    expect(typeof PROVIDER_ORIGIN).toBe('symbol');
    expect(typeof LOAD_ORIGIN).toBe('symbol');
    expect(PROVIDER_ORIGIN).not.toBe(LOAD_ORIGIN);
  });
});
