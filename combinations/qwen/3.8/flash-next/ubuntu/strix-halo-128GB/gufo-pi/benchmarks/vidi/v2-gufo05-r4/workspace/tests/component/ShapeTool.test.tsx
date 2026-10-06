/**
 * Shapes on the board, drawn by hand (`shape.ui`).
 *
 * Everything here is asked of the real screen: the tool is held, the pointer moves, and the
 * answer is what the document ended up with and what the board shows. The one thing the Shape
 * tool must never do — move the thing you pressed on instead of drawing over it — is TC-28.
 */

import { act, cleanup, render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardScreen } from '../../src/client/board/BoardScreen';
import { boardObjects, createSticky, objectBounds, type ObjectSnapshot } from '../../src/shared/board-model';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { worldToScreen } from '../../src/client/canvas/camera';
import { createShape, getShapeLabel, type ShapeSnap } from '../../src/shared/objects/shape';
import {
  doubleClick,
  fireInput,
  fireKey,
  clickElement,
  firePointer,
  flushCameraFrame,
  flushFrames,
  shapeEditor,
  stubResizeObserver,
  stubViewportGeometry,
  testCamera,
  toolButton,
  toolPressed,
  viewportElement
} from './harness';

// The connection is reported through the module, so the board is editable without a server.
const connection: { current: string } = { current: 'connected' };

vi.mock('../../src/client/board/useBoardDoc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/board/useBoardDoc')>();
  return {
    ...actual,
    useBoardDoc: (options: Parameters<typeof actual.useBoardDoc>[0]) => ({
      ...actual.useBoardDoc(options),
      connection: connection.current
    })
  };
});

interface BoardFixture {
  doc: Y.Doc;
  root: HTMLElement;
  objects(): readonly ObjectSnapshot[];
}

beforeEach(() => {
  connection.current = 'connected';
  vi.useFakeTimers();
  stubViewportGeometry();
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderBoard(): Promise<BoardFixture> {
  const doc = new Y.Doc();
  const result: RenderResult = render(<BoardScreen doc={doc} />);
  await flushCameraFrame();
  return { doc, root: result.container, objects: () => boardObjects(doc) };
}

/** A board point as the screen currently sees it. */
function screen(world: Point): Point {
  return worldToScreen(testCamera(), world);
}

function shapeSnapshot(board: BoardFixture, id: string): ShapeSnap {
  const object = board.objects().find((candidate) => candidate.id === id);
  if (!object || object.type !== 'shape') throw new Error(`shape ${id} is not on the board`);
  return object as ShapeSnap;
}

function shapeElement(board: BoardFixture, id: string): HTMLElement {
  const element = board.root.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (!element) throw new Error(`shape ${id} is not on screen`);
  return element;
}

function shapes(board: BoardFixture): ShapeSnap[] {
  return board.objects().filter((object) => object.type === 'shape') as ShapeSnap[];
}

/** The Shape tool's surface. In a browser it is the only thing under the pointer. */
function shapeSurface(board: BoardFixture): HTMLElement {
  const element = board.root.querySelector<HTMLElement>('[data-vidi6="shape-tool"]');
  if (!element) throw new Error('the Shape tool is not being held');
  return element;
}

function holdShapeTool(board: BoardFixture): void {
  fireKey('s');
  expect(viewportElement(board.root).dataset.tool).toBe('shape');
}

function preview(board: BoardFixture): HTMLElement | null {
  return board.root.querySelector<HTMLElement>('[data-vidi6="shape-preview"]');
}

/** Press, move in steps, release — a real drag, not a call. */
async function dragOn(
  target: Element,
  from: Point,
  to: Point,
  options: { shift?: boolean; steps?: number } = {}
): Promise<void> {
  const steps = options.steps ?? 3;
  firePointer(target, 'pointerdown', from.x, from.y, { shiftKey: options.shift });
  for (let step = 1; step <= steps; step += 1) {
    firePointer(
      target,
      'pointermove',
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps,
      { shiftKey: options.shift }
    );
    await flushFrames();
  }
  firePointer(target, 'pointerup', to.x, to.y, { shiftKey: options.shift });
  await flushFrames();
}

async function click(board: BoardFixture, world: Point): Promise<void> {
  const point = screen(world);
  await dragOn(shapeSurface(board), point, point, { steps: 1 });
}

describe('the Shape tool', () => {
  it('TC-15: drags out a rectangle to an exact size, once, and hands the pen back', async () => {
    const board = await renderBoard();
    holdShapeTool(board);
    expect(toolPressed(toolButton(board.root, 'shape'))).toBe(true);

    const from = screen({ x: -300, y: -200 });
    const to = screen({ x: -100, y: -80 });
    firePointer(shapeSurface(board), 'pointerdown', from.x, from.y);
    await flushFrames();

    // The promise appears before the thing does, and says what kind it will be.
    const ghost = preview(board);
    expect(ghost).not.toBeNull();
    expect((ghost?.querySelector('[data-vidi6="shape-preview-outline"]') as HTMLElement).dataset.kind).toBe('rect');
    expect(shapes(board)).toHaveLength(0);

    firePointer(shapeSurface(board), 'pointermove', to.x, to.y);
    await flushFrames();
    // The promise is drawn in screen pixels, and says how big the thing will be: at 100% the
    // box shown and the box stored are the same box.
    const grown = preview(board)!;
    expect(Number(grown.getAttribute('width'))).toBeCloseTo(to.x - from.x, 6);
    expect(Number(grown.getAttribute('height'))).toBeCloseTo(to.y - from.y, 6);

    firePointer(shapeSurface(board), 'pointerup', to.x, to.y);
    await flushFrames();

    // One shape, exactly the box that was shown, selected, and the tool is put down (`tools.pen`).
    const [shape] = shapes(board);
    expect(shape).toBeDefined();
    expect(objectBounds(shape)).toEqual({ x: -300, y: -200, width: 200, height: 120 });
    expect(shape.fill).toBe('white');
    expect(shape.stroke).toBe('dark');
    expect(getShapeLabel(board.doc, shape.id)?.toString()).toBe('');
    expect(preview(board)).toBeNull();
    expect(viewportElement(board.root).dataset.tool).toBe('select');
    expect(shapeElement(board, shape.id).dataset.selected).toBe('true');
  });

  it('makes a standard size wherever it is clicked, including outside everything', async () => {
    const board = await renderBoard();
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;

    holdShapeTool(board);
    await click(board, { x: -100, y: 0 });
    expect(objectBounds(shapes(board)[0])).toEqual({
      x: -100 - half,
      y: -half,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD
    });

    // A second click, outside every object, makes a second shape where it landed.
    holdShapeTool(board);
    await click(board, { x: 400, y: 300 });
    expect(shapes(board)).toHaveLength(2);
    expect(objectBounds(shapes(board)[1])).toEqual({
      x: 400 - half,
      y: 300 - half,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD
    });
  });

  it('draws a square while Shift is held', async () => {
    const board = await renderBoard();
    holdShapeTool(board);
    await dragOn(shapeSurface(board), screen({ x: -300, y: -200 }), screen({ x: -100, y: -80 }), {
      shift: true
    });
    const bounds = objectBounds(shapes(board)[0]);
    expect(bounds.width).toBe(200);
    expect(bounds.height).toBe(200);
  });

  it('TC-16: opens a label on double-click and keeps it inside its limit', async () => {
    const board = await renderBoard();
    const id = makeShape(board, { x: -200, y: -100, width: 200, height: 120 });
    await flushFrames();

    const middle = screen({ x: -100, y: -40 });
    doubleClick(shapeElement(board, id), middle.x, middle.y);
    const editor = shapeEditor(board.root);
    expect(editor).not.toBeNull();
    // Editing a label is not an invitation to start drawing behind it.
    expect(viewportElement(board.root).dataset.tool).toBe('select');

    const tooLong = 'x'.repeat(600);
    fireInput(editor!, tooLong);
    // Putting the pen down ends the edit and keeps what was typed (Escape does not discard a
    // shape's label, the way it discards a note's colour change).
    fireKey('Escape', { target: editor! });
    await flushFrames();

    expect(getShapeLabel(board.doc, id)?.toString()).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(shapeEditor(board.root)).toBeNull();
    // A label that wrapped is still a label: the shape is where it was, still the one selected.
    expect(objectBounds(shapeSnapshot(board, id))).toEqual({ x: -200, y: -100, width: 200, height: 120 });
  });

  it('TC-17: paints a shape from its toolbar without touching anything else', async () => {
    const board = await renderBoard();
    const id = makeShape(board, { x: -200, y: -100, width: 200, height: 120 });
    await flushFrames();
    // Select it the way a visitor does, and let it grow a label to lose.
    await clickObject(board, id);
    await editText(board, id, 'Quarterly plan');
    await clickObject(board, id);
    const before = shapeSnapshot(board, id);

    const toolbar = board.root.querySelector<HTMLElement>('[data-vidi6="shape-toolbar"]');
    expect(toolbar).not.toBeNull();
    const fill = toolbar!.querySelector<HTMLElement>('[data-vidi6="shape-swatch"][data-role="fill"][data-color="blue"]');
    const outline = toolbar!.querySelector<HTMLElement>(
      '[data-vidi6="shape-swatch"][data-role="stroke"][data-color="red"]'
    );
    clickElement(fill!);
    clickElement(outline!);
    await flushFrames();

    const after = shapeSnapshot(board, id);
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe('red');
    expect(getShapeLabel(board.doc, id)?.toString()).toBe('Quarterly plan');
    expect(objectBounds(after)).toEqual(objectBounds(before));
    expect(shapeElement(board, id).dataset.selected).toBe('true');
  });

  it('TC-28: presses on a shape without pressing *it*: the tool owns the pointer', async () => {
    const board = await renderBoard();
    const noteId = createSticky(board.doc, { x: -300, y: -100 });
    const shapeId = makeShape(board, { x: -100, y: -100, width: 200, height: 200 });
    await flushFrames();
    // Both are on screen; press on the note to select it, so a stray move would move it.
    await clickObject(board, noteId);

    const before = board.objects().map((object) => objectBounds(object));
    holdShapeTool(board);

    // Press on the note and drag across the shape. In a browser the press cannot reach either:
    // the tool's surface is what is under the pointer (`tools.pen`).
    const overNote = screen({ x: -250, y: -50 });
    const across = screen({ x: 100, y: 50 });
    firePointer(shapeSurface(board), 'pointerdown', overNote.x, overNote.y);
    await flushFrames();
    expect(board.root.querySelector('[data-vidi6="marquee"]')).toBeNull();
    expect(preview(board)).not.toBeNull();
    firePointer(shapeSurface(board), 'pointermove', across.x, across.y);
    await flushFrames();

    expect(board.objects().map((object) => objectBounds(object))).toEqual(before);
    firePointer(shapeSurface(board), 'pointerup', across.x, across.y);
    await flushFrames();

    // Nothing moved; a shape was drawn where the drag went, over the objects it crossed.
    expect(board.objects().map((object) => objectBounds(object)).slice(0, 2)).toEqual(before);
    const drawn = shapes(board).find((shape) => shape.id !== shapeId);
    expect(drawn).toBeDefined();
    expect(objectBounds(drawn!)).toEqual({ x: -250, y: -50, width: 350, height: 100 });
  });

  it('picks a shape up by its rectangle, and not from just outside it', async () => {
    const board = await renderBoard();
    const id = makeShape(board, { x: -200, y: -100, width: 200, height: 120 });
    await flushFrames();

    await clickObject(board, id);
    expect(shapeElement(board, id).dataset.selected).toBe('true');

    // Just outside, and the press belongs to the board: the shape is put down again.
    const outside = screen({ x: 10, y: -40 });
    firePointer(viewportElement(board.root), 'pointerdown', outside.x, outside.y);
    firePointer(viewportElement(board.root), 'pointerup', outside.x, outside.y);
    await flushFrames();
    expect(shapeElement(board, id).dataset.selected).toBe('false');
  });

  it('draws ellipses and diamonds, which are the same gesture with a different outline', async () => {
    const board = await renderBoard();
    for (const kind of ['ellipse', 'diamond']) {
      // The kind sits beside the tool, as the design says: choose it, then draw it.
      clickElement(toolButton(board.root, 'shape'));
      clickElement(board.root.querySelector<HTMLElement>('[data-vidi6="tool-shape-kind"]')!);
      clickElement(board.root.querySelector<HTMLElement>(`[data-vidi6="shape-kind"][data-kind="${kind}"]`)!);
      await flushFrames();
      expect(toolPressed(toolButton(board.root, 'shape'))).toBe(true);
      holdShapeTool(board);
      await click(board, { x: 0, y: 0 });
    }
    expect(shapes(board).map((shape) => shape.kind)).toEqual(['ellipse', 'diamond']);
    // Each one is drawn as the kind it is.
    expect(board.root.querySelectorAll('ellipse').length).toBeGreaterThan(0);
    expect(board.root.querySelectorAll('polygon').length).toBeGreaterThan(0);
  });
});

/** Put a shape on the board the way the model does, so a test can start from one. */
function makeShape(board: BoardFixture, rect: { x: number; y: number; width: number; height: number }): string {
  let id = '';
  act(() => {
    id = createShape(board.doc, { kind: 'rect', rect, at: { x: rect.x, y: rect.y } }, '') ?? '';
  });
  if (!id) throw new Error('the shape was not created');
  return id;
}

/** Click an object at its middle. */
async function clickObject(board: BoardFixture, id: string): Promise<void> {
  const object = board.objects().find((candidate) => candidate.id === id);
  if (!object) throw new Error(`${id} is not on the board`);
  const bounds = objectBounds(object);
  const point = screen({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  const element = board.root.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (!element) throw new Error(`${id} is not on screen`);
  firePointer(element, 'pointerdown', point.x, point.y);
  firePointer(element, 'pointerup', point.x, point.y);
  await flushFrames();
}

/** Type into a shape's label editor and put the pen down. */
async function editText(board: BoardFixture, id: string, text: string): Promise<void> {
  const bounds = objectBounds(shapeSnapshot(board, id));
  const point = screen({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  doubleClick(shapeElement(board, id), point.x, point.y);
  const editor = shapeEditor(board.root);
  if (!editor) throw new Error(`shape ${id} did not open for editing`);
  fireInput(editor, text);
  fireKey('Escape', { target: editor });
  await flushFrames();
}
