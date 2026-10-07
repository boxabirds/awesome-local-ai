// Story 8, undo.boundaries unit tests (TC-12, TC-13): typing-burst grouping
// via the Yjs capture timeout, driven with fake system time. The Yjs
// UndoManager merges transactions that are less than `captureTimeout`
// apart (measured with Date.now()), so a burst of inserts between two
// boundary() calls is exactly one undo step.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  initDoc,
  createSticky,
  getStickyText,
  snapshot,
} from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

// The Yjs UndoManager measures the capture gap with lib0/time's
// getUnixTime, which captured Date.now at import time (so vi's fake timers
// cannot reach it). Mock the module with a controllable clock instead.
const clock = vi.hoisted(() => ({ now: 0 }));
vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lib0/time')>();
  return { ...actual, getUnixTime: () => clock.now };
});

const T0 = 1_700_000_000_000; // arbitrary fixed epoch ms

// The editor writes Y.Text through applyTextDiff with LOCAL_ORIGIN; these
// tests mimic that write path (a raw insert with origin null would not be
// captured at all).
function insertAtEnd(doc: Y.Doc, text: Y.Text, s: string): void {
  doc.transact(() => {
    text.insert(text.length, s);
  }, LOCAL_ORIGIN);
}

describe('undo.boundaries (story 8)', () => {
  let doc: Y.Doc;
  let undo: UndoController;

  beforeEach(() => {
    clock.now = T0;
    doc = new Y.Doc();
    initDoc(doc);
    undo = createUndo(doc);
  });
  afterEach(() => {
    undo.destroy();
    doc.destroy();
  });

  const at = (offsetMs: number): void => {
    clock.now = T0 + offsetMs;
  };

  // TC-12: inserts 100 ms apart between two boundary() calls are one step;
  // one undo removes the whole burst.
  it('TC-12: a 100 ms typing burst between boundaries is a single undo step', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(id).not.toBeNull();
    undo.boundary();
    const text = getStickyText(doc, id!);
    expect(text).toBeDefined();

    insertAtEnd(doc, text!, 'a');
    at(100);
    insertAtEnd(doc, text!, 'b');
    at(200);
    insertAtEnd(doc, text!, 'c');
    undo.boundary();

    expect(text!.toString()).toBe('abc');

    // One undo removes the entire burst …
    expect(undo.undo()).toBe(true);
    expect(text!.toString()).toBe('');
    // … and exactly the one earlier step (the creation) remains.
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc).length).toBe(0);
    expect(undo.canUndo()).toBe(false);
  });

  // TC-13 (boundary value): inserts exactly UNDO_CAPTURE_TIMEOUT_MS apart
  // form two steps; one millisecond less apart merge into one.
  it('TC-13a: inserts exactly UNDO_CAPTURE_TIMEOUT_MS apart are two steps', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(id).not.toBeNull();
    undo.boundary();
    const text = getStickyText(doc, id!);
    insertAtEnd(doc, text!, 'a');
    at(UNDO_CAPTURE_TIMEOUT_MS);
    insertAtEnd(doc, text!, 'b');
    undo.boundary();

    // First undo removes only the second insert …
    expect(undo.undo()).toBe(true);
    expect(text!.toString()).toBe('a');
    // … the second removes the first (two separate steps).
    expect(undo.undo()).toBe(true);
    expect(text!.toString()).toBe('');
    expect(undo.undo()).toBe(true); // the creation
    expect(snapshot(doc).length).toBe(0);
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13b: inserts UNDO_CAPTURE_TIMEOUT_MS − 1 ms apart merge into one step', () => {
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(id).not.toBeNull();
    undo.boundary();
    const text = getStickyText(doc, id!);
    insertAtEnd(doc, text!, 'a');
    at(UNDO_CAPTURE_TIMEOUT_MS - 1);
    insertAtEnd(doc, text!, 'b');
    undo.boundary();

    // One undo removes both inserts …
    expect(undo.undo()).toBe(true);
    expect(text!.toString()).toBe('');
    // … and only the creation step remains.
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc).length).toBe(0);
    expect(undo.canUndo()).toBe(false);
  });

  // Error path: boundary() with an empty stack is a harmless no-op.
  it('boundary() on an empty stack is a no-op', () => {
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    // …and it does not prevent normal capture afterwards.
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(id).not.toBeNull();
    expect(undo.canUndo()).toBe(true);
  });
});
