/**
 * Unit tests for undo.boundaries typing-burst capture (TC-12, TC-13).
 * Uses the UndoManager's internal lastChange to simulate time gaps
 * (Yjs captures Date.now at module load so vitest's fake timers don't affect it).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

describe('undo.boundaries (capture timeout)', () => {
  let doc: Y.Doc;
  let ctrl: UndoController;

  beforeEach(() => {
    doc = new Y.Doc();
    ctrl = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });
  });

  afterEach(() => {
    ctrl.destroy();
    doc.destroy();
  });

  function insertText(ytext: Y.Text, content: string): void {
    doc.transact(() => {
      ytext.insert(ytext.length, content);
    }, LOCAL_ORIGIN);
  }

  /** Simulate `ms` passing since the last captured change. */
  function advance(ms: number): void {
    ctrl._um.lastChange -= ms;
  }

  it('TC-12: keystrokes 100ms apart between boundaries → one undo step removes whole burst', () => {
    const ytext = new Y.Text();
    doc.getMap('objects').set('note', ytext);
    ctrl.boundary();

    // Insert characters simulating 100ms apart (within capture timeout of 500ms)
    const chars = 'hello world';
    for (const ch of chars) {
      insertText(ytext, ch);
      advance(100); // 100ms < 500ms so all merge into one step
    }

    ctrl.boundary();
    expect(ytext.toString()).toBe('hello world');

    // One undo should remove the entire burst
    expect(ctrl.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
  });

  it('TC-13a: pause exactly UNDO_CAPTURE_TIMEOUT_MS → two separate steps', () => {
    const ytext = new Y.Text();
    doc.getMap('objects').set('note', ytext);
    ctrl.boundary();

    insertText(ytext, 'abc');
    advance(UNDO_CAPTURE_TIMEOUT_MS);
    insertText(ytext, 'def');
    ctrl.boundary();

    expect(ytext.toString()).toBe('abcdef');

    // Undo should only remove the second burst
    expect(ctrl.undo()).toBe(true);
    expect(ytext.toString()).toBe('abc');

    // Second undo removes the first burst
    expect(ctrl.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
  });

  it('TC-13b: pause UNDO_CAPTURE_TIMEOUT_MS − 1ms → one combined step', () => {
    const ytext = new Y.Text();
    doc.getMap('objects').set('note', ytext);
    ctrl.boundary();

    insertText(ytext, 'abc');
    advance(UNDO_CAPTURE_TIMEOUT_MS - 1);
    insertText(ytext, 'def');
    ctrl.boundary();

    expect(ytext.toString()).toBe('abcdef');

    // One undo should remove both bursts (they were within capture window)
    expect(ctrl.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
  });

  it('boundary() on empty stack is a no-op', () => {
    expect(() => ctrl.boundary()).not.toThrow();
    expect(ctrl.canUndo()).toBe(false);
  });
});
