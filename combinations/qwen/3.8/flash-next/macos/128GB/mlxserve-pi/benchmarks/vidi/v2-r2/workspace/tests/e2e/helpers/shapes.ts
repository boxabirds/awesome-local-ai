// Helpers for story 10's e2e tests: shapes drawn by drag and by click, and the
// arrows that point at them. Content is read out of the live document through
// `window.__vidi6.snapshot()` (test build only), and every click is placed through
// the camera the board is holding, so a test says where on the board it means rather
// than where the pixels happened to land. The board answers to client coordinates, so
// a board point a test can click is within roughly 640 by 400 of the start point the
// board opens on.

import { expect, type Locator, type Page } from '@playwright/test';
import type { ConnectorSnapshot, ConnectorEnd, Endpoint } from '../../../src/shared/objects/connector';
import type { ShapeSnapshot, ShapeKind } from '../../../src/shared/objects/shape';
import { readCamera, type Point } from './board';

export type { ConnectorEnd, Point, ShapeKind };

/** A shape reduced to the fields that must agree across every client. */
export interface ShapeContent {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  label: string;
  z: number;
}

/** An arrow reduced to the same kind of content. */
export interface ConnectorContent {
  id: string;
  from: Endpoint;
  to: Endpoint;
  ends: { from: Point; to: Point };
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

interface Hooks {
  __vidi6: {
    snapshot(): Record<string, unknown>[];
    __applyUpdate(update: number[], origin?: string): void;
  };
}

/** Every object on the board, as the test hook answers it. */
function snapshotOf(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    () => (window as unknown as Hooks).__vidi6.snapshot() as Record<string, unknown>[],
  );
}

/** The shapes on the board, in the order the document holds them - which is the
 * order they are painted in, so an index here is an index in the DOM. */
export async function shapes(page: Page): Promise<ShapeContent[]> {
  const all = await snapshotOf(page);
  return all
    .filter((o) => o['type'] === 'shape')
    .map((o) => {
      const s = o as unknown as ShapeSnapshot;
      return {
        id: s.id,
        kind: s.kind,
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
        fill: s.fill,
        stroke: s.stroke,
        label: s.label,
        z: s.z,
      };
    });
}

/** The arrows on the board, likewise in document (and therefore DOM) order. */
export async function connectors(page: Page): Promise<ConnectorContent[]> {
  const all = await snapshotOf(page);
  return all
    .filter((o) => o['type'] === 'connector')
    .map((o) => {
      const c = o as unknown as ConnectorSnapshot;
      return {
        id: c.id,
        from: c.from,
        to: c.to,
        ends: { from: { ...c.ends.from }, to: { ...c.ends.to } },
        x: c.x,
        y: c.y,
        width: c.width,
        height: c.height,
        z: c.z,
      };
    });
}

export async function shapeCount(page: Page): Promise<number> {
  return (await shapes(page)).length;
}
export async function connectorCount(page: Page): Promise<number> {
  return (await connectors(page)).length;
}

export async function shapeAt(page: Page, index: number): Promise<ShapeContent> {
  const list = await shapes(page);
  const shape = list[index];
  if (shape === undefined) throw new Error(`shape ${index} is not on the board`);
  return shape;
}

/** A shape by id, and the index it is painted at. */
export async function shapeById(page: Page, id: string): Promise<ShapeContent> {
  const list = await shapes(page);
  const shape = list.find((s) => s.id === id);
  if (shape === undefined) throw new Error(`shape ${id} is not on the board`);
  return shape;
}

export async function shapeIndexOf(page: Page, id: string): Promise<number> {
  const index = (await shapes(page)).findIndex((s) => s.id === id);
  if (index < 0) throw new Error(`shape ${id} is not on the board`);
  return index;
}

export async function connectorById(page: Page, id: string): Promise<ConnectorContent> {
  const list = await connectors(page);
  const connector = list.find((c) => c.id === id);
  if (connector === undefined) throw new Error(`connector ${id} is not on the board`);
  return connector;
}

export async function connectorIndexOf(page: Page, id: string): Promise<number> {
  const index = (await connectors(page)).findIndex((c) => c.id === id);
  if (index < 0) throw new Error(`connector ${id} is not on the board`);
  return index;
}

export async function connectorAt(page: Page, index: number): Promise<ConnectorContent> {
  const list = await connectors(page);
  const connector = list[index];
  if (connector === undefined) throw new Error(`connector ${index} is not on the board`);
  return connector;
}

const sameJson = (pages: Page[], read: (page: Page) => Promise<unknown>): Promise<boolean> =>
  Promise.all(pages.map(read)).then((all) => {
    const first = JSON.stringify(all[0]);
    return all.every((c) => JSON.stringify(c) === first);
  });

/** True once every page holds the same shapes, sizes and labels included. */
export function shapesMatch(pages: Page[]): Promise<boolean> {
  return sameJson(pages, shapes);
}
/** True once every page holds the same arrows, endpoints and drawn points included. */
export function connectorsMatch(pages: Page[]): Promise<boolean> {
  return sameJson(pages, connectors);
}

export async function waitForShapesMatch(pages: Page[], timeout = 15_000): Promise<void> {
  await expect
    .poll(() => shapesMatch(pages), { timeout, message: 'the shapes to converge' })
    .toBe(true);
}

export async function waitForConnectorsMatch(pages: Page[], timeout = 15_000): Promise<void> {
  await expect
    .poll(() => connectorsMatch(pages), { timeout, message: 'the arrows to converge' })
    .toBe(true);
}

// ---------------------------------------------------------------------------
// the tools
// ---------------------------------------------------------------------------

export function shapeToolLayer(page: Page): Locator {
  return page.getByTestId('shape-tool-layer');
}
export function connectorToolLayer(page: Page): Locator {
  return page.getByTestId('connector-tool-layer');
}
export function shapePreview(page: Page): Locator {
  return page.getByTestId('shape-preview');
}
export function shapeKindMenu(page: Page): Locator {
  return page.getByTestId('shape-kind-menu');
}
export function shapeKindButton(page: Page, kind: ShapeKind): Locator {
  return page.getByTestId(`shape-kind-${kind}`);
}
export function shapeToolButton(page: Page): Locator {
  return page.getByTestId('tool-shape');
}
export function connectorToolButton(page: Page): Locator {
  return page.getByTestId('tool-connector');
}
export function shapeObjects(page: Page): Locator {
  return page.locator('[data-testid="shape-object"]');
}
export function connectorObjects(page: Page): Locator {
  return page.locator('[data-testid="connector-object"]');
}
export function shapeLabel(page: Page, index: number): Locator {
  return shapeObjects(page).nth(index).locator('[data-testid="shape-label"]');
}
export function shapeInput(page: Page): Locator {
  return page.locator('[data-testid="shape-input"]');
}
export function connectorEndHandle(page: Page, index: number, end: ConnectorEnd): Locator {
  return connectorObjects(page).nth(index).locator(`[data-testid="connector-end-${end}"]`);
}

/** Hold the Shape tool (and choose a kind when the test names one). */
export async function holdShapeTool(page: Page, kind?: ShapeKind): Promise<void> {
  await page.keyboard.press('s');
  await expect(shapeToolLayer(page)).toHaveCount(1);
  if (kind !== undefined && kind !== (await currentKind(page))) {
    await expect(shapeKindMenu(page)).toHaveCount(1);
    await shapeKindButton(page, kind).click();
  }
}

/** Hold the Connector tool. */
export async function holdConnectorTool(page: Page): Promise<void> {
  await page.keyboard.press('l');
  await expect(connectorToolLayer(page)).toHaveCount(1);
}

/** The kind the Shape tool will draw next, as the toolbar says. */
async function currentKind(page: Page): Promise<ShapeKind | null> {
  for (const kind of ['rect', 'ellipse', 'diamond'] as const) {
    if ((await shapeKindButton(page, kind).getAttribute('aria-checked')) === 'true') return kind;
  }
  return null;
}

// ---------------------------------------------------------------------------
// placing the pointer by where on the board it means
// ---------------------------------------------------------------------------

/** Where a board point is on the screen: the board's own mapping, read from the
 * camera it is holding. The board answers to client coordinates, so a world point
 * outside the window is a point nobody can click. */
export async function screenOf(page: Page, world: Point): Promise<Point> {
  const camera = await readCamera(page);
  return {
    x: (world.x - camera.x) * camera.zoom,
    y: (world.y - camera.y) * camera.zoom,
  };
}

/** The box a shape is drawn in, in screen coordinates. */
export async function shapeScreenBox(page: Page, index: number): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await shapeObjects(page).nth(index).boundingBox();
  if (box === null) throw new Error(`shape ${index} is not rendered`);
  return box;
}

/** Where a shape's centre is on the screen. */
export async function shapeScreenCentre(page: Page, index: number): Promise<Point> {
  const box = await shapeScreenBox(page, index);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Where an arrow's end is drawn, read from the handle the board offers for it. */
export async function connectorEndScreenPoint(page: Page, index: number, end: ConnectorEnd): Promise<Point> {
  const box = await connectorEndHandle(page, index, end).boundingBox();
  if (box === null) throw new Error(`arrow ${index} has no ${end} handle`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------

/** Press, move in steps, release: the tool's layer is what takes the pointer, because
 * it is the topmost thing over the board while the tool is held. */
async function dragOnLayer(
  page: Page,
  from: Point,
  to: Point,
  steps = 8,
  shift = false,
): Promise<void> {
  const start = await screenOf(page, from);
  const end = await screenOf(page, to);
  await page.mouse.move(start.x, start.y);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: Math.max(1, steps >> 1) });
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

/** Draw a shape with the tool: the drag is the shape. Waits for the tool to let go. */
export async function drawShape(
  page: Page,
  from: Point,
  to: Point,
  options: { kind?: ShapeKind; shift?: boolean } = {},
): Promise<void> {
  const before = await shapeCount(page);
  await holdShapeTool(page, options.kind);
  await dragOnLayer(page, from, to, 8, options.shift === true);
  await expect(shapeToolLayer(page)).toHaveCount(0);
  await expect
    .poll(() => shapeCount(page), { message: 'the shape to be on the board' })
    .toBeGreaterThan(before);
}

/** Draw a shape with a click: it is made the standard size, centred on the click. */
export async function clickShape(page: Page, at: Point, kind?: ShapeKind): Promise<void> {
  const before = await shapeCount(page);
  await holdShapeTool(page, kind);
  const atScreen = await screenOf(page, at);
  await page.mouse.click(atScreen.x, atScreen.y);
  await expect(shapeToolLayer(page)).toHaveCount(0);
  await expect
    .poll(() => shapeCount(page), { message: 'the shape to be on the board' })
    .toBeGreaterThan(before);
}

/** Draw an arrow between two board points. Waits for the arrow to be there. */
export async function drawArrow(
  page: Page,
  from: Point,
  to: Point,
  steps = 8,
): Promise<void> {
  const before = await connectorCount(page);
  await holdConnectorTool(page);
  await dragOnLayer(page, from, to, steps);
  await expect(connectorToolLayer(page)).toHaveCount(0);
  await expect
    .poll(() => connectorCount(page), { message: 'the arrow to be on the board' })
    .toBeGreaterThan(before);
}

/** Press on the tool's layer at one board point and hold, leaving the pointer down. */
export async function pressArrowAt(page: Page, at: Point): Promise<void> {
  await holdConnectorTool(page);
  const point = await screenOf(page, at);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 20, point.y + 10, { steps: 3 });
}

/** Move the held arrow to a board point and let go. */
export async function releaseArrowAt(page: Page, at: Point): Promise<void> {
  const point = await screenOf(page, at);
  await page.mouse.move(point.x, point.y, { steps: 6 });
  await page.mouse.up();
}

/** Drag an arrow's end to a board point and let go. */
export async function dragArrowEnd(
  page: Page,
  index: number,
  end: ConnectorEnd,
  to: Point,
): Promise<void> {
  const from = await connectorEndScreenPoint(page, index, end);
  const target = await screenOf(page, to);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + target.x) / 2, (from.y + target.y) / 2, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
}

/** Select a shape by clicking its centre (the board's, not the tool's, click). */
export async function selectShape(page: Page, index: number): Promise<void> {
  const centre = await shapeScreenCentre(page, index);
  await page.mouse.click(centre.x, centre.y);
  await expect(shapeObjects(page).nth(index)).toHaveAttribute('data-selected', 'true');
}

/** Open a shape's label editor the way the PRD opens it: by double-clicking it. */
export async function editShapeLabel(page: Page, index: number): Promise<void> {
  const centre = await shapeScreenCentre(page, index);
  await page.mouse.dblclick(centre.x, centre.y);
  await expect(shapeInput(page)).toHaveCount(1);
}

/** Drag a shape by a screen delta: the board's own move gesture, in its own tool. */
export async function dragShape(page: Page, index: number, dx: number, dy: number): Promise<void> {
  const centre = await shapeScreenCentre(page, index);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + dx / 2, centre.y + dy / 2, { steps: 4 });
  await page.mouse.move(centre.x + dx, centre.y + dy, { steps: 6 });
  await page.mouse.up();
}

/** Click the middle of an arrow's line to select it. A straight line crosses the
 * middle of its own box, so the tolerance is comfortably reached. */
export async function selectArrow(page: Page, index: number): Promise<void> {
  const box = await connectorObjects(page).nth(index).boundingBox();
  if (box === null) throw new Error(`arrow ${index} is not rendered`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(connectorObjects(page).nth(index)).toHaveAttribute('data-selected', 'true');
}

/**
 * Put a built flow onto a live board by applying the fixture's update to the document
 * the page is holding. That is the road a peer's objects take - an update arrives, the
 * document changes, the board paints it - so the shapes and arrows this seeds are drawn
 * by the board rather than by the test, and they go on to the other clients from there.
 */
export async function seedFlow(page: Page, all: Uint8Array): Promise<void> {
  await page.evaluate((bytes) => {
    (window as unknown as Hooks).__vidi6.__applyUpdate(bytes, 'fixture');
  }, Array.from(all));
}
