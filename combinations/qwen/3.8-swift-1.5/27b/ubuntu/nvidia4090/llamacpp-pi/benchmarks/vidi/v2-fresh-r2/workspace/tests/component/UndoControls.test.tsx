/**
 * Component tests for undo.controls: buttons, shortcuts and view-only gating
 * (TC-18 to TC-21).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { act, screen, fireEvent } from '@testing-library/react';
import { renderBoard, hook, insertSticky } from './harness';
import {
  objects,
  moveObjects,
  LOCAL_ORIGIN,
  type StickySnapshot,
} from '../../src/shared/board-model';

describe('undo.controls (component)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-18: undo button disabled when empty, enabled after a move; tooltips show shortcuts', () => {
    renderBoard();
    const h = hook();
    const doc = h.getDoc!();

    // Initially, undo is disabled
    const undoBtn = screen.getByTestId('undo-btn');
    expect(undoBtn).toBeDisabled();
    expect(undoBtn).toHaveAttribute('title', 'Undo (Ctrl/Cmd+Z)');

    const redoBtn = screen.getByTestId('redo-btn');
    expect(redoBtn).toBeDisabled();
    expect(redoBtn).toHaveAttribute('title', 'Redo (Ctrl/Cmd+Shift+Z)');

    // Make a move
    const id = insertSticky(400, 300);
    act(() => { h.undo?.boundary(); });
    const startSnap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    act(() => {
      h.undo?.boundary();
      moveObjects(doc, new Map([[id, { x: startSnap.x + 100, y: startSnap.y }]]));
      h.undo?.boundary();
    });

    // After the move, undo should be enabled
    // (the re-render happens via the onChange subscription)
    expect(screen.getByTestId('undo-btn')).not.toBeDisabled();
  });

  it('TC-19: Ctrl+Z undoes, Ctrl+Shift+Z redoes, Ctrl+Y redoes', () => {
    renderBoard();
    const h = hook();
    const doc = h.getDoc!();

    // Make a move
    const id = insertSticky(400, 300);
    act(() => { h.undo?.boundary(); });
    const startSnap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    const startX = startSnap.x;
    const startY = startSnap.y;

    act(() => {
      h.undo?.boundary();
      moveObjects(doc, new Map([[id, { x: startX + 100, y: startY + 50 }]]));
      h.undo?.boundary();
    });

    // Verify position changed
    let snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    expect(snap.x).toBe(startX + 100);

    // Ctrl+Z → undo
    act(() => {
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    });
    snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    expect(snap.x).toBe(startX);
    expect(snap.y).toBe(startY);

    // Ctrl+Shift+Z → redo
    act(() => {
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
    });
    snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    expect(snap.x).toBe(startX + 100);
    expect(snap.y).toBe(startY + 50);

    // Ctrl+Z again → undo
    act(() => {
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    });
    snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    expect(snap.x).toBe(startX);

    // Ctrl+Y → redo
    act(() => {
      fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    });
    snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    expect(snap.x).toBe(startX + 100);
  });

  it('TC-20: view-only (load-failed) → no undo/redo via button or shortcut', () => {
    renderBoard();
    const h = hook();
    const doc = h.getDoc!();

    // Force load-failed state (view-only)
    act(() => {
      h.forceLoadFailed?.();
    });

    // Make a change directly on the doc (simulating a local change before
    // the load-failed state was set)
    const id = insertSticky(400, 300);
    act(() => { h.undo?.boundary(); });
    const startSnap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    act(() => {
      h.undo?.boundary();
      moveObjects(doc, new Map([[id, { x: startSnap.x + 100, y: startSnap.y }]]));
      h.undo?.boundary();
    });

    // Undo button should be disabled (view-only)
    const undoBtn = screen.getByTestId('undo-btn');
    expect(undoBtn).toBeDisabled();

    // Ctrl+Z should be a no-op in view-only mode
    act(() => {
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    });

    // Position should NOT have changed (undo was blocked)
    const snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    expect(snap.x).toBe(startSnap.x + 100);
  });

  it('TC-21: redo after a new change clears the redo stack', () => {
    renderBoard();
    const h = hook();
    const doc = h.getDoc!();

    // Make a move
    const id = insertSticky(400, 300);
    act(() => { h.undo?.boundary(); });
    const startSnap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    const startX = startSnap.x;
    const startY = startSnap.y;

    act(() => {
      h.undo?.boundary();
      moveObjects(doc, new Map([[id, { x: startX + 100, y: startY }]]));
      h.undo?.boundary();
    });

    // Undo
    act(() => {
      h.undo?.undo();
    });
    let snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    expect(snap.x).toBe(startX);

    // Redo button should be enabled
    expect(screen.getByTestId('redo-btn')).not.toBeDisabled();

    // Make a NEW change (clears redo stack)
    act(() => {
      h.undo?.boundary();
      moveObjects(doc, new Map([[id, { x: startX + 200, y: startY }]]));
      h.undo?.boundary();
    });

    // Redo button should be disabled again (redo stack cleared)
    expect(screen.getByTestId('redo-btn')).toBeDisabled();

    // Verify the new position
    snap = (objects(doc) as StickySnapshot[]).find((s) => s.id === id)!;
    expect(snap.x).toBe(startX + 200);
  });
});
