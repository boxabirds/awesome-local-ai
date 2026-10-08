import { act, screen } from '@testing-library/react';
import { worldToScreen } from '../../src/client/canvas/camera';
import type { Point } from '../../src/client/canvas/camera';
import type { SeedStroke } from '../../src/client/canvas/testHooks';
import type { PenColor, PenThickness } from '../../src/shared/config';
import { scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { getObjectType } from '../../src/client/objects/registry';
import { dispatchKey, dispatchPointer } from './util';
import { hook, viewportEl } from './stickyUtil';

/**
 * Helpers for story 11's component tests: the pen tool's surface, its options, and
 * the strokes that end up on the board.
 */

/** Strokes on the board, in paint order. */
export function getStrokes(): readonly StrokeSnap[] {
  return hook().getStrokes();
}

export function strokeEls(): HTMLElement[] {
  return screen.queryAllByTestId('stroke-object');
}

/** The stroke's own rendered path, as it sits on the board. */
export function strokeLineEl(index = 0): Element {
  const el = screen.queryAllByTestId('stroke-line')[index];
  if (!el) throw new Error(`no drawn stroke at index ${index}`);
  return el;
}

export function strokePathD(index = 0): string {
  return strokeLineEl(index).getAttribute('d') ?? '';
}

/** The Pen tool's surface, or null when the board is not in the Pen tool. */
export function penToolEl(): HTMLElement | null {
  return screen.queryByTestId('pen-tool');
}

export function penToolbarEl(): HTMLElement | null {
  return screen.queryByTestId('pen-toolbar');
}

export function previewEl(): Element | null {
  return screen.queryByTestId('pen-preview');
}

/** Which tool the board is in, read from the viewport the user is looking at. */
export function toolState(): string {
  return viewportEl().getAttribute('data-tool') ?? 'missing';
}

/** Press P: the Pen tool is active and its surface is under the pointer. */
export function penLayer(): HTMLElement {
  dispatchKey({ key: 'p' });
  const el = screen.queryByTestId('pen-tool');
  if (!el) throw new Error('P did not make the Pen tool active');
  // The pen's surface belongs inside the viewport: that is what keeps wheel and pinch
  // navigating while a pointer drag is the pen's (PRD pen.navigation).
  if (!viewportEl().contains(el)) throw new Error('the pen surface is not inside the viewport');
  return el;
}

export function pickPenColor(color: PenColor): void {
  const el = screen.getByTestId(`pen-color-${color}`);
  act(() => {
    el.click();
  });
}

export function pickPenThickness(thickness: PenThickness): void {
  const el = screen.getByTestId(`pen-thickness-${thickness}`);
  act(() => {
    el.click();
  });
}

/** Create strokes as fixtures, as if the board had been saved with the drawing on it. */
export function seedStrokes(specs: readonly SeedStroke[]): string[] {
  let ids: string[] = [];
  act(() => {
    ids = hook().seedStrokes(specs);
  });
  return ids;
}

export function seedStroke(spec: SeedStroke): StrokeSnap {
  const id = seedStrokes([spec])[0]!;
  const stroke = getStrokes().find((s) => s.id === id);
  if (!stroke) throw new Error('seedStroke: the seeded stroke is not on the board');
  return stroke;
}

/** Press, move through every point and release, all on the pen's surface. */
export function drawOn(layer: Element, points: readonly Point[], pointerId = 1): void {
  if (points.length === 0) throw new Error('drawOn needs at least one point');
  dispatchPointer(layer, 'pointerdown', { pointerId, clientX: points[0].x, clientY: points[0].y });
  for (let i = 1; i < points.length; i++) {
    dispatchPointer(layer, 'pointermove', { pointerId, clientX: points[i].x, clientY: points[i].y });
  }
  const last = points[points.length - 1];
  dispatchPointer(layer, 'pointerup', { pointerId, clientX: last.x, clientY: last.y });
}

/**
 * The same gesture without a `act()` wrapper per event, for the stroke that runs past
 * the point limit: five thousand separate act() calls would cost more than the test.
 */
export function drawLongPath(layer: Element, points: readonly Point[], pointerId = 1): void {
  const fire = (target: EventTarget, type: string, at: Point): void => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      button: 0,
      buttons: 1,
      pointerId,
      clientX: at.x,
      clientY: at.y,
      shiftKey: false,
    });
    target.dispatchEvent(event);
  };
  act(() => {
    fire(layer, 'pointerdown', points[0]);
    for (let i = 1; i < points.length; i++) fire(window, 'pointermove', points[i]);
    const last = points[points.length - 1];
    fire(window, 'pointerup', last);
  });
}

/** A world path, drawn on the board with the pen: the stroke that lands is returned. */
export function drawStroke(worldPoints: readonly Point[]): StrokeSnap {
  const before = getStrokes().length;
  const screen = worldPoints.map((p) => worldToScreen(hook().getCamera(), p));
  drawOn(penLayer(), screen);
  const strokes = getStrokes();
  if (strokes.length !== before + 1) {
    throw new Error(`drawing ${worldPoints.length} points made ${strokes.length - before} strokes`);
  }
  return strokes[strokes.length - 1]!;
}

/** How far a world point is from a stroke's line, in board units (TC-15). */
export function distanceFromStrokeLine(stroke: StrokeSnap, at: Point): number {
  const points = scaledPoints(stroke);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / lengthSq));
    best = Math.min(best, Math.hypot(at.x - (a.x + dx * t), at.y - (a.y + dy * t)));
  }
  return best;
}

/** The registry's answer to "is this point on that stroke, at that zoom?" */
export function strokeHit(stroke: StrokeSnap, at: Point, zoom: number): boolean {
  const spec = getObjectType('stroke');
  if (!spec) throw new Error('the stroke type is not registered');
  return spec.hitTest(stroke, at, zoom);
}
