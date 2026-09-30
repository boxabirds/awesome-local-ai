import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc, objectsSnapshot, snapshot } from '../../src/shared/board-model';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import { type ShapeSnap, getShapeLabel, isShape } from '../../src/shared/objects/shape';
import { flushFrame, pointer, stickyNotes } from './helpers';

// Pass-through spy: the real model runs, and calls are counted.
vi.mock('../../src/shared/objects/shape', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/objects/shape')>();
  return { ...actual, createShape: vi.fn(actual.createShape) };
});

const { App } = await import('../../src/client/App');
const shapeModel = await import('../../src/shared/objects/shape');

// jsdom has no layout: the camera starts centred on world (0, 0) at 100%.
const CENTRE = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

function setup(doc = newDoc()) {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  vi.mocked(shapeModel.createShape).mockClear();
  render(<App doc={doc} />);
  return { doc };
}

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const shapes = (doc: Y.Doc) => objectsSnapshot(doc).filter(isShape) as ShapeSnap[];
const layer = () => screen.getByTestId('shape-tool');
const selectPressed = () => screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed');
const shapeEl = (id: string) => document.querySelector(`[data-shape-object][data-id="${id}"]`) as HTMLElement;

function click(el: HTMLElement, x: number, y: number) {
  pointer(el, 'down', x, y);
  pointer(el, 'up', x, y);
}

describe('shape.ui ShapeTool', () => {
  it('TC-15 S, drag → dashed preview, createShape once, the new shape selected, back to Select', () => {
    const { doc } = setup();
    fireEvent.keyDown(window, { key: 's' });
    expect(screen.getByRole('button', { name: 'Shape (S)' }).getAttribute('aria-pressed')).toBe('true');
    // The kind menu opens with Rectangle selected.
    const menu = screen.getByRole('group', { name: 'Shape kind' });
    expect(within(menu).getByRole('button', { name: 'Rectangle' }).getAttribute('aria-pressed')).toBe('true');
    pointer(layer(), 'down', CENTRE.x + 100, CENTRE.y + 100);
    pointer(layer(), 'move', CENTRE.x + 300, CENTRE.y + 220);
    const preview = screen.getByTestId('shape-preview');
    expect(preview.style.left).toBe(`${CENTRE.x + 100}px`);
    expect(preview.style.width).toBe('200px');
    expect(preview.style.height).toBe('120px');
    expect(shapeModel.createShape).not.toHaveBeenCalled();
    pointer(layer(), 'up', CENTRE.x + 300, CENTRE.y + 220);
    expect(shapeModel.createShape).toHaveBeenCalledTimes(1);
    const [s] = shapes(doc);
    expect(s).toMatchObject({ kind: 'rect', x: 100, y: 100, width: 200, height: 120, fill: 'white', stroke: 'dark' });
    expect(window.__vidi6?.getSelection?.()).toEqual([s!.id]);
    expect(selectPressed()).toBe('true');
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(shapeEl(s!.id).dataset.selected).toBe('true');
  });

  it('Shift squares the preview and the shape; a click drops a standard diamond centred on the click', () => {
    const { doc } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Shape (S)' }));
    pointer(layer(), 'down', CENTRE.x, CENTRE.y);
    fireEvent.pointerMove(layer(), { clientX: CENTRE.x - 200, clientY: CENTRE.y + 120, pointerId: 1, shiftKey: true });
    const preview = screen.getByTestId('shape-preview');
    expect([preview.style.width, preview.style.height]).toEqual(['200px', '200px']);
    fireEvent.pointerUp(layer(), { clientX: CENTRE.x - 200, clientY: CENTRE.y + 120, pointerId: 1, shiftKey: true });
    expect(shapes(doc)[0]).toMatchObject({ x: -200, y: 0, width: 200, height: 200 });

    fireEvent.keyDown(window, { key: 's' });
    fireEvent.click(screen.getByRole('button', { name: 'Diamond' }));
    expect(screen.getByRole('button', { name: 'Diamond' }).getAttribute('aria-pressed')).toBe('true');
    click(layer(), CENTRE.x + 500, CENTRE.y + 40);
    const diamond = shapes(doc).find((s) => s.kind === 'diamond')!;
    expect(diamond).toMatchObject({ width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD });
    expect(diamond.x + diamond.width / 2).toBe(500);
    expect(diamond.y + diamond.height / 2).toBe(40);
    expect(shapeEl(diamond.id).querySelector('polygon')).not.toBeNull();
  });

  it('pointercancel creates nothing and the tool stays active', () => {
    const { doc } = setup();
    fireEvent.keyDown(window, { key: 's' });
    pointer(layer(), 'down', CENTRE.x, CENTRE.y);
    pointer(layer(), 'move', CENTRE.x + 100, CENTRE.y + 100);
    pointer(layer(), 'cancel', CENTRE.x + 100, CENTRE.y + 100);
    expect(shapes(doc)).toHaveLength(0);
    expect(screen.queryByTestId('shape-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'Shape (S)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-28 a Shape tool drag starting over a sticky note never moves the note', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    setup(doc);
    const before = snapshot(doc)[0]!;
    fireEvent.keyDown(window, { key: 's' });
    // The tool layer lies above every object, so it receives the press.
    const tool = layer();
    expect(tool.compareDocumentPosition(stickyNotes()[0]!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    pointer(tool, 'down', CENTRE.x, CENTRE.y);
    pointer(tool, 'move', CENTRE.x + 150, CENTRE.y + 90);
    flushFrame();
    pointer(tool, 'up', CENTRE.x + 150, CENTRE.y + 90);
    flushFrame();
    expect(snapshot(doc)[0]).toEqual(before);
    expect(shapes(doc)[0]).toMatchObject({ x: 0, y: 0, width: 150, height: 90 });
  });
});

describe('shape.ui ShapeObject and ShapeToolbar', () => {
  function withShape() {
    const doc = newDoc();
    const id = shapeModel.createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'g')!;
    setup(doc);
    return { doc, id };
  }

  it('TC-16 double-click opens the label editor; 600 typed characters keep 500; label centred in the shape', () => {
    const { doc, id } = withShape();
    fireEvent.doubleClick(shapeEl(id));
    const editor = screen.getByRole('textbox', { name: 'Shape label' }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(editor);
    expect(shapeEl(id).dataset.editing).toBe('true');
    fireEvent.input(editor, { target: { value: 'x'.repeat(600) } });
    expect(getShapeLabel(doc, id)!.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(editor.value).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(shapeEl(id).dataset.editing).toBe('false');
    expect(shapeEl(id).getAttribute('aria-label')).toBe(`Rectangle: ${'x'.repeat(SHAPE_LABEL_MAX_CHARS)}`);
    // The label box is the shape's box: it re-wraps and stays centred when resized.
    const box = within(shapeEl(id)).getByTestId('shape-label-box');
    expect([box.style.left, box.style.right, box.style.top, box.style.bottom]).toEqual(['0px', '0px', '0px', '0px']);
  });

  it('TC-17 blue fill and red outline swatches recolour the shape; label and selection unchanged', () => {
    const { doc, id } = withShape();
    act(() => {
      doc.transact(() => getShapeLabel(doc, id)!.insert(0, 'Checkout'));
    });
    click(shapeEl(id), CENTRE.x + 50, CENTRE.y + 50);
    expect(window.__vidi6?.getSelection?.()).toEqual([id]);
    const toolbar = screen.getByRole('toolbar', { name: 'Shape' });
    expect(within(toolbar).getAllByRole('button', { name: / fill$/ })).toHaveLength(7);
    expect(within(toolbar).getAllByRole('button', { name: / outline$/ })).toHaveLength(6);
    expect(within(toolbar).getByRole('button', { name: 'White fill' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Blue fill' }));
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Shape' })).getByRole('button', { name: 'Red outline' }));
    const s = shapes(doc)[0]!;
    expect(s).toMatchObject({ fill: 'blue', stroke: 'red', label: 'Checkout', x: 0, y: 0, width: 200, height: 120 });
    expect(window.__vidi6?.getSelection?.()).toEqual([id]);
    expect(shapeEl(id).querySelector('rect')!.getAttribute('fill')).toBe('#BBDEFB');
    expect(shapeEl(id).querySelector('rect')!.getAttribute('stroke')).toBe('#E53935');
    fireEvent.click(screen.getByRole('button', { name: 'No fill' }));
    expect(shapes(doc)[0]!.fill).toBe('none');
  });
});
