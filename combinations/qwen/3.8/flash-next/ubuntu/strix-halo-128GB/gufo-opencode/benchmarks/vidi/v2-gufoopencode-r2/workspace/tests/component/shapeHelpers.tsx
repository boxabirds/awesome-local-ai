// Shared helpers for story 10 component tests (shapes and connectors).

import { act, fireEvent, screen } from '@testing-library/react';
import { board, flush } from './stickyHelpers';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import type { Endpoint } from '../../src/shared/geometry/connector-geometry';
import type { ShapeKind } from '../../src/shared/config';

export function objects(): ObjectSnapshot[] {
  return board().getObjectSnapshots!() as ObjectSnapshot[];
}

export function shapes(): ObjectSnapshot[] {
  return objects().filter((o) => o.type === 'shape');
}

export function connectors(): ObjectSnapshot[] {
  return objects().filter((o) => o.type === 'connector');
}

// Creates a shape through the real model at an exact world rect.
export function makeShape(kind: ShapeKind, x: number, y: number, w: number, h: number): string {
  let id: string | null = null;
  act(() => {
    id = createShape(board().doc, { kind, rect: { x, y, width: w, height: h }, at: { x, y } }, 'tester');
  });
  flush();
  if (typeof id !== 'string') throw new Error('createShape failed');
  return id;
}

export function makeConnector(from: Endpoint, to: Endpoint): string {
  let id: string | null = null;
  act(() => {
    id = createConnector(board().doc, from, to, 'tester');
  });
  flush();
  if (typeof id !== 'string') throw new Error('createConnector failed');
  return id;
}

export function shapeEl(id: string): HTMLElement {
  const el = screen
    .getAllByTestId('shape-object')
    .find((n) => n.getAttribute('data-shape-id') === id);
  if (!el) throw new Error(`shape ${id} not rendered`);
  return el as HTMLElement;
}

export function connectorEl(id: string): HTMLElement {
  const el = screen
    .getAllByTestId('connector-object')
    .find((n) => n.getAttribute('data-connector-id') === id);
  if (!el) throw new Error(`connector ${id} not rendered`);
  return el as HTMLElement;
}

// jsdom viewport rects are all zero, so screen coordinates equal the
// viewport-relative coordinates that camera.ts expects.
export function screenOf(wx: number, wy: number, cam: { x: number; y: number; zoom: number }): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}

export function dragOn(
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  const catcher = screen.getByTestId('shape-tool-catcher');
  fireEvent.pointerDown(catcher, { pointerId: 1, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: to.x, clientY: to.y });
  flush();
}
