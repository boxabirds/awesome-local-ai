// Shared helpers for story 11 component tests (pen tool and stroke object).

import { act, fireEvent, screen } from '@testing-library/react';
import { board, flush } from './stickyHelpers';
import { createStroke } from '../../src/shared/objects/stroke';
import type { PenColor, PenThickness } from '../../src/shared/config';
import type { ObjectSnapshot, StrokeSnap } from '../../src/shared/board-model';

export function strokes(): StrokeSnap[] {
  return (board().getObjectSnapshots!() as ObjectSnapshot[]).filter(
    (o) => o.type === 'stroke',
  ) as StrokeSnap[];
}

// Creates a stroke through the real model (world-space points).
export function makeStroke(
  points: { x: number; y: number }[],
  color: PenColor = 'black',
  thickness: PenThickness = 'medium',
): string {
  let id: string | null = null;
  act(() => {
    id = createStroke(board().doc, { points, color, thickness }, 'tester');
  });
  flush();
  if (typeof id !== 'string') throw new Error('createStroke failed');
  return id;
}

export function strokeEl(id: string): HTMLElement {
  const el = screen
    .getAllByTestId('stroke-object')
    .find((n) => n.getAttribute('data-stroke-id') === id);
  if (!el) throw new Error(`stroke ${id} not rendered`);
  return el as HTMLElement;
}

// Presses on the Pen catcher and moves through the given screen points
// (no release). Returns a move/finish pair so tests can cancel instead.
export function penDownMove(points: { x: number; y: number }[]): void {
  const catcher = screen.getByTestId('pen-tool-catcher');
  const first = points[0];
  fireEvent.pointerDown(catcher, { pointerId: 1, clientX: first.x, clientY: first.y });
  for (let i = 1; i < points.length; i++) {
    fireEvent.pointerMove(catcher, {
      pointerId: 1,
      clientX: points[i].x,
      clientY: points[i].y,
    });
  }
}

export function penUp(p: { x: number; y: number }): void {
  fireEvent.pointerUp(window, { pointerId: 1, clientX: p.x, clientY: p.y });
  flush();
}

export function penDraw(points: { x: number; y: number }[]): void {
  penDownMove(points);
  penUp(points[points.length - 1]);
}
