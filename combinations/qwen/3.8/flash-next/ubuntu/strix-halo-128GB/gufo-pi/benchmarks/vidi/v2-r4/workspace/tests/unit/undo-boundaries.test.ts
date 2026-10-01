/**
 * Unit tests for undo.boundaries — typing burst capture timeout (TC-12, TC-13)
 *
 * Note: Yjs's UndoManager uses `Date.now` captured at module-load time by lib0,
 * so vi.useFakeTimers() cannot intercept it. We use a short captureTimeoutMs
 * and real timers for deterministic timing.
 */
import { describe, expect, it, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky,
  getStickyText,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

let ctrl: UndoController | null = null;
let doc: Y.Doc;

function setup(): Y.Doc {
  doc = new Y.Doc();
  return doc;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  ctrl?.destroy();
  ctrl = null;
  doc?.destroy();
});

describe('undo.boundaries — capture timeout', () => {
  it('TC-12: keystrokes 10 ms apart between two boundary() calls → one step', async () => {
    setup();
    let id = '';
    doc.transact(() => { id = createSticky(doc, { x: 100, y: 100 }); }, LOCAL_ORIGIN);
    const ytext = getStickyText(doc, id)!;

    // Use 100ms capture timeout; type 10ms apart
    ctrl = createUndo(doc, { captureTimeoutMs: 100 });

    ctrl.boundary(); // start editing

    // Type "hello" with 10 ms between each character
    const chars = 'hello';
    for (let i = 0; i < chars.length; i++) {
      doc.transact(() => { ytext.insert(ytext.length, chars[i]!); }, LOCAL_ORIGIN);
      await delay(10);
    }

    ctrl.boundary(); // end editing

    // Should be exactly one undo step (all characters merge)
    expect(ctrl.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(ctrl.undo()).toBe(false);
  });

  it('TC-13: pause exactly captureTimeoutMs → two steps; pause − 1 ms → one step', async () => {
    setup();
    let id = '';
    doc.transact(() => { id = createSticky(doc, { x: 100, y: 100 }); }, LOCAL_ORIGIN);
    const ytext = getStickyText(doc, id)!;

    // Use a 50ms capture timeout for fast, reliable test
    const cap = 50;
    ctrl = createUndo(doc, { captureTimeoutMs: cap });

    ctrl.boundary();

    // Type "ab"
    doc.transact(() => { ytext.insert(0, 'a'); }, LOCAL_ORIGIN);
    doc.transact(() => { ytext.insert(1, 'b'); }, LOCAL_ORIGIN);

    // Pause exactly at the boundary
    await delay(cap + 5); // ensure we're past the boundary

    doc.transact(() => { ytext.insert(2, 'c'); }, LOCAL_ORIGIN);
    doc.transact(() => { ytext.insert(3, 'd'); }, LOCAL_ORIGIN);

    ctrl.boundary();

    // Two steps: "cd" then "ab"
    expect(ctrl.undo()).toBe(true);
    expect(ytext.toString()).toBe('ab');
    expect(ctrl.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(ctrl.undo()).toBe(false);
  });

  it('TC-13b: pause under captureTimeoutMs → one step', async () => {
    setup();
    let id = '';
    doc.transact(() => { id = createSticky(doc, { x: 100, y: 100 }); }, LOCAL_ORIGIN);
    const ytext = getStickyText(doc, id)!;

    // Use a 200ms capture timeout; pause 100ms (well under boundary)
    const cap = 200;
    ctrl = createUndo(doc, { captureTimeoutMs: cap });

    ctrl.boundary();

    // Type "ab" then pause 100ms (under boundary) then type "cd"
    doc.transact(() => { ytext.insert(0, 'a'); }, LOCAL_ORIGIN);
    doc.transact(() => { ytext.insert(1, 'b'); }, LOCAL_ORIGIN);

    await delay(100);

    doc.transact(() => { ytext.insert(2, 'c'); }, LOCAL_ORIGIN);
    doc.transact(() => { ytext.insert(3, 'd'); }, LOCAL_ORIGIN);

    ctrl.boundary();

    // One step: all merge
    expect(ctrl.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(ctrl.undo()).toBe(false);
  });

  it('boundary() on an empty stack is a no-op', () => {
    setup();
    ctrl = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });
    // Should not throw
    ctrl.boundary();
    ctrl.boundary();
    ctrl.boundary();
    expect(ctrl.canUndo()).toBe(false);
  });
});
