import { beforeEach, describe, expect, it, vi } from 'vitest';

// lib0 keeps a reference to Date.now from import time, so the fake clock must exist before Yjs loads.
vi.useFakeTimers();
const Y = await import('yjs');
const { createUndo } = await import('../../src/client/board/undo');
const { LOCAL_ORIGIN } = await import('../../src/shared/board-model');
const { UNDO_CAPTURE_TIMEOUT_MS } = await import('../../src/shared/config');

function setup() {
  const doc = new Y.Doc();
  const text = doc.getText('t');
  const type = (s: string) => doc.transact(() => text.insert(text.length, s), LOCAL_ORIGIN);
  const undo = createUndo(doc);
  undo.addScope(text as never);
  return { text, type, undo };
}

describe('undo.boundaries (typing bursts)', () => {
  beforeEach(() => { vi.setSystemTime(1_000_000); });

  it('TC-12 keystrokes 100 ms apart are one step', () => {
    const { text, type, undo } = setup();
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

  it('TC-13 a pause of exactly UNDO_CAPTURE_TIMEOUT_MS starts a new step', () => {
    const { text, type, undo } = setup();
    type('a');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS);
    type('b');
    undo.undo();
    expect(text.toString()).toBe('a');
    undo.undo();
    expect(text.toString()).toBe('');
  });

  it('TC-13 a pause one millisecond shorter stays one step', () => {
    const { text, type, undo } = setup();
    type('a');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS - 1);
    type('b');
    undo.undo();
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('boundary on an empty stack is a no-op', () => {
    const { undo } = setup();
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
  });
});
