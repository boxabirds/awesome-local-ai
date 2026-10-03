/**
 * Browser helpers for story 10: shapes and connectors.
 *
 * The board reports each shape's world rectangle and each connector's resolved endpoints
 * in the DOM (`data-shape-*`, `data-start-*`/`data-end-*`), so a test reads what is painted
 * rather than the app's internals. Gestures are real pointer moves a person can make.
 */
import { expect, type Page } from '@playwright/test';

import type { ShapeKind } from '../../../src/shared/config';
import type { ScreenPoint } from './board';

export const SHAPE_SELECTOR = '[data-testid="shape-object"]';
export const CONNECTOR_SELECTOR = '[data-testid="connector-object"]';
export const CONNECTOR_DOT = '[data-testid="connector-dot"]';
export const CONNECTOR_HANDLE = '[data-testid="connector-handle"]';
export const SHAPE_TOOL_OVERLAY = '[data-testid="shape-tool"]';

export interface ShapeOnScreen {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  label: string;
  selected: boolean;
}

export interface ConnectorOnScreen {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  fromKind: string;
  toKind: string;
  fromId: string;
  toId: string;
  selected: boolean;
}

export async function readShapes(page: Page): Promise<ShapeOnScreen[]> {
  return page.$$eval(SHAPE_SELECTOR, (elements) =>
    elements.map((element) => {
      const node = element as HTMLElement;
      return {
        id: node.dataset.objectId ?? '',
        kind: node.dataset.kind ?? '',
        x: Number(node.dataset.shapeX),
        y: Number(node.dataset.shapeY),
        width: Number(node.dataset.shapeWidth),
        height: Number(node.dataset.shapeHeight),
        fill: node.dataset.fill ?? '',
        stroke: node.dataset.stroke ?? '',
        label: node.dataset.label ?? '',
        selected: node.dataset.selected === 'true',
      };
    }),
  );
}

export async function readShape(page: Page, id: string): Promise<ShapeOnScreen | null> {
  return (await readShapes(page)).find((shape) => shape.id === id) ?? null;
}

export async function shapeCount(page: Page): Promise<number> {
  return (await page.$$(SHAPE_SELECTOR)).length;
}

export async function readConnectors(page: Page): Promise<ConnectorOnScreen[]> {
  return page.$$eval(CONNECTOR_SELECTOR, (elements) =>
    elements.map((element) => {
      const node = element as HTMLElement;
      return {
        id: node.dataset.objectId ?? '',
        startX: Number(node.dataset.startX),
        startY: Number(node.dataset.startY),
        endX: Number(node.dataset.endX),
        endY: Number(node.dataset.endY),
        fromKind: node.dataset.fromKind ?? '',
        toKind: node.dataset.toKind ?? '',
        fromId: node.dataset.fromId ?? '',
        toId: node.dataset.toId ?? '',
        selected: node.dataset.selected === 'true',
      };
    }),
  );
}

export async function readConnector(page: Page, id: string): Promise<ConnectorOnScreen | null> {
  return (await readConnectors(page)).find((c) => c.id === id) ?? null;
}

export async function connectorCount(page: Page): Promise<number> {
  return (await page.$$(CONNECTOR_SELECTOR)).length;
}

/** How many lines the label is painted across (one rectangle per wrapped line box). */
export async function paintedLabelLines(page: Page, id: string): Promise<number> {
  return page.evaluate((selector) => {
    const shape = document.querySelector<HTMLElement>(selector);
    const label = shape?.querySelector<HTMLElement>('[data-testid="shape-label"]');
    if (!label) return -1;
    const range = document.createRange();
    range.selectNodeContents(label);
    const rows = new Set<number>();
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.height > 0) rows.add(Math.round(rect.y));
    }
    return rows.size;
  }, `${SHAPE_SELECTOR}[data-object-id="${id}"]`);
}

/** How far the painted label text's centre sits from the shape's centre. */
export async function labelCentredInShape(page: Page, id: string): Promise<{
  dx: number;
  dy: number;
  shapeWidth: number;
}> {
  return page.evaluate((selector) => {
    const shape = document.querySelector<HTMLElement>(selector);
    const label = shape?.querySelector<HTMLElement>('[data-testid="shape-label"]');
    if (!shape || !label) throw new Error('shape or label is not on screen');
    const s = shape.getBoundingClientRect();
    // The label wrapper fills the shape, so centre the *words*, not the box: the union of
    // the line boxes the text is painted on.
    const range = document.createRange();
    range.selectNodeContents(label);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (rects.length === 0) return { dx: 0, dy: 0, shapeWidth: s.width };
    const left = Math.min(...rects.map((r) => r.x));
    const right = Math.max(...rects.map((r) => r.x + r.width));
    const top = Math.min(...rects.map((r) => r.y));
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    return {
      dx: (left + right) / 2 - (s.x + s.width / 2),
      dy: (top + bottom) / 2 - (s.y + s.height / 2),
      shapeWidth: s.width,
    };
  }, `${SHAPE_SELECTOR}[data-object-id="${id}"]`);
}

/** Arm the Shape tool by its keyboard shortcut. */
export async function armShapeTool(page: Page): Promise<void> {
  await page.getByTestId('board-viewport').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('s');
  await expect(page.getByTestId('tool-shape')).toHaveAttribute('aria-pressed', 'true');
}

/** Choose the kind the Shape tool will draw next. */
export async function chooseShapeKind(page: Page, kind: ShapeKind): Promise<void> {
  await page.getByTestId(`shape-kind-${kind}`).click();
}

/** Drag the Shape tool across the board, drawing a box from `from` to `to`. */
export async function drawShape(page: Page, from: ScreenPoint, to: ScreenPoint): Promise<string> {
  const before = new Set((await readShapes(page)).map((s) => s.id));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  let fresh: ShapeOnScreen[] = [];
  await expect
    .poll(
      async () => {
        fresh = (await readShapes(page)).filter((s) => !before.has(s.id));
        return fresh.length;
      },
      { message: 'the shape drag drew no shape' },
    )
    .toBe(1);
  return fresh[0]!.id;
}

/** The screen point of one shape's connection dot (`side`), while the Connector tool is armed. */
export async function connectorDotPoint(page: Page, id: string, side: string): Promise<ScreenPoint> {
  const box = await page
    .locator(`${CONNECTOR_DOT}[data-object-id="${id}"][data-side="${side}"]`)
    .boundingBox()
    .catch(() => null);
  if (!box) throw new Error(`shape ${id} shows no ${side} connection dot`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag from one object's dot to another object's centre, drawing a connector. */
export async function drawConnector(
  page: Page,
  from: { id: string; side: string },
  to: ScreenPoint,
): Promise<string> {
  await expect(page.locator(`${CONNECTOR_DOT}[data-object-id="${from.id}"][data-side="${from.side}"]`)).toBeVisible();
  const start = await connectorDotPoint(page, from.id, from.side);
  const before = new Set((await readConnectors(page)).map((c) => c.id));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  let fresh: ConnectorOnScreen[] = [];
  await expect
    .poll(
      async () => {
        fresh = (await readConnectors(page)).filter((c) => !before.has(c.id));
        return fresh.length;
      },
      { message: 'the connector drag drew no connector' },
    )
    .toBe(1);
  return fresh[0]!.id;
}

/** Arm the Connector tool by its shortcut. */
export async function armConnectorTool(page: Page): Promise<void> {
  await page.getByTestId('board-viewport').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('l');
  await expect(page.getByTestId('tool-connector')).toHaveAttribute('aria-pressed', 'true');
}

/** Select a shape by clicking its centre. Returns its centre screen point. */
export async function selectShape(page: Page, id: string): Promise<ScreenPoint> {
  const box = await page.locator(`${SHAPE_SELECTOR}[data-object-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`shape ${id} is not on screen`);
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(centre.x, centre.y);
  await expect
    .poll(() => readShape(page, id).then((s) => s?.selected ?? false), {
      message: `shape ${id} did not become selected`,
    })
    .toBe(true);
  return centre;
}

/** Drag a shape by a screen delta from its centre. */
export async function dragShape(page: Page, id: string, delta: ScreenPoint): Promise<void> {
  const centre = await selectShapeCentre(page, id);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + delta.x, centre.y + delta.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function selectShapeCentre(page: Page, id: string): Promise<ScreenPoint> {
  const box = await page.locator(`${SHAPE_SELECTOR}[data-object-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`shape ${id} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Click near a connector's midpoint to select it. */
export async function selectConnector(page: Page, id: string): Promise<void> {
  const connector = await readConnector(page, id);
  if (!connector) throw new Error(`connector ${id} is not on screen`);
  // Convert the world midpoint to screen via the current camera.
  const cam = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="board-viewport"]')!;
    return { x: Number(el.dataset.cameraX), y: Number(el.dataset.cameraY), zoom: Number(el.dataset.cameraZoom) };
  });
  const midWorld = { x: (connector.startX + connector.endX) / 2, y: (connector.startY + connector.endY) / 2 };
  const midScreen = { x: (midWorld.x - cam.x) * cam.zoom, y: (midWorld.y - cam.y) * cam.zoom };
  await page.mouse.click(midScreen.x, midScreen.y);
  await expect
    .poll(() => readConnector(page, id).then((c) => c?.selected ?? false), {
      message: `connector ${id} did not become selected`,
    })
    .toBe(true);
}
