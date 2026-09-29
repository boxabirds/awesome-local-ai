import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  getStickyText,
  LOCAL_ORIGIN,
} from '@/shared/board-model';
import { createUndo } from '@/client/board/undo';
import { UNDO_CAPTURE_TIMEOUT_MS } from '@/shared/config';
import { createPeer } from './peer';

/**
 * Story 8: merge boundaries (undo.boundary).
 *
 * These exercise the capture-timeout merge logic through real typing bursts on
 * a `Y.Text`. The {@link Y.UndoManager} reads the wall clock through
 * `Date.now()` (`lib0/time` captures it at import time as a read-only module
 * export, so it cannot be faked from the test). The tests therefore rely on
 * real timing with a comfortable margin on each side of `UNDO_CAPTURE_TIMEOUT_MS`:
 *   - a burst of inserts issued back-to-back / close together merges into one
 *     step (TC-12, and the "< timeout" side of TC-13);
 *   - two inserts separated by a real pause longer than the timeout become two
 *     steps (the ">= timeout" side of TC-13).
 *
 * NOTE (spec deviation): the spec asks for the exact boundary values (exactly
 * UNDO_CAPTURE_TIMEOUT_MS -> two steps, UNDO_CAPTURE_TIMEOUT_MS - 1 -> one step)
 * with fake system time. That is not achievable because Yjs captures
 * `Date.now` at import time (read-only). The behaviour on both sides of the
 * threshold is verified here with real time instead.
 */

/** Resolves after `ms` real milliseconds (guaranteed >= ms). */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Appends one char to the note text as a tracked (LOCAL_ORIGIN) transaction. */
function type(doc: Y.Doc, text: Y.Text, ch: string): void {
  doc.transact(() => {
    text.insert(text.length, ch);
  }, LOCAL_ORIGIN);
}

describe('capture-timeout merge boundaries (undo.boundary)', () => {
  it('TC-12: a typing burst between two boundary() calls is exactly one undo step', async () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);
    const peer = createPeer();
    const id = createSticky(peer.doc, { x: 0, y: 0 });
    peer.pushTo(doc);
    const text = getStickyText(doc, id)!;

    // A typing burst: inserts close in time, bracketed by boundary() calls.
    c.boundary();
    type(doc, text, 'h');
    await wait(100);
    type(doc, text, 'e');
    await wait(100);
    type(doc, text, 'y');
    c.boundary();
    expect(text.toString()).toBe('hey');

    // Exactly one step: a single undo removes the whole burst.
    expect(c.canUndo()).toBe(true);
    expect(c.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(c.canUndo()).toBe(false);
  });

  it('TC-13: the capture timeout is the merge boundary (< -> one step, >= -> two steps)', async () => {
    // Below the timeout: the two inserts merge into a single step.
    {
      const doc = new Y.Doc();
      initDoc(doc);
      const c = createUndo(doc);
      const peer = createPeer();
      const id = createSticky(peer.doc, { x: 0, y: 0 });
      peer.pushTo(doc);
      const text = getStickyText(doc, id)!;

      type(doc, text, 'a');
      // Back-to-back: comfortably below UNDO_CAPTURE_TIMEOUT_MS.
      type(doc, text, 'b');
      expect(text.toString()).toBe('ab');

      // One step: one undo removes both inserts.
      expect(c.undo()).toBe(true);
      expect(text.toString()).toBe('');
      expect(c.canUndo()).toBe(false);
    }

    // At/above the timeout: the two inserts are two separate steps.
    {
      const doc = new Y.Doc();
      initDoc(doc);
      const c = createUndo(doc);
      const peer = createPeer();
      const id = createSticky(peer.doc, { x: 0, y: 0 });
      peer.pushTo(doc);
      const text = getStickyText(doc, id)!;

      type(doc, text, 'a');
      // A real pause longer than the capture timeout.
      await wait(UNDO_CAPTURE_TIMEOUT_MS + 80);
      type(doc, text, 'b');
      expect(text.toString()).toBe('ab');

      // Two steps: each insert is undone separately.
      expect(c.undo()).toBe(true);
      expect(text.toString()).toBe('a');
      expect(c.undo()).toBe(true);
      expect(text.toString()).toBe('');
      expect(c.canUndo()).toBe(false);
    }
  });

  it('TC-13 (error path): boundary() on an empty stack is a no-op', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const c = createUndo(doc);

    expect(() => c.boundary()).not.toThrow();
    expect(c.canUndo()).toBe(false);
    expect(c.canRedo()).toBe(false);
    // A change after the no-op boundary still records a normal single step.
    const peer = createPeer();
    const id = createSticky(peer.doc, { x: 0, y: 0 });
    peer.pushTo(doc);
    const text = getStickyText(doc, id)!;
    type(doc, text, 'x');
    expect(c.canUndo()).toBe(true);
    expect(c.undo()).toBe(true);
    expect(text.toString()).toBe('');
  });
});
