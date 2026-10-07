/**
 * Shapes and arrows in a real browser (`tests/e2e/shapes-connectors.spec.ts`).
 *
 * The same two tools the jsdom suite drives, driven here with a real mouse over a real
 * board served by `wrangler dev`. What the helpers hand back are measurements, in the
 * two currencies a story about geometry has to keep in step: the box a shape is drawn
 * in (CSS pixels, from the element) and the box it is stored in (board units, from the
 * document). A test that only reads one of them proves either the pixels or the model,
 * which is half a proof.
 *
 * Where an arrow is concerned, "where it is drawn" is not in the document at all - the
 * ends are recomputed from the objects it joins - so the helpers read the drawn ends out
 * of the `<polyline>` and its box, scaled by the live camera, rather than out of the
 * endpoints. That is the only way a test can see the arrow move when nobody wrote to it.
 */

import { expect, type Locator, type Page } from '@playwright/test';

import { cameraState, waitForRender } from './board.js';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../../../src/client/canvas/camera.js';
import type { ObjectSnapshot } from '../../../src/shared/board-model.js';
import type { Rect } from '../../../src/shared/geometry.js';
import type { ShapeSnap, ShapeKind } from '../../../src/shared/objects/shape.js';
import type { ConnectorSnap } from '../../../src/shared/objects/connector.js';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config.js';

/** A box on the screen, in CSS pixels. */
export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const shapeToolButton = (page: Page): Locator => page.getByTestId('shape-tool-button');
export const connectorToolButton = (page: Page): Locator => page.getByTestId('connector-tool-button');
export const selectToolButton = (page: Page): Locator => page.getByTestId('select-tool-button');
export const shapeKindMenu = (page: Page): Locator => page.getByTestId('shape-kind-menu');
export const shapeKindOption = (page: Page, kind: string): Locator =>
  page.locator(`[data-testid="shape-kind-button"][data-kind="${kind}"]`);
export const shapeElements = (page: Page): Locator => page.getByTestId('shape-object');
export const connectorElements = (page: Page): Locator => page.getByTestId('connector-object');
export const shapePreview = (page: Page): Locator => page.getByTestId('shape-preview');
export const connectorPreview = (page: Page): Locator => page.getByTestId('connector-preview-line');
export const connectorDots = (page: Page): Locator => page.getByTestId('connector-dot');
export const shapeToolbar = (page: Page): Locator => page.getByTestId('shape-toolbar');
export const shapeFillButton = (page: Page, color: string): Locator =>
  page.locator(`[data-testid="shape-fill-button"][data-color="${color}"]`);
export const shapeStrokeButton = (page: Page, color: string): Locator =>
  page.locator(`[data-testid="shape-stroke-button"][data-color="${color}"]`);
export const shapeDeleteButton = (page: Page): Locator => page.getByTestId('shape-toolbar-delete');

/** The element one object is drawn in, by id: a test that moves an object must read it by id. */
export const shapeOf = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="shape-object"][data-object-id="${id}"]`);
export const connectorOf = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="connector-object"][data-object-id="${id}"]`);
export const connectorHandle = (page: Page, id: string, end: 'from' | 'to'): Locator =>
  connectorOf(page, id).locator(`[data-testid="connector-handle"][data-end="${end}"]`);
export const shapeLabelOf = (page: Page, id: string): Locator =>
  shapeOf(page, id).locator('[data-testid="shape-label"]');
/** The textarea a shape is being written into, while it is. */
export const shapeLabelEditor = (page: Page): Locator => page.getByTestId('shape-label-editor');
/** The drawn figure of a shape: a `rect`, an `ellipse` or a `polygon`. */
export const shapeFigure = (page: Page, id: string): Locator =>
  shapeOf(page, id).locator('[data-testid="shape-figure"]');

/* ------------------------------------------------------------------ the document */

/** Every shape, in drawing order, as its own page's document holds it. */
export async function docShapes(page: Page): Promise<ShapeSnap[]> {
  return (await docObjects(page)).filter((object): object is ShapeSnap => object.type === 'shape');
}

/** Every arrow, in drawing order. */
export async function docConnectors(page: Page): Promise<ConnectorSnap[]> {
  return (await docObjects(page)).filter((object): object is ConnectorSnap => object.type === 'connector');
}

/**
 * The objects of this page's document, read where they are kept. The snapshot the app
 * renders from is not reachable by name from outside, and rebuilding it here would be a
 * second implementation of the reading; `objectSnapshot` is what the board itself uses,
 * so the test is told the same thing the pixels were told.
 */
async function docObjects(page: Page): Promise<ObjectSnapshot[]> {
  return page.evaluate(() => {
    const hooks = window.__vidi6Board;
    if (!hooks) throw new Error('window.__vidi6Board is missing: the e2e suite needs the test build');
    return [...hooks.getNotes()];
  });
}

export async function shapeAt(page: Page, index: number): Promise<ShapeSnap> {
  const shapes = await docShapes(page);
  const shape = shapes[index];
  if (!shape) throw new Error(`no shape at position ${index} of ${shapes.length}`);
  return shape;
}

export async function connectorAt(page: Page, index: number): Promise<ConnectorSnap> {
  const connectors = await docConnectors(page);
  const connector = connectors[index];
  if (!connector) throw new Error(`no connector at position ${index} of ${connectors.length}`);
  return connector;
}

export async function shapeById(page: Page, id: string): Promise<ShapeSnap> {
  const shape = (await docShapes(page)).find((candidate) => candidate.id === id);
  if (!shape) throw new Error(`no shape with id ${id}`);
  return shape;
}

export async function connectorById(page: Page, id: string): Promise<ConnectorSnap> {
  const connector = (await docConnectors(page)).find((candidate) => candidate.id === id);
  if (!connector) throw new Error(`no connector with id ${id}`);
  return connector;
}

/** Wait until the shapes are in the document *and* drawn (a change that arrived is a change shown). */
export async function waitForShapeCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => docShapes(page).then((shapes) => shapes.length), { message: `expected ${count} shapes` })
    .toBe(count);
  await expect(shapeElements(page)).toHaveCount(count);
}

export async function waitForConnectorCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => docConnectors(page).then((list) => list.length), { message: `expected ${count} connectors` })
    .toBe(count);
  await expect(connectorElements(page)).toHaveCount(count);
}

/* ---------------------------------------------------------------- the screen space */

/** The live camera, and the two conversions a test needs from it. */
export async function screenOf(page: Page, point: Point): Promise<Point> {
  return worldToScreen(await cameraState(page), point);
}

export async function worldOf(page: Page, point: Point): Promise<Point> {
  return screenToWorld(await cameraState(page), point);
}

/** The box a shape is drawn in, in CSS pixels. */
export async function shapeScreenBox(page: Page, id: string): Promise<ScreenBox> {
  const box = await shapeOf(page, id).boundingBox();
  if (box === null) throw new Error(`shape ${id} is in the document but not drawn`);
  return box;
}

/** The centre of a shape as it is drawn, which is where a drag aims to land. */
export async function shapeScreenCentre(page: Page, id: string): Promise<Point> {
  const box = await shapeScreenBox(page, id);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The two ends of an arrow as they are *drawn*, in CSS pixels: the `<polyline>`'s
 * points are in the arrow's own board-unit space and the whole world layer is scaled
 * by the camera, so a point of the line reaches the screen at the svg's box plus the
 * point times the zoom. Read this way, an arrow that followed a shape it was never
 * told about is visible - which is the whole behaviour this story is about.
 */
export async function connectorScreenEnds(page: Page, id: string): Promise<{ from: Point; to: Point }> {
  const zoom = (await cameraState(page)).zoom;
  return connectorOf(page, id).evaluate((element, scale) => {
    const line = element.querySelector('[data-testid="connector-line"]');
    const box = element.getBoundingClientRect();
    const read = (which: number): Point => {
      const points = (line?.getAttribute('points') ?? '').trim().split(/\s+/u);
      const [x = '0', y = '0'] = (points[which] ?? '0,0').split(',');
      return { x: box.left + Number(x) * scale, y: box.top + Number(y) * scale };
    };
    return { from: read(0), to: read(1) };
  }, zoom);
}

/* -------------------------------------------------------------------- the gestures */

/** A mouse drag with intermediate steps, so whatever is under the way is passed over. */
async function mouseDrag(page: Page, from: Point, to: Point, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps });
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await waitForRender(page);
}

/** The tool a button names, and the state the board is expected to be in afterwards. */
export async function enterShapeTool(page: Page, kind?: string): Promise<void> {
  await shapeToolButton(page).click();
  await expect(shapeToolButton(page)).toHaveAttribute('aria-pressed', 'true');
  if (kind !== undefined) {
    await expect(shapeKindMenu(page)).toBeVisible();
    await shapeKindOption(page, kind).click();
    await expect(shapeKindOption(page, kind)).toHaveAttribute('aria-pressed', 'true');
  }
}

export async function enterConnectorTool(page: Page): Promise<void> {
  await connectorToolButton(page).click();
  await expect(connectorToolButton(page)).toHaveAttribute('aria-pressed', 'true');
}

/** A tool that made its thing leaves itself behind: Select is pressed again. */
export async function expectBackToSelect(page: Page): Promise<void> {
  await expect(selectToolButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(shapeToolButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(connectorToolButton(page)).toHaveAttribute('aria-pressed', 'false');
}

/**
 * Draw a shape by dragging, and hand back what the board holds when the tool has put
 * itself away. `shift` is the square-constraint key held at the moment of release.
 */
export async function drawShape(
  page: Page,
  from: Point,
  to: Point,
  options: { kind?: string; shift?: boolean } = {},
): Promise<ShapeSnap> {
  const before = (await docShapes(page)).length;
  await enterShapeTool(page, options.kind);
  if (options.shift === true) await page.keyboard.down('Shift');
  await mouseDrag(page, from, to);
  if (options.shift === true) await page.keyboard.up('Shift');
  await expectBackToSelect(page);
  await waitForShapeCount(page, before + 1);
  return await shapeAt(page, before);
}

/** Make a shape where nobody dragged: a click in the Shape tool, which is a real gesture. */
export async function clickShape(page: Page, at: Point, kind?: string): Promise<ShapeSnap> {
  const before = (await docShapes(page)).length;
  await enterShapeTool(page, kind);
  await page.mouse.click(at.x, at.y);
  await expectBackToSelect(page);
  await waitForShapeCount(page, before + 1);
  return await shapeAt(page, before);
}

/**
 * Draw an arrow between two screen points, and hand back the arrow that appeared. The
 * release is what decides the far end, so the points are given as screen points: over
 * a shape they attach, over nothing they stay where they were let go.
 */
export async function drawConnector(page: Page, from: Point, to: Point): Promise<ConnectorSnap> {
  const before = (await docConnectors(page)).length;
  await enterConnectorTool(page);
  await mouseDrag(page, from, to);
  await expectBackToSelect(page);
  await waitForConnectorCount(page, before + 1);
  return await connectorAt(page, before);
}

/** Hover the Connector tool over a point, without pressing: this is what puts the dots out. */
export async function hoverConnectorTool(page: Page, at: Point): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await waitForRender(page);
}

/** Drag one end of a selected arrow somewhere else, and let go there (`connector.reattach`). */
export async function dragConnectorEnd(
  page: Page,
  id: string,
  end: 'from' | 'to',
  to: Point,
): Promise<void> {
  const handle = connectorHandle(page, id, end);
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (box === null) throw new Error(`the ${end} handle of arrow ${id} has no box`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // The window, not the handle, is what watches this drag: the pointer leaves a small
  // circle the moment it moves, and a handle that only answered while it was still
  // under the pointer would lose every drag a person actually performs.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await waitForRender(page);
}

/** The screen centres of the shapes, in the order they were drawn. */
export async function shapeCentres(page: Page, ids: string[]): Promise<Point[]> {
  return Promise.all(ids.map((id) => shapeScreenCentre(page, id)));
}

/* ------------------------------------------------------------------- the fixtures */

/**
 * Put shapes and arrows on a board with the app's own model calls, through the test
 * hook. A fixture that wrote the `objects` fields by hand would be a fixture that had
 * decided what a shape is; these are the functions the Shape tool and the Connector
 * tool call, on this page's document, and the board cannot tell them apart from a
 * person who drew quickly.
 */
export interface FixtureShape {
  kind: string;
  /** Where it is drawn, in board units. */
  rect: Rect;
  label?: string;
  fill?: string;
  stroke?: string;
  /** Who made it, as the document records it. A fixture is honest about its author. */
  by: string;
}

/** One shape of the fixture, written; returns its id. */
export async function addShape(page: Page, shape: FixtureShape): Promise<string> {
  // Everything inside `evaluate` runs in the page, which knows nothing about the names
  // out here - so the centre and the palette check are spelled out there rather than
  // closed over from here.
  return page.evaluate((input) => {
    const hooks = window.__vidi6Board;
    if (!hooks) throw new Error('window.__vidi6Board is missing: the e2e suite needs the test build');
    const box = input.rect;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const created = hooks.createShape({ kind: input.kind as ShapeKind, rect: box, at }, input.by);
    // The model is the one that says whether a kind is a kind; a fixture that names one
    // it invented fails here rather than drawing something else.
    if (created === null) throw new Error(`the model refused the shape ${input.kind}`);
    if (input.label !== undefined && input.label.length > 0) {
      const label = hooks.shapeLabel(created);
      if (label === undefined) throw new Error(`shape ${created} has no label to write into`);
      label.insert(0, input.label);
    }
    if (input.fill !== undefined || input.stroke !== undefined) {
      if (!hooks.setShapeStyle(created, { fill: input.fill, stroke: input.stroke })) {
        throw new Error(`the model refused the colours of shape ${created}`);
      }
    }
    return created;
  }, shape);
}

/** An attached end of the fixture: the arrow joins this shape and follows it. */
export interface FixtureEnd {
  /** Index into the shapes the fixture made. */
  shape: number;
}

/** A free end of the fixture: a point of board, which nothing will ever move. */
export interface FreeEnd {
  x: number;
  y: number;
}

export type FixtureEndpoint = FixtureEnd | FreeEnd;

/**
 * One arrow of the fixture, written: `{ shape: 0 }` joins a shape, `{ x, y }` is a
 * point. Both ends of an arrow are decided here the way the tool decides them, and the
 * model is the one that says yes or no - so a fixture that asks for an arrow between a
 * shape and itself fails here, loudly, instead of quietly testing nothing.
 */
export async function addConnector(
  page: Page,
  from: FixtureEndpoint,
  to: FixtureEndpoint,
  by: string,
  ids: string[],
): Promise<string> {
  return page.evaluate(
    ({ tail, head, who, shapes }) => {
      const hooks = window.__vidi6Board;
      if (!hooks) throw new Error('window.__vidi6Board is missing: the e2e suite needs the test build');
      const endpoint = (end: FixtureEndpoint) =>
        'x' in end
          ? ({ kind: 'free', x: end.x, y: end.y } as const)
          : (() => {
              const id = shapes[end.shape];
              if (id === undefined) throw new Error(`the fixture has no shape at position ${end.shape}`);
              return { kind: 'attached', objectId: id, fallback: { x: 0, y: 0 } } as const;
            })();
      const created = hooks.createConnector(endpoint(tail), endpoint(head), who);
      if (created === null) throw new Error('the model refused this arrow');
      return created;
    },
    { tail: from, head: to, who: by, shapes: ids },
  );
}

/** Wait until a change from another page has arrived here; the timeout is the design's. */
export const EVENTUALLY = { timeout: E2E_EVENTUAL_TIMEOUT_MS };

/** The camera of a page, for a test that has to do its own arithmetic. */
export async function camera(page: Page): Promise<Camera> {
  return cameraState(page);
}
