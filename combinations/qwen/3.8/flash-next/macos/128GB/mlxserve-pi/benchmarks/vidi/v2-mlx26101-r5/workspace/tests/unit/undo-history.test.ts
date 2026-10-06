/**
 * A person's own undo history, on a board other people are working on (story 8, `undo.history`).
 *
 * Everything here runs on the real thing: two `Y.Doc`s kept in step the way the room keeps two tabs
 * in step (`tests/unit/helpers/peer.ts`), the real `UndoManager`, and the same mutation functions the
 * board calls. Nothing is mocked, because the property under test — that the history contains this
 * person's changes and nobody else's — lives in the one question Yjs asks about every transaction, and
 * a fake would answer a question nobody is asking.
 *
 * The negative cases are the point of the file. A history that undoes your own mistakes is a feature
 * fourteen years old; a history that leaves the colleague's work alone is the thing this board has to
 * get right, and it is only visible in the assertions that say *this did not move*.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  moveObjects,
  resizeObjects,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD, type StickyColor } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { applyTextDiff } from '../../src/client/objects/StickyText';
import { SHORT_PHRASE } from '../fixtures/texts';
import { connectPeer, loadFrom, type RemotePeer } from './helpers/peer';

/** One board, its history, and the colleague who is working on it at the same time. */
interface Scene {
  doc: Y.Doc;
  undo: UndoController;
  peer: RemotePeer;
  /** The colleague's document, for the tests that write as them. */
  theirs: Y.Doc;
}

function scene(): Scene {
  const doc = new Y.Doc();
  initDoc(doc);
  const peer = connectPeer(doc);
  const undo = createUndo(doc);
  return { doc, undo, peer, theirs: peer.doc };
}

/** Reads one note out of a board, or fails the test that asked for a note which is not there. */
function note(doc: Y.Doc, id: string): StickySnapshot {
  const found = snapshot(doc).find((object) => object.id === id);
  if (found === undefined) throw new Error(`no object ${id} on the board`);
  return found as StickySnapshot;
}

/** The parts of a note that a person would notice, for the tests that say nothing else changed. */
function visible(doc: Y.Doc, id: string): Record<string, unknown> {
  const object = note(doc, id);
  return {
    x: object.x,
    y: object.y,
    width: object.width ?? STICKY_SIZE_WORLD,
    height: object.height ?? STICKY_SIZE_WORLD,
    color: object.color,
    z: object.z,
    text: getStickyText(doc, id)?.toString() ?? '',
  };
}

/** Types into a note the way the note's own editor does: one transaction, this tab's origin. */
function typeInto(doc: Y.Doc, id: string, text: string): void {
  const ytext = getStickyText(doc, id);
  if (ytext === undefined) throw new Error(`note ${id} has no text to type into`);
  applyTextDiff(ytext, text, LOCAL_ORIGIN);
}

/** Creates a note, and says which one it is. */
function makeNote(doc: Y.Doc, x: number, y: number): string {
  const id = createSticky(doc, { x, y });
  if (typeof id !== 'string') throw new Error('the board refused to make a note');
  return id;
}

/**
 * Where a note made with `makeNote(x, y)` really is: a note is created *centred* on the point a
 * double-click landed on, and stored by its top-left, so the number in the document is half a note
 * away from the number in the test. The tests that talk about positions read this instead of
 * repeating the arithmetic.
 */
function topLeft(x: number, y: number): { x: number; y: number } {
  const half = STICKY_SIZE_WORLD / 2;
  return { x: x - half, y: y - half };
}

/** Takes back steps until there are none left, and says how many it took. */
function drain(undo: UndoController): number {
  let steps = 0;
  while (undo.undo()) steps += 1;
  return steps;
}

describe('a board with two people on it', () => {
  it('TC-01 undoes my move and nothing the colleague did while I was moving', () => {
    const { doc, undo, theirs } = scene();
    // Two notes already on the board when this person arrived, and a third the colleague adds after.
    const mine = makeNote(theirs, 100, 100);
    const recoloured = makeNote(theirs, 400, 100);
    loadFrom(theirs, doc);

    const before = visible(doc, mine);
    undo.boundary();
    moveObject(doc, mine, 640, 480);
    undo.boundary();

    expect(note(doc, mine).x).toBe(640);
    // The colleague makes a note of their own, and repaints the other one, in the same window.
    const theirs2 = makeNote(theirs, 700, 700);
    setStickyColor(theirs, recoloured, 'pink');

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);

    // Mine is back where it was…
    expect(visible(doc, mine)).toEqual(before);
    // …their new note is still on the board…
    expect(snapshot(doc).map((object) => object.id)).toContain(theirs2);
    // …and their colour is still their colour. Undo asked about my move and answered only that.
    expect(note(doc, recoloured).color).toBe('pink');
    // The same three answers on their screen, because an undo is a change like any other.
    expect(visible(theirs, mine)).toEqual(before);
    expect(note(theirs, recoloured).color).toBe('pink');
    expect(snapshot(theirs).map((object) => object.id)).toContain(theirs2);
  });

  it('TC-02 remembers nothing but my own changes: a board I only watched has nothing to undo', () => {
    const { doc, undo, theirs } = scene();
    const id = makeNote(theirs, 0, 0);
    loadFrom(theirs, doc);

    // The colleague does the whole story of a note: makes it, moves it, types in it, repaints it.
    moveObject(theirs, id, 300, 300);
    typeInto(theirs, id, SHORT_PHRASE);
    setStickyColor(theirs, id, 'blue');
    deleteObjects(theirs, [id]);

    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    // And there is nothing to put back either: an undo that never happened has no redo behind it.
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  it('TC-03 does not claim the board that was already there when I arrived', () => {
    const { doc, undo, theirs } = scene();
    // A board that had a whole afternoon of work on it before this tab was opened.
    const morning = makeNote(theirs, 40, 40);
    typeInto(theirs, morning, SHORT_PHRASE);
    const alsoMorning = makeNote(theirs, 80, 80);

    // This is what the load does: the state arrives as bytes, with the connection as its origin.
    loadFrom(theirs, doc);

    expect(snapshot(doc).map((object) => object.id).sort()).toEqual([morning, alsoMorning].sort());
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    // The notes are where the previous person left them, on both screens.
    expect(visible(doc, morning)).toEqual(visible(theirs, morning));
  });

  it('TC-04 brings back eight deleted notes at once, exactly as they were', () => {
    const { doc, undo, theirs } = scene();
    const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const id = makeNote(theirs, i * 100, i * 50);
      typeInto(theirs, id, `${SHORT_PHRASE} ${i}`);
      setStickyColor(theirs, id, colors[i % colors.length] as StickyColor);
      resizeObjects(theirs, new Map([[id, { x: i * 100, y: i * 50, width: 180 + i, height: 160 + i }]]));
      ids.push(id);
    }
    loadFrom(theirs, doc);

    const before = ids.map((id) => visible(doc, id));
    expect(new Set(before.map((object) => object.text)).size).toBe(8);

    // One delete of eight, from the selection bar or the Delete key: one step, not eight.
    undo.boundary();
    expect(deleteObjects(doc, ids)).toBe(8);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(8);
    // Text, colour, size and position: everything a person would notice if it came back wrong.
    for (const [index, id] of ids.entries()) {
      expect(visible(doc, id)).toEqual(before[index]);
    }
    // And they come back on the colleague's board too, in the same order they were stacked in.
    expect(snapshot(theirs).map((object) => object.id).sort()).toEqual([...ids].sort());
    expect(drain(undo)).toBe(0);
  });

  it('TC-05 puts back exactly what it took back', () => {
    const { doc, undo, theirs } = scene();
    const id = makeNote(theirs, 10, 10);
    loadFrom(theirs, doc);

    undo.boundary();
    moveObject(doc, id, 250, 350);
    typeInto(doc, id, SHORT_PHRASE);
    undo.boundary();

    const moved = visible(doc, id);
    expect(undo.undo()).toBe(true);
    expect(visible(doc, id)).toEqual({ ...moved, ...topLeft(10, 10), text: '' });
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect(visible(doc, id)).toEqual(moved);
    expect(undo.canRedo()).toBe(false);
    // Both screens, again: the redo was written into the same document the undo was.
    expect(visible(theirs, id)).toEqual(moved);
  });

  it('TC-06 forgets the future the moment I do something new', () => {
    const { doc, undo, theirs } = scene();
    const id = makeNote(theirs, 10, 10);
    loadFrom(theirs, doc);

    undo.boundary();
    moveObject(doc, id, 200, 200);
    undo.boundary();
    expect(undo.undo()).toBe(true);
    expect(undo.canRedo()).toBe(true);

    // A colour, one second after the undo. The thing that had been undone is no longer the future.
    undo.boundary();
    setStickyColor(doc, id, 'green');
    undo.boundary();

    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
    // The undo that did happen is still there to be taken back: only what was *ahead* went.
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(note(doc, id).color).toBe(DEFAULT_STICKY_COLOR);
    // The move is still undone: a new change cleared the future, not the past.
    expect(note(doc, id).x).toBe(topLeft(10, 10).x);
  });

  it('TC-07 skips a step whose note the colleague deleted, without making a scene', () => {
    const { doc, undo, theirs } = scene();
    const target = makeNote(theirs, 10, 10);
    loadFrom(theirs, doc);

    undo.boundary();
    const created = makeNote(doc, 500, 500);
    undo.boundary();
    expect(snapshot(doc).map((object) => object.id)).toContain(created);

    undo.boundary();
    moveObject(doc, target, 800, 800);
    undo.boundary();

    // The colleague deletes the very note I had just moved, while I was looking away.
    deleteObjects(theirs, [target]);
    expect(snapshot(doc).find((object) => object.id === target)).toBeUndefined();

    // Undo. There is a step at the top of the stack, and the object it would move no longer exists.
    // Nothing is resurrected, nothing is thrown, and nothing is said to the person but the screen.
    expect(() => {
      expect(undo.undo()).toBeTypeOf('boolean');
    }).not.toThrow();
    expect(snapshot(doc).find((object) => object.id === target)).toBeUndefined();
    expect(snapshot(theirs).find((object) => object.id === target)).toBeUndefined();

    // And the history still works. The step under the dead one was taken in the same press — Yjs walks
    // past a step it cannot apply rather than showing the person a press that did nothing — so the note
    // I made is no longer on the board, there is something to put back, and putting it back does what
    // it says.
    expect(snapshot(doc).map((object) => object.id)).not.toContain(created);
    expect(undo.canRedo()).toBe(true);
    expect(() => {
      expect(undo.redo()).toBeTypeOf('boolean');
    }).not.toThrow();
    expect(snapshot(doc).find((object) => object.id === target)).toBeUndefined();
    expect(snapshot(doc).map((object) => object.id)).toContain(created);
  });

  it('TC-08 brings back a deleted note with the words that were in it when it went', () => {
    const { doc, undo, theirs } = scene();
    const id = makeNote(theirs, 10, 10);
    loadFrom(theirs, doc);

    // The colleague writes into my note. I never see it; I delete the note a moment later.
    typeInto(theirs, id, 'their words');
    expect(getStickyText(doc, id)?.toString()).toBe('their words');

    undo.boundary();
    deleteObjects(doc, [id]);
    undo.boundary();
    expect(snapshot(doc)).toHaveLength(0);

    expect(undo.undo()).toBe(true);
    // Not empty, and not the version from before they typed: what the note said at the moment it was
    // deleted is what comes back, because that is the state this person deleted.
    expect(getStickyText(doc, id)?.toString()).toBe('their words');
    expect(getStickyText(theirs, id)?.toString()).toBe('their words');
  });

  it('TC-11 remembers nothing across a reload, which is what a session is', () => {
    const { doc, undo, theirs } = scene();
    const id = makeNote(theirs, 10, 10);
    loadFrom(theirs, doc);

    undo.boundary();
    moveObject(doc, id, 300, 120);
    undo.boundary();
    expect(undo.canUndo()).toBe(true);

    // The tab closes: the controller is destroyed with the board that made it.
    undo.destroy();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    // A press that arrives after the close reaches nothing, and takes nothing back with it.
    expect(note(doc, id).x).toBe(300);

    // The same board, a new tab, the same document: the notes are there. The history is not.
    const reopened = createUndo(doc);
    expect(reopened.canUndo()).toBe(false);
    expect(reopened.canRedo()).toBe(false);
    expect(reopened.undo()).toBe(false);
    // The colleague's note is still the colleague's note, and this tab did not touch it.
    expect(visible(doc, id)).toEqual(visible(theirs, id));
    reopened.destroy();
  });
});

describe('a board whose history has a limit on it', () => {
  const LIMIT = 5;

  /** A board with a note on it, and a history that forgets after LIMIT steps. */
  function limited(): { doc: Y.Doc; undo: UndoController; id: string } {
    const doc = new Y.Doc();
    initDoc(doc);
    const peer = connectPeer(doc);
    // The note was here before this person arrived, so the history below holds nothing but nudges.
    const id = makeNote(peer.doc, 0, 0);
    loadFrom(peer.doc, doc);
    return { doc, undo: createUndo(doc, { maxSteps: LIMIT }), id };
  }

  /** Moves the note to x = step × 10: one press of an arrow key, one step of the history. */
  function nudge(doc: Y.Doc, undo: UndoController, id: string, step: number): void {
    undo.boundary();
    moveObjects(doc, new Map([[id, { x: step * 10, y: 0 }]]));
    undo.boundary();
  }

  /** Puts back every step the history can put back, and says how many that was. */
  function drainRedo(undo: UndoController): number {
    let steps = 0;
    while (undo.redo()) steps += 1;
    return steps;
  }

  it('TC-09 drops the oldest step when the newest one does not fit', () => {
    const { doc, undo, id } = limited();

    // One step more than the history can hold: the note walks ten units at a time.
    for (let step = 1; step <= LIMIT + 1; step += 1) nudge(doc, undo, id, step);
    expect(note(doc, id).x).toBe((LIMIT + 1) * 10);

    // Exactly LIMIT presses take something back, and the one after them takes nothing.
    expect(drain(undo)).toBe(LIMIT);
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);

    // What is left behind is the oldest *kept* step's starting point, not the true one: the step that
    // would have taken the note from 0 to 10 is the one that was forgotten. That is the trade the
    // setting makes — a board open all afternoon remembers a bounded amount — and it is the reason the
    // bound is 200 rather than 20.
    expect(note(doc, id).x).toBe(10);

    // Everything that was kept is still put back, in order, by the same number of presses.
    expect(drainRedo(undo)).toBe(LIMIT);
    expect(note(doc, id).x).toBe((LIMIT + 1) * 10);
  });

  it('TC-10 keeps every step that still fits, to the last one', () => {
    const { doc, undo, id } = limited();

    for (let step = 1; step <= LIMIT; step += 1) nudge(doc, undo, id, step);
    expect(note(doc, id).x).toBe(LIMIT * 10);

    // A history exactly full has thrown nothing away: the first nudge is still there to take back,
    // which is the whole difference between the boundary and being one step over it.
    expect(drain(undo)).toBe(LIMIT);
    expect(note(doc, id).x).toBe(topLeft(0, 0).x);
    expect(undo.canRedo()).toBe(true);
    expect(drainRedo(undo)).toBe(LIMIT);
    expect(note(doc, id).x).toBe(LIMIT * 10);
  });
});
