import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { newDoc } from './helpers';

const hoisted = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));

vi.mock('../../src/client/board/useBoardDoc', async () => {
  const model = await import('../../src/shared/board-model');
  const react = await import('react');
  return {
    useBoardDoc: () => {
      const doc = hoisted.doc;
      const [objects, setObjects] = react.useState(() => model.snapshotObjects(doc));
      react.useEffect(() => {
        const map = doc.getMap('objects');
        const h = () => setObjects(model.snapshotObjects(doc));
        map.observeDeep(h);
        return () => map.unobserveDeep(h);
      }, [doc]);
      return { doc, objects, connection: 'connected' };
    },
  };
});

import { createSticky, snapshotObjects } from '../../src/shared/board-model';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import { createShape, getShapeLabel, type ShapeSnap } from '../../src/shared/objects/shape';
import { App } from './TestApp';

afterEach(cleanup);
beforeEach(() => { hoisted.doc = newDoc(); });

// jsdom viewport 1024 x 768; the initial camera puts the world origin at the centre.
const ORIGIN = { x: 512, y: 384 };
const shapes = () => snapshotObjects(hoisted.doc).filter((o): o is ShapeSnap => o.type === 'shape');
const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const layer = () => screen.getByTestId('shape-tool-layer');
const ptr = (clientX: number, clientY: number, extra: object = {}) => ({ clientX, clientY, pointerId: 1, button: 0, ...extra });

function drawShape(from: [number, number], to: [number, number], extra: object = {}) {
  fireEvent.pointerDown(layer(), ptr(from[0], from[1]));
  fireEvent.pointerMove(layer(), ptr(to[0], to[1], extra));
  fireEvent.pointerUp(layer(), ptr(to[0], to[1], extra));
}

describe('shape tool', () => {
  it('TC-15 S then drag previews, creates one shape covering the drag and selects it', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 's' });
    expect(screen.getByRole('menuitemradio', { name: 'Rectangle' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.pointerDown(layer(), ptr(100, 100));
    fireEvent.pointerMove(layer(), ptr(300, 220));
    const preview = screen.getByTestId('shape-preview');
    expect(preview.style.left).toBe('100px');
    expect(preview.style.width).toBe('200px');
    expect(shapes()).toHaveLength(0);
    fireEvent.pointerUp(layer(), ptr(300, 220));
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0]).toMatchObject({ kind: 'rect', x: 100 - ORIGIN.x, y: 100 - ORIGIN.y, width: 200, height: 120 });
    const el = screen.getByRole('group', { name: 'Rectangle' });
    expect(el.getAttribute('data-selected')).toBe('true');
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('shape-tool-layer')).toBeNull();
  });

  it('a click, and a drag smaller than the minimum, drop a standard-size shape centred on the point', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Shape (S)' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Diamond' }));
    drawShape([400, 300], [400, 300]);
    expect(shapes()[0]).toMatchObject({
      kind: 'diamond', width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD,
      x: 400 - ORIGIN.x - SHAPE_DEFAULT_SIZE_WORLD / 2, y: 300 - ORIGIN.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    });
    expect(screen.getByRole('group', { name: 'Diamond' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 's' });
    drawShape([600, 500], [610, 700]); // 10 wide: below the minimum
    expect(shapes()).toHaveLength(2);
    expect(shapes()[1].width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });

  it('Shift makes the shape square using the larger dimension', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 's' });
    drawShape([100, 100], [300, 220], { shiftKey: true });
    expect(shapes()[0]).toMatchObject({ width: 200, height: 200 });
  });

  it('TC-22 Escape with the Shape tool returns to Select and creates nothing, even mid-drag', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.pointerDown(layer(), ptr(100, 100));
    fireEvent.pointerMove(layer(), ptr(300, 300));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    expect(shapes()).toHaveLength(0);
  });

  it('pointercancel creates nothing and keeps the tool', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.pointerDown(layer(), ptr(100, 100));
    fireEvent.pointerMove(layer(), ptr(300, 300));
    fireEvent.pointerCancel(layer(), ptr(300, 300));
    expect(screen.queryByTestId('shape-preview')).toBeNull();
    expect(shapes()).toHaveLength(0);
    expect(layer()).toBeTruthy();
  });

  it('TC-28 a drag that starts over a sticky creates a shape and does not move the sticky', () => {
    createSticky(hoisted.doc, { x: 0, y: 0 });
    const before = snapshotObjects(hoisted.doc)[0];
    render(<App />);
    fireEvent.keyDown(window, { key: 's' });
    drawShape([ORIGIN.x, ORIGIN.y], [ORIGIN.x + 300, ORIGIN.y + 200]);
    const sticky = snapshotObjects(hoisted.doc).find((o) => o.type === 'sticky')!;
    expect([sticky.x, sticky.y]).toEqual([before.x, before.y]);
    expect(shapes()).toHaveLength(1);
  });

  it('TC-16 double-click opens the label editor and stops at 500 characters', () => {
    const id = createShape(hoisted.doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 100 }, at: { x: 0, y: 0 } }, 'g')!;
    render(<App />);
    const el = screen.getByRole('group', { name: 'Rectangle' });
    fireEvent.doubleClick(el);
    const editor = screen.getByRole('textbox', { name: 'Shape label' }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(editor);
    fireEvent.input(editor, { target: { value: 'x'.repeat(600) } });
    expect(getShapeLabel(hoisted.doc, id)!.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(editor.value.length).toBe(SHAPE_LABEL_MAX_CHARS);
    fireEvent.input(editor, { target: { value: 'Checkout' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('group', { name: 'Rectangle: Checkout' })).toBeTruthy();
  });

  it('TC-17 fill and outline swatches recolour the selected shape and keep label, size and selection', () => {
    const id = createShape(hoisted.doc, { kind: 'ellipse', rect: { x: 0, y: 0, width: 200, height: 100 }, at: { x: 0, y: 0 } }, 'g')!;
    getShapeLabel(hoisted.doc, id)!.insert(0, 'Hi');
    render(<App />);
    expect(screen.queryByRole('toolbar', { name: 'Shape tools' })).toBeNull();
    const el = screen.getByRole('group', { name: 'Ellipse: Hi' });
    fireEvent.pointerDown(el, ptr(600, 400));
    fireEvent.pointerUp(window, ptr(600, 400));
    expect(screen.getAllByRole('button', { name: /fill$/ })).toHaveLength(7);
    expect(screen.getAllByRole('button', { name: /outline$/ })).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'blue fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'red outline' }));
    expect(shapes()[0]).toMatchObject({ fill: 'blue', stroke: 'red', label: 'Hi', width: 200, height: 100, x: 0, y: 0 });
    expect(screen.getByRole('group', { name: 'Ellipse: Hi' }).getAttribute('data-selected')).toBe('true');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'no fill' })); });
    expect(shapes()[0].fill).toBe('none');
  });

  it('S then create returns to Select with the new shape selected', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Shape (S)' }));
    expect(screen.getByRole('button', { name: 'Shape (S)' }).getAttribute('aria-pressed')).toBe('true');
    drawShape([100, 100], [300, 300]);
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Shape (S)' }).getAttribute('aria-pressed')).toBe('false');
  });
});
