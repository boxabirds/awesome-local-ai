// shape.ui (TC-15 to TC-17, TC-28): Shape tool, shape label editing and the shape toolbar.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { getShapeLabel } from '../../src/shared/objects/shape';
import { dispatchKey, useFakeFrames } from './helpers';
import {
  docWithShapes,
  objectEl,
  pressedTool,
  resetCameraTracking,
  selectedIds,
  shapesOf,
  toClient,
  toWorld,
  toolButton,
} from './shapeHelpers';
import { click, renderApp } from './stickyHelpers';
import { countLocalWrites } from './textHelpers';

beforeEach(() => {
  useFakeFrames();
  resetCameraTracking();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const shapeTool = () => screen.getByTestId('shape-tool');
const labelEditor = () => screen.queryByRole<HTMLTextAreaElement>('textbox', { name: 'Shape label' });

function drag(el: Element, from: { x: number; y: number }, to: { x: number; y: number }, init = {}) {
  fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, button: 0, pointerId: 1, ...init });
  fireEvent.pointerMove(el, { clientX: to.x, clientY: to.y, pointerId: 1, ...init });
  fireEvent.pointerUp(el, { clientX: to.x, clientY: to.y, pointerId: 1, ...init });
}

describe('shape.ui Shape tool', () => {
  it('TC-15 S, drag (100,100)→(300,220): preview, one shape of 200x120 there, selected, back to Select', () => {
    const { doc } = renderApp();
    const writes = countLocalWrites(doc);
    dispatchKey({ key: 's' });
    expect(pressedTool()).toBe('Shape (S)');
    // The kind menu shows with Rectangle chosen.
    expect(toolButton('Rectangle').getAttribute('aria-pressed')).toBe('true');

    fireEvent.pointerDown(shapeTool(), { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(shapeTool(), { clientX: 300, clientY: 220, pointerId: 1 });
    const preview = screen.getByTestId('shape-preview');
    expect(preview.style).toMatchObject({ left: '100px', top: '100px', width: '200px', height: '120px' });
    expect(shapesOf(doc)).toHaveLength(0);
    fireEvent.pointerUp(shapeTool(), { clientX: 300, clientY: 220, pointerId: 1 });

    const shapes = shapesOf(doc);
    expect(shapes).toHaveLength(1);
    expect(writes.n).toBe(1);
    const start = toWorld({ x: 100, y: 100 });
    expect(shapes[0]).toMatchObject({ kind: 'rect', ...start, width: 200, height: 120 });
    expect(selectedIds()).toEqual([shapes[0].id]);
    expect(pressedTool()).toBe('Select (V)');
    expect(screen.queryByTestId('shape-tool')).toBeNull();
  });

  it('a click drops a standard Diamond centred on the click; Shift squares a drag', () => {
    const { doc } = renderApp();
    fireEvent.click(toolButton('Shape (S)'));
    fireEvent.click(toolButton('Diamond'));
    expect(pressedTool()).toBe('Shape (S)');
    drag(shapeTool(), { x: 400, y: 300 }, { x: 400, y: 300 });
    const s = SHAPE_DEFAULT_SIZE_WORLD;
    const at = toWorld({ x: 400, y: 300 });
    expect(shapesOf(doc)[0]).toMatchObject({ kind: 'diamond', x: at.x - s / 2, y: at.y - s / 2, width: s, height: s });

    // The chosen kind is kept for the next shape.
    dispatchKey({ key: 's' });
    expect(toolButton('Diamond').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toolButton('Ellipse'));
    drag(shapeTool(), { x: 100, y: 100 }, { x: 300, y: 220 }, { shiftKey: true });
    expect(shapesOf(doc)[1]).toMatchObject({ kind: 'ellipse', width: 200, height: 200 });
  });

  it('pointercancel creates nothing and keeps the tool', () => {
    const { doc } = renderApp();
    dispatchKey({ key: 's' });
    fireEvent.pointerDown(shapeTool(), { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(shapeTool(), { clientX: 300, clientY: 220, pointerId: 1 });
    fireEvent.pointerCancel(shapeTool(), { pointerId: 1 });
    expect(screen.queryByTestId('shape-preview')).toBeNull();
    expect(shapesOf(doc)).toHaveLength(0);
    expect(pressedTool()).toBe('Shape (S)');
  });

  it('TC-28 a Shape drag starting over a sticky note does not move the note', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const note = createSticky(doc, { x: 0, y: 0 }) as string;
    renderApp(doc);
    dispatchKey({ key: 's' });
    const from = toClient({ x: 0, y: 0 });
    drag(shapeTool(), from, { x: from.x + 150, y: from.y + 90 });
    const sticky = objectsSnapshot(doc).find((o) => o.id === note)!;
    expect(sticky).toMatchObject({ x: -STICKY_SIZE_WORLD / 2, y: -STICKY_SIZE_WORLD / 2 });
    const shapes = shapesOf(doc);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ x: 0, y: 0, width: 150, height: 90 });
  });
});

describe('shape.ui ShapeObject label', () => {
  it('TC-16 double-click opens the label editor; 600 typed characters keep 500', () => {
    const { doc, ids } = docWithShapes([{ x: 0, y: 0, width: 200, height: 120 }]);
    renderApp(doc);
    fireEvent.doubleClick(objectEl(ids[0]));
    const editor = labelEditor();
    expect(editor).not.toBeNull();
    expect(document.activeElement).toBe(editor);
    fireEvent.change(editor!, { target: { value: 'x'.repeat(600) } });
    expect(getShapeLabel(doc, ids[0])!.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(editor!.value).toHaveLength(SHAPE_LABEL_MAX_CHARS);

    // Escape ends editing; the label shows centred in the shape, which is announced with it.
    fireEvent.keyDown(editor!, { key: 'Escape' });
    expect(labelEditor()).toBeNull();
    const el = objectEl(ids[0]);
    expect(el.getAttribute('aria-roledescription')).toBe('Rectangle');
    expect(el.getAttribute('aria-label')).toBe('x'.repeat(SHAPE_LABEL_MAX_CHARS));
  });

  it('Enter on a selected shape edits its label; a label is named by its text', () => {
    const { doc, ids } = docWithShapes([{ x: 0, y: 0, width: 200, height: 120 }], 'diamond');
    getShapeLabel(doc, ids[0])!.insert(0, 'Paid?');
    renderApp(doc);
    expect(screen.getByRole('group', { name: 'Paid?' }).getAttribute('aria-roledescription')).toBe('Diamond');
    click(objectEl(ids[0]));
    dispatchKey({ key: 'Enter' });
    expect(labelEditor()?.value).toBe('Paid?');
  });
});

describe('shape.ui ShapeToolbar', () => {
  it('TC-17 blue fill and red outline swatches recolour the shape; label and selection unchanged', () => {
    const { doc, ids } = docWithShapes([{ x: 0, y: 0, width: 200, height: 120 }]);
    getShapeLabel(doc, ids[0])!.insert(0, 'Checkout');
    renderApp(doc);
    click(objectEl(ids[0]));
    const toolbar = screen.getByRole('toolbar', { name: 'Shape toolbar' });
    expect(toolbar.querySelectorAll('button[aria-label$=" fill"]')).toHaveLength(7);
    expect(toolbar.querySelectorAll('button[aria-label$=" outline"]')).toHaveLength(6);

    fireEvent.click(screen.getByRole('button', { name: 'blue fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'red outline' }));
    expect(shapesOf(doc)[0]).toMatchObject({
      fill: 'blue',
      stroke: 'red',
      label: 'Checkout',
      x: 0,
      y: 0,
      width: 200,
      height: 120,
    });
    expect(selectedIds()).toEqual([ids[0]]);
    expect(screen.getByRole('button', { name: 'blue fill' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'none fill' }));
    expect(shapesOf(doc)[0].fill).toBe('none');
  });
});
