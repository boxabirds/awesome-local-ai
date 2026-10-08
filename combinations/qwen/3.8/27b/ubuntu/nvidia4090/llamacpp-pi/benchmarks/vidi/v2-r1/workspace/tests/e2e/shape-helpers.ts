// Shared helpers for the story 10 e2e specs (shapes.spec.ts,
// connectors.spec.ts). Each spec starts and stops its own wrangler process
// (see wrangler-process.ts); these helpers are pure functions over a Page.

import type { Page } from '@playwright/test';
import { checkoutFlowSpec, type CheckoutEndpointSpec } from '../fixtures/checkout-flow';

/** e2e camera default: screen = world + (640, 400), zoom 1. */
export const SX = 640;
export const SY = 400;

export interface EndpointInfo {
  kind: 'free' | 'attached';
  x?: number;
  y?: number;
  objectId?: string;
}

export interface ObjectInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text: string;
  z: number;
  size?: string;
  widthMode?: 'auto' | 'fixed';
  kind?: 'rect' | 'ellipse' | 'diamond';
  fill?: string;
  stroke?: string;
  label?: string;
  fromPoint?: { x: number; y: number };
  toPoint?: { x: number; y: number };
  from?: EndpointInfo;
  to?: EndpointInfo;
  // Story 11 (strokes).
  /** Flattened [x0, y0, ...] relative to the bbox origin (strokes only). */
  points?: number[];
  /** Bbox size at creation (strokes only). */
  baseWidth?: number;
  baseHeight?: number;
  /** 'thin' | 'medium' | 'thick' (strokes only). */
  thickness?: string;
}

interface Hooks {
  getObjects(): ObjectInfo[];
  getCamera(): { x: number; y: number; zoom: number };
  setCamera(cam: { x: number; y: number; zoom: number }): void;
  createShape(a: {
    kind: 'rect' | 'ellipse' | 'diamond';
    rect: { x: number; y: number; width: number; height: number } | null;
    at: { x: number; y: number };
    square?: boolean;
  }): string | null;
  setShapeLabel(id: string, text: string): void;
  createConnector(
    from: { kind: 'free'; x: number; y: number } | { kind: 'attached'; objectId: string },
    to: { kind: 'free'; x: number; y: number } | { kind: 'attached'; objectId: string },
  ): string | null;
}

export async function getObjects(page: Page): Promise<Map<string, ObjectInfo>> {
  const list = await page.evaluate(() =>
    (window as unknown as { __vidi6: { getObjects(): ObjectInfo[] } }).__vidi6.getObjects(),
  );
  return new Map(list.map((o) => [o.id, o]));
}

export async function objectsOf(page: Page, type: string): Promise<ObjectInfo[]> {
  return [...(await getObjects(page)).values()].filter((o) => o.type === type);
}

export async function getCamera(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(
    () => (window as unknown as { __vidi6: { getCamera(): { x: number; y: number; zoom: number } } }).__vidi6.getCamera(),
  );
}

export async function setCamera(
  page: Page,
  cam: { x: number; y: number; zoom: number },
): Promise<void> {
  await page.evaluate((c) => {
    (window as unknown as { __vidi6: { setCamera(c: { x: number; y: number; zoom: number }): void } }).__vidi6.setCamera(c);
  }, cam);
}

export async function openBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-root"]', { timeout: 20000 });
  // The story-10 test hooks are installed once the board page mounts; wait
  // for them so subsequent page.evaluate calls never race the install.
  await page.waitForFunction(
    () => (window as unknown as { __vidi6?: unknown }).__vidi6 !== undefined,
    null,
    { timeout: 15000 },
  );
}

export async function createBoard(base: string): Promise<string> {
  const res = await fetch(`${base}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`board creation failed: ${res.status}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/**
 * Seed the checkout-flow fixture (4 labelled shapes + 3 attached + 1 free
 * connector) through the story-10 test hooks; returns the shape ids in order.
 */
export async function seedCheckoutFlow(page: Page): Promise<string[]> {
  const spec = checkoutFlowSpec();
  return page.evaluate((s) => {
    const h = (window as unknown as { __vidi6: Hooks }).__vidi6;
    const ids: string[] = [];
    for (const sh of s.shapes) {
      const id = h.createShape({ kind: sh.kind, rect: sh.rect, at: { x: sh.rect.x, y: sh.rect.y } });
      if (id === null) throw new Error('createShape returned null');
      h.setShapeLabel(id, sh.label);
      ids.push(id);
    }
    const ep = (ref: CheckoutEndpointSpec) =>
      ref.shape === null
        ? { kind: 'free' as const, x: ref.point!.x, y: ref.point!.y }
        : { kind: 'attached' as const, objectId: ids[ref.shape] };
    for (const c of s.connectors) {
      const id = h.createConnector(ep(c.from), ep(c.to));
      if (id === null) throw new Error('createConnector returned null');
    }
    return ids;
  }, spec);
}

/** Wait until `count` pages each report `total` objects of `type`. */
export async function waitObjects(
  pages: Page[],
  type: string,
  total: number,
  timeoutMs = 15000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  await expect
    .poll(
      async () => {
        const counts = await Promise.all(
          pages.map(async (p) => (await objectsOf(p, type)).length),
        );
        return counts.every((n) => n === total);
      },
      { timeout: timeoutMs },
    )
    .toBe(true);
}

/** Move the object under the pointer at screen (x, y) by (dx, dy). */
export async function dragAt(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

/** Screen coords of a world point for the current camera. */
export function toScreen(cam: { x: number; y: number; zoom: number }, wx: number, wy: number) {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}
