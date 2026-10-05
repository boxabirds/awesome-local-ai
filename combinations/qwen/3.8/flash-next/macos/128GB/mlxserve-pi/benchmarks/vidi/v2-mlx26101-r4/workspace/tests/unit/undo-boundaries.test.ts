/**
 * Where one undo step ends and the next begins (TC-12, TC-13).
 *
 * A step is a thing somebody did, and the only clue that a burst of changes is one thing rather than
 * fifty is how close together they happened. That is the whole mechanism, which makes the length of the
 * pause the thing to test: it is not a tuning knob that some behaviour vaguely depends on, it is the
 * definition of a step, stated once in config and checked here at the number it states.
 *
 * The clock is `helpers/clock`, imported on the very next line and before anything that pulls in yjs —
 * which is not a style choice, it is the reason this file can talk about milliseconds at all: Yjs keeps
 * the clock it read the first time its library was loaded, so a clock installed afterwards is one it is
 * no longer looking at. Nothing here waits. The clock is moved to `UNDO_CAPTURE_TIMEOUT_MS - 1` and to
 * `UNDO_CAPTURE_TIMEOUT_MS` and nowhere near them, which is what makes the boundary a fact rather than a
 * probability, and what lets the same file also show the failure the boundary exists to prevent: typing
 * that pauses for a second is two things, and undo takes away one of them.
 */
import './helpers/clock';

import { afterAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createUndo } from '../../src/client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { advance, release } from './helpers/clock';

/** What a change from another person's screen looks like to this document, as a provider's would be. */
const FROM_ELSEWHERE = Symbol('test.somebody.else');

interface Board {
  doc: Y.Doc;
  note: string;
  undo: ReturnType<typeof createUndo>;
}

/** A board with one empty note on it, and a history that starts here. */
function boardWithNote(): Board {
  const doc = new Y.Doc();
  initDoc(doc);
  const note = createSticky(doc, { x: 0, y: 0 });
  return { doc, note, undo: createUndo(doc) };
}

/** One keystroke, written the way the editor writes one. */
function keystroke(doc: Y.Doc, note: string, at: number, char: string): void {
  const ytext = getStickyText(doc, note)!;
  Y.transact(doc, () => ytext.insert(at, char), LOCAL_ORIGIN);
}

/** What the note says right now. */
function textOf(doc: Y.Doc, note: string): string {
  return getStickyText(doc, note)!.toString();
}

/** A change that came in from another person's screen. */
function fromElsewhere(doc: Y.Doc, edit: (doc: Y.Doc) => void): void {
  const there = new Y.Doc();
  initDoc(there);
  Y.applyUpdate(there, Y.encodeStateAsUpdate(doc), FROM_ELSEWHERE);
  edit(there);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(there, Y.encodeStateVector(doc)), FROM_ELSEWHERE);
  there.destroy();
}

afterAll(() => {
  release();
});

describe('a typing burst is one step', () => {
  it('TC-12: typing that never pauses is one thing to undo', () => {
    const { doc, note, undo } = boardWithNote();

    // A boundary before, so the burst is certainly a step of its own…
    undo.boundary();
    for (let index = 0; index < 5; index += 1) {
      keystroke(doc, note, index, 'h');
      // …and each keystroke a fifth of the way towards the next step.
      advance(100);
    }
    // And a boundary after, so that whatever comes next is a step of its own too.
    undo.boundary();

    expect(textOf(doc, note)).toBe('hhhhh');
    expect(undo.undo()).toBe(true);
    expect(textOf(doc, note)).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13: a pause of exactly the timeout makes two steps, one millisecond shorter makes one', () => {
    const { doc, note, undo } = boardWithNote();
    undo.boundary();
    keystroke(doc, note, 0, 'a');

    advance(UNDO_CAPTURE_TIMEOUT_MS);
    keystroke(doc, note, 1, 'b');
    undo.boundary();

    expect(textOf(doc, note)).toBe('ab');
    // Two steps: the pause was long enough to count as having stopped.
    expect(undo.undo()).toBe(true);
    expect(textOf(doc, note)).toBe('a');
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(textOf(doc, note)).toBe('');
    expect(undo.canUndo()).toBe(false);

    // One millisecond shorter, and it was never a pause at all.
    const second = boardWithNote();
    second.undo.boundary();
    keystroke(second.doc, second.note, 0, 'a');
    advance(UNDO_CAPTURE_TIMEOUT_MS - 1);
    keystroke(second.doc, second.note, 1, 'b');
    second.undo.boundary();

    expect(second.undo.undo()).toBe(true);
    expect(textOf(second.doc, second.note)).toBe('');
    expect(second.undo.canUndo()).toBe(false);
  });

  it('typing that pauses is two things, which is the whole reason the pause has a number', () => {
    const { doc, note, undo } = boardWithNote();
    undo.boundary();
    keystroke(doc, note, 0, 'r');
    keystroke(doc, note, 1, 'e');
    advance(1000);
    keystroke(doc, note, 2, 'd');
    undo.boundary();

    expect(textOf(doc, note)).toBe('red');
    expect(undo.undo()).toBe(true);
    expect(textOf(doc, note)).toBe('re');
  });

  it('a burst interrupted by somebody else is still one burst of mine', () => {
    const { doc, note, undo } = boardWithNote();
    undo.boundary();
    keystroke(doc, note, 0, 'a');

    // A colleague writes in the same note while my word is half finished.
    fromElsewhere(doc, (there) => {
      const ytext = getStickyText(there, note)!;
      ytext.insert(ytext.length, '!');
    });
    expect(textOf(doc, note)).toBe('a!');

    advance(10);
    keystroke(doc, note, 1, 'b');
    undo.boundary();

    // One undo takes both of my letters and leaves theirs where it stands.
    expect(undo.undo()).toBe(true);
    expect(textOf(doc, note)).toBe('!');
    expect(undo.canUndo()).toBe(false);
  });
});

describe('ending a step the clock would have merged', () => {
  it('a boundary makes the next change its own step even a moment later', () => {
    const { doc, note, undo } = boardWithNote();

    undo.boundary();
    moveObject(doc, note, 100, 100);
    // Two hundred milliseconds is nothing to the clock; the boundary is what separates them.
    advance(200);
    undo.boundary();
    moveObject(doc, note, 200, 200);
    advance(200);
    undo.boundary();
    setStickyColor(doc, note, 'blue');

    // Three steps, because three actions are three steps however quickly they follow one another.
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0]).toMatchObject({ color: 'yellow', x: 200, y: 200 });
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0]).toMatchObject({ color: 'yellow', x: 100, y: 100 });
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0]).toMatchObject({ color: 'yellow', x: -100, y: -100 });
    expect(undo.canUndo()).toBe(false);
  });

  it('a boundary when there is nothing to undo asks for nothing', () => {
    const { undo } = boardWithNote();

    expect(() => {
      undo.boundary();
      undo.boundary();
      undo.boundary();
    }).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  it('a boundary at the end of a burst changes nothing on the board', () => {
    const { doc, note, undo } = boardWithNote();
    keystroke(doc, note, 0, 'a');
    const before = JSON.stringify(snapshot(doc));

    undo.boundary();

    expect(JSON.stringify(snapshot(doc))).toBe(before);
    expect(textOf(doc, note)).toBe('a');
  });
});
