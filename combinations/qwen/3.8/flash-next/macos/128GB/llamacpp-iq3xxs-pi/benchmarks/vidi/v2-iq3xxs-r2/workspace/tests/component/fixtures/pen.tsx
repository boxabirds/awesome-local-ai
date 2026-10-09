/**
 * Helpers for story 11's component tests: the Pen tool, its toolbar, and strokes.
 *
 * A stroke is made the way the board makes one whenever the test is about the gesture — the pen
 * surface and a run of pointer events — and straight into the document (`seedStroke`) whenever
 * the test only needs one to be there. Points are stated in board units and turned into screen
 * points through the camera, because where a click lands and where that is on the board is the
 * camera's business, not the test's.
 *
 * A long run of points is dispatched without waiting for a frame every time: the preview is
 * allowed to be one frame behind, and a test that fires 5,010 pointer events cannot afford to
 * await 5,010 macrotasks either.
 */
import * as Y from 'yjs';
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  type PenColor,
  type PenThickness,
} from '../../../src/shared/config';
import { deleteObject, objectSnapshots } from '../../../src/shared/board-model';
import { createStroke, isStrokeSnapshot, scaledPoints } from '../../../src/shared/objects/stroke';
import type { StrokeSnap } from '../../../src/shared/objects/stroke';
import type { Point } from '../../../src/shared/geometry';
import { worldToScreen } from '../../../src/client/canvas/camera';
import {
  boardDoc,
  flushFrames,
  pointerCancelOn,
  pointerDownOn,
  pointerMoveOn,
  pointerUpOn,
  pressKey,
  readCamera,
} from './board';

export const PEN_TOOL_TEST_ID = 'pen-tool-surface';

/** How many pointer events go by between one flush of the preview and the next. */
const PREVIEW_FLUSH_EVERY = 250;

/* ---------------------------------------------------------------------------
 * The tool and its toolbar.
 * ------------------------------------------------------------------------ */

export function penToolButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>('[data-testid="tool-pen"]');
  if (!element) throw new Error('no Pen button on the toolbar');
  return element;
}

export function penToolPressed(): boolean {
  return penToolButton().getAttribute('aria-pressed') === 'true';
}

export async function clickPenTool(): Promise<void> {
  act(() => {
    penToolButton().click();
  });
  await flushFrames();
}

export async function pressPenKey(key: 'p' | 'v' | 's' = 'p'): Promise<void> {
  pressKey(key);
  await flushFrames();
}

export function penSurface(): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-testid="${PEN_TOOL_TEST_ID}"]`);
  if (!element) throw new Error('the Pen tool surface is not mounted');
  return element;
}

export function penSurfaceOrNull(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${PEN_TOOL_TEST_ID}"]`);
}

export function penToolbarOrNull(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="pen-toolbar"]');
}

export function penSwatch(colour: PenColor): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`[data-testid="pen-colour-${colour}"]`);
  if (!element) throw new Error(`no swatch for the ${colour} pen`);
  return element;
}

export function penThicknessButton(thickness: PenThickness): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`[data-testid="pen-thickness-${thickness}"]`);
  if (!element) throw new Error(`no ${thickness} thickness button`);
  return element;
}

/** Every colour the toolbar offers, in the order the settings list them. */
export function penColourNames(): PenColor[] {
  return Object.keys(PEN_COLORS) as PenColor[];
}

export const PEN_THICKNESS_NAMES: readonly PenThickness[] = ['thin', 'medium', 'thick'];

/** Which swatches and buttons read as pressed — exactly one of each, always. */
export function penPressedColours(): PenColor[] {
  return penColourNames().filter((colour) => penSwatch(colour).getAttribute('aria-pressed') === 'true');
}

export function penPressedThicknesses(): PenThickness[] {
  return PEN_THICKNESS_NAMES.filter(
    (name) => penThicknessButton(name).getAttribute('aria-pressed') === 'true',
  );
}

export function clickPenSwatch(colour: PenColor): void {
  act(() => {
    penSwatch(colour).click();
  });
}

export function clickPenThickness(thickness: PenThickness): void {
  act(() => {
    penThicknessButton(thickness).click();
  });
}

/** The line the pen is drawing right now, or null when it is not drawing one. */
export function previewPath(): Element | null {
  return document.querySelector('[data-testid="pen-preview"]');
}

export function previewPathD(): string | null {
  return previewPath()?.getAttribute('d') ?? null;
}

export function penCursorOrNull(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="pen-cursor"]');
}

/** Where the round cursor is and how big it is, in screen pixels. */
export function penCursorBox(): { x: number; y: number; size: number } {
  const element = penCursorOrNull();
  if (!element) throw new Error('the pen cursor is not mounted');
  const size = parseFloat(element.style.width.replace('px', ''));
  const x = parseFloat(element.style.left.replace('px', ''));
  const y = parseFloat(element.style.top.replace('px', ''));
  return { x: x + size / 2, y: y + size / 2, size };
}

/* ---------------------------------------------------------------------------
 * Strokes: the document, and the DOM.
 * ------------------------------------------------------------------------ */

export function strokesInDoc(doc = boardDoc()): StrokeSnap[] {
  return objectSnapshots(doc).filter(isStrokeSnapshot);
}

export function strokeInDoc(id: string, doc = boardDoc()): StrokeSnap {
  const stroke = strokesInDoc(doc).find((entry) => entry.id === id);
  if (!stroke) throw new Error(`no stroke with id ${id}`);
  return stroke;
}

export async function waitForStrokes(count: number): Promise<StrokeSnap[]> {
  let strokes: StrokeSnap[] = [];
  await vi.waitFor(() => {
    strokes = strokesInDoc();
    if (strokes.length !== count) throw new Error(`expected ${count} strokes, found ${strokes.length}`);
  });
  return strokes;
}

/** A stroke straight into the document, through the model that would have made it. */
export function seedStroke(
  points: readonly Point[],
  opts: { color?: PenColor; thickness?: PenThickness } = {},
  doc = boardDoc(),
): string {
  let id: string | null = null;
  act(() => {
    id = createStroke(
      doc,
      {
        points,
        color: opts.color ?? DEFAULT_PEN_COLOR,
        thickness: opts.thickness ?? DEFAULT_PEN_THICKNESS,
      },
      'seed',
    );
  });
  if (!id) throw new Error(`no stroke created from ${points.length} points`);
  return id;
}

export function strokeElement(id: string, container: ParentNode = document.body): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-testid="stroke-object"][data-note-id="${id}"]`,
  );
  if (!element) throw new Error(`no stroke element for id ${id}`);
  return element;
}

export function strokeHitPath(id: string, container: ParentNode = document.body): Element {
  const element = strokeElement(id, container).querySelector('[data-testid="stroke-hit"]');
  if (!element) throw new Error(`no click area for stroke ${id}`);
  return element;
}

/** The `d` the stroke is drawn with, in its own box's coordinates. */
export function strokePathD(id: string, container: ParentNode = document.body): string {
  const path = strokeElement(id, container).querySelector('[data-testid="stroke-line"]');
  if (!path) throw new Error(`no drawn line for stroke ${id}`);
  return path.getAttribute('d') ?? '';
}

/**
 * The notes that read as selected — and only the notes. Every object on the board carries
 * `data-note-id`, story 2's name for it, so a query for selected *objects* would answer with
 * the stroke as well, and a test about one type needs to say which type it means.
 */
export function selectedStickyIds(container: ParentNode = document.body): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-note-type="sticky"]'))
    .filter((element) => element.dataset.selected === 'true')
    .map((element) => element.dataset.noteId ?? '');
}

export function selectedStrokeIds(container: ParentNode = document.body): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="stroke-object"]'))
    .filter((element) => element.dataset.selected === 'true')
    .map((element) => element.dataset.noteId ?? '');
}

/** Press and release on the line's own click area: selection without a drag. */
export async function selectStroke(id: string, at?: Point): Promise<void> {
  const stroke = strokeInDoc(id);
  const line = scaledPoints(stroke);
  const point = at ?? line[Math.floor(line.length / 2)];
  const screen = worldToScreen(readCamera(), point);
  const hit = strokeHitPath(id);
  act(() => {
    for (const type of ['pointerdown', 'pointerup'] as const) {
      hit.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: screen.x,
          clientY: screen.y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
        }),
      );
    }
  });
  await flushFrames();
}

/* ---------------------------------------------------------------------------
 * Drawing.
 * ------------------------------------------------------------------------ */

/** A board point, where it is drawn on the screen right now. */
export function screenOfWorld(point: Point): Point {
  return worldToScreen(readCamera(), point);
}

/** The same path somewhere else on the screen: board units through the camera. */
export function screenOf(points: readonly Point[]): Point[] {
  const cam = readCamera();
  return points.map((point) => worldToScreen(cam, point));
}

export interface DrawnStroke {
  /** Every stroke the gesture finished, oldest first: more than one is a split long stroke. */
  readonly ids: string[];
}

/**
 * Draw with the Pen tool through a run of board points: press on the first, move through the
 * rest, release on the last. Returns the id of every stroke that appeared.
 *
 * `opts.cancel` ends the gesture the way an interruption does, and `opts.hold` leaves the
 * pointer down so the test can say what happened while it was still down.
 */
export async function drawStroke(
  points: readonly Point[],
  opts: { cancel?: boolean; hold?: boolean; flushEvery?: number } = {},
): Promise<DrawnStroke> {
  if (points.length === 0) throw new Error('drawStroke needs at least one point');
  const before = new Set(strokesInDoc().map((stroke) => stroke.id));
  const surface = penSurface();
  const screen = screenOf(points);
  const flushEvery = opts.flushEvery ?? PREVIEW_FLUSH_EVERY;
  pointerDownOn(surface, screen[0]);
  await flushFrames();
  for (let index = 1; index < screen.length; index += 1) {
    pointerMoveOn(surface, screen[index]);
    if (index % flushEvery === 0 || index === screen.length - 1) await flushFrames();
  }
  if (opts.cancel) {
    pointerCancelOn(surface, screen[screen.length - 1]);
  } else if (!opts.hold) {
    pointerUpOn(surface, screen[screen.length - 1]);
  }
  await flushFrames();
  const fresh = strokesInDoc().filter((stroke) => !before.has(stroke.id));
  return { ids: fresh.map((stroke) => stroke.id) };
}

/** Take a stroke out of the document again, the way another browser's delete does. */
export function deleteStroke(id: string, doc = boardDoc()): void {
  act(() => {
    deleteObject(doc, id);
  });
}

/**
 * Change a stroke's box through the document — what story 7's resize writes — so a test can ask
 * what the drawing looks like now that the box is a different size.
 */
export function resizeStrokeInDoc(
  id: string,
  size: { width: number; height: number },
  doc = boardDoc(),
): void {
  act(() => {
    doc.transact(() => {
      const object = doc.getMap<Y.Map<unknown>>('objects').get(id);
      if (!object) throw new Error(`no object with id ${id} in the document`);
      object.set('width', size.width);
      object.set('height', size.height);
    });
  });
}

/** A short wobbly diagonal, in board units: enough for most tests. */
export function strokePath(from: Point, to: Point, steps = 8): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const along = index / steps;
    points.push({
      x: from.x + (to.x - from.x) * along + Math.sin(along * Math.PI * 3) * 6,
      y: from.y + (to.y - from.y) * along + Math.cos(along * Math.PI * 2) * 4,
    });
  }
  return points;
}
