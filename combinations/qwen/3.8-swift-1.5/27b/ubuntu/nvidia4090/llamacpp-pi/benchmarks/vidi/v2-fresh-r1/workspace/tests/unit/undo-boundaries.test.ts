// Unit tests for undo.boundaries: capture-timeout grouping of typing bursts.
// TC-12, TC-13.
//
// Yjs's UndoManager uses `time.getUnixTime()` from lib0, which is a direct
// reference to `Date.now` captured at module load time. We patch `Date.now`
// via vi.hoisted (runs before all imports) and use dynamic imports for the
// modules that depend on it.

import { describe, expect, it, vi } from 'vitest';

const { setTime } = vi.hoisted(() => {
  let _t = 1000;
  Date.now = () => _t;
  return { setTime: (t: number) => { _t = t; } };
});

const Y = await import('yjs');
const { LOCAL_ORIGIN, initDoc } = await import('../../src/shared/board-model');
const { UNDO_CAPTURE_TIMEOUT_MS } = await import('../../src/shared/config');
const { createUndo } = await import('../../src/client/board/undo');

type Doc = InstanceType<typeof Y.Doc>;

function makeDoc(): Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('undo.boundaries (capture timeout)', () => {
  // TC-12: keystrokes 100 ms apart → one step.
  it('TC-12 keystrokes within capture timeout merge into one step', () => {
    setTime(1000);
    const doc = makeDoc();
    const ctrl = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    const text = new Y.Text();
    const objects = doc.getMap('objects');
    const id = crypto.randomUUID();
    doc.transact(() => {
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', 100);
      note.set('y', 100);
      note.set('color', 'yellow');
      note.set('text', text);
      note.set('z', 1);
      note.set('createdAt', Date.now());
      objects.set(id, note);
    }, LOCAL_ORIGIN);
    ctrl.boundary(); // Close the creation step.

    // Simulate typing: 3 inserts 100 ms apart (all within 500ms).
    setTime(1000);
    doc.transact(() => { text.insert(0, 'a'); }, LOCAL_ORIGIN);
    setTime(1100);
    doc.transact(() => { text.insert(1, 'b'); }, LOCAL_ORIGIN);
    setTime(1200);
    doc.transact(() => { text.insert(2, 'c'); }, LOCAL_ORIGIN);

    // Close the typing step.
    ctrl.boundary();

    // One undo should remove the entire burst.
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(text.toString()).toBe('');

    // The next undo should be the creation step.
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(objects.has(id)).toBe(false);

    ctrl.destroy();
  });

  // TC-13a: pause exactly UNDO_CAPTURE_TIMEOUT_MS → two steps.
  // Yjs merges when (now - lastChange) < captureTimeout.
  // At exactly captureTimeout: 500 < 500 is false → new step.
  it('TC-13a pause exactly at capture timeout produces two steps', () => {
    setTime(1000);
    const doc = makeDoc();
    const ctrl = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    const text = new Y.Text();
    const objects = doc.getMap('objects');
    const id = crypto.randomUUID();
    doc.transact(() => {
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', 100);
      note.set('y', 100);
      note.set('color', 'yellow');
      note.set('text', text);
      note.set('z', 1);
      note.set('createdAt', Date.now());
      objects.set(id, note);
    }, LOCAL_ORIGIN);
    ctrl.boundary(); // Close the creation step.

    // First insert at t=1000.
    setTime(1000);
    doc.transact(() => { text.insert(0, 'a'); }, LOCAL_ORIGIN);
    // Advance exactly to t=1500 (1000 + 500 = captureTimeout).
    // The check: 500 < 500 is false → new step.
    setTime(1000 + UNDO_CAPTURE_TIMEOUT_MS);
    doc.transact(() => { text.insert(1, 'b'); }, LOCAL_ORIGIN);
    ctrl.boundary();

    // Two undos needed to clear all text.
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo(); // Removes 'b' (the second step)
    expect(text.toString()).toBe('a');
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo(); // Removes 'a' (the first step)
    expect(text.toString()).toBe('');

    ctrl.destroy();
  });

  // TC-13b: pause UNDO_CAPTURE_TIMEOUT_MS - 1 ms → one step.
  it('TC-13b pause just under capture timeout produces one step', () => {
    setTime(1000);
    const doc = makeDoc();
    const ctrl = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    const text = new Y.Text();
    const objects = doc.getMap('objects');
    const id = crypto.randomUUID();
    doc.transact(() => {
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', 100);
      note.set('y', 100);
      note.set('color', 'yellow');
      note.set('text', text);
      note.set('z', 1);
      note.set('createdAt', Date.now());
      objects.set(id, note);
    }, LOCAL_ORIGIN);
    ctrl.boundary(); // Close the creation step.

    // First insert at t=1000.
    setTime(1000);
    doc.transact(() => { text.insert(0, 'a'); }, LOCAL_ORIGIN);
    // Advance to t=1499 (1000 + 499 = captureTimeout - 1).
    // The check: 499 < 500 is true → merge into same step.
    setTime(1000 + UNDO_CAPTURE_TIMEOUT_MS - 1);
    doc.transact(() => { text.insert(1, 'b'); }, LOCAL_ORIGIN);
    ctrl.boundary();

    // One undo removes both.
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(text.toString()).toBe('');

    ctrl.destroy();
  });

  // boundary() on an empty stack is a no-op.
  it('boundary on empty stack is a no-op', () => {
    setTime(1000);
    const doc = makeDoc();
    const ctrl = createUndo(doc);
    expect(() => ctrl.boundary()).not.toThrow();
    expect(ctrl.canUndo()).toBe(false);
    ctrl.destroy();
  });
});
