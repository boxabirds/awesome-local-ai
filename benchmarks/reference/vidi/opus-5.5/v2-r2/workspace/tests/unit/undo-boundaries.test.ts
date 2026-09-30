import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { type UndoController, createUndo } from '../../src/client/board/undo';
import { LOCAL_ORIGIN, createSticky, getStickyText, initDoc } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

let doc: Y.Doc;
let undo: UndoController;
let text: Y.Text;

function type(s: string) {
  doc.transact(() => text.insert(text.length, s), LOCAL_ORIGIN);
}

function steps(): number {
  let n = 0;
  while (undo.undo()) n++;
  return n;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  if (id === false) throw new Error('create rejected');
  text = getStickyText(doc, id)!;
  undo = createUndo(doc);
});

afterEach(() => {
  undo.destroy();
  vi.useRealTimers();
});

describe('undo.boundaries: typing bursts', () => {
  it('TC-12 keystrokes 100 ms apart between two boundaries are one step', () => {
    undo.boundary();
    for (const ch of 'hello') {
      type(ch);
      vi.advanceTimersByTime(100);
    }
    undo.boundary();
    expect(text.toString()).toBe('hello');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13 a pause of exactly UNDO_CAPTURE_TIMEOUT_MS starts a new step', () => {
    undo.boundary();
    type('one');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS);
    type(' two');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('one');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
  });

  it('TC-13 a pause of UNDO_CAPTURE_TIMEOUT_MS − 1 ms merges into one step', () => {
    undo.boundary();
    type('one');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS - 1);
    type(' two');
    expect(steps()).toBe(1);
    expect(text.toString()).toBe('');
  });

  it('boundary splits changes made within the capture window', () => {
    type('a');
    undo.boundary();
    type('b');
    expect(steps()).toBe(2);
  });

  it('boundary on an empty history is a no-op', () => {
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
  });
});
