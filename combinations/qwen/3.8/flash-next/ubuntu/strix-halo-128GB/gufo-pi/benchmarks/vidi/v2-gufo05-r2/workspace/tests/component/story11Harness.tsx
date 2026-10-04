/**
 * Helpers for story 11's component tests: sketches on a real board.
 *
 * A stroke is drawn with a pointer, so most of what is worth checking here is a gesture:
 * down, along, and the various ways a gesture stops. Points are given in *board* units and
 * converted through the camera the page is using, so a test says "a loop 200 units wide"
 * and stays true at any zoom — which matters in a story whose whole subject is the
 * distance between a screen pixel and a board unit.
 */

import { act, screen } from '@testing-library/react';
import type * as Y from 'yjs';

import { objectBounds, objectSnapshots } from '../../src/shared/board-model';
import type { Point, Rect } from '../../src/shared/geometry';
import type { PenColor, PenThickness } from '../../src/shared/config';
import {
  createStroke,
  readStrokes,
  scaledPoints,
  type StrokeSnapshot,
} from '../../src/shared/objects/stroke';
import { worldToScreen } from '../../src/client/canvas/camera';
import {
  firePointer,
  flushFrames,
  readBoardDoc,
  readCamera,
  renderBoard,
} from './boardHarness';

export {
  fireKey,
  firePointer,
  fireWheel,
  flushFrames,
  readBoardDoc,
  readCamera,
  renderBoard,
  surface,
} from './boardHarness';

/** Render the board and hand back its live document. */
export function renderStory11(): Y.Doc {
  renderBoard();
  return readBoardDoc();
}

// --- holding the pen --------------------------------------------------------

export function penToolButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Pen (P)' }) as HTMLButtonElement;
}

export function selectToolButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Select (V)' }) as HTMLButtonElement;
}

export function pickPenTool(): void {
  act(() => penToolButton().click());
  flushFrames();
}

export function pickSelectTool(): void {
  act(() => selectToolButton().click());
  flushFrames();
}

/** The layer the Pen tool holds while it is held. */
export function penLayer(): HTMLElement {
  const el = screen.queryByTestId('pen-tool-layer');
  if (!el) throw new Error('the Pen tool is not in hand');
  return el;
}

export function penToolbar(): HTMLElement {
  const el = screen.queryByTestId('pen-toolbar');
  if (!el) throw new Error('the pen options are not on the page');
  return el;
}

export function pickPenColor(name: PenColor): void {
  act(() => screen.getByTestId(`pen-color-${name}`).click());
  flushFrames();
}

export function pickPenThickness(name: PenThickness): void {
  act(() => screen.getByTestId(`pen-thickness-${name}`).click());
  flushFrames();
}

export function colorPressed(name: PenColor): boolean {
  return screen.getByTestId(`pen-color-${name}`).getAttribute('aria-pressed') === 'true';
}

export function thicknessPressed(name: PenThickness): boolean {
  return screen.getByTestId(`pen-thickness-${name}`).getAttribute('aria-pressed') === 'true';
}

/** The line being drawn, or null when nothing is under the pen. */
export function previewPath(): SVGPathElement | null {
  return document.querySelector<SVGPathElement>('[data-testid="pen-preview-path"]');
}

export function previewD(): string {
  return previewPath()?.getAttribute('d') ?? '';
}

/** The ring that stands in for the pointer. */
export function penCursor(): HTMLElement {
  return screen.getByTestId('pen-cursor');
}

// --- strokes ---------------------------------------------------------------

export function strokesOf(doc: Y.Doc): StrokeSnapshot[] {
  return readStrokes(doc);
}

/** Put a stroke on the board through the model, and return its id. */
export function seedStrokeOn(
  doc: Y.Doc,
  points: readonly Point[],
  color: PenColor = 'black',
  thickness: PenThickness = 'medium',
): string {
  let id = '';
  act(() => {
    id = createStroke(doc, { points, color, thickness }, 'tester') ?? '';
  });
  flushFrames();
  return id;
}

/** The object's own container, as story 7 positions it on the board. */
export function strokeContainerEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (!el) throw new Error(`object ${id} is not rendered`);
  return el;
}

export function strokeEl(id: string): SVGGraphicsElement {
  const el = document.querySelector<SVGGraphicsElement>(`[data-testid="stroke-${id}"]`);
  if (!el) throw new Error(`stroke ${id} is not rendered`);
  return el;
}

/** The invisible band a press is answered by — the only part of a sketch you can click. */
export function strokeHitEl(id: string): SVGGraphicsElement {
  const el = document.querySelector<SVGGraphicsElement>(`[data-testid="stroke-hit-${id}"]`);
  if (!el) throw new Error(`stroke ${id} has no click band`);
  return el;
}

export function strokeInkEl(id: string): SVGGraphicsElement {
  const el = document.querySelector<SVGGraphicsElement>(
    `[data-testid="stroke-${id}"] [data-testid="stroke-line"]`,
  );
  if (!el) throw new Error(`stroke ${id} has no drawn line`);
  return el;
}

/**
 * Count the document updates a gesture writes. One stroke is one update, so a tool that
 * wrote on every move — or committed the same line twice — is caught here rather than by
 * counting the objects that happen to be left at the end.
 */
export function countUpdates<T>(doc: Y.Doc, run: () => T): { result: T; updates: number } {
  let updates = 0;
  const observer = () => {
    updates += 1;
  };
  doc.on('update', observer);
  try {
    return { result: run(), updates };
  } finally {
    doc.off('update', observer);
  }
}

/** Every object on the board, of any type — for "nothing was created" assertions. */
export function objectCount(doc: Y.Doc): number {
  return objectSnapshots(doc).length;
}

/** The box an object occupies on the board, whatever its type. */
export function boxOf(doc: Y.Doc, id: string): Rect {
  const object = objectSnapshots(doc).find((entry) => entry.id === id);
  if (!object) throw new Error(`object ${id} is not on the board`);
  return objectBounds(object);
}

/**
 * A stroke's stored points back in board units: they are kept relative to their own box,
 * so comparing two strokes — or a stroke with the pointer path that made it — means
 * adding the box's origin back.
 */
export function worldPoints(stroke: StrokeSnapshot): Point[] {
  return scaledPoints(stroke).map((point) => ({
    x: objectBounds(stroke).x + point.x,
    y: objectBounds(stroke).y + point.y,
  }));
}

/** Where this page's selection is, as ids. */
export function selectionIds(): string[] {
  return [...(window.__vidi6?.selectedIds?.() ?? [])];
}

/** Screen coordinates of a board point, under the camera this page is using. */
export function toScreen(point: Point): Point {
  return worldToScreen(readCamera(), point);
}

/** Look at the board through a given zoom, around a given top-left point. */
export function setCamera(zoom: number, at: Point = { x: 0, y: 0 }): void {
  act(() => {
    window.__vidi6?.setCamera?.({ x: at.x, y: at.y, zoom });
  });
  flushFrames();
}

export type GestureEnd = 'up' | 'cancel' | 'capture' | 'none';

/**
 * Draw a pointer path on the layer the pen holds.
 *
 * The points are board points; the last one is where the gesture ends unless `endAt` says
 * otherwise. `end` chooses how it stops: released, cancelled by the browser, or a pointer
 * capture that went away — the three ways a stroke is kept — or not at all, which is how a
 * test looks at the preview before anything is committed.
 */
export function drawWorld(
  points: readonly Point[],
  options: { end?: GestureEnd; endAt?: Point; el?: Element } = {},
): void {
  if (points.length === 0) throw new Error('a gesture needs at least one point');
  const el = options.el ?? penLayer();
  const screen = points.map(toScreen);
  firePointer(el, 'pointerdown', screen[0]!.x, screen[0]!.y);
  for (const at of screen.slice(1)) firePointer(el, 'pointermove', at.x, at.y);
  const end = options.end ?? 'up';
  const last = options.endAt ? toScreen(options.endAt) : screen[screen.length - 1]!;
  if (end === 'up') firePointer(el, 'pointerup', last.x, last.y);
  if (end === 'cancel') firePointer(el, 'pointercancel', last.x, last.y);
  if (end === 'capture') firePointer(el, 'lostpointercapture', last.x, last.y);
  flushFrames();
}

/**
 * One pointer event standing for many moves, the way a fast pointer reports them.
 *
 * `getCoalescedEvents` is what a 250 Hz stylus uses to hand the browser several positions
 * between two frames, and a tool that ignored it would draw a cornered version of a smooth
 * line; a test needs to be able to send a batch, which jsdom cannot do on its own.
 */
export function fireBatch(
  kind: 'pointerdown' | 'pointermove',
  batch: readonly Point[],
  el: Element = penLayer(),
): void {
  if (batch.length === 0) throw new Error('a batch needs at least one point');
  // The batch is what a browser hands over: events with client coordinates, not points.
  const positions = batch.map((point) => {
    const at = toScreen(point);
    return { clientX: at.x, clientY: at.y };
  });
  const first = positions[0]!;
  const event = new MouseEvent(kind, {
    bubbles: true,
    cancelable: true,
    clientX: first.clientX,
    clientY: first.clientY,
    button: 0,
    buttons: 1,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  // React hands the handler the event that was dispatched, so this is the batch the tool
  // will read.
  Object.defineProperty(event, 'getCoalescedEvents', { value: () => positions });
  act(() => {
    el.dispatchEvent(event);
  });
  flushFrames();
}
