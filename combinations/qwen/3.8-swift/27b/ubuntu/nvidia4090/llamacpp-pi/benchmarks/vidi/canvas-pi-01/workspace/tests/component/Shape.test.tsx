// Shape tool / shape object / shape toolbar component tests (story 10,
// TC-15 to TC-17, TC-28). The board is the full app at the 1280x800 fixture
// with the HOME camera, so world (0,0) is screen (640, 400) at zoom 1.

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
} from '../../src/shared/config';
import {
  dispatch,
  installResizeObserverMock,
  inputValue,
  pointerEvent,
  renderApp,
  windowKey,
} from './helpers';
import { liveNotes, noteAt } from './story7-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => {
  cleanup();
});

const selectBtn = (): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>('button[aria-label="Select (V)"]');
  if (el === null) throw new Error('Select (V) button not rendered');
  return el;
};

const shapeBtn = (): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>('button[data-testid="shape"]');
  if (el === null) throw new Error('Shape button not rendered');
  return el;
};

const shapeEls = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-testid="shape-object"]'));

/** Create a shape by dragging the Shape tool overlay (S shortcut). */
function dragShape(container: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
  windowKey('s');
  const overlay = container.querySelector<HTMLElement>('[data-testid="shape-tool"]');
  if (overlay === null) throw new Error('shape tool overlay not rendered');
  dispatch(overlay, pointerEvent('pointerdown', from.x, from.y));
  dispatch(overlay, pointerEvent('pointermove', to.x, to.y));
  dispatch(overlay, pointerEvent('pointerup', to.x, to.y));
}

/** Create a standard-size shape by clicking the Shape tool overlay. */
function clickShapeAt(container: HTMLElement, x: number, y: number): void {
  windowKey('s');
  const overlay = container.querySelector<HTMLElement>('[data-testid="shape-tool"]');
  if (overlay === null) throw new Error('shape tool overlay not rendered');
  dispatch(overlay, pointerEvent('pointerdown', x, y));
  dispatch(overlay, pointerEvent('pointerup', x, y));
}

describe('shape.ui', () => {
  it('TC-15 S tool pointerdown/move/up → preview shown, createShape called once, selection = new id', async () => {
    const { container } = await renderApp();
    dragShape(container, { x: 700, y: 450 }, { x: 900, y: 550 });

    // One shape created: 200x100 at world (60,50).
    const shapes = liveNotes().filter((n) => n.type === 'shape');
    expect(shapes).toHaveLength(1);
    const shape = shapes[0]!;
    expect(shape.x).toBe(60);
    expect(shape.y).toBe(50);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(100);

    // Selected (the new id) and the tool returned to Select.
    const el = shapeEls(container)[0]!;
    expect(el.getAttribute('data-id')).toBe(shape.id);
    expect(el.hasAttribute('data-selected')).toBe(true);
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-15b the dashed preview is shown while dragging and gone after release', async () => {
    const { container } = await renderApp();
    windowKey('s');
    const overlay = container.querySelector<HTMLElement>('[data-testid="shape-tool"]');
    if (overlay === null) throw new Error('shape tool overlay not rendered');
    dispatch(overlay, pointerEvent('pointerdown', 700, 450));
    dispatch(overlay, pointerEvent('pointermove', 900, 550));
    expect(container.querySelector('[data-testid="shape-draft"]')).not.toBeNull();
    dispatch(overlay, pointerEvent('pointerup', 900, 550));
    expect(container.querySelector('[data-testid="shape-draft"]')).toBeNull();
  });

  it('TC-16 dblclick shape, type 600 chars → editor open, label length SHAPE_LABEL_MAX_CHARS (boundary)', async () => {
    const { container } = await renderApp();
    clickShapeAt(container, 640, 400);

    const el = shapeEls(container)[0]!;
    dispatch(el, new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const editor = container.querySelector<HTMLElement>('[data-testid="shape-editor"]');
    expect(editor).not.toBeNull();
    const textarea = editor!.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).not.toBeNull();

    inputValue(textarea!, 'a'.repeat(600));
    const shapes = liveNotes().filter((n) => n.type === 'shape');
    expect(shapes[0]!.label).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(shapeEls(container)[0]!.getAttribute('data-label')).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });

  it('TC-17 click blue fill and red outline swatches → colours applied; label and selection unchanged', async () => {
    const { container } = await renderApp();
    clickShapeAt(container, 640, 400);
    const shapes = liveNotes().filter((n) => n.type === 'shape');
    const id = shapes[0]!.id;
    expect(shapes[0]!.label).toBe('');

    const toolbar = container.querySelector<HTMLElement>('[data-testid="shape-toolbar"]');
    expect(toolbar).not.toBeNull();
    const blue = container.querySelector<HTMLButtonElement>('[data-testid="fill-blue"]');
    const red = container.querySelector<HTMLButtonElement>('[data-testid="stroke-red"]');
    expect(blue).not.toBeNull();
    expect(red).not.toBeNull();
    dispatch(blue!, new MouseEvent('click', { bubbles: true, cancelable: true }));
    dispatch(red!, new MouseEvent('click', { bubbles: true, cancelable: true }));

    const after = liveNotes().filter((n) => n.type === 'shape');
    expect(after[0]!.fill).toBe('blue');
    expect(after[0]!.stroke).toBe('red');
    // Label and size unchanged…
    expect(after[0]!.label).toBe('');
    expect(after[0]!.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    // …and the shape is still selected.
    const el = shapeEls(container).find((e) => e.getAttribute('data-id') === id);
    expect(el!.hasAttribute('data-selected')).toBe(true);
    expect(blue!.getAttribute('aria-pressed')).toBe('true');
    expect(red!.getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-28 Shape tool drag starting over an existing sticky → sticky position unchanged (negative)', async () => {
    const { container } = await renderApp();
    noteAt(100, 100); // top-left at world (100,100)
    const before = liveNotes().find((n) => n.type === 'sticky')!;
    expect(before.x).toBe(100);
    expect(before.y).toBe(100);

    // Drag starting at the sticky's centre (screen 840,600) → (1000,700).
    dragShape(container, { x: 840, y: 600 }, { x: 1000, y: 700 });

    const after = liveNotes().find((n) => n.id === before.id)!;
    expect(after.x).toBe(100);
    expect(after.y).toBe(100);
    // The drag created a shape instead of moving the sticky.
    expect(liveNotes().filter((n) => n.type === 'shape')).toHaveLength(1);
  });

  it('TC-15c click (no drag) → standard-size shape centred on the click', async () => {
    const { container } = await renderApp();
    clickShapeAt(container, 640, 400); // world (0,0)
    const shape = liveNotes().find((n) => n.type === 'shape')!;
    expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.x).toBe(-SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(shape.y).toBe(-SHAPE_DEFAULT_SIZE_WORLD / 2);
    // Shape tool reverts to select after creating (tools.return_to_select).
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');
    expect(shapeBtn().getAttribute('aria-pressed')).toBe('false');
  });

  it('Shift while dragging → square anchored at the drag origin', async () => {
    const { container } = await renderApp();
    windowKey('s');
    const overlay = container.querySelector<HTMLElement>('[data-testid="shape-tool"]');
    if (overlay === null) throw new Error('shape tool overlay not rendered');
    dispatch(overlay, pointerEvent('pointerdown', 700, 450));
    dispatch(overlay, new MouseEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      clientX: 900,
      clientY: 550,
      button: 0,
      shiftKey: true,
    }));
    dispatch(overlay, new MouseEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      clientX: 900,
      clientY: 550,
      button: 0,
      shiftKey: true,
    }));
    const shape = liveNotes().find((n) => n.type === 'shape')!;
    // Dragged 200x100 with Shift → 200x200 anchored at the drag origin.
    expect(shape.x).toBe(60);
    expect(shape.y).toBe(50);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
  });
});
