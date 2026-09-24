import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { LOCAL_ORIGIN, createSticky, getStickyText, initDoc, moveObject, snapshot } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

const KEYSTROKE_GAP_MS = 100;
const START_TIME = new Date('2026-09-25T10:00:00Z');
const WORD = 'hello';
/** A pause far longer than the capture timeout (a person holding a drag still). */
const LONG_PAUSE_MS = UNDO_CAPTURE_TIMEOUT_MS * 4;

let doc: Y.Doc;
let ctl: UndoController;
let ytext: Y.Text;
let noteId: string;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START_TIME);
  doc = new Y.Doc();
  initDoc(doc);
  noteId = createSticky(doc, { x: 0, y: 0 });
  ytext = getStickyText(doc, noteId)!;
  ctl = createUndo(doc);
});

afterEach(() => {
  ctl.destroy();
  vi.useRealTimers();
});

function type(chars: string): void {
  doc.transact(() => ytext.insert(ytext.length, chars), LOCAL_ORIGIN);
}

function wait(ms: number): void {
  vi.advanceTimersByTime(ms);
}

/** Undoes until nothing is left; returns how many steps there were. */
function countSteps(): number {
  let steps = 0;
  while (ctl.undo()) steps += 1;
  return steps;
}

describe('undo.boundaries (capture timeout)', () => {
  it('TC-12 keystrokes 100 ms apart between two boundaries are one step; one undo removes the burst', () => {
    ctl.boundary();
    for (const ch of WORD) {
      type(ch);
      wait(KEYSTROKE_GAP_MS);
    }
    ctl.boundary();
    expect(ytext.toString()).toBe(WORD);
    expect(ctl.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(ctl.canUndo()).toBe(false);
  });

  it('TC-13 a pause of exactly UNDO_CAPTURE_TIMEOUT_MS starts a new step', () => {
    ctl.boundary();
    type('ab');
    wait(UNDO_CAPTURE_TIMEOUT_MS);
    type('cd');
    ctl.boundary();
    expect(ctl.undo()).toBe(true);
    expect(ytext.toString()).toBe('ab');
    expect(ctl.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
  });

  it('TC-13 a pause of UNDO_CAPTURE_TIMEOUT_MS − 1 ms stays in the same step', () => {
    ctl.boundary();
    type('ab');
    wait(UNDO_CAPTURE_TIMEOUT_MS - 1);
    type('cd');
    ctl.boundary();
    expect(countSteps()).toBe(1);
    expect(ytext.toString()).toBe('');
  });

  it('boundary splits changes made within the capture timeout', () => {
    ctl.boundary();
    type('a');
    ctl.boundary();
    type('b');
    ctl.boundary();
    expect(countSteps()).toBe(2);
  });

  it('boundary on an empty history is a no-op', () => {
    expect(() => ctl.boundary()).not.toThrow();
    ctl.boundary();
    expect(ctl.canUndo()).toBe(false);
    expect(ctl.canRedo()).toBe(false);
  });

  it('a gesture is one step even when the pointer is held still longer than the capture timeout', () => {
    const start = snapshot(doc)[0]!;
    ctl.beginGesture();
    moveObject(doc, noteId, start.x + 10, start.y);
    wait(LONG_PAUSE_MS);
    moveObject(doc, noteId, start.x + 20, start.y);
    ctl.endGesture();
    // The next change is its own step even within the timeout.
    type('x');
    ctl.boundary();
    expect(ctl.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(ctl.undo()).toBe(true);
    expect(snapshot(doc)[0]).toMatchObject({ x: start.x, y: start.y });
    expect(ctl.canUndo()).toBe(false);
    // Typing after the gesture groups by the capture timeout again.
    type('a');
    wait(UNDO_CAPTURE_TIMEOUT_MS);
    type('b');
    expect(countSteps()).toBe(2);
  });

  it('lastStep identifies the newest undo step (the editor stops at the step it started on)', () => {
    expect(ctl.lastStep()).toBeNull();
    ctl.boundary();
    type('a');
    ctl.boundary();
    const first = ctl.lastStep();
    expect(first).not.toBeNull();
    type('b');
    expect(ctl.lastStep()).not.toBe(first);
    ctl.undo();
    expect(ctl.lastStep()).toBe(first);
  });

  it('joinLastStep adds a change to the newest step even after a boundary and a long pause (story 9)', () => {
    const start = snapshot(doc)[0]!;
    ctl.boundary();
    type(WORD);
    ctl.boundary();
    wait(LONG_PAUSE_MS);
    const step = ctl.lastStep();
    expect(ctl.joinLastStep(() => moveObject(doc, noteId, 50, 60))).toBe(true);
    expect(ctl.lastStep()).toBe(step);
    // ...and closes it: the next change is a new step.
    type('!');
    expect(ctl.lastStep()).not.toBe(step);
    ctl.undo();
    expect(ytext.toString()).toBe(WORD);
    ctl.undo();
    expect(ytext.toString()).toBe('');
    expect(snapshot(doc)[0]).toMatchObject({ x: start.x, y: start.y });
    expect(ctl.canUndo()).toBe(false);
  });

  it('joinLastStep with an empty history starts the first step', () => {
    ctl.joinLastStep(() => moveObject(doc, noteId, 50, 60));
    expect(ctl.canUndo()).toBe(true);
    ctl.undo();
    expect(ctl.canUndo()).toBe(false);
  });
});
