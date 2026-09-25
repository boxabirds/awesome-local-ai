/** Story 10 shape.ui component tests (TC-15 to TC-17, TC-28): Shape tool, ShapeObject label, ShapeToolbar. */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';
import { countUpdates } from './boardHelpers';
import { readCamera } from './helpers';
import { dragOn, key, objectEl, pointer, renderApp, shapes, toolButton, toScreen } from './shapeHelpers';

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
});

afterEach(() => {
  vi.useRealTimers();
});

function shapeLayer(): HTMLElement {
  return screen.getByTestId('shape-tool');
}

describe('shape.ui', () => {
  it('TC-15 S, drag (100,100)→(300,220): preview while dragging, one shape 200x120 created, selected, Select active', () => {
    renderApp(doc);
    key('s');
    expect(toolButton('Shape (S)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Rectangle' })).toHaveAttribute('aria-checked', 'true');
    const camera = readCamera();
    const updates = countUpdates(doc);

    const layer = shapeLayer();
    pointer(layer, 'pointerDown', { x: 100, y: 100 });
    pointer(layer, 'pointerMove', { x: 200, y: 160 });
    pointer(layer, 'pointerMove', { x: 300, y: 220 });
    const preview = screen.getByTestId('shape-preview');
    expect(preview.style.left).toBe('100px');
    expect(preview.getAttribute('width')).toBe('200');
    expect(preview.getAttribute('height')).toBe('120');
    expect(shapes(doc)).toHaveLength(0);
    pointer(layer, 'pointerUp', { x: 300, y: 220 });

    expect(updates.count).toBe(1);
    const all = shapes(doc);
    expect(all).toHaveLength(1);
    const s = all[0]!;
    const origin = screenToWorld(camera, { x: 100, y: 100 });
    expect(s).toMatchObject({ kind: 'rect', x: origin.x, y: origin.y, width: 200, height: 120, fill: 'white', stroke: 'dark' });
    expect(objectEl(s.id)).toHaveAttribute('data-selected', 'true');
    expect(screen.getAllByTestId('selection-outline').map((o) => o.dataset.objectId)).toEqual([s.id]);
    expect(toolButton('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(screen.queryByTestId('shape-preview')).toBeNull();
  });

  it('TC-15 a click drops a standard diamond centred on the point; Shift squares a drag', () => {
    renderApp(doc);
    const camera = readCamera();
    key('s');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Diamond' }));
    expect(screen.getByRole('menuitemradio', { name: 'Diamond' })).toHaveAttribute('aria-checked', 'true');
    pointer(shapeLayer(), 'pointerDown', { x: 400, y: 300 });
    pointer(shapeLayer(), 'pointerUp', { x: 400, y: 300 });
    const diamond = shapes(doc)[0]!;
    const at = screenToWorld(camera, { x: 400, y: 300 });
    expect(diamond).toMatchObject({ kind: 'diamond', width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD });
    expect(diamond.x + SHAPE_DEFAULT_SIZE_WORLD / 2).toBe(at.x);
    expect(diamond.y + SHAPE_DEFAULT_SIZE_WORLD / 2).toBe(at.y);
    expect(screen.getByRole('group', { name: 'Diamond' })).toBeInTheDocument();

    // The kind is remembered; Shift makes the drag square.
    key('s');
    expect(screen.getByRole('menuitemradio', { name: 'Diamond' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ellipse' }));
    dragOn(shapeLayer(), { x: 100, y: 500 }, { x: 300, y: 620 }, { shiftKey: true });
    const circle = shapes(doc).find((s) => s.kind === 'ellipse')!;
    expect(circle).toMatchObject({ width: 200, height: 200 });
  });

  it('TC-15 pointercancel creates nothing and keeps the Shape tool', () => {
    renderApp(doc);
    key('s');
    pointer(shapeLayer(), 'pointerDown', { x: 100, y: 100 });
    pointer(shapeLayer(), 'pointerMove', { x: 300, y: 220 });
    pointer(shapeLayer(), 'pointerCancel', { x: 300, y: 220 });
    expect(shapes(doc)).toHaveLength(0);
    expect(toolButton('Shape (S)')).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-16 double-click edits the label; typing 600 characters keeps 500', () => {
    renderApp(doc);
    let id = '';
    act(() => {
      id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'g')!;
    });
    fireEvent.doubleClick(objectEl(id));
    const ed = screen.getByRole('textbox', { name: 'Shape label' }) as HTMLTextAreaElement;
    expect(ed).toHaveFocus();
    ed.value = 'x'.repeat(600);
    fireEvent.input(ed);
    expect(getShapeLabel(doc, id)!.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(ed.value).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(shapes(doc)[0]!.label).toHaveLength(500);
    fireEvent.keyDown(ed, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Shape label' })).toBeNull();
    expect(screen.getByTestId('shape-label')).toHaveTextContent('x'.repeat(500));
    expect(objectEl(id)).toHaveAttribute('aria-label', `Rectangle: ${'x'.repeat(500)}`);
  });

  it('TC-17 blue fill and red outline swatches recolour the shape; label and selection unchanged', () => {
    renderApp(doc);
    let id = '';
    act(() => {
      id = createShape(doc, { kind: 'ellipse', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'g')!;
      getShapeLabel(doc, id)!.insert(0, 'Checkout');
    });
    const at = toScreen({ x: 100, y: 60 });
    pointer(objectEl(id), 'pointerDown', at);
    pointer(objectEl(id), 'pointerUp', at);
    expect(objectEl(id)).toHaveAttribute('data-selected', 'true');
    const toolbar = screen.getByRole('toolbar', { name: 'Shape' });
    expect(screen.getAllByRole('button', { name: / fill$/ })).toHaveLength(7);
    expect(screen.getAllByRole('button', { name: / outline$/ })).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'White fill' })).toHaveAttribute('aria-pressed', 'true');
    expect(toolbar).toBeInTheDocument();

    const before = shapes(doc)[0]!;
    fireEvent.click(screen.getByRole('button', { name: 'Blue fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Red outline' }));
    const after = shapes(doc)[0]!;
    expect(after).toMatchObject({ fill: 'blue', stroke: 'red', label: 'Checkout', x: before.x, y: before.y, width: before.width, height: before.height });
    expect(objectEl(id)).toHaveAttribute('data-selected', 'true');
    expect(objectEl(id)).toHaveAttribute('data-fill', 'blue');
    expect(objectEl(id).querySelector('ellipse')).toHaveAttribute('fill', '#BBDEFB');
    expect(screen.getByRole('button', { name: 'Blue fill' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Red outline' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'No fill' }));
    expect(shapes(doc)[0]!.fill).toBe('none');
  });

  it('TC-28 a Shape tool drag starting over a sticky note creates a shape and never moves the note', () => {
    renderApp(doc);
    act(() => {
      createSticky(doc, { x: 0, y: 0 });
    });
    const note = snapshot(doc)[0]!;
    key('s');
    const from = toScreen({ x: 0, y: 0 });
    dragOn(shapeLayer(), from, { x: from.x + 150, y: from.y + 100 });
    expect(snapshot(doc)[0]).toEqual(note);
    const s = shapes(doc);
    expect(s).toHaveLength(1);
    expect(s[0]!.z).toBeGreaterThan(note.z);
    expect(s[0]).toMatchObject({ x: 0, y: 0, width: 150, height: 100 });
  });
});

describe('shape and arrow undo steps (story 8 conventions)', () => {
  it('creating, restyling and re-attaching are one undo step each', () => {
    renderApp(doc);
    key('s');
    pointer(screen.getByTestId('shape-tool'), 'pointerDown', { x: 300, y: 300 });
    pointer(screen.getByTestId('shape-tool'), 'pointerUp', { x: 300, y: 300 });
    const id = shapes(doc)[0]!.id;
    fireEvent.click(screen.getByRole('button', { name: 'Green fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Orange outline' }));
    expect(shapes(doc)[0]).toMatchObject({ fill: 'green', stroke: 'orange' });

    key('z', { ctrlKey: true });
    expect(shapes(doc)[0]).toMatchObject({ fill: 'green', stroke: 'dark' });
    key('z', { ctrlKey: true });
    expect(shapes(doc)[0]).toMatchObject({ fill: 'white', stroke: 'dark' });
    key('z', { ctrlKey: true });
    expect(shapes(doc)).toHaveLength(0);
    key('z', { ctrlKey: true, shiftKey: true });
    expect(shapes(doc).map((s) => s.id)).toEqual([id]);
  });
});
