import { describe, expect, it, vi } from 'vitest';
import { createUndo } from '../../src/client/board/undo';
import { createSticky, getStickyText, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { newBoardDoc } from './helpers/peer';

// lib0 (Yjs) captures Date.now when it is first imported, so the fake clock must exist before the imports run.
vi.hoisted(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

function noteWithController() {
  const doc = newBoardDoc();
  const undo = createUndo(doc);
  const id = createSticky(doc, { x: 0, y: 0 }) as string;
  undo.boundary();
  const text = getStickyText(doc, id)!;
  const put = (s: string) => doc.transact(() => text.insert(text.length, s), LOCAL_ORIGIN);
  return { undo, text, put };
}

describe('undo capture timeout', () => {
  it('TC-12 keystrokes 100 ms apart form one step', () => {
    const { undo, text, put } = noteWithController();
    for (const ch of 'hello') { put(ch); vi.advanceTimersByTime(100); }
    undo.boundary();
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.undo()).toBe(true); // the next step is the creation, not more typing
  });

  it('TC-13 a pause of exactly the timeout starts a new step; one millisecond less does not', () => {
    const a = noteWithController();
    a.put('a'); vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS); a.put('b');
    a.undo.undo();
    expect(a.text.toString()).toBe('a');

    const b = noteWithController();
    b.put('a'); vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS - 1); b.put('b');
    b.undo.undo();
    expect(b.text.toString()).toBe('');
  });

  it('boundary on an empty stack is a no-op', () => {
    const undo = createUndo(newBoardDoc());
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
  });
});
