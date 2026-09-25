import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, getStickyText, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';

let doc: Y.Doc;
let text: Y.Text;
let c: UndoController;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));
  doc = new Y.Doc();
  text = getStickyText(doc, createSticky(doc, { x: 0, y: 0 }))!;
  c = createUndo(doc);
});

afterEach(() => {
  c.destroy();
  vi.useRealTimers();
});

/** Types `s` at the end of the note as one local transaction (one keystroke). */
function type(s: string) {
  doc.transact(() => text.insert(text.length, s), LOCAL_ORIGIN);
}

function wait(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

/** Undoes until empty; returns the number of steps. */
function steps(): number {
  let n = 0;
  while (c.undo()) n++;
  return n;
}

describe('typing bursts (undo.boundaries)', () => {
  it('TC-12 keystrokes 100 ms apart between two boundaries are one step; undo removes the whole burst', () => {
    c.boundary();
    for (const ch of 'hello') {
      type(ch);
      wait(100);
    }
    c.boundary();
    expect(text.toString()).toBe('hello');
    expect(c.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(c.redo()).toBe(true);
    expect(text.toString()).toBe('hello');
  });

  it('TC-13 a pause of exactly UNDO_CAPTURE_TIMEOUT_MS starts a new step', () => {
    c.boundary();
    type('one');
    wait(UNDO_CAPTURE_TIMEOUT_MS);
    type(' two');
    c.boundary();
    c.undo();
    expect(text.toString()).toBe('one');
    c.undo();
    expect(text.toString()).toBe('');
  });

  it('TC-13 a pause of UNDO_CAPTURE_TIMEOUT_MS − 1 ms stays in the same step', () => {
    c.boundary();
    type('one');
    wait(UNDO_CAPTURE_TIMEOUT_MS - 1);
    type(' two');
    c.boundary();
    c.undo();
    expect(text.toString()).toBe('');
    expect(c.canUndo()).toBe(false);
  });

  it('a boundary splits changes that are close together', () => {
    type('a');
    c.boundary();
    type('b');
    expect(steps()).toBe(2);
  });

  it('boundary on an empty stack is a no-op', () => {
    expect(() => c.boundary()).not.toThrow();
    expect(c.canUndo()).toBe(false);
    expect(c.canRedo()).toBe(false);
  });

  it('beginStep keeps one step open across long pauses until the next boundary', () => {
    c.beginStep();
    type('a');
    wait(UNDO_CAPTURE_TIMEOUT_MS * 10);
    type('b');
    c.boundary();
    type('c');
    expect(steps()).toBe(2);
    expect(text.toString()).toBe('');
  });
});
