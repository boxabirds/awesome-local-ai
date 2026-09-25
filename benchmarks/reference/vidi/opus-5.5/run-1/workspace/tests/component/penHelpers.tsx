/** Helpers for story 11 component tests (Pen tool and strokes) on the real board. */
import { act, fireEvent, screen } from '@testing-library/react';
import { objectSnapshot } from '../../src/shared/board-model';
import type { Point } from '../../src/shared/geometry';
import {
  createStroke,
  isStroke,
  type PenColor,
  type PenThickness,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import { doc } from './stickyHelpers';

export const POINTER_ID = 1;
const PRIMARY_BUTTON = 0;
const AUTHOR = 'g_component';

export function strokes(): StrokeSnap[] {
  return objectSnapshot(doc()).filter(isStroke);
}

export function penTool(): HTMLElement {
  return screen.getByTestId('pen-tool');
}

export function penPreview(): SVGPathElement {
  return screen.getByTestId('pen-preview') as unknown as SVGPathElement;
}

export function strokeEls(): HTMLElement[] {
  return screen.queryAllByTestId('stroke-object');
}

/** A stroke made directly in the document (as a local change), for tests about other things. */
export function addStroke(points: Point[], color: PenColor = 'black', thickness: PenThickness = 'thin'): string {
  let id: string | null = null;
  act(() => {
    id = createStroke(doc(), { points, color, thickness }, AUTHOR);
  });
  if (!id) throw new Error('stroke not created');
  return id;
}

export function penDown(p: Point, el: Element = penTool()): void {
  fireEvent.pointerDown(el, { pointerId: POINTER_ID, button: PRIMARY_BUTTON, clientX: p.x, clientY: p.y });
}

export function penMove(p: Point, el: Element = penTool()): void {
  fireEvent.pointerMove(el, { pointerId: POINTER_ID, clientX: p.x, clientY: p.y });
}

export function penUp(p: Point, el: Element = penTool()): void {
  fireEvent.pointerUp(el, { pointerId: POINTER_ID, button: PRIMARY_BUTTON, clientX: p.x, clientY: p.y });
}

/** A full drag through `points` (screen, board area) with the Pen: press, moves, release. */
export function drawPath(points: readonly Point[]): void {
  const el = penTool();
  penDown(points[0]!, el);
  for (const p of points.slice(1)) penMove(p, el);
  penUp(points[points.length - 1]!, el);
}
