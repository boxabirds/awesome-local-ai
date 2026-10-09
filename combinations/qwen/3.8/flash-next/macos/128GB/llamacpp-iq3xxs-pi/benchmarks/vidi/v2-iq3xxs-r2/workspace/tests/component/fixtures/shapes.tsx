/**
 * Helpers for story 10's component tests: the Shape and Connector tools, shapes and arrows.
 *
 * Shapes and arrows are made the way the board makes them — the tool and a drag — whenever the
 * test is about that drag, and straight into the document (`seedShape`, `seedConnector`)
 * whenever the test only needs one to be there. Positions are stated in board units and turned
 * into screen points through the camera, because where a click lands and where that is on the
 * board is the camera's business, not the test's.
 *
 * A press for a tool goes on the tool's own surface, which is the layer over the viewport that
 * takes every press while that tool is up — the thing TC-28 is about.
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../../src/shared/config';
import { createShape, DEFAULT_SHAPE_KIND, isShapeSnapshot, SHAPE_TYPE } from '../../../src/shared/objects/shape';
import type { ShapeKind, ShapeSnapshot } from '../../../src/shared/objects/shape';
import {
  createConnector,
  isConnectorSnapshot,
  readConnector,
  CONNECTOR_TYPE,
  type ConnectorSnapshot,
  type EndpointInput,
} from '../../../src/shared/objects/connector';
import { objectSnapshots, type ObjectSnapshot } from '../../../src/shared/board-model';
import type { Point, Rect } from '../../../src/shared/geometry';
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

export const CONNECTOR_TOOL_TEST_ID = 'connector-tool-surface';
export const SHAPE_TOOL_TEST_ID = 'shape-tool-surface';

/** Two shapes far enough apart that no drag between them is ambiguous. */
export const B_LAYOUT = {
  first: { x: -420, y: -120, width: 160, height: 160 },
  second: { x: -60, y: -120, width: 160, height: 160 },
} as const;

/** The board as the document holds it, every type. */
export function objectsInDoc(doc = boardDoc()): readonly ObjectSnapshot[] {
  return objectSnapshots(doc);
}

export function shapesInDoc(doc = boardDoc()): ShapeSnapshot[] {
  return objectsInDoc(doc).filter(isShapeSnapshot);
}

export function connectorsInDoc(doc = boardDoc()): ConnectorSnapshot[] {
  return objectsInDoc(doc).filter(isConnectorSnapshot);
}

export function shapeInDoc(id: string, doc = boardDoc()): ShapeSnapshot {
  const shape = shapesInDoc(doc).find((entry) => entry.id === id);
  if (!shape) throw new Error(`no shape with id ${id}`);
  return shape;
}

export function connectorInDoc(id: string, doc = boardDoc()): ConnectorSnapshot {
  const connector = readConnector(doc, id);
  if (!connector) throw new Error(`no connector with id ${id}`);
  return connector;
}

export async function waitForShapes(count: number): Promise<ShapeSnapshot[]> {
  let shapes: ShapeSnapshot[] = [];
  await vi.waitFor(() => {
    shapes = shapesInDoc();
    if (shapes.length !== count) throw new Error(`expected ${count} shapes, found ${shapes.length}`);
  });
  return shapes;
}

export async function waitForConnectors(count: number): Promise<ConnectorSnapshot[]> {
  let connectors: ConnectorSnapshot[] = [];
  await vi.waitFor(() => {
    connectors = connectorsInDoc();
    if (connectors.length !== count) throw new Error(`expected ${count} arrows, found ${connectors.length}`);
  });
  return connectors;
}

/* ---------------------------------------------------------------------------
 * The tools.
 * ------------------------------------------------------------------------ */

export function shapeToolButton(): HTMLButtonElement {
  return button('[data-testid="tool-shape"]');
}

export function connectorToolButton(): HTMLButtonElement {
  return button('[data-testid="tool-connector"]');
}

function button(selector: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`no button matching ${selector}`);
  return element;
}

export function toolPressed(selector: string): boolean {
  return button(selector).getAttribute('aria-pressed') === 'true';
}

/** Press a tool's key, the way a keyboard does. */
export async function pressToolKey(key: 's' | 'l' | 'v'): Promise<void> {
  pressKey(key);
  await flushFrames();
}

export async function clickShapeTool(): Promise<void> {
  act(() => {
    shapeToolButton().click();
  });
  await flushFrames();
}

export async function clickConnectorTool(): Promise<void> {
  act(() => {
    connectorToolButton().click();
  });
  await flushFrames();
}

export function shapeToolSurface(): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-testid="${SHAPE_TOOL_TEST_ID}"]`);
  if (!element) throw new Error('the Shape tool surface is not mounted');
  return element;
}

export function connectorToolSurface(): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-testid="${CONNECTOR_TOOL_TEST_ID}"]`);
  if (!element) throw new Error('the Connector tool surface is not mounted');
  return element;
}

export function shapeToolSurfaceOrNull(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${SHAPE_TOOL_TEST_ID}"]`);
}

export function connectorToolSurfaceOrNull(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${CONNECTOR_TOOL_TEST_ID}"]`);
}

export function previewElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="shape-preview"]');
}

export function connectorDots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="connector-dot"]'));
}

export function highlightedDots(): HTMLElement[] {
  return connectorDots().filter((dot) => dot.dataset.highlighted === 'true');
}

/* ---------------------------------------------------------------------------
 * The objects, as DOM.
 * ------------------------------------------------------------------------ */

export function shapeElement(id: string, container: ParentNode = document.body): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-testid="shape-object"][data-note-id="${id}"]`,
  );
  if (!element) throw new Error(`no shape element for id ${id}`);
  return element;
}

export function connectorElement(id: string, container: ParentNode = document.body): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-testid="connector-object"][data-note-id="${id}"]`,
  );
  if (!element) throw new Error(`no arrow element for id ${id}`);
  return element;
}

export function selectedShapeIds(container: ParentNode = document.body): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="shape-object"]'))
    .filter((element) => element.dataset.selected === 'true')
    .map((element) => element.dataset.noteId ?? '');
}

export function selectedConnectorIds(container: ParentNode = document.body): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="connector-object"]'))
    .filter((element) => element.dataset.selected === 'true')
    .map((element) => element.dataset.noteId ?? '');
}

/** Where a shape's centre is drawn right now. */
export function shapeCentreOnScreen(id: string): Point {
  const shape = shapeInDoc(id);
  return worldToScreen(readCamera(), {
    x: shape.x + shape.width / 2,
    y: shape.y + shape.height / 2,
  });
}

/** Where a board point is drawn right now. */
export function screenOf(point: Point): Point {
  return worldToScreen(readCamera(), point);
}

/** A rectangle's own centre, in board units. */
export function centreOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/* ---------------------------------------------------------------------------
 * Making things.
 * ------------------------------------------------------------------------ */

/** A shape straight into the document, at a board rectangle. */
export function seedShape(rect: Rect, kind: ShapeKind = DEFAULT_SHAPE_KIND, doc = boardDoc()): string {
  let id: string | null = null;
  act(() => {
    id = createShape(doc, { kind, rect, at: centreOf(rect), square: false }, 'seed');
  });
  if (!id) throw new Error(`no shape created at ${JSON.stringify(rect)}`);
  return id;
}

/** An arrow straight into the document, between two objects by id. */
export function seedConnector(from: EndpointInput, to: EndpointInput, doc = boardDoc()): string {
  let id: string | null = null;
  act(() => {
    id = createConnector(doc, from, to, 'seed');
  });
  if (!id) throw new Error(`no arrow created between ${JSON.stringify(from)} and ${JSON.stringify(to)}`);
  return id;
}

/**
 * The board centre in board units: where a shape lands when the tool is clicked rather than
 * dragged, and the point a test that only needs "somewhere on the board" asks for.
 */
export function boardCentre(): Point {
  const cam = readCamera();
  const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
  if (!viewport) throw new Error('no viewport mounted');
  const width = Number(viewport.clientWidth) || 1280;
  const height = Number(viewport.clientHeight) || 800;
  return screenCentre({ width, height }, cam);
}

function screenCentre(size: { width: number; height: number }, cam: ReturnType<typeof readCamera>): Point {
  return { x: -cam.x / cam.zoom + size.width / cam.zoom / 2, y: -cam.y / cam.zoom + size.height / cam.zoom / 2 };
}

/** A drag on a tool's surface, in screen pixels, one flush per step. */
export async function dragOnSurface(
  surface: HTMLElement,
  from: Point,
  to: Point,
  steps = 4,
): Promise<void> {
  pointerDownOn(surface, from);
  for (let step = 1; step <= steps; step += 1) {
    pointerMoveOn(surface, {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    });
    await flushFrames();
  }
  pointerUpOn(surface, to);
  await flushFrames();
}

/** A press that never becomes a drag: down and up on the same point. */
export async function clickOnSurface(surface: HTMLElement, at: Point): Promise<void> {
  pointerDownOn(surface, at);
  await flushFrames();
  pointerUpOn(surface, at);
  await flushFrames();
}

export async function cancelOnSurface(surface: HTMLElement, from: Point, to: Point): Promise<void> {
  pointerDownOn(surface, from);
  pointerMoveOn(surface, to);
  await flushFrames();
  pointerCancelOn(surface, to);
  await flushFrames();
}

/**
 * Draw a shape with the tool: a drag from one screen point to another, or a click when `to` is
 * left out. Returns the id of the shape that appeared.
 */
export async function drawShape(from: Point, to?: Point, kind?: ShapeKind): Promise<string> {
  const before = new Set(shapesInDoc().map((shape) => shape.id));
  await clickShapeTool();
  if (kind) {
    act(() => {
      button(`[data-testid="shape-kind-${kind}"]`).click();
    });
    await flushFrames();
  }
  const surface = shapeToolSurface();
  if (to) await dragOnSurface(surface, from, to);
  else await clickOnSurface(surface, from);
  const created = shapesInDoc().find((shape) => !before.has(shape.id));
  if (!created) throw new Error(`the Shape tool created no shape at ${JSON.stringify(from)}`);
  return created.id;
}

/** Draw an arrow with the Connector tool, from one screen point to another. */
export async function drawConnector(from: Point, to: Point): Promise<string> {
  const before = new Set(connectorsInDoc().map((connector) => connector.id));
  await clickConnectorTool();
  await dragOnSurface(connectorToolSurface(), from, to);
  const created = connectorsInDoc().find((connector) => !before.has(connector.id));
  if (!created) throw new Error(`the Connector tool created no arrow from ${JSON.stringify(from)}`);
  return created.id;
}

/* ---------------------------------------------------------------------------
 * The shape toolbar.
 * ------------------------------------------------------------------------ */

export function shapeToolbarElement(container: ParentNode = document.body): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="shape-toolbar"]');
}

export function clickShapeSwatch(testId: string): void {
  const element = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`no swatch with data-testid "${testId}"`);
  act(() => {
    element.click();
  });
}

/** The numbers the settings say a shape's size is bounded by, for a test to name them. */
export const SHAPE_SIZES = {
  default: SHAPE_DEFAULT_SIZE_WORLD,
  min: SHAPE_MIN_SIZE_WORLD,
  toleranceScreenPx: CONNECTOR_HIT_TOLERANCE_PX,
  type: SHAPE_TYPE,
  connectorType: CONNECTOR_TYPE,
};
