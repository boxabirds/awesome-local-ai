import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, initDoc, objectSnapshot, snapshot } from '../../src/shared/board-model';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { createShape, getShapeLabel, type ShapeSnap } from '../../src/shared/objects/shape';
import { countUpdates, key, pointer, press, renderApp, setCamera } from './helpers';

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const shapes = (doc: Y.Doc) => objectSnapshot(doc).filter((o) => o.type === 'shape') as ShapeSnap[];
const shapeEl = (id: string) => document.querySelector<HTMLElement>(`[data-shape-id="${id}"]`)!;
const surface = () => screen.getByTestId('shape-tool');
const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const selection = () => window.__vidi6!.selection!();

describe('Shape tool, shape object and shape toolbar (shape.ui)', () => {
  it('TC-15 S, drag: a preview follows the pointer, the release creates one shape exactly covering the drag and selects it', () => {
    const doc = freshDoc();
    renderApp(doc);
    setCamera({ x: 0, y: 0, zoom: 1 });
    key('s', document.body);
    expect(screen.getByRole('button', { name: 'Shape (S)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Rectangle' })).toHaveAttribute('aria-checked', 'true');
    pointer(surface(), 'down', 100, 100);
    pointer(surface(), 'move', 300, 220);
    const preview = screen.getByTestId('shape-preview');
    expect(preview).toHaveStyle({ left: '100px', top: '100px' });
    expect(preview).toHaveAttribute('width', '200');
    expect(preview).toHaveAttribute('height', '120');
    expect(shapes(doc)).toHaveLength(0);
    const updates = countUpdates(doc, () => pointer(surface(), 'up', 300, 220));
    expect(updates).toBe(1);
    const all = shapes(doc);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'rect', x: 100, y: 100, width: 200, height: 120 });
    expect(selection()).toEqual([all[0].id]);
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(shapeEl(all[0].id)).toHaveAttribute('data-selected', 'true');
  });

  it('a click with the Diamond kind drops a standard diamond centred on the click; Shift squares a drag', () => {
    const doc = freshDoc();
    renderApp(doc);
    setCamera({ x: -100, y: -50, zoom: 2 });
    key('s', document.body);
    act(() => screen.getByRole('menuitemradio', { name: 'Diamond' }).click());
    pointer(surface(), 'down', 400, 300);
    pointer(surface(), 'up', 401, 300);
    const [d] = shapes(doc);
    const s = SHAPE_DEFAULT_SIZE_WORLD;
    // Screen (400, 300) at zoom 2 from (-100, -50) is world (100, 100).
    expect(d).toMatchObject({ kind: 'diamond', x: 100 - s / 2, y: 100 - s / 2, width: s, height: s });

    key('s', document.body);
    expect(screen.getByRole('menuitemradio', { name: 'Diamond' })).toHaveAttribute('aria-checked', 'true');
    act(() => screen.getByRole('menuitemradio', { name: 'Ellipse' }).click());
    act(() => {
      fireEvent.pointerDown(surface(), { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
      fireEvent.pointerMove(surface(), { clientX: 200, clientY: 100, pointerId: 1, shiftKey: true });
      fireEvent.pointerUp(surface(), { clientX: 200, clientY: 100, pointerId: 1, shiftKey: true });
    });
    const e = shapes(doc).find((o) => o.kind === 'ellipse')!;
    expect(e).toMatchObject({ x: -100, y: -50, width: 100, height: 100 });
  });

  it('TC-16 double-click edits the label; 600 typed characters are cut to the limit', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'g')!;
    renderApp(doc);
    act(() => {
      fireEvent.doubleClick(shapeEl(id));
    });
    const editor = screen.getByRole('textbox', { name: 'Shape label' });
    expect(editor).toHaveFocus();
    expect(shapeEl(id)).toHaveAttribute('data-state', 'editing');
    act(() => {
      fireEvent.input(editor, { target: { value: 'Checkout flow step '.repeat(40).slice(0, 600) } });
    });
    expect(getShapeLabel(doc, id)!.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect((editor as HTMLTextAreaElement).value).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    act(() => {
      fireEvent.keyDown(editor, { key: 'Escape' });
    });
    expect(screen.queryByRole('textbox', { name: 'Shape label' })).toBeNull();
    // The label is drawn inside the shape and announced with the kind.
    expect(shapeEl(id)).toHaveAttribute('aria-label', expect.stringMatching(/^Rectangle: Checkout flow step/));
    expect(shapeEl(id).querySelector('[data-testid="shape-label"]')).toHaveStyle({ width: '200px', height: '120px' });
  });

  it('TC-17 fill and outline swatches recolour the selected shape and keep its label and the selection', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'ellipse', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'g')!;
    getShapeLabel(doc, id)!.insert(0, 'Paid?');
    renderApp(doc);
    press(shapeEl(id));
    expect(selection()).toEqual([id]);
    const toolbar = screen.getByRole('toolbar', { name: 'Shape' });
    const fills = screen.getAllByRole('button', { name: / fill$/ });
    expect(fills.map((b) => b.getAttribute('aria-label'))).toEqual([
      'none fill',
      'white fill',
      'blue fill',
      'green fill',
      'yellow fill',
      'pink fill',
      'grey fill',
    ]);
    expect(screen.getAllByRole('button', { name: / outline$/ })).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'white fill' })).toHaveAttribute('aria-pressed', 'true');
    act(() => screen.getByRole('button', { name: 'blue fill' }).click());
    act(() => screen.getByRole('button', { name: 'red outline' }).click());
    const s = shapes(doc)[0];
    expect(s).toMatchObject({ fill: 'blue', stroke: 'red', label: 'Paid?', x: 0, y: 0, width: 200, height: 120 });
    expect(selection()).toEqual([id]);
    expect(toolbar).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'blue fill' })).toHaveAttribute('aria-pressed', 'true');
    expect(shapeEl(id)).toHaveAttribute('data-fill', 'blue');
    expect(shapeEl(id)).toHaveAttribute('data-stroke', 'red');
  });

  it('TC-28 a Shape tool drag that starts over a sticky note does not move the note', () => {
    const doc = freshDoc();
    const noteId = createSticky(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 });
    renderApp(doc);
    setCamera({ x: 0, y: 0, zoom: 1 });
    key('s', document.body);
    // The tool's surface lies over the whole board, so the press over the note reaches it, not the note.
    pointer(surface(), 'down', 50, 50);
    pointer(surface(), 'move', 150, 150);
    pointer(surface(), 'up', 250, 250);
    expect(snapshot(doc)[0]).toMatchObject({ id: noteId, x: 0, y: 0 });
    expect(shapes(doc)[0]).toMatchObject({ x: 50, y: 50, width: 200, height: 200 });
    expect(selection()).toEqual([shapes(doc)[0].id]);
  });
});
