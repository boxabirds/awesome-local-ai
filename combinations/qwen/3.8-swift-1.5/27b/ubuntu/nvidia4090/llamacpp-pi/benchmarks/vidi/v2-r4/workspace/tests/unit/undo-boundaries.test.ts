import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Yjs captures Date.now as a native binding when its module is evaluated, so
// fake timers must be installed before the yjs import for the capture-timeout
// boundary tests below to control the clock Yjs reads.
vi.hoisted(() => {
  vi.useFakeTimers();
});

import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  getStickyText,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';

let undo: UndoController;

// Non-zero start: Yjs treats lastChange === 0 as "no change captured yet"
beforeEach(() => {
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  undo?.destroy();
});

function freshDocWithNote(): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  const ytext = getStickyText(doc, id)!;
  undo = createUndo(doc);
  // Close any capture window from setup so the test starts a fresh step
  undo.boundary();
  return { doc, ytext };
}

// Keystrokes are local mutations: transactions with LOCAL_ORIGIN, like in the app
function type(ytext: Y.Text, doc: Y.Doc, ch: string): void {
  doc.transact(() => {
    ytext.insert(ytext.length, ch);
  }, LOCAL_ORIGIN);
}

describe('undo.boundaries: typing bursts are grouped by the capture timeout', () => {
  // TC-12: keystrokes 100 ms apart between two boundary() calls → one step;
  // undo removes the whole burst
  it('TC-12: typing 100 ms apart is one undo step', () => {
    const { doc, ytext } = freshDocWithNote();

    type(ytext, doc, 'a');
    vi.advanceTimersByTime(100);
    type(ytext, doc, 'b');
    vi.advanceTimersByTime(100);
    type(ytext, doc, 'c');
    undo.boundary();

    expect(ytext.toString()).toBe('abc');
    expect(undo.canUndo()).toBe(true);

    expect(undo.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    // The whole burst was a single step
    expect(undo.canUndo()).toBe(false);
  });

  // TC-13: pause of exactly UNDO_CAPTURE_TIMEOUT_MS → two steps;
  // pause of UNDO_CAPTURE_TIMEOUT_MS − 1 ms → one step
  it('TC-13: pause of exactly UNDO_CAPTURE_TIMEOUT_MS starts a new step', () => {
    const { doc, ytext } = freshDocWithNote();

    type(ytext, doc, 'a');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS);
    type(ytext, doc, 'b');
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(ytext.toString()).toBe('a');
    expect(undo.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13: pause of UNDO_CAPTURE_TIMEOUT_MS − 1 ms stays one step', () => {
    const { doc, ytext } = freshDocWithNote();

    type(ytext, doc, 'a');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS - 1);
    type(ytext, doc, 'b');
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  // Error path: boundary() on an empty stack is a no-op
  it('boundary() on an empty stack is a no-op', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    undo = createUndo(doc);
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
  });
});
