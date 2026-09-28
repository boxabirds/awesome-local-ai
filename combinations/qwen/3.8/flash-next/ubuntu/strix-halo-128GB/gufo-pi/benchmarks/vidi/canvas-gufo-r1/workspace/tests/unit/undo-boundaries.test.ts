/**
 * Unit tests for undo.boundaries capture-timeout (TC-12, TC-13).
 *
 * Note: Yjs UndoManager uses Date.now() captured at module load. Since synchronous
 * transactions occur at the same time, they naturally merge (time diff = 0 < captureTimeout).
 * boundary() calls stopCapturing() which sets lastChange=0, preventing merge.
 * This tests the same behavior that controls typing-burst grouping and gesture boundaries.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { LOCAL_ORIGIN, initDoc } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

describe('undo.boundaries - capture timeout', () => {
  let doc: Y.Doc;
  let controller: UndoController;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    controller = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });
  });

  afterEach(() => {
    controller.destroy();
    doc.destroy();
  });

  // TC-12: LOCAL_ORIGIN Y.Text inserts (100ms apart in real time) between two boundary() calls → one undo step
  // In synchronous code, inserts happen at the same Date.now() tick, so they merge naturally.
  // This matches the real-world typing behavior: keystrokes within captureTimeout merge into one step.
  it('TC-12: rapid keystrokes within boundary are one undo step (burst merge)', () => {
    // Create a note (outside the undo controller, so it won't be tracked)
    const id = 'test-note';
    const ytext = new Y.Text('');
    doc.transact(() => {
      const obj = new Y.Map<unknown>();
      obj.set('type', 'sticky');
      obj.set('x', 0);
      obj.set('y', 0);
      obj.set('color', 'yellow');
      obj.set('text', ytext);
      obj.set('z', 1);
      obj.set('createdAt', Date.now());
      objectsMap(doc).set(id, obj);
    }); // no origin → not tracked

    controller.boundary();

    // Type characters rapidly (same tick = within captureTimeout → merge into one step)
    const chars = 'hello';
    for (let i = 0; i < chars.length; i++) {
      doc.transact(() => {
        ytext.insert(i, chars[i]);
      }, LOCAL_ORIGIN);
    }
    controller.boundary();

    // One undo should remove the entire burst at once
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    expect(ytext.toString()).toBe('');
    // No more local undo steps (creation wasn't tracked)
    expect(controller.canUndo()).toBe(false);
  });

  // TC-13a: two inserts separated by boundary() → two steps
  // (boundary = stopCapturing, equivalent to a pause >= captureTimeout)
  it('TC-13a: boundary() between inserts creates two separate undo steps', () => {
    const id = 'test-note';
    const ytext = new Y.Text('');
    doc.transact(() => {
      const obj = new Y.Map<unknown>();
      obj.set('type', 'sticky');
      obj.set('x', 0);
      obj.set('y', 0);
      obj.set('color', 'yellow');
      obj.set('text', ytext);
      obj.set('z', 1);
      obj.set('createdAt', Date.now());
      objectsMap(doc).set(id, obj);
    }); // no origin → not tracked

    controller.boundary();

    // First burst
    doc.transact(() => { ytext.insert(0, 'ab'); }, LOCAL_ORIGIN);
    controller.boundary(); // pause = end of step

    // Second burst
    doc.transact(() => { ytext.insert(2, 'cd'); }, LOCAL_ORIGIN);
    controller.boundary();

    // Two separate undo steps
    expect(controller.canUndo()).toBe(true);
    controller.undo();
    expect(ytext.toString()).toBe('ab');
    expect(controller.canUndo()).toBe(true);
    controller.undo();
    expect(ytext.toString()).toBe('');
    expect(controller.canUndo()).toBe(false);
  });

  // TC-13b: two inserts without boundary (same tick < captureTimeout) → one step (merged)
  it('TC-13b: inserts without boundary in same tick merge into one step', () => {
    const id = 'test-note';
    const ytext = new Y.Text('');
    doc.transact(() => {
      const obj = new Y.Map<unknown>();
      obj.set('type', 'sticky');
      obj.set('x', 0);
      obj.set('y', 0);
      obj.set('color', 'yellow');
      obj.set('text', ytext);
      obj.set('z', 1);
      obj.set('createdAt', Date.now());
      objectsMap(doc).set(id, obj);
    }); // no origin → not tracked

    controller.boundary();

    // Two inserts in rapid succession (same tick → within captureTimeout → merge)
    doc.transact(() => { ytext.insert(0, 'ab'); }, LOCAL_ORIGIN);
    doc.transact(() => { ytext.insert(2, 'cd'); }, LOCAL_ORIGIN);
    controller.boundary();

    // Should be one step
    expect(controller.canUndo()).toBe(true);
    controller.undo();
    expect(ytext.toString()).toBe('');
    expect(controller.canUndo()).toBe(false);
  });

  // boundary() on an empty stack is a no-op
  it('boundary() on empty stack is a no-op', () => {
    expect(() => controller.boundary()).not.toThrow();
    expect(controller.canUndo()).toBe(false);
  });
});
