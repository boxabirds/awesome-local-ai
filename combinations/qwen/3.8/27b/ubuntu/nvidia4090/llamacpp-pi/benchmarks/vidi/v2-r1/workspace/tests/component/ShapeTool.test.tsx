// Story 10 component tests: the Shape tool, the shape object and the shape
// toolbar (TC-15 to TC-17, TC-28).
//
//  - TC-15: an S-tool press/move/release shows a live preview and creates
//    exactly one shape covering the dragged rect, selected, back on Select.
//  - TC-16: double-clicking a shape opens the label editor; typing beyond
//    SHAPE_LABEL_MAX_CHARS is clamped to the limit (boundary).
//  - TC-17: the shape toolbar's fill and outline swatches recolor the shape
//    without touching its label, size, position or selection.
//  - TC-28: a Shape-tool drag that starts over an existing sticky never
//    moves the sticky (the tool captures the pointer first).
//
// The camera is pinned to the origin at 100% so world units equal screen
// pixels.

import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
import { click, flushRaf, hooks, renderApp, typeIntoEditor, addNote, note } from './helpers';

const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const shapeButton = () => screen.getByRole('button', { name: 'Shape (S)' });

function pinCamera(): void {
  hooks().setCamera({ x: 0, y: 0, zoom: 1 });
}

const vp = () => screen.getByTestId('board-viewport');

function press(x: number, y: number): void {
  fireEvent.pointerDown(vp(), { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}
function move(x: number, y: number): void {
  fireEvent.pointerMove(window, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}
function release(x: number, y: number): void {
  fireEvent.pointerUp(vp(), { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}

function shapeIds(): string[] {
  return hooks().getObjects().filter((o) => o.type === 'shape').map((o) => o.id);
}

describe('shape tool, object and toolbar (component)', () => {
  it('TC-15: S-tool press/move/release previews then creates one shape, selected, on Select', async () => {
    await renderApp();
    pinCamera();

    fireEvent.keyDown(window, { key: 's' });
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'true');

    press(100, 100);
    move(300, 220);
    // The dashed preview is on screen while the drag is in flight.
    expect(screen.getByTestId('shape-preview')).toBeInTheDocument();

    release(300, 220);
    await flushRaf();
    expect(screen.queryByTestId('shape-preview')).not.toBeInTheDocument();

    // Exactly one shape, exactly the dragged rect, and it is selected.
    const ids = shapeIds();
    expect(ids).toHaveLength(1);
    const obj = hooks().getObjects().find((o) => o.id === ids[0]);
    expect(obj).toBeDefined();
    expect(obj!.x).toBeCloseTo(100, 5);
    expect(obj!.y).toBeCloseTo(100, 5);
    expect(obj!.width).toBeCloseTo(200, 5);
    expect(obj!.height).toBeCloseTo(120, 5);

    // Return-to-Select and the new shape is the only selection.
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    const el = screen.getByTestId('shape-object');
    expect(el).toHaveAttribute('data-selected');
  });

  it('TC-16: dblclick opens the label editor; typing 600 chars clamps to the limit', async () => {
    await renderApp();
    pinCamera();
    let id = '';
    act(() => {
      id = createShape(hooks().doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'me') ?? '';
    });
    expect(id).not.toBe('');

    const el = screen.getByTestId('shape-object');
    fireEvent.dblClick(el);
    const ta = screen.getByTestId('shape-label-editor');
    expect(ta).toHaveFocus();

    typeIntoEditor(ta, 'a'.repeat(SHAPE_LABEL_MAX_CHARS + 100));
    await flushRaf();

    const label = getShapeLabel(hooks().doc, id)?.toString() ?? '';
    expect(label.length).toBe(SHAPE_LABEL_MAX_CHARS);
  });

  it('TC-17: fill and outline swatches recolor the shape; label, size and selection unchanged', async () => {
    await renderApp();
    pinCamera();
    let id = '';
    act(() => {
      id = createShape(
        hooks().doc,
        { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } },
        'me',
      ) ?? '';
    });
    act(() => {
      getShapeLabel(hooks().doc, id)?.insert(0, 'hi');
    });

    // Select the shape (click) so the toolbar appears.
    click(screen.getByTestId('shape-object'));
    await flushRaf();

    const before = hooks().getObjects().find((o) => o.id === id)!;
    expect(before.label).toBe('hi');

    fireEvent.click(screen.getByRole('button', { name: 'blue fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'red outline' }));
    await flushRaf();

    const after = hooks().getObjects().find((o) => o.id === id)!;
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe('red');
    // Label, size and position are untouched.
    expect(after.label).toBe('hi');
    expect(after.width).toBeCloseTo(before.width, 5);
    expect(after.height).toBeCloseTo(before.height, 5);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    // Still selected.
    expect(screen.getByTestId('shape-object')).toHaveAttribute('data-selected');
  });

  it('TC-28: an S-tool drag starting over a sticky never moves the sticky', async () => {
    await renderApp();
    pinCamera();
    const stickyId = addNote(0, 0); // centred at the origin
    const before = note(stickyId)!;

    fireEvent.keyDown(window, { key: 's' });
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'true');

    // Drag that starts over the sticky (the origin) and ends elsewhere.
    press(0, 0);
    move(150, 80);
    release(150, 80);
    await flushRaf();

    const after = note(stickyId)!;
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });
});
