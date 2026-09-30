import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createSticky, objectsSnapshot, snapshot } from '../../src/shared/board-model';
import { SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import { createShape, getShapeLabel, isShape, type ShapeSnap } from '../../src/shared/objects/shape';
import { keyDown, model, noteEl, readCamera, renderApp } from './helpers';

const shapes = () => objectsSnapshot(window.__vidi6!.doc).filter(isShape) as ShapeSnap[];
const shapeEl = (id: string) => document.querySelector<HTMLElement>(`[data-shape-id="${id}"]`)!;
const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const shapeButton = () => screen.getByRole('button', { name: 'Shape (S)' });

function drag(el: Element, from: { x: number; y: number }, to: { x: number; y: number }, shiftKey = false) {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y, shiftKey });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2, shiftKey });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: to.x, clientY: to.y, shiftKey });
}

describe('shape.ui', () => {
  it('TC-15 with the Shape tool a drag previews, creates one 200x120 shape covering it, selects it and returns to Select', () => {
    const { viewport } = renderApp();
    const cam = readCamera(viewport);
    keyDown(document.body, 's');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'true');
    // The kind menu shows Rectangle selected.
    expect(screen.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Ellipse' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Diamond' })).toHaveAttribute('aria-pressed', 'false');
    const layer = screen.getByTestId('shape-tool');
    drag(layer, { x: 100, y: 100 }, { x: 300, y: 220 });
    const preview = screen.getByTestId('shape-preview');
    expect(preview.style.left).toBe('100px');
    expect(preview.style.width).toBe('200px');
    expect(preview.style.height).toBe('120px');
    expect(shapes()).toHaveLength(0);
    fireEvent.pointerUp(layer, { pointerId: 1, clientX: 300, clientY: 220 });
    const all = shapes();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'rect', width: 200, height: 120, fill: 'white', stroke: 'dark' });
    expect(all[0].x).toBeCloseTo(100 / cam.zoom + cam.x, 9);
    expect(all[0].y).toBeCloseTo(100 / cam.zoom + cam.y, 9);
    expect(shapeEl(all[0].id).dataset.selected).toBe('true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    // Accessible name carries the kind.
    expect(screen.getByRole('group', { name: 'Rectangle' })).toBe(shapeEl(all[0].id));
  });

  it('TC-15 Diamond from the menu: a click drops a standard shape; Shift squares a drag', () => {
    const { viewport } = renderApp();
    const cam = readCamera(viewport);
    fireEvent.click(shapeButton());
    fireEvent.click(screen.getByRole('button', { name: 'Diamond' }));
    expect(screen.getByRole('button', { name: 'Diamond' })).toHaveAttribute('aria-pressed', 'true');
    const layer = screen.getByTestId('shape-tool');
    fireEvent.pointerDown(layer, { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(layer, { pointerId: 1, clientX: 400, clientY: 300 });
    const [diamond] = shapes();
    expect(diamond).toMatchObject({ kind: 'diamond', width: 160, height: 160 });
    expect(diamond.x + 80).toBeCloseTo(400 / cam.zoom + cam.x, 9);
    // The shape kind is remembered; Shift makes the next drag square.
    fireEvent.click(shapeButton());
    drag(screen.getByTestId('shape-tool'), { x: 100, y: 100 }, { x: 300, y: 160 }, true);
    expect(screen.getByTestId('shape-preview').style.height).toBe('200px');
    fireEvent.pointerUp(screen.getByTestId('shape-tool'), { pointerId: 1, clientX: 300, clientY: 160, shiftKey: true });
    const square = shapes().find((s) => s.id !== diamond.id)!;
    expect(square).toMatchObject({ kind: 'diamond', width: 200, height: 200 });
  });

  it('TC-16 double-clicking a shape edits its centred label; typing 600 characters keeps 500', () => {
    renderApp();
    const id = model((doc) => createShape(doc, { kind: 'ellipse', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'c_x'))!;
    fireEvent.doubleClick(shapeEl(id));
    const editor = screen.getByRole('textbox', { name: 'Shape label' });
    expect(editor).toHaveFocus();
    expect(shapeEl(id).dataset.editing).toBe('true');
    fireEvent.input(editor, { target: { value: 'x'.repeat(600) } });
    expect(getShapeLabel(window.__vidi6!.doc, id)!.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect((editor as HTMLTextAreaElement).value).toHaveLength(500);
    keyDown(editor, 'Escape');
    expect(shapeEl(id).dataset.editing).toBe('false');
    expect(screen.getByTestId('shape-label-content')).toHaveTextContent('x'.repeat(500));
    // The label box sits inside the ellipse, centred, and follows a resize.
    const label = screen.getByTestId('shape-label');
    expect(parseFloat(label.style.width)).toBeCloseTo(200 * Math.SQRT1_2, 6);
    expect(parseFloat(label.style.left)).toBeCloseTo((200 - 200 * Math.SQRT1_2) / 2, 6);
    model((doc) => {
      const obj = doc.getMap<import('yjs').Map<unknown>>('objects').get(id)!;
      obj.set('width', 400);
    });
    expect(parseFloat(screen.getByTestId('shape-label').style.width)).toBeCloseTo(400 * Math.SQRT1_2, 6);
    expect(screen.getByRole('group', { name: `Ellipse: ${'x'.repeat(500)}` })).toBe(shapeEl(id));
  });

  it('TC-17 fill and outline swatches recolour the selected shape and keep its label and selection', () => {
    renderApp();
    const id = model((doc) => {
      const s = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'c_x')!;
      getShapeLabel(doc, s)!.insert(0, 'Checkout');
      return s;
    });
    fireEvent.pointerDown(shapeEl(id), { pointerId: 1, button: 0, clientX: 600, clientY: 400 });
    fireEvent.pointerUp(shapeEl(id), { pointerId: 1, clientX: 600, clientY: 400 });
    const toolbar = screen.getByRole('toolbar', { name: 'Shape' });
    const fills = [...toolbar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(fills).toEqual([
      'No fill', 'White fill', 'Blue fill', 'Green fill', 'Yellow fill', 'Pink fill', 'Grey fill',
      'Dark outline', 'Blue outline', 'Green outline', 'Orange outline', 'Red outline', 'Grey outline',
      'Delete shape',
    ]);
    expect(screen.getByRole('button', { name: 'White fill' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Blue fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Red outline' }));
    const [shape] = shapes();
    expect(shape).toMatchObject({ fill: 'blue', stroke: 'red', label: 'Checkout', x: 0, y: 0, width: 200, height: 120 });
    expect(shapeEl(id).dataset.selected).toBe('true');
    expect(screen.getByRole('button', { name: 'Blue fill' })).toHaveAttribute('aria-pressed', 'true');
    expect(shapeEl(id).querySelector('rect')).toHaveAttribute('fill', '#BBDEFB');
    expect(shapeEl(id).querySelector('rect')).toHaveAttribute('stroke', '#E53935');
  });

  it('TC-28 a Shape tool drag starting over a sticky note never moves the note', () => {
    const { viewport } = renderApp();
    const cam = readCamera(viewport);
    const noteId = model((doc) => createSticky(doc, { x: 200 / cam.zoom + cam.x, y: 200 / cam.zoom + cam.y }));
    const before = snapshot(window.__vidi6!.doc)[0];
    keyDown(document.body, 's');
    const layer = screen.getByTestId('shape-tool');
    drag(layer, { x: 200, y: 200 }, { x: 400, y: 350 });
    fireEvent.pointerUp(layer, { pointerId: 1, clientX: 400, clientY: 350 });
    const after = snapshot(window.__vidi6!.doc)[0];
    expect(after).toMatchObject({ x: before.x, y: before.y });
    expect(noteEl(noteId).dataset.selected).toBe('false');
    expect(shapes()).toHaveLength(1);
  });
});
