// undo.boundaries: typing bursts grouped by UNDO_CAPTURE_TIMEOUT_MS on a fake clock (TC-12, TC-13).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, createSticky, getStickyText, initDoc } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { type UndoController, createUndo } from '../../src/client/board/undo';

let doc: Y.Doc;
let text: Y.Text;
let undo: UndoController;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-29T10:00:00Z'));
  doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 }) as string;
  text = getStickyText(doc, id)!;
  undo = createUndo(doc);
});
afterEach(() => {
  undo.destroy();
  vi.useRealTimers();
});

function type(s: string) {
  doc.transact(() => text.insert(text.length, s), LOCAL_ORIGIN);
}
function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}
function countSteps(): number {
  let n = 0;
  while (undo.undo()) n++;
  return n;
}

describe('undo.boundaries typing', () => {
  it('TC-12 keystrokes 100 ms apart form one step', () => {
    undo.boundary();
    for (const ch of 'hello') {
      type(ch);
      advance(100);
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
    advance(UNDO_CAPTURE_TIMEOUT_MS);
    type('cd');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('ab');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
  });

  it('TC-13 a pause of UNDO_CAPTURE_TIMEOUT_MS − 1 ms stays in the same step', () => {
    undo.boundary();
    type('ab');
    advance(UNDO_CAPTURE_TIMEOUT_MS - 1);
    type('cd');
    expect(countSteps()).toBe(1);
    expect(text.toString()).toBe('');
  });

  it('boundary() splits steps even without a pause, and is a no-op on an empty stack', () => {
    undo.boundary();
    undo.boundary();
    expect(undo.canUndo()).toBe(false);
    type('a');
    undo.boundary();
    type('b');
    expect(countSteps()).toBe(2);
  });
});
