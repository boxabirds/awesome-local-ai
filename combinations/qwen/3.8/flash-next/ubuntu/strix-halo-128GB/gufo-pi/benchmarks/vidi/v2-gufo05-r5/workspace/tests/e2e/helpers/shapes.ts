/**
 * E2E helpers for shapes and arrows (story 10).
 *
 * Objects are put on the board through the client's test hooks, which call the real model functions
 * - the same `createShape` and `createConnector` the tools call - and everything else is read back
 * either from the document (`window.__vidi6.getObjects()`) or from the picture that was drawn, so a
 * failure says whether the board or the screen is wrong.
 */
import { expect, type Page } from '@playwright/test';
import {
  isConnectorSnapshot,
  isShapeSnapshot,
  type ConnectorSnapshot,
  type ObjectSnapshot,
  type ShapeSnapshot,
} from '../../../src/shared/board-model';
import type { Endpoint } from '../../../src/shared/objects/connector';
import type { ShapeKind } from '../../../src/shared/objects/shape';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import { CHECKOUT_FLOW, endpointFor, type CheckoutFlow } from '../../fixtures/checkout-flow';

/** The point a test aims at, in world units. */
export interface World {
  x: number;
  y: number;
}

/** The board centred on the world origin: what the app itself starts with. */
export const SCREEN_CENTRE = { x: 640, y: 400 };

/** The camera that puts the world origin in the middle of a 1280x800 board at `zoom`. */
export function centredCamera(zoom = 1): { x: number; y: number; zoom: number } {
  return { x: -SCREEN_CENTRE.x / zoom, y: -SCREEN_CENTRE.y / zoom, zoom };
}

/** Where a world point is drawn, with the camera this file's tests use. */
export function toScreen(world: World, zoom = 1): { x: number; y: number } {
  return { x: world.x * zoom + SCREEN_CENTRE.x, y: world.y * zoom + SCREEN_CENTRE.y };
}

async function objectsOn(page: Page): Promise<readonly ObjectSnapshot[]> {
  return page.evaluate(() => {
    if (!window.__vidi6) {
      throw new Error('window.__vidi6 is missing: build the client with `vite build --mode test`');
    }
    return window.__vidi6.getObjects();
  });
}

export async function shapesOn(page: Page): Promise<readonly ShapeSnapshot[]> {
  return (await objectsOn(page)).filter(isShapeSnapshot);
}

export async function connectorsOn(page: Page): Promise<readonly ConnectorSnapshot[]> {
  return (await objectsOn(page)).filter(isConnectorSnapshot);
}

/** One shape by id, or the object that is not there: the message says which one was looked for. */
export async function shapeById(page: Page, id: string): Promise<ShapeSnapshot> {
  const shape = (await shapesOn(page)).find((obj) => obj.id === id);
  if (!shape) throw new Error(`shape ${id} is not on this board`);
  return shape;
}

/** Makes a shape through the model; fails with a clear message if the model refused it. */
export async function createShape(
  page: Page,
  shape: { kind: ShapeKind; x: number; y: number; width: number; height: number; label?: string },
): Promise<string> {
  const id = await page.evaluate((args) => window.__vidi6!.createShapeAt(args), shape);
  expect(id, `the model refused the shape ${JSON.stringify(shape)}`).not.toBe('');
  await expect(page.locator(`[data-shape-id="${id}"]`)).toHaveCount(1);
  return id;
}

/** Makes an arrow through the model; fails with a clear message if the model refused it. */
export async function createConnector(
  page: Page,
  from: Endpoint,
  to: Endpoint,
): Promise<string> {
  const id = await page.evaluate(
    (ends) => window.__vidi6!.createConnectorBetween(ends.from, ends.to),
    { from, to },
  );
  expect(id, `the model refused the arrow ${JSON.stringify({ from, to })}`).not.toBe('');
  await expect(page.locator(`[data-connector-id="${id}"]`)).toHaveCount(1);
  return id;
}

/** Waits until this page's document holds `count` shapes. */
export async function waitForShapeCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => shapesOn(page).then((shapes) => shapes.length), {
      message: `this board should hold ${count} shapes`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(count);
}

/** Waits until this page's document holds `count` arrows. */
export async function waitForConnectorCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => connectorsOn(page).then((connectors) => connectors.length), {
      message: `this board should hold ${count} arrows`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(count);
}

/** Waits until this page's document no longer holds an object. */
export async function waitForGone(page: Page, id: string): Promise<void> {
  await expect
    .poll(() => objectsOn(page).then((objects) => objects.some((obj) => obj.id === id)), {
      message: `object ${id} is still on this board`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(false);
}

/**
 * The two points the arrow is actually drawn between. The SVG is drawn in world units, so these are
 * world coordinates and can be compared with what the document says.
 */
export async function drawnEnds(
  page: Page,
  id: string,
): Promise<{ from: World; to: World }> {
  const line = page.locator(`[data-connector-id="${id}"] [data-testid="connector-line"]`);
  await expect(line).toHaveCount(1);
  const read = (name: string) => line.getAttribute(name).then((value) => Number(value));
  return {
    from: { x: await read('x1'), y: await read('y1') },
    to: { x: await read('x2'), y: await read('y2') },
  };
}

/** Where a shape is drawn, in world units, from the inline style the board set on it. */
export async function drawnBox(
  page: Page,
  id: string,
): Promise<{ left: number; top: number; width: number; height: number }> {
  return page.locator(`[data-shape-id="${id}"]`).evaluate((el) => ({
    left: Number.parseFloat(el.style.left),
    top: Number.parseFloat(el.style.top),
    width: Number.parseFloat(el.style.width),
    height: Number.parseFloat(el.style.height),
  }));
}

/** The label's height in screen pixels: more than one line's worth means it wrapped. */
export async function labelHeightPx(page: Page, id: string): Promise<number> {
  const box = await page
    .locator(`[data-shape-id="${id}"] [data-testid="shape-label"]`)
    .boundingBox();
  if (!box) throw new Error(`shape ${id} has no label on the screen`);
  return box.height;
}

/**
 * Puts the checkout-flow fixture on the board: four labelled shapes, then the arrows between them.
 * Returns the ids in fixture order.
 */
export async function applyCheckoutFlow(
  page: Page,
  flow: CheckoutFlow = CHECKOUT_FLOW,
): Promise<{ shapes: string[]; connectors: string[] }> {
  const shapes: string[] = [];
  for (const shape of flow.shapes) {
    shapes.push(await createShape(page, shape));
  }
  const connectors: string[] = [];
  for (const connector of flow.connectors) {
    connectors.push(
      await createConnector(
        page,
        endpointFor(connector.from, flow, shapes),
        endpointFor(connector.to, flow, shapes),
      ),
    );
  }
  await expect(page.locator('[data-shape-id]')).toHaveCount(flow.shapes.length);
  await expect(page.locator('[data-connector-id]')).toHaveCount(flow.connectors.length);
  return { shapes, connectors };
}
