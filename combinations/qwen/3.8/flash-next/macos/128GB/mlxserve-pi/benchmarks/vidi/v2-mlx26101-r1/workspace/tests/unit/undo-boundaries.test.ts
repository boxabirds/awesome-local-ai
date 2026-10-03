// undo.boundaries — typing-burst grouping by the capture timeout (unit).
//
// Yjs merges consecutive captured transactions into one undo step while they fall
// within `captureTimeout` of each other; a pause of that length or longer starts a
// new step. That single rule is the whole of undo.typing: a burst typed without a
// pause is one step, and Ctrl/Cmd+Z inside the note undoes the most recent typing
// step (not the note's earlier move). The boundary values that matter are exactly
// UNDO_CAPTURE_TIMEOUT_MS (new step) and UNDO_CAPTURE_TIMEOUT_MS − 1 (still merged).
//
// The capture timeout uses `lib0/time.getUnixTime`, which snapshots `Date.now` when
// the module is first imported. To move time deterministically we install the fake
// clock BEFORE importing anything that pulls in yjs, so the manager reads a clock
// we advance by hand rather than the wall clock. `vitest`'s `vi` does not import
// yjs, so it is safe to import statically; everything yjs-dependent is loaded with
// a dynamic import below, after `useFakeTimers()`.

import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
// Type-only import: erased at compile time, so it does NOT pull in yjs at runtime
// and does not let lib0/time snapshot the un-faked `Date.now`.
import type { Doc as YDoc, Map as YMap, Text as YText } from 'yjs';

vi.useFakeTimers(); // must run before yjs / lib0/time is first imported
const Y = await import('yjs');
const { UNDO_CAPTURE_TIMEOUT_MS } = await import('../../src/shared/config');
const { createUndo } = await import('../../src/client/board/undo');
const { LOCAL_ORIGIN, createSticky, moveObject, snapshot, initDoc } =
  await import('../../src/shared/board-model');

beforeAll(() => {
  vi.setSystemTime(1_700_000_000_000);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  vi.setSystemTime(1_700_000_000_000); // only elapsed gaps matter
});

/** A doc with one note and its live Y.Text, plus a fresh controller. */
function typingFixture(captureTimeoutMs?: number) {
  const doc: YDoc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 300, y: 300 });
  const ytext = doc
    .getMap<YMap<unknown>>('objects')
    .get(id)!
    .get('text') as YText;
  const um = captureTimeoutMs
    ? createUndo(doc, { captureTimeoutMs })
    : createUndo(doc);
  /** Type one character (one LOCAL_ORIGIN transaction). */
  const key = (ch: string): void => {
    doc.transact(() => ytext.insert(ytext.length, ch), LOCAL_ORIGIN);
  };
  const advance = (ms: number): void => {
    vi.advanceTimersByTime(ms);
  };
  return { doc, id, ytext, um, key, advance };
}

describe('undo.boundaries — typing bursts (unit)', () => {
  // TC-12: keystrokes 100 ms apart between two boundary() calls are ONE step; a
  // single undo removes the whole burst but leaves an earlier move alone.
  it('TC-12 merges a burst typed 100 ms apart into one undo step', () => {
    const { doc, id, ytext, um, key, advance } = typingFixture();
    const createdX = snapshot(doc).find((s) => s.id === id)!.x;

    // An earlier move (its own step).
    moveObject(doc, id, createdX + 100, createdX + 100);
    um.boundary();

    // The typing burst: five keystrokes 100 ms apart, all inside one window.
    um.boundary();
    for (const ch of 'hello') {
      key(ch);
      advance(100);
    }
    expect(ytext.toString()).toBe('hello');

    // One undo reverses the WHOLE burst ...
    expect(um.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    // ... the earlier move is untouched (it is the only step left).
    expect(snapshot(doc).find((s) => s.id === id)!.x).toBe(createdX + 100);
    expect(um.canUndo()).toBe(true);
    um.undo();
    expect(snapshot(doc).find((s) => s.id === id)!.x).toBe(createdX); // back to create x
  });

  // TC-13: a pause of exactly UNDO_CAPTURE_TIMEOUT_MS starts a new step; a pause of
  // UNDO_CAPTURE_TIMEOUT_MS − 1 ms keeps it merged.
  it('TC-13 splits at the exact capture timeout and merges one ms below', () => {
    const T = UNDO_CAPTURE_TIMEOUT_MS;

    // Exactly the timeout between the two inserts → two steps.
    {
      const { ytext, um, key, advance } = typingFixture();
      key('a');
      advance(T); // gap === captureTimeout → NOT merged
      key('b');
      expect(ytext.toString()).toBe('ab');
      expect(um.undo()).toBe(true);
      expect(ytext.toString()).toBe('a'); // only 'b' removed: two separate steps
    }

    // One millisecond below the timeout → merged into a single step.
    {
      const { ytext, um, key, advance } = typingFixture();
      key('a');
      advance(T - 1); // gap === captureTimeout - 1 → merged
      key('b');
      expect(ytext.toString()).toBe('ab');
      expect(um.undo()).toBe(true);
      expect(ytext.toString()).toBe(''); // the whole pair removed as one step
    }
  });

  // Error path: boundary() on an empty history is a harmless no-op.
  it('boundary() on an empty stack is a no-op and never throws', () => {
    const doc: YDoc = new Y.Doc();
    initDoc(doc);
    const um = createUndo(doc);
    expect(() => um.boundary()).not.toThrow();
    expect(um.canUndo()).toBe(false);
    expect(um.undo()).toBe(false);
    um.destroy();
  });
});
