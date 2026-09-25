/**
 * shape.ui (story 10) on the real board with a real Y.Doc: Shape tool gestures, label editing
 * and the shape toolbar. TC-15, TC-16, TC-17 and TC-28.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import { getShapeLabel } from '../../src/shared/objects/shape';
import { PROSE_1000 } from '../fixtures/texts';
import { centre, dragOn, selectedIds, shapeEl, shapes, shapeTool, toolPressed, toScreen } from './shapeHelpers';
import { camera, createSelectedNote, doc, notes, renderBoard } from './stickyHelpers';
import { pressKey } from './textHelpers';

function labelEditor(): HTMLTextAreaElement | null {
  return screen.queryByRole('textbox', { name: 'Shape label' });
}

/** S, then a drag on the tool layer from `a` to `b` (screen); returns the new shape's id. */
function drawShape(a = { x: 100, y: 100 }, b = { x: 300, y: 220 }): string {
  pressKey('s');
  dragOn(shapeTool(), a, b);
  const all = shapes();
  return all[all.length - 1]!.id;
}

describe('shape.ui Shape tool', () => {
  it('TC-15 S, drag: dashed preview follows the pointer; release creates one shape of the dragged rect, selected, tool back to Select', () => {
    renderBoard();
    pressKey('s');
    expect(toolPressed('Shape (S)')).toBe('true');
    const layer = shapeTool();
    fireEvent.pointerDown(layer, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    expect(screen.queryByTestId('shape-preview')).toBeNull();
    fireEvent.pointerMove(layer, { pointerId: 1, clientX: 300, clientY: 220 });
    const preview = screen.getByTestId('shape-preview');
    expect(preview.style.left).toBe('100px');
    expect(preview.style.top).toBe('100px');
    expect(preview.style.width).toBe('200px');
    expect(preview.style.height).toBe('120px');
    expect(shapes()).toHaveLength(0);

    fireEvent.pointerUp(layer, { pointerId: 1, button: 0, clientX: 300, clientY: 220 });
    const created = shapes();
    expect(created).toHaveLength(1);
    const cam = camera();
    expect(created[0]).toMatchObject({
      kind: 'rect',
      x: 100 / cam.zoom + cam.x,
      y: 100 / cam.zoom + cam.y,
      width: 200,
      height: 120,
    });
    expect(selectedIds()).toEqual([created[0]!.id]);
    expect(toolPressed('Select (V)')).toBe('true');
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(screen.queryByTestId('shape-preview')).toBeNull();
  });

  it('TC-15 click drops a default-size shape centred on the click; Shift squares a drag; the menu picks the kind', () => {
    renderBoard();
    pressKey('s');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Diamond' }));
    expect(screen.getByRole('menuitemradio', { name: 'Diamond' }).getAttribute('aria-checked')).toBe('true');
    dragOn(shapeTool(), { x: 400, y: 300 }, { x: 400, y: 300 });
    const cam = camera();
    const clicked = shapes()[0]!;
    expect(clicked.kind).toBe('diamond');
    expect(centre(clicked)).toEqual({ x: 400 + cam.x, y: 300 + cam.y });
    expect(clicked.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);

    pressKey('s');
    dragOn(shapeTool(), { x: 100, y: 100 }, { x: 300, y: 220 }, { shiftKey: true });
    const squared = shapes()[1]!;
    expect(squared.kind).toBe('diamond');
    expect(squared).toMatchObject({ x: 100 + cam.x, y: 100 + cam.y, width: 200, height: 200 });
  });

  it('TC-28 a Shape drag starting on a sticky note never moves or selects the note (negative)', () => {
    renderBoard();
    const noteEl = createSelectedNote(400, 300);
    const before = notes()[0]!;
    pressKey('s');
    // The tool layer covers the board: the press lands on it, not on the note.
    dragOn(shapeTool(), { x: 400, y: 300 }, { x: 560, y: 420 });
    expect(notes()[0]).toMatchObject({ x: before.x, y: before.y });
    expect(shapes()).toHaveLength(1);
    expect(selectedIds()).toEqual([shapes()[0]!.id]);
    expect(noteEl.dataset.selected).toBe('false');
  });

  it('pointercancel creates nothing and keeps the tool', () => {
    renderBoard();
    pressKey('s');
    fireEvent.pointerDown(shapeTool(), { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(shapeTool(), { pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerCancel(shapeTool(), { pointerId: 1 });
    expect(shapes()).toHaveLength(0);
    expect(toolPressed('Shape (S)')).toBe('true');
  });
});

describe('shape.ui label and toolbar', () => {
  it('TC-16 double-click opens the label editor; 600 characters typed keep 500', () => {
    renderBoard();
    const id = drawShape();
    fireEvent.doubleClick(shapeEl(id));
    const editorEl = labelEditor();
    expect(editorEl).not.toBeNull();
    expect(document.activeElement).toBe(editorEl);
    const typed = (PROSE_1000 + PROSE_1000).slice(0, 600);
    fireEvent.change(editorEl!, { target: { value: typed } });
    expect(getShapeLabel(doc(), id)!.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(shapes()[0]!.label).toBe(typed.slice(0, SHAPE_LABEL_MAX_CHARS));
    fireEvent.keyDown(editorEl!, { key: 'Escape' });
    expect(labelEditor()).toBeNull();
    // Shown centred in the shape and announced with kind and label.
    expect(shapeEl(id).getAttribute('aria-label')).toBe(`Rectangle: ${typed.slice(0, SHAPE_LABEL_MAX_CHARS)}`);
    expect(screen.getByTestId('shape-label').textContent).toBe(typed.slice(0, SHAPE_LABEL_MAX_CHARS));
  });

  it('TC-16 the label box follows the shape size (re-wraps on resize) and Enter edits a selected shape', () => {
    renderBoard();
    const id = drawShape();
    const box = () => screen.getByTestId('shape-label-box');
    const widthBefore = parseFloat(box().style.width);
    act(() => {
      doc().transact(() => {
        doc().getMap<import('yjs').Map<unknown>>('objects').get(id)!.set('width', 400);
      });
    });
    expect(parseFloat(box().style.width)).toBeGreaterThan(widthBefore);
    pressKey('Enter');
    expect(labelEditor()).not.toBeNull();
  });

  it('TC-17 Blue fill then Red outline: colours applied; label, size, position and selection unchanged', () => {
    renderBoard();
    const id = drawShape();
    act(() => {
      getShapeLabel(doc(), id)!.insert(0, 'Checkout');
    });
    const before = shapes()[0]!;
    const toolbar = screen.getByRole('toolbar', { name: 'Shape' });
    expect(toolbar).toBeTruthy();
    expect(screen.getAllByRole('button', { name: / fill$/ })).toHaveLength(7);
    expect(screen.getAllByRole('button', { name: / outline$/ })).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Blue fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Red outline' }));
    const after = shapes()[0]!;
    expect(after).toEqual({ ...before, fill: 'blue', stroke: 'red' });
    expect(selectedIds()).toEqual([id]);
    expect(screen.getByRole('button', { name: 'Blue fill' }).getAttribute('aria-pressed')).toBe('true');
    expect(shapeEl(id).dataset.fill).toBe('blue');
    fireEvent.click(screen.getByRole('button', { name: 'No fill' }));
    expect(shapes()[0]!.fill).toBe('none');
  });

  it('a shape is selected by clicking it and moved by dragging it with the Select tool', () => {
    renderBoard();
    const id = drawShape();
    const s = shapes()[0]!;
    const c = toScreen(centre(s));
    fireEvent.pointerDown(shapeEl(id), { pointerId: 1, button: 0, clientX: c.x, clientY: c.y });
    fireEvent.pointerMove(shapeEl(id), { pointerId: 1, clientX: c.x + 50, clientY: c.y + 30 });
    fireEvent.pointerUp(shapeEl(id), { pointerId: 1, button: 0, clientX: c.x + 50, clientY: c.y + 30 });
    expect(shapes()[0]).toMatchObject({ x: s.x + 50, y: s.y + 30 });
  });
});
