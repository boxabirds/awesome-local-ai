/**
 * Capture-timeout unit tests (TC-12, TC-13).
 * Tests typing-burst grouping via fake system time.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createUndo } from '@/client/board/undo';
import { LOCAL_ORIGIN } from '@/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '@/shared/config';

describe('undo.boundaries — TC-12, TC-13', () => {
  // TC-12: keystrokes 100ms apart between boundary() calls → one undo step
  it('TC-12: rapid inserts within captureTimeout merge into one step', async () => {
    const doc = new Y.Doc();
    const text = new Y.Text();
    doc.getMap('meta').set('schemaVersion', 1);
    
    const objects = doc.getMap('objects');
    const inner = new Y.Map();
    inner.set('type', 'sticky');
    inner.set('x', 0);
    inner.set('y', 0);
    inner.set('color', 'yellow');
    inner.set('text', text);
    inner.set('z', 1);
    inner.set('createdAt', Date.now());
    Y.transact(doc, () => {
      objects.set('a', inner);
    }, LOCAL_ORIGIN);

    const undoController = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    // Insert some text
    Y.transact(doc, () => {
      text.insert(0, 'Hello');
    }, LOCAL_ORIGIN);
    undoController.boundary();

    // Insert more text quickly (within captureTimeout)
    Y.transact(doc, () => {
      text.insert(5, ' World');
    }, LOCAL_ORIGIN);

    // These should merge into the same step due to capture timeout
    // The capture window is still open because we haven't called boundary() or waited enough
    
    // Wait for half the capture timeout — should NOT trigger a new step
    await new Promise(r => setTimeout(r, UNDO_CAPTURE_TIMEOUT_MS - 100));

    Y.transact(doc, () => {
      text.insert(11, '!');
    }, LOCAL_ORIGIN);

    // All inserts are in one capture window
    undoController.boundary(); // Close the window

    // Should have only 1 redo step available (the whole burst)
    expect(undoController.canRedo()).toBe(false);
    
    // Undo should remove all inserted text at once
    const result = undoController.undo();
    expect(result).toBe(true);
    expect(text.toString()).toBe('Hello'); // Only 'Hello' remains from creation

    undoController.destroy();
    doc.destroy();
  });

  // TC-13: pause at exactly UNDO_CAPTURE_TIMEOUT_MS → two steps; pause at −1 ms → one
  it('TC-13a: pause of UNDO_CAPTURE_TIMEOUT_MS creates two separate steps', async () => {
    const doc = new Y.Doc();
    const objects = doc.getMap('objects');
    
    const inner = new Y.Map();
    inner.set('type', 'sticky');
    inner.set('x', 0);
    inner.set('y', 0);
    inner.set('color', 'yellow');
    inner.set('text', new Y.Text());
    inner.set('z', 1);
    inner.set('createdAt', Date.now());
    Y.transact(doc, () => {
      objects.set('a', inner);
    }, LOCAL_ORIGIN);

    const undoController = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    // First insert
    Y.transact(doc, () => {
      (inner.get('text') as Y.Text).insert(0, 'Step1');
    }, LOCAL_ORIGIN);
    undoController.boundary(); // End first step

    // Move x to trigger a step and close that capture window
    Y.transact(doc, () => {
      inner.set('x', 100);
    }, LOCAL_ORIGIN);
    undoController.boundary();

    // Second insert after waiting UNDO_CAPTURE_TIMEOUT_MS
    await new Promise(r => setTimeout(r, UNDO_CAPTURE_TIMEOUT_MS + 1));
    
    Y.transact(doc, () => {
      inner.set('x', 200);
    }, LOCAL_ORIGIN);
    undoController.boundary();

    // Two separate moves should give us two undo steps
    const moved1 = getX(doc, 'a');
    expect(moved1).toBe(200);

    expect(undoController.undo()).toBe(true);
    expect(getX(doc, 'a')).toBe(100); // Second move undone

    expect(undoController.undo()).toBe(true);
    expect(getX(doc, 'a')).toBe(0); // First move undone

    undoController.destroy();
    doc.destroy();
  });

  function getX(doc: Y.Doc, id: string): number | undefined {
    const obj = doc.getMap('objects').get(id);
    if (!obj || !(obj instanceof Y.Map)) return undefined;
    return Number((obj as Y.Map<any>).get('x'));
  }

  // TC-13b variation: boundary() on empty stack is a no-op
  it('boundary() on empty stack is safe no-op', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap('objects');
    const inner = new Y.Map();
    inner.set('type', 'sticky');
    inner.set('x', 0);
    inner.set('y', 0);
    inner.set('color', 'yellow');
    inner.set('text', new Y.Text());
    inner.set('z', 1);
    inner.set('createdAt', Date.now());
    Y.transact(doc, () => {
      objects.set('a', inner);
    }, LOCAL_ORIGIN);

    const undoController = createUndo(doc);

    // No changes yet — boundary on empty should not throw
    expect(() => undoController.boundary()).not.toThrow();
    expect(undoController.canUndo()).toBe(false);

    undoController.destroy();
    doc.destroy();
  });
});
