/** Helpers for story 10 component tests (shapes, arrows, tools) on the real board. */
import { act, fireEvent, screen } from '@testing-library/react';
import { worldToScreen, type Camera, type Point } from '../../src/client/canvas/camera';
import { objectSnapshot } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import { createConnector, isConnector, type ConnectorSnap, type Endpoint } from '../../src/shared/objects/connector';
import { createShape, isShape, type ShapeKind, type ShapeSnap } from '../../src/shared/objects/shape';
import { camera, doc, flushFrame } from './stickyHelpers';

export const POINTER_ID = 1;
const PRIMARY_BUTTON = 0;
const AUTHOR = 'g_component';
const HALF = 2;

export function shapes(): ShapeSnap[] {
  return objectSnapshot(doc()).filter(isShape);
}

export function arrows(): ConnectorSnap[] {
  return objectSnapshot(doc()).filter(isConnector);
}

export function selectedIds(): string[] {
  return window.__vidi6?.getSelection() ?? [];
}

export function toolPressed(name: string): string | null {
  return screen.getByRole('button', { name }).getAttribute('aria-pressed');
}

export function setZoom(zoom: number, at: Point = { x: 0, y: 0 }): void {
  act(() => {
    window.__vidi6!.setCamera({ x: at.x, y: at.y, zoom } satisfies Camera);
  });
  flushFrame();
}

/** Screen point (board area) of a world point with the current camera. */
export function toScreen(p: Point): Point {
  return worldToScreen(camera(), p);
}

export function centre(r: Rect): Point {
  return { x: r.x + r.width / HALF, y: r.y + r.height / HALF };
}

/** A shape made directly in the document (as a local change), for tests about other things. */
export function addShape(rect: Rect, kind: ShapeKind = 'rect'): string {
  let id: string | null = null;
  act(() => {
    id = createShape(doc(), { kind, rect, at: { x: rect.x, y: rect.y } }, AUTHOR);
  });
  if (!id) throw new Error('shape not created');
  return id;
}

export function addArrow(from: Endpoint, to: Endpoint): string {
  let id: string | null = null;
  act(() => {
    id = createConnector(doc(), from, to, AUTHOR);
  });
  if (!id) throw new Error('arrow not created');
  return id;
}

export function attachedTo(objectId: string): Endpoint {
  return { kind: 'attached', objectId, fallback: { x: 0, y: 0 } };
}

export function pointerDown(el: Element, p: Point, init: Record<string, unknown> = {}): void {
  fireEvent.pointerDown(el, { pointerId: POINTER_ID, button: PRIMARY_BUTTON, clientX: p.x, clientY: p.y, ...init });
}

export function pointerMove(el: Element, p: Point, init: Record<string, unknown> = {}): void {
  fireEvent.pointerMove(el, { pointerId: POINTER_ID, clientX: p.x, clientY: p.y, ...init });
}

export function pointerUp(el: Element, p: Point, init: Record<string, unknown> = {}): void {
  fireEvent.pointerUp(el, { pointerId: POINTER_ID, button: PRIMARY_BUTTON, clientX: p.x, clientY: p.y, ...init });
}

/** Press at `a`, move in two steps to `b`, release at `b` (all on `el`). */
export function dragOn(el: Element, a: Point, b: Point, init: Record<string, unknown> = {}): void {
  pointerDown(el, a, init);
  pointerMove(el, { x: (a.x + b.x) / HALF, y: (a.y + b.y) / HALF }, init);
  pointerMove(el, b, init);
  pointerUp(el, b, init);
}

export function shapeTool(): HTMLElement {
  return screen.getByTestId('shape-tool');
}

export function connectorTool(): HTMLElement {
  return screen.getByTestId('connector-tool');
}

export function shapeEl(id: string): HTMLElement {
  const el = screen.queryAllByTestId('shape-object').find((e) => e.dataset.id === id);
  if (!el) throw new Error(`shape ${id} not rendered`);
  return el;
}

export function dots(): { side: string; x: number; y: number; highlighted: boolean }[] {
  return screen.queryAllByTestId('connection-dot').map((d) => ({
    side: d.getAttribute('data-side') ?? '',
    x: Number(d.getAttribute('cx')),
    y: Number(d.getAttribute('cy')),
    highlighted: d.getAttribute('data-highlighted') === 'true',
  }));
}
