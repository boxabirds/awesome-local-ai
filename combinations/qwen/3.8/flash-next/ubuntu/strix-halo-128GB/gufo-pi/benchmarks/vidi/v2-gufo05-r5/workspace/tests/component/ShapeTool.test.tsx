/**
 * Shape tool and shape object component tests (tasks 12, 14).
 *
 * TC-15 the Shape tool draws with the pointer and hands over to Select; TC-16 the label is edited
 * like any other text, up to its own limit; TC-17 the shape toolbar restyles without touching
 * anything else; TC-28 a shape drawn over a sticky note leaves the note where it was.
 */
import { act, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, expect, test } from 'vitest';
import type * as Y from 'yjs';
import { renderBoard, dispatchKey, runFrames } from './helpers';
import {
  createSticky,
  createShape,
  getShapeLabel,
  isShapeSnapshot,
  snapshot,
  type ObjectSnapshot,
  type ShapeSnapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
import type { ShapeKind } from '../../src/shared/objects/shape';

const pointer = (clientX: number, clientY: number, opts?: Record<string, unknown>) => ({
  pointerId: 7,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX,
  clientY,
  ...opts,
});

function doc(): Y.Doc {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook window.__vidi6 is not registered');
  return hooks.getDoc();
}

function objects(): readonly ObjectSnapshot[] {
  return window.__vidi6?.getObjects() ?? [];
}

function shapes(): readonly ShapeSnapshot[] {
  return objects().filter(isShapeSnapshot);
}

function shapeOf(id: string): ShapeSnapshot | undefined {
  return shapes().find((obj) => obj.id === id);
}

function shapeElement(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-shape-id="${id}"]`);
  if (!el) throw new Error(`shape ${id} is not rendered`);
  return el;
}

function noteOf(id: string): StickySnapshot {
  const note = (window.__vidi6?.getNotes() ?? []).find((n: StickySnapshot) => n.id === id);
  if (!note) throw new Error(`note ${id} is not in the document`);
  return note;
}

function noteElement(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`note ${id} is not rendered`);
  return el;
}

function shapeSurface(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="shape-tool-surface"]');
  if (!el) throw new Error('the Shape tool is not up');
  return el;
}

function shapeSurfaceOrNone(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="shape-tool-surface"]');
}

function selectButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Select (V)' });
}

async function addShape(rect: Rect, kind: ShapeKind = 'rect'): Promise<string> {
  let id = '';
  await act(() => {
    id =
      createShape(
        doc(),
        { kind, rect, at: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } },
        'local',
      ) ?? '';
  });
  await runFrames();
  return id;
}

/** Click the middle of a shape's box: the generic gesture selects it without moving anything. */
async function clickShape(id: string, at: [number, number]): Promise<void> {
  const el = shapeElement(id);
  fireEvent.pointerDown(el, pointer(at[0], at[1]));
  fireEvent.pointerUp(el, pointer(at[0], at[1]));
  await runFrames();
}

async function addNote(x: number, y: number): Promise<string> {
  let id = '';
  await act(() => {
    id = createSticky(doc(), { x, y });
  });
  await runFrames();
  return id;
}

/**
 * Start the Shape tool, press at `from`, drag to `to`, release. The board is at the origin at zoom
 * 1, so a screen point and a world point are the same numbers throughout.
 */
async function dragShape(from: [number, number], to: [number, number], shift = false): Promise<void> {
  const surface = shapeSurface();
  fireEvent.pointerDown(surface, pointer(from[0], from[1]));
  fireEvent.pointerMove(surface, pointer(to[0], to[1], { shiftKey: shift }));
  await runFrames();
  fireEvent.pointerUp(surface, pointer(to[0], to[1], { shiftKey: shift }));
  await runFrames();
}

async function startShapeTool(): Promise<void> {
  dispatchKey(window, { key: 's' });
  await runFrames();
}

/** Put the camera where the tests read the board from: the origin, at 1:1. */
async function originCamera(): Promise<void> {
  window.__vidi6!.setCamera({ x: 0, y: 0, zoom: 1 });
  await runFrames();
  await runFrames();
}

async function openBoard(): Promise<void> {
  renderBoard();
  await runFrames();
  await originCamera();
}

describe('the Shape tool (TC-15, TC-28)', () => {
  test('TC-15 pressing s, then pressing, dragging and releasing the board draws one shape and Select takes over', async () => {
    await openBoard();

    await startShapeTool();
    expect(shapeSurface()).toBeTruthy();

    const surface = shapeSurface();
    fireEvent.pointerDown(surface, pointer(300, 200));
    fireEvent.pointerMove(surface, pointer(360, 230));
    await runFrames();
    // the rectangle being dragged is shown while the pointer is still down
    const preview = document.querySelector<HTMLElement>('[data-testid="shape-preview"]');
    expect(preview).not.toBeNull();
    expect(preview?.getAttribute('data-kind')).toBe('rect');

    fireEvent.pointerMove(surface, pointer(420, 260));
    fireEvent.pointerUp(surface, pointer(420, 260));
    await runFrames();

    const drawn = shapes();
    expect(drawn.length).toBe(1);
    expect(drawn[0]).toMatchObject({ kind: 'rect', x: 300, y: 200, width: 120, height: 60 });

    // the new shape is selected, and Select is the active tool again
    expect(shapeElement(drawn[0]!.id)).toHaveAttribute('data-selected', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(shapeSurfaceOrNone()).toBeNull();
  });

  test('TC-15 a press and release without a drag makes a default-sized shape around the point', async () => {
    await openBoard();
    await startShapeTool();

    // a press with no drag at all: the shape is centred on the point that was pressed
    const surface = shapeSurface();
    fireEvent.pointerDown(surface, pointer(400, 300));
    fireEvent.pointerUp(surface, pointer(400, 300));
    await runFrames();

    const drawn = shapes();
    expect(drawn.length).toBe(1);
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    expect(drawn[0]).toMatchObject({
      x: 400 - half,
      y: 300 - half,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });
  });

  test('TC-15 holding shift while releasing makes the drawn rectangle a square', async () => {
    await openBoard();
    await startShapeTool();
    await dragShape([200, 200], [420, 290], true);

    const drawn = shapes();
    expect(drawn.length).toBe(1);
    expect(drawn[0]!.width).toBe(drawn[0]!.height);
    // the corner the drag started from stays put
    expect(drawn[0]).toMatchObject({ x: 200, y: 200, width: 220, height: 220 });
  });

  test('TC-28 a shape dragged out over a sticky note leaves the note exactly where it was', async () => {
    await openBoard();
    const id = await addNote(300, 300);
    const before = noteOf(id);
    expect(noteElement(id)).toBeTruthy();

    await startShapeTool();
    // the drag starts on top of where the note is: while the Shape tool is up the note is not under
    // the pointer at all, so it is not picked up, not moved and not selected
    await dragShape([300, 300], [520, 440]);

    const after = noteOf(id);
    expect({ x: after.x, y: after.y, width: after.width, height: after.height }).toEqual({
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
    });
    expect(noteElement(id)).not.toHaveAttribute('data-selected', 'true');
    expect(shapes().length).toBe(1);
  });
});

describe('the shape object (TC-16)', () => {
  test('TC-16 double-clicking a shape edits its label, and typing is clamped to the label limit', async () => {
    await openBoard();
    const id = await addShape({ x: 100, y: 100, width: 240, height: 140 });

    fireEvent.doubleClick(shapeElement(id));
    await runFrames();
    const editor = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="shape-label-editor"]',
    );
    expect(editor).not.toBeNull();

    fireEvent.change(editor!, { target: { value: 'Start here' } });
    await runFrames();
    expect(shapeOf(id)?.label).toBe('Start here');

    // 600 characters typed become 500 kept, in one step that both participants replay the same way
    fireEvent.change(editor!, { target: { value: 'x'.repeat(600) } });
    await runFrames();
    const label = getShapeLabel(doc(), id);
    expect(label?.toString().length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(shapeOf(id)?.label.length).toBe(SHAPE_LABEL_MAX_CHARS);

    fireEvent.keyDown(editor!, { key: 'Escape' });
    await runFrames();
    expect(
      document.querySelector('[data-testid="shape-label-editor"]'),
    ).toBeNull();
  });
});

describe('the shape toolbar (TC-17)', () => {
  test('TC-17 the toolbar shows the palette; choosing a fill and an outline changes only those two', async () => {
    await openBoard();
    const id = await addShape({ x: 100, y: 100, width: 240, height: 140 });
    await clickShape(id, [200, 160]);

    const toolbar = document.querySelector('[data-testid="shape-toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(screen.getByRole('button', { name: 'yellow fill' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'blue outline' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'blue fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'red outline' }));
    await runFrames();

    const shape = shapeOf(id);
    expect(shape?.fill).toBe('blue');
    expect(shape?.stroke).toBe('red');
    // nothing else about the shape moved, changed kind or lost its label
    expect(shape).toMatchObject({ kind: 'rect', x: 100, y: 100, width: 240, height: 140, label: '' });
    // and it is still the selected thing
    expect(shapeElement(id)).toHaveAttribute('data-selected', 'true');
    // the swatches say which colours the shape has now
    expect(screen.getByRole('button', { name: 'blue fill' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'red outline' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('TC-17 clicking a swatch does not clear the selection or reach the board', async () => {
    await openBoard();
    const id = await addShape({ x: 100, y: 100, width: 240, height: 140 });
    await clickShape(id, [200, 160]);

    // a press on the bar is not a press on the board: it does not clear the selection, and it does
    // not paint anything either - a swatch answers to the click
    const swatch = screen.getByRole('button', { name: 'green fill' });
    fireEvent.pointerDown(swatch);
    await runFrames();
    expect(shapeElement(id)).toHaveAttribute('data-selected', 'true');
    expect(shapeOf(id)?.fill).toBe('white');

    fireEvent.click(swatch);
    await runFrames();
    expect(shapeOf(id)?.fill).toBe('green');
    expect(shapeElement(id)).toHaveAttribute('data-selected', 'true');
    expect(shapes().length).toBe(1);
  });

  test('TC-17 the toolbar deletes the shape it belongs to', async () => {
    await openBoard();
    const id = await addShape({ x: 0, y: 0, width: 100, height: 100 });
    await clickShape(id, [50, 50]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete shape' }));
    await runFrames();
    expect(shapes().length).toBe(0);
    expect(snapshot(doc()).find((obj) => obj.id === id)).toBeUndefined();
  });
});
