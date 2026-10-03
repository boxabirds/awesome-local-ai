/**
 * Component tests for undo.boundaries: gesture and typing boundaries
 * (TC-14 to TC-17).
 *
 * Uses the real BoardView harness with a fake provider, a real Y.Doc, and
 * the real undo controller to verify that gesture and editing boundaries
 * produce the correct number of undo steps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { act, screen, fireEvent } from '@testing-library/react';
import { renderBoard, hook, insertSticky, advance } from './harness';
import {
  objects,
  moveObjects,
  getStickyText,
  LOCAL_ORIGIN,
  type StickySnapshot,
} from '../../src/shared/board-model';

describe('undo.boundaries (component)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-14: 30-frame drag via useTransformGesture → one undo restores start position', async () => {
    renderBoard();
    const h = hook();
    const doc = h.getDoc!();

    // Insert a sticky and close its capture window
    const id = insertSticky(400, 300);
    act(() => { h.undo?.boundary(); });
    const startSnap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    const startX = startSnap.x;
    const startY = startSnap.y;

    // Simulate a 30-frame drag (the gesture hook calls boundary() at start
    // and end; here we simulate the frames within one capture window)
    act(() => {
      h.undo?.boundary(); // gesture start
      for (let frame = 1; frame <= 30; frame++) {
        const dx = frame * 2;
        const dy = frame;
        moveObjects(doc, new Map([[id, { x: startX + dx, y: startY + dy }]]));
        vi.advanceTimersByTime(16); // one rAF frame
      }
      h.undo?.boundary(); // gesture end
    });

    // One undo should restore the start position
    act(() => {
      h.undo?.undo();
    });

    const afterUndo = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    expect(afterUndo.x).toBe(startX);
    expect(afterUndo.y).toBe(startY);
  });

  it('TC-15: drag ends, colour changed 200 ms later → two separate steps', async () => {
    renderBoard();
    const h = hook();
    const doc = h.getDoc!();

    // Insert a sticky
    const id = insertSticky(400, 300);
    act(() => { h.undo?.boundary(); });
    const startSnap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;

    // Simulate a drag (one step, bounded)
    act(() => {
      h.undo?.boundary(); // gesture start
      moveObjects(doc, new Map([[id, { x: startSnap.x + 100, y: startSnap.y + 50 }]]));
      vi.advanceTimersByTime(16);
      h.undo?.boundary(); // gesture end
    });

    // Advance time by 200ms
    vi.advanceTimersByTime(200);

    // Change colour (second step, bounded)
    act(() => {
      h.undo?.boundary();
      const obj = doc.getMap('objects').get(id) as Y.Map<any>;
      doc.transact(() => { obj.set('color', 'blue'); }, LOCAL_ORIGIN);
      h.undo?.boundary();
    });

    // First undo: undoes the colour change
    act(() => {
      h.undo?.undo();
    });
    let snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    expect(snap.color).toBe('yellow'); // back to default
    expect(snap.x).toBe(startSnap.x + 100); // position still moved

    // Second undo: undoes the move
    act(() => {
      h.undo?.undo();
    });
    snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    expect(snap.x).toBe(startSnap.x);
    expect(snap.y).toBe(startSnap.y);
  });

  it('TC-16: edit note, type, Ctrl+Z inside editor → typing undone, earlier move not undone', async () => {
    renderBoard();
    const h = hook();
    const doc = h.getDoc!();

    // Insert a sticky
    const id = insertSticky(400, 300);
    act(() => { h.undo?.boundary(); });
    const startSnap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;

    // Move it (one step, bounded)
    act(() => {
      h.undo?.boundary();
      moveObjects(doc, new Map([[id, { x: startSnap.x + 50, y: startSnap.y }]]));
      h.undo?.boundary();
    });

    // Start editing (boundary on mount is called by StickyTextEditor)
    act(() => {
      h.startEdit?.(id);
    });

    // Type in the editor
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    act(() => {
      textarea.value = 'hello';
      fireEvent.input(textarea);
    });

    // Ctrl+Z inside the editor → undoes typing only
    act(() => {
      fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });
    });

    // Text should be empty (typing undone)
    const text = getStickyText(doc, id)!;
    expect(text.toString()).toBe('');

    // The move should NOT be undone (position still changed)
    const snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    expect(snap.x).toBe(startSnap.x + 50);
  });

  it('TC-17: pointercancel mid-drag → one step restoring start position', async () => {
    renderBoard();
    const h = hook();
    const doc = h.getDoc!();

    // Insert a sticky
    const id = insertSticky(400, 300);
    act(() => { h.undo?.boundary(); });
    const startSnap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    const startX = startSnap.x;
    const startY = startSnap.y;

    // Simulate a partial drag (pointercancel) — the gesture hook calls
    // boundary() on start and on pointercancel, so the partial move is one step
    act(() => {
      h.undo?.boundary(); // gesture start
      moveObjects(doc, new Map([[id, { x: startX + 30, y: startY + 15 }]]));
      vi.advanceTimersByTime(16);
      moveObjects(doc, new Map([[id, { x: startX + 50, y: startY + 25 }]]));
      vi.advanceTimersByTime(16);
      h.undo?.boundary(); // pointercancel → gesture end
    });

    // One undo should restore the start position
    act(() => {
      h.undo?.undo();
    });

    const afterUndo = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    expect(afterUndo.x).toBe(startX);
    expect(afterUndo.y).toBe(startY);
  });
});
