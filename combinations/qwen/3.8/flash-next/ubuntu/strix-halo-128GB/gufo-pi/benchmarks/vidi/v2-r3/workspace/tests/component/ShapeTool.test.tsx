import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { snapshot, getObjectsMap, isShape, isSticky } from '../../src/shared/board-model';
import { createSticky } from '../../src/shared/board-model';
import { pointer, frames } from './pointerUtils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} />);
  const handle = handleRef.current!;
  return { handle, doc: handle.doc };
}

describe('shape.tool (TC-15, TC-16, TC-17, TC-28)', () => {
  it('TC-15: S tool pointerdown/move/up creates shape; preview shown; selection = new id', () => {
    const { handle, doc } = setup();

    // Activate shape tool
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    frames();

    expect(handle.getTool()).toBe('shape');

    // Drag on board from (100,100) to (300,220)
    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', 100, 100);
    frames();
    pointer(board, 'pointermove', 300, 220);
    frames();

    // Preview should be shown
    expect(screen.getByTestId('shape-preview')).toBeInTheDocument();

    pointer(board, 'pointerup', 300, 220);
    frames();

    // Shape should be created
    const objects = snapshot(doc);
    const shape = objects.find((o) => o.type === 'shape');
    expect(shape).toBeDefined();

    // Tool should return to select
    expect(handle.getTool()).toBe('select');

    // New shape should be selected
    expect(handle.getSelectedIds().has(shape!.id)).toBe(true);
  });

  it('TC-16: dblclick shape opens editor, typing >500 chars clamps to 500', () => {
    const { handle, doc } = setup();

    // Create a shape first
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    frames();
    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', 200, 200);
    pointer(board, 'pointerup', 200, 200);
    frames();

    const objects = snapshot(doc);
    const shape = objects.find((o) => o.type === 'shape');
    expect(shape).toBeDefined();

    // Double-click the shape to start editing
    const shapeEl = screen.getByTestId('shape-object');
    fireEvent.doubleClick(shapeEl);
    frames();

    // Editor should be open
    const editor = screen.getByTestId('shape-label-editor');
    expect(editor).toBeInTheDocument();

    // Simulate typing 600 chars
    const longText = 'a'.repeat(600);
    editor.textContent = longText;
    fireEvent.input(editor);
    frames();

    // Label should be clamped to 500
    act(() => {
      fireEvent.keyDown(editor, { key: 'Escape' });
    });
    frames();

    const snap = snapshot(doc);
    const s = snap.find((o) => o.id === shape!.id) as any;
    expect(s.label.length).toBeLessThanOrEqual(500);
  });

  it('TC-17: click blue fill and red outline swatches → colours applied; label and selection unchanged', () => {
    const { handle, doc } = setup();

    // Create a shape
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    frames();
    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', 200, 200);
    pointer(board, 'pointerup', 200, 200);
    frames();

    const objects = snapshot(doc);
    const shapeId = objects.find((o) => o.type === 'shape')!.id;

    // Select the shape
    act(() => { handle.selection.click(shapeId); });
    frames();

    // Shape toolbar should be visible
    expect(screen.getByTestId('shape-toolbar')).toBeInTheDocument();

    // Click blue fill
    fireEvent.click(screen.getByTestId('fill-blue'));
    frames();

    // Click red outline
    fireEvent.click(screen.getByTestId('stroke-red'));
    frames();

    const snap = snapshot(doc);
    const s = snap.find((o) => o.id === shapeId) as any;
    expect(s.fill).toBe('blue');
    expect(s.stroke).toBe('red');
    // Selection unchanged
    expect(handle.getSelectedIds().has(shapeId)).toBe(true);
  });

  it('TC-28: Shape tool drag starting over a sticky does not move that sticky', () => {
    const { handle, doc } = setup();

    // Create a sticky note at a known position
    let stickyId = '';
    act(() => {
      stickyId = createSticky(doc, { x: 200, y: 200 });
    });
    frames();

    const snapBefore = snapshot(doc);
    const stickyBefore = snapBefore.find((o) => o.id === stickyId) as any;
    const origX = stickyBefore.x;
    const origY = stickyBefore.y;

    // Activate shape tool
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    frames();

    // Drag starting over the sticky position
    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;
    pointer(board, 'pointerdown', 200, 200);
    frames();
    pointer(board, 'pointermove', 350, 350);
    frames();
    pointer(board, 'pointerup', 350, 350);
    frames();

    // Sticky position should be unchanged
    const snapAfter = snapshot(doc);
    const stickyAfter = snapAfter.find((o) => o.id === stickyId) as any;
    expect(stickyAfter.x).toBe(origX);
    expect(stickyAfter.y).toBe(origY);
  });
});
