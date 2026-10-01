import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

function setup() {
  const doc = new Y.Doc();
  const text = new Y.Text();
  doc.getMap('objects').set('t', text);
  const undo = createUndo(doc);
  undo.boundary();
  const type = (s: string) => doc.transact(() => text.insert(text.length, s), LOCAL_ORIGIN);
  return { text, undo, type };
}

describe('typing bursts', () => {
  it('TC-12 keystrokes 100 ms apart form one step', () => {
    const { text, undo, type } = setup();
    for (const c of 'hello') {
      type(c);
      vi.advanceTimersByTime(100);
    }
    undo.boundary();
    expect(text.toString()).toBe('hello');
    undo.undo();
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13 a pause of exactly UNDO_CAPTURE_TIMEOUT_MS starts a new step', () => {
    const { text, undo, type } = setup();
    type('a');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS);
    type('b');
    undo.undo();
    expect(text.toString()).toBe('a');
    undo.undo();
    expect(text.toString()).toBe('');
  });

  it('TC-13 a pause of UNDO_CAPTURE_TIMEOUT_MS − 1 ms stays one step', () => {
    const { text, undo, type } = setup();
    type('a');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS - 1);
    type('b');
    undo.undo();
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('boundary on an empty stack is a no-op', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
  });
});
