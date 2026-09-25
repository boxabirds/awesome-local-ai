import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// lib0 (used by Y.UndoManager) binds `Date.now` when it is first imported, so the fake
// clock must be installed before the imports below and kept for the whole file.
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
import * as Y from 'yjs';
import { createSticky, getStickyText, LOCAL_ORIGIN, moveObject } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';

describe('capture timeout (undo.boundaries)', () => {
  let doc: Y.Doc;
  let undo: UndoController;
  let text: Y.Text;
  let now: number;

  function type(s: string): void {
    doc.transact(() => text.insert(text.length, s), LOCAL_ORIGIN);
  }
  function wait(ms: number): void {
    now += ms;
    vi.setSystemTime(now);
  }

  beforeEach(() => {
    now = new Date('2026-01-01T00:00:00Z').getTime();
    vi.setSystemTime(now);
    doc = new Y.Doc();
    undo = createUndo(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    text = getStickyText(doc, id)!;
    undo.boundary();
    wait(1000);
  });
  afterEach(() => {
    undo.destroy();
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('TC-12 keystrokes 100 ms apart are one step', () => {
    undo.boundary();
    for (const ch of 'hello') {
      type(ch);
      wait(100);
    }
    undo.boundary();
    expect(undo.undoSize()).toBe(2); // creation + typing
    undo.undo();
    expect(text.toString()).toBe('');
    expect(undo.undoSize()).toBe(1);
  });

  it('TC-13 a pause of exactly UNDO_CAPTURE_TIMEOUT_MS starts a new step', () => {
    type('a');
    wait(UNDO_CAPTURE_TIMEOUT_MS);
    type('b');
    expect(undo.undoSize()).toBe(3);
    undo.undo();
    expect(text.toString()).toBe('a');
  });

  it('TC-13 a pause of UNDO_CAPTURE_TIMEOUT_MS − 1 ms stays in the same step', () => {
    type('a');
    wait(UNDO_CAPTURE_TIMEOUT_MS - 1);
    type('b');
    expect(undo.undoSize()).toBe(2);
    undo.undo();
    expect(text.toString()).toBe('');
  });

  it('boundary() splits steps without a pause; on an empty stack it is a no-op', () => {
    type('a');
    undo.boundary();
    type('b');
    expect(undo.undoSize()).toBe(3);

    const empty = createUndo(new Y.Doc());
    expect(() => empty.boundary()).not.toThrow();
    expect(empty.canUndo()).toBe(false);
    empty.destroy();
  });

  it('startGroup keeps one step open across long pauses until boundary()', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.startGroup();
    moveObject(doc, id, 10, 10);
    wait(UNDO_CAPTURE_TIMEOUT_MS * 4);
    moveObject(doc, id, 20, 20);
    undo.boundary();
    wait(10);
    moveObject(doc, id, 30, 30);
    expect(undo.undoSize()).toBe(4);
  });

  it('undoIn only undoes a step that changed nothing but the given text', () => {
    type('abc');
    undo.boundary();
    expect(undo.undoIn(text)).toBe(true);
    expect(text.toString()).toBe('');
    // The top step is now the creation: not typing in this text.
    expect(undo.undoIn(text)).toBe(false);
    expect(undo.canUndo()).toBe(true);
    expect(undo.redoIn(text)).toBe(true);
    expect(text.toString()).toBe('abc');
  });
});
