import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, getStickyText, initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';

const START = new Date('2026-09-30T10:00:00Z');

let doc: Y.Doc;
let text: Y.Text;
let undo: UndoController;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
  doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  text = getStickyText(doc, id)!;
  undo = createUndo(doc);
});

afterEach(() => {
  undo.destroy();
  vi.useRealTimers();
});

function type(chars: string) {
  doc.transact(() => text.insert(text.length, chars), LOCAL_ORIGIN);
}

function wait(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

function countSteps(): number {
  let n = 0;
  while (undo.undo()) n++;
  return n;
}

describe('undo.boundaries — typing bursts', () => {
  it('TC-12 keystrokes 100 ms apart are one step, undone as a whole', () => {
    undo.boundary();
    for (const ch of 'hello') {
      type(ch);
      wait(100);
    }
    undo.boundary();
    expect(text.toString()).toBe('hello');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13 a pause of exactly UNDO_CAPTURE_TIMEOUT_MS starts a new step', () => {
    undo.boundary();
    type('ab');
    wait(UNDO_CAPTURE_TIMEOUT_MS);
    type('cd');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('ab');
    expect(countSteps()).toBe(1);
    expect(text.toString()).toBe('');
  });

  it('TC-13 a pause of UNDO_CAPTURE_TIMEOUT_MS − 1 ms stays in the same step', () => {
    undo.boundary();
    type('ab');
    wait(UNDO_CAPTURE_TIMEOUT_MS - 1);
    type('cd');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('boundary() splits steps even without a pause', () => {
    type('ab');
    undo.boundary();
    type('cd');
    undo.undo();
    expect(text.toString()).toBe('ab');
  });

  it('boundary() on an empty stack is a no-op', () => {
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
  });
});
