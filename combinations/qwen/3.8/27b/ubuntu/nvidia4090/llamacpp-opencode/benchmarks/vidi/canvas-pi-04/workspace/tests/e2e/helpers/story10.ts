// Story 10 e2e helpers (TC-23..TC-27).
//
// Shapes and connectors are created through the REAL tools (S / L + mouse)
// so the full path runs in the browser; the checkout-flow fixture is seeded
// server side through the /__test/boards/:id/seed-flow hook (real model
// calls in the worker). Helpers are camera-aware like helpers/story7.ts:
// world points are converted to viewport-local screen with the parked
// camera.

import { expect, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';
import { CHECKOUT_FLOW, type FlowSpec } from '../../fixtures/checkout-flow';

export const VIEWPORT = '[data-testid="board-viewport"]';
export const SHAPE = '[data-testid="shape-object"]';
export const SHAPE_LABEL = '.shape-object__label';
export const SHAPE_EDITOR = 'textarea[aria-label="Shape label"]';
export const CONNECTOR = '[data-testid="connector-object"]';
export const CONNECTOR_BODY = '.connector-object__body';

export interface SeedFlowResult {
  /** Fixture key -> object id. */
  shapes: Record<string, string>;
  /** Connector ids, in fixture order. */
  connectors: string[];
}

export interface FlowCounts {
  shapes: number;
  connectors: number;
  other: number;
}

/** Seed the checkout-flow fixture on the board (server side). */
export async function seedFlow(baseURL: string, boardId: string): Promise<SeedFlowResult> {
  const res = await fetch(`${baseURL}/__test/boards/${boardId}/seed-flow`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(CHECKOUT_FLOW satisfies FlowSpec),
  });
  const data = (await res.json()) as { ok: boolean } & SeedFlowResult;
  expect(data.ok, `seed-flow should succeed`).toBe(true);
  return { shapes: data.shapes, connectors: data.connectors };
}

/** Server-side per-type object counts (ground truth). */
export async function flowCount(baseURL: string, boardId: string): Promise<FlowCounts> {
  const res = await fetch(`${baseURL}/__test/boards/${boardId}/flow`, { method: 'POST' });
  const data = (await res.json()) as { ok: boolean } & FlowCounts;
  expect(data.ok).toBe(true);
  return { shapes: data.shapes, connectors: data.connectors, other: data.other };
}

/** Viewport-local screen point for a world point under `camera`. */
function localOf(camera: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - camera.x) * camera.zoom, y: (wy - camera.y) * camera.zoom };
}

async function viewportBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return (await page.locator(VIEWPORT).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** Wait for the board viewport to be on screen (interactions land). */
export async function waitForViewport(page: Page): Promise<void> {
  await page.locator(VIEWPORT).waitFor({ state: 'visible', timeout: 15_000 });
}

/**
 * Activate a drawing tool (S or L) and wait for it to land. `kind` selects a
 * shape kind from the toolbar menu (the Shape tool only).
 */
export async function useDrawingTool(
  page: Page,
  tool: 'shape' | 'connector',
  kind?: 'Rectangle' | 'Ellipse' | 'Diamond',
): Promise<void> {
  await page.keyboard.press(tool === 'shape' ? 's' : 'l');
  await page.locator(`${VIEWPORT}.is-drawing-tool`).waitFor({ timeout: 10_000 });
  if (kind !== undefined) {
    await page.getByRole('menuitemradio', { name: kind }).click();
  }
}

/** True while any drawing tool (shape/connector) is active. */
export async function isDrawingToolActive(page: Page): Promise<boolean> {
  return (await page.locator(`${VIEWPORT}.is-drawing-tool`).count()) > 0;
}

/** Draw a shape by dragging world (x0,y0) -> (x1,y1) with the Shape tool. */
export async function dragShapeDraw(
  page: Page,
  camera: Camera,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<void> {
  await useDrawingTool(page, 'shape');
  const box = await viewportBox(page);
  const s0 = localOf(camera, x0, y0);
  const s1 = localOf(camera, x1, y1);
  await page.mouse.move(box.x + s0.x, box.y + s0.y);
  await page.mouse.down();
  await page.mouse.move(box.x + s1.x, box.y + s1.y, { steps: 12 });
  await page.mouse.up();
}

/** Create a shape of `kind` at world (wx, wy) with a plain click (S tool). */
export async function clickShape(
  page: Page,
  camera: Camera,
  kind: 'Rectangle' | 'Ellipse' | 'Diamond',
  wx: number,
  wy: number,
): Promise<void> {
  await useDrawingTool(page, 'shape', kind);
  const box = await viewportBox(page);
  const s = localOf(camera, wx, wy);
  await page.mouse.click(box.x + s.x, box.y + s.y);
}

/** Draw a connector by dragging world (x0,y0) -> (x1,y1) with the L tool. */
export async function dragConnector(
  page: Page,
  camera: Camera,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<void> {
  await useDrawingTool(page, 'connector');
  const box = await viewportBox(page);
  const s0 = localOf(camera, x0, y0);
  const s1 = localOf(camera, x1, y1);
  await page.mouse.move(box.x + s0.x, box.y + s0.y);
  await page.mouse.down();
  await page.mouse.move(box.x + s1.x, box.y + s1.y, { steps: 12 });
  await page.mouse.up();
}

export async function shapeCount(page: Page): Promise<number> {
  return page.locator(SHAPE).count();
}

export async function connectorCount(page: Page): Promise<number> {
  return page.locator(CONNECTOR).count();
}

/** The id of the currently selected shape (tools select what they create). */
export async function selectedShapeId(page: Page): Promise<string | null> {
  return page.locator(`${SHAPE}[data-selected]`).first().getAttribute('data-shape-id');
}

/** The id of the currently selected connector. */
export async function selectedConnectorId(page: Page): Promise<string | null> {
  return page.locator(`${CONNECTOR}[data-selected]`).first().getAttribute('data-connector-id');
}

/** The rendered world box of a shape (style values are world px). */
export async function shapeWorld(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; w: number; h: number; kind: string }> {
  return page.locator(`${SHAPE}[data-shape-id="${id}"]`).evaluate((el) => {
    const s = el.style;
    return {
      x: parseFloat(s.left),
      y: parseFloat(s.top),
      w: parseFloat(s.width),
      h: parseFloat(s.height),
      kind: el.getAttribute('data-shape-kind') ?? '',
    };
  });
}

/** The rendered body line of a connector (world coordinates). */
export async function connectorEnds(
  page: Page,
  id: string,
): Promise<{ x1: number; y1: number; x2: number; y2: number }> {
  return page
    .locator(`${CONNECTOR}[data-connector-id="${id}"] ${CONNECTOR_BODY}`)
    .evaluate((el) => ({
      x1: parseFloat(el.getAttribute('x1') ?? '0'),
      y1: parseFloat(el.getAttribute('y1') ?? '0'),
      x2: parseFloat(el.getAttribute('x2') ?? '0'),
      y2: parseFloat(el.getAttribute('y2') ?? '0'),
    }));
}

/** Drag a shape (by id) by a world delta. */
export async function dragShape(
  page: Page,
  id: string,
  dx: number,
  dy: number,
  zoom: number,
): Promise<void> {
  const el = page.locator(`${SHAPE}[data-shape-id="${id}"]`);
  const box = await el.boundingBox();
  if (box === null) throw new Error(`shape ${id} has no bounding box`);
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 20 + dx * zoom, box.y + 20 + dy * zoom, { steps: 16 });
  await page.mouse.up();
}

/** Double-click a shape and type `text` into its label editor, then Escape. */
export async function editShapeLabel(page: Page, id: string, text: string): Promise<void> {
  await page.locator(`${SHAPE}[data-shape-id="${id}"]`).dblclick();
  await page.locator(SHAPE_EDITOR).waitFor({ timeout: 10_000 });
  await page.locator(SHAPE_EDITOR).pressSequentially(text);
  await page.keyboard.press('Escape');
}

/**
 * Measure the label text of a shape: number of rendered lines (Range
 * client rects) and the text's screen-space centre, against the shape's
 * screen centre. Text-align centring is what this checks.
 */
export async function labelLayout(
  page: Page,
  id: string,
): Promise<{
  lines: number;
  midX: number;
  midY: number;
  shapeMidX: number;
  shapeMidY: number;
  fontPx: number;
}> {
  return page.evaluate((shapeId) => {
    const shape = document.querySelector<HTMLElement>(
      `[data-shape-id="${shapeId}"]`,
    );
    const label = shape?.querySelector<HTMLElement>('.shape-object__label') ?? null;
    const sb = shape?.getBoundingClientRect();
    const shapeMidX = sb ? sb.x + sb.width / 2 : NaN;
    const shapeMidY = sb ? sb.y + sb.height / 2 : NaN;
    const node: Node | null = label !== null ? (label.firstChild ?? null) : null;
    const fontPx = label !== null ? parseFloat(getComputedStyle(label).fontSize) : NaN;
    if (shape === null || label === null || node === null || node.nodeType !== Node.TEXT_NODE) {
      return { lines: 0, midX: NaN, midY: NaN, shapeMidX, shapeMidY, fontPx };
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects());
    if (rects.length === 0) {
      return { lines: 0, midX: NaN, midY: NaN, shapeMidX, shapeMidY, fontPx };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.left);
      maxX = Math.max(maxX, r.right);
      minY = Math.min(minY, r.top);
      maxY = Math.max(maxY, r.bottom);
    }
    return {
      lines: rects.length,
      midX: (minX + maxX) / 2,
      midY: (minY + maxY) / 2,
      shapeMidX,
      shapeMidY,
      fontPx,
    };
  }, id);
}
