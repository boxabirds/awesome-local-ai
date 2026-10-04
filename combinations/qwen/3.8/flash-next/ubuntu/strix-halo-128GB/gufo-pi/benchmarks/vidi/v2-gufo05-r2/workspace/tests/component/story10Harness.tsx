/**
 * Helpers for story 10's component tests: shapes and arrows on a real board, and
 * pointers described in *board* units.
 *
 * Everything goes through the real board (`renderBoard`), because the things most
 * likely to be wrong in this story are all in the join: the tool that must own the
 * gesture rather than the object under it, the arrow whose line is derived from another
 * object's box, and the click that is inside an arrow's box but nowhere near its line.
 * Board coordinates are converted through the camera the page is actually using, so a
 * test says "40 units right of the shape" and stays true at any zoom.
 */

import { act, screen } from '@testing-library/react';
import type * as Y from 'yjs';

import { deleteObject, objectBounds, objectSnapshots } from '../../src/shared/board-model';
import type { Rect, Point } from '../../src/shared/geometry';
import type { ShapeKind } from '../../src/shared/config';
import { createShape, readShapes, type ShapeSnapshot } from '../../src/shared/objects/shape';
import {
  createConnector,
  readConnectors,
  setConnectorEndpoint,
  type ConnectorSnapshot,
} from '../../src/shared/objects/connector';
import { nearestSide, sideAnchor } from '../../src/shared/geometry/connector-geometry';
import { worldToScreen } from '../../src/client/canvas/camera';
import {
  fireKey,
  firePointer,
  flushFrames,
  readBoardDoc,
  readCamera,
  renderBoard,
  surface,
} from './boardHarness';

export { fireKey, firePointer, flushFrames, readBoardDoc, readCamera, renderBoard, surface };

/** Render the board and hand back its live document. */
export function renderStory10(): Y.Doc {
  renderBoard();
  return readBoardDoc();
}

/** A shape whose *top-left* is the given rect, drawn through the model. */
export function seedShape(doc: Y.Doc, kind: ShapeKind, rect: Rect): string {
  let id = '';
  act(() => {
    id =
      createShape(
        doc,
        { kind, rect, at: { x: rect.x, y: rect.y }, square: false },
        'tester',
      ) ?? '';
  });
  flushFrames();
  return id;
}

/** A shape centred on a point, at the standard size — the click's result. */
export function seedShapeCentre(doc: Y.Doc, kind: ShapeKind, at: Point): string {
  let id = '';
  act(() => {
    id = createShape(doc, { kind, rect: null, at, square: false }, 'tester') ?? '';
  });
  flushFrames();
  return id;
}

/**
 * An arrow between two objects, each end hanging from the side that faces the other —
 * which is exactly what a drag from one to the other stores.
 */
export function seedArrow(doc: Y.Doc, fromId: string, toId: string): string {
  const rects = rectsOf(doc);
  const a = rects.get(fromId);
  const b = rects.get(toId);
  if (!a || !b) throw new Error(`both objects must be on the board to connect them`);
  const from = sideAnchor(a, nearestSide(a, centre(b)));
  const to = sideAnchor(b, nearestSide(b, centre(a)));
  let id = '';
  act(() => {
    id =
      createConnector(
        doc,
        { kind: 'attached', objectId: fromId, fallbackX: from.x, fallbackY: from.y },
        { kind: 'attached', objectId: toId, fallbackX: to.x, fallbackY: to.y },
        'tester',
      ) ?? '';
  });
  flushFrames();
  return id;
}

/**
 * An arrow between two board points, with nothing at either end.
 *
 * The model will not create one — an arrow has to belong to something when it is drawn —
 * so this is made the way a person makes one: draw it out of a shape, drag that end off
 * into empty board, then delete the shape. What is left is a loose line, arrived at
 * through the board's own rules.
 */
export function seedFreeArrow(doc: Y.Doc, from: Point, to: Point): string {
  let arrow = '';
  act(() => {
    const helper =
      createShape(
        doc,
        {
          kind: 'rect',
          rect: { x: from.x - 20, y: from.y - 20, width: 40, height: 40 },
          at: from,
          square: false,
        },
        'tester',
      ) ?? '';
    arrow =
      createConnector(
        doc,
        { kind: 'attached', objectId: helper, fallbackX: from.x, fallbackY: from.y },
        { kind: 'free', x: to.x, y: to.y },
        'tester',
      ) ?? '';
    setConnectorEndpoint(doc, arrow, 'from', { kind: 'free', x: from.x, y: from.y });
    deleteObject(doc, helper);
  });
  flushFrames();
  return arrow;
}

export function shapesOf(doc: Y.Doc): ShapeSnapshot[] {
  return readShapes(doc);
}

export function arrowsOf(doc: Y.Doc): ConnectorSnapshot[] {
  return readConnectors(doc);
}

export function rectsOf(doc: Y.Doc): Map<string, Rect> {
  return new Map(objectSnapshots(doc).map((object) => [object.id, objectBounds(object)]));
}

export function boxOf(doc: Y.Doc, id: string): Rect {
  const object = objectSnapshots(doc).find((entry) => entry.id === id);
  if (!object) throw new Error(`object ${id} is not on the board`);
  return objectBounds(object);
}

export function centre(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
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

export function shapeToolButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Shape (S)' }) as HTMLButtonElement;
}

export function connectorToolButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Connector (L)' }) as HTMLButtonElement;
}

export function selectToolButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Select (V)' }) as HTMLButtonElement;
}

export function pickShapeTool(kind?: ShapeKind): void {
  if (kind) {
    act(() => {
      screen.getByTestId(`shape-kind-${kind}`).click();
    });
  }
  act(() => shapeToolButton().click());
  flushFrames();
}

export function pickConnectorTool(): void {
  act(() => connectorToolButton().click());
  flushFrames();
}

export function pickSelectTool(): void {
  act(() => selectToolButton().click());
  flushFrames();
}

/** The layer the active tool holds, whichever it is. */
export function toolLayer(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.tool-layer');
  if (!el) throw new Error('no tool layer is on the page');
  return el;
}

export function shapeToolLayer(): HTMLElement {
  const el = screen.queryByTestId('shape-tool-layer');
  if (!el) throw new Error('the Shape tool is not in hand');
  return el;
}

export function connectorToolLayer(): HTMLElement {
  const el = screen.queryByTestId('connector-tool-layer');
  if (!el) throw new Error('the Connector tool is not in hand');
  return el;
}

export function previewEl(): HTMLElement | null {
  return screen.queryByTestId('shape-preview');
}

export function objectEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (!el) throw new Error(`object ${id} is not rendered`);
  return el;
}

export function dotEl(side: string): SVGCircleElement | null {
  return document.querySelector<SVGCircleElement>(`[data-testid="connector-dot-${side}"]`);
}

export function dots(): SVGCircleElement[] {
  return ['top', 'right', 'bottom', 'left']
    .map((side) => dotEl(side))
    .filter((el): el is SVGCircleElement => el !== null);
}

export function handleEl(end: 'from' | 'to'): SVGCircleElement | null {
  return document.querySelector<SVGCircleElement>(`[data-testid="connector-handle-${end}"]`);
}

export function hitLineEl(id: string): SVGLineElement | null {
  return document.querySelector<SVGCircleElement>(
    `[data-testid="connector-hit-${id}"]`,
  ) as SVGLineElement | null;
}

/** Where this page's selection is, as ids. */
export function selectionIds(): string[] {
  return [...(window.__vidi6?.selectedIds?.() ?? [])];
}

/** A pointer press/drag/release on an element, in screen pixels. */
export function dragScreen(
  el: Element,
  from: Point,
  to: Point,
  options: { shift?: boolean; moves?: number; release?: boolean } = {},
): void {
  const modifiers = { shift: options.shift ?? false };
  firePointer(el, 'pointerdown', from.x, from.y, modifiers);
  const moves = options.moves ?? 2;
  for (let i = 1; i <= moves; i += 1) {
    firePointer(
      el,
      'pointermove',
      from.x + ((to.x - from.x) * i) / moves,
      from.y + ((to.y - from.y) * i) / moves,
      modifiers,
    );
  }
  if (options.release !== false) firePointer(el, 'pointerup', to.x, to.y, modifiers);
  flushFrames();
}

/** A drag between two board points, on whatever element is asked for. */
export function dragWorld(
  el: Element,
  from: Point,
  to: Point,
  options: { shift?: boolean; moves?: number; release?: boolean } = {},
): void {
  dragScreen(el, toScreen(from), toScreen(to), options);
}

/**
 * Count the document updates a gesture writes. One creation is one update, so a tool
 * that created twice — or created on every move — is caught here rather than by
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

/** The objects on the board, of any type — for "nothing was created" assertions. */
export function objectCount(doc: Y.Doc): number {
  return objectSnapshots(doc).length;
}

/** Double-click an object — the way a person starts typing into it. */
export function dblClickObject(id: string, at: Point = { x: 100, y: 100 }): void {
  const el = objectEl(id);
  act(() => {
    el.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }),
    );
  });
  flushFrames();
}

/** Replace a textarea's value the way typing or pasting does, then report it. */
export function typeInto(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  flushFrames();
}

/** The label editor of a shape, or null when it is not open. */
export function labelEditor(id: string): HTMLTextAreaElement | null {
  return objectEl(id).querySelector('textarea');
}

/** The label as drawn (not the shared text): what a person reads. */
export function labelOf(id: string): string {
  const el = document.querySelector<HTMLElement>(`[data-testid="shape-label-${id}"]`);
  return el?.textContent ?? '';
}

/** The board itself, for clicks that are meant for empty space. */
export function boardEl(): HTMLElement {
  return surface();
}
