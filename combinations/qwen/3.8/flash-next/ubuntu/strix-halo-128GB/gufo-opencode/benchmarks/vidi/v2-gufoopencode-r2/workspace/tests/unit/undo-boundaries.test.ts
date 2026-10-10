// Task 7 (story 8): capture-timeout unit tests (TC-12, TC-13) for
// undo.boundaries typing-burst grouping, driven by fake system time so the
// UNDO_CAPTURE_TIMEOUT_MS boundary is exercised exactly.
//
// lib0 captures `Date.now` at module load (`export const getUnixTime =
// Date.now`), so a later vi.useFakeTimers() would not reach yjs. The unit
// project inlines yjs/lib0 (vitest.config.ts) and this mock re-exports
// lib0/time with a live `Date.now`, letting the fake clock rule the manager.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  getStickyText,
  initDoc,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';

vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getUnixTime: () => Date.now() };
});

// Non-zero base: the UndoManager treats lastChange === 0 as "no change yet".
const T0 = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(): { undo: UndoController; text: Y.Text; type(ch: string): void } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 100, y: 100 }) as string;
  const text = getStickyText(doc, id);
  if (!text) throw new Error('no text');
  const undo = createUndo(doc);
  return {
    undo,
    text,
    type: (ch: string) => {
      doc.transact(() => text.insert(text.length, ch), LOCAL_ORIGIN);
    },
  };
}

// TC-12: a burst between two boundary() calls is one undo step.
describe('TC-12 (undo.boundaries typing burst)', () => {
  it('inserts 100 ms apart merge into exactly one step', () => {
    const { undo, text, type } = setup();
    undo.boundary();
    for (const ch of 'abc') {
      type(ch);
      vi.setSystemTime(Date.now() + 100);
    }
    undo.boundary();

    expect(text.toString()).toBe('abc');
    expect(undo.undo()).toBe(true); // the whole burst disappears
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false); // exactly one step existed
  });
});

// TC-13: boundary values of the capture window.
describe('TC-13 (undo.boundaries capture timeout)', () => {
  it('a pause of exactly UNDO_CAPTURE_TIMEOUT_MS starts a second step', () => {
    const { undo, text, type } = setup();
    type('a');
    vi.setSystemTime(T0 + UNDO_CAPTURE_TIMEOUT_MS); // exactly the limit
    type('b');

    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('a'); // only the second insert reverted
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false); // two steps in total
  });

  it('a pause of UNDO_CAPTURE_TIMEOUT_MS − 1 ms stays one step', () => {
    const { undo, text, type } = setup();
    type('a');
    vi.setSystemTime(T0 + UNDO_CAPTURE_TIMEOUT_MS - 1); // one ms below
    type('b');

    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe(''); // both inserts merged and reverted
    expect(undo.canUndo()).toBe(false); // one step in total
  });
});

// Error path: boundary() with an empty stack is a no-op.
describe('undo.boundaries error path', () => {
  it('boundary() on an empty stack changes nothing and still captures after', () => {
    const { undo, text, type } = setup();
    expect(() => undo.boundary()).not.toThrow();
    type('a');
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
  });
});
