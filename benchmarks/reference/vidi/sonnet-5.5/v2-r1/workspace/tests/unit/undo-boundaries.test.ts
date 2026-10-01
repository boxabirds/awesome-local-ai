import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import { LOCAL_ORIGIN, createSticky, getStickyText, initDoc } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

function setup() {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 }) as string;
  const undo = createUndo(doc);
  const text = getStickyText(doc, id)!;
  const type = (s: string) => doc.transact(() => text.insert(text.length, s), LOCAL_ORIGIN);
  return { doc, undo, text, type };
}

describe('undo.boundaries typing bursts', () => {
  it('TC-12 keystrokes 100 ms apart are one step', () => {
    const { undo, text, type } = setup();
    undo.boundary();
    for (const ch of 'hello') {
      type(ch);
      vi.advanceTimersByTime(100);
    }
    undo.boundary();
    expect(text.toString()).toBe('hello');
    undo.undo();
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13 a pause of exactly the timeout splits steps; one ms less merges', () => {
    const split = setup();
    split.undo.boundary();
    split.type('a');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS);
    split.type('b');
    split.undo.undo();
    expect(split.text.toString()).toBe('a');
    expect(split.undo.canUndo()).toBe(true);

    const merged = setup();
    merged.undo.boundary();
    merged.type('a');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS - 1);
    merged.type('b');
    merged.undo.undo();
    expect(merged.text.toString()).toBe('');
    expect(merged.undo.canUndo()).toBe(false);
  });

  it('boundary on an empty stack is a no-op', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
  });
});
