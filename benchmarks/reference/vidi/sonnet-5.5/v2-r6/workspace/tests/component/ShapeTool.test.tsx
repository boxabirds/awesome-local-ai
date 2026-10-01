import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { snapshot, type ShapeSnapshot } from '../../src/shared/board-model';
import { SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
import { addNote, moveTo, noteEl, press, release, renderBoardAtOrigin } from './board';

const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });
const shapes = (doc: Y.Doc) => snapshot(doc).filter((o): o is ShapeSnapshot => o.type === 'shape');
const shapeEl = (id: string) => document.querySelector(`[data-shape-object][data-object-id="${id}"]`) as HTMLElement;
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

function addShape(doc: Y.Doc, x: number, y: number, w = 200, h = 120): string {
  let id = '';
  act(() => { id = createShape(doc, { kind: 'rect', rect: { x, y, width: w, height: h }, at: { x, y } }, 'g') as string; });
  return id;
}

describe('shape tool', () => {
  it('TC-15 S then drag previews and creates one shape, selected, and returns to Select', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    key('s');
    expect(pressed('Shape (S)')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Rectangle' }).getAttribute('aria-checked')).toBe('true');
    press(viewport, 100, 100);
    fireEvent.pointerMove(window, { clientX: 300, clientY: 220, pointerId: 1 });
    expect(screen.getByTestId('shape-preview')).toBeTruthy();
    expect(shapes(doc)).toHaveLength(0);
    fireEvent.pointerUp(window, { clientX: 300, clientY: 220, pointerId: 1 });
    const made = shapes(doc);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ kind: 'rect', x: 100, y: 100, width: 200, height: 120, fill: 'white', stroke: 'dark' });
    expect(shapeEl(made[0].id).dataset.selected).toBe('true');
    expect(pressed('Select (V)')).toBe('true');
    expect(screen.queryByTestId('shape-preview')).toBeNull();
  });

  it('click drops a standard diamond centred on the click; Shift draws a square', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    key('s');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Diamond' }));
    press(viewport, 400, 300);
    fireEvent.pointerUp(window, { clientX: 400, clientY: 300, pointerId: 1 });
    expect(shapes(doc)[0]).toMatchObject({ kind: 'diamond', x: 320, y: 220, width: 160, height: 160 });
    key('s');
    press(viewport, 10, 10);
    fireEvent.pointerMove(window, { clientX: 210, clientY: 130, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(window, { clientX: 210, clientY: 130, pointerId: 1, shiftKey: true });
    const last = shapes(doc).find((s) => s.x === 10);
    expect(last).toMatchObject({ width: 200, height: 200 });
  });

  it('TC-22 Escape leaves the Shape tool without creating anything, also mid-drag', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    key('s');
    key('Escape');
    expect(pressed('Select (V)')).toBe('true');
    key('s');
    press(viewport, 10, 10);
    fireEvent.pointerMove(window, { clientX: 200, clientY: 200, pointerId: 1 });
    key('Escape');
    fireEvent.pointerUp(window, { clientX: 200, clientY: 200, pointerId: 1 });
    expect(shapes(doc)).toHaveLength(0);
    expect(pressed('Select (V)')).toBe('true');
    expect(screen.queryByTestId('shape-preview')).toBeNull();
  });

  it('TC-28 a Shape-tool drag that starts on a sticky does not move it', async () => {
    const { doc, viewport } = await renderBoardAtOrigin();
    const id = addNote(doc, 100, 100);
    const before = { ...snapshot(doc).find((o) => o.id === id)! };
    key('s');
    press(noteEl(id), 100, 100);
    moveTo(window as unknown as Element, 300, 260);
    release(window as unknown as Element, 300, 260);
    const after = snapshot(doc).find((o) => o.id === id)!;
    expect([after.x, after.y]).toEqual([before.x, before.y]);
    expect(shapes(doc)).toHaveLength(1);
    expect(viewport).toBeTruthy();
  });
});

describe('shape object', () => {
  it('TC-16 double-click edits the label centred, capped at 500 characters', async () => {
    const { doc } = await renderBoardAtOrigin();
    const id = addShape(doc, 0, 0);
    fireEvent.pointerDown(shapeEl(id), { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(shapeEl(id), { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.doubleClick(shapeEl(id));
    const ta = screen.getByRole('textbox', { name: 'Shape label' }) as HTMLTextAreaElement;
    ta.value = 'x'.repeat(600);
    fireEvent.input(ta);
    expect(getShapeLabel(doc, id)!.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(ta.value).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(ta.className).toBe('shape-editor');
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(shapeEl(id).getAttribute('aria-label')).toMatch(/^Rectangle: x+$/);
    expect(shapeEl(id).dataset.selected).toBe('true');
  });

  it('TC-17 the toolbar swatches recolour the selected shape and keep label and selection', async () => {
    const { doc } = await renderBoardAtOrigin();
    const id = addShape(doc, 0, 0);
    act(() => { getShapeLabel(doc, id)!.insert(0, 'Checkout'); });
    fireEvent.pointerDown(shapeEl(id), { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(window, { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
    expect(screen.getAllByRole('button', { name: /fill$/ })).toHaveLength(7);
    expect(screen.getAllByRole('button', { name: /outline$/ })).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'blue fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'red outline' }));
    const s = shapes(doc)[0];
    expect(s).toMatchObject({ fill: 'blue', stroke: 'red', label: 'Checkout', width: 200, height: 120 });
    expect(shapeEl(id).dataset.selected).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'no fill' }));
    expect(shapes(doc)[0].fill).toBe('none');
  });
});
