// Story 11 e2e helpers (TC-17..TC-20).
//
// Strokes are drawn through the REAL pen tool (P + mouse) so the full path
// runs in the browser; stickies are seeded server side through the /__test/
// /seed hook. Helpers are camera-aware like helpers/story10.ts: world points
// are converted to viewport-local screen with the parked camera.

import { expect, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';
import type { Point } from '../../../src/shared/geometry';

export const VIEWPORT = '[data-testid="board-viewport"]';
export const STROKE = '[data-testid="stroke-object"]';
export const STROKE_HIT = '[data-testid="stroke-hit"]';
export const PEN_PREVIEW = '[data-testid="pen-preview-path"]';
export const PEN_CURSOR = '[data-testid="pen-cursor"]';
export const NOTE = '[data-note-id]';

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

/** Seed stickies server side (the first lands at world (40,40)). */
export async function seedSticky(baseURL: string, boardId: string, count = 1): Promise<void> {
  const res = await fetch(`${baseURL}/__test/boards/${boardId}/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ count }),
  });
  const data = (await res.json()) as { ok: boolean };
  expect(data.ok, `seed ${count} sticky(ies) should succeed`).toBe(true);
}

/** Activate the Pen tool (P) and wait for it to land. */
export async function usePenTool(page: Page): Promise<void> {
  await page.keyboard.press('p');
  await page.locator(`${VIEWPORT}.is-drawing-tool`).waitFor({ timeout: 10_000 });
}

/** True while the pen (or another drawing tool) is active. */
export async function isPenActive(page: Page): Promise<boolean> {
  return (await page.locator(`${VIEWPORT}.is-drawing-tool`).count()) > 0;
}

/** A rough circular loop in world space (starts and ends at the top). */
export function loopPoints(cx: number, cy: number, r: number, n = 24): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2; // start at the top
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** Draw a freehand stroke through world points with the pen (a real drag). */
export async function drawPenStroke(page: Page, camera: Camera, points: Point[]): Promise<void> {
  const box = await viewportBox(page);
  const [first, ...rest] = points;
  const s0 = localOf(camera, first.x, first.y);
  await page.mouse.move(box.x + s0.x, box.y + s0.y);
  await page.mouse.down();
  for (const p of rest) {
    const s = localOf(camera, p.x, p.y);
    await page.mouse.move(box.x + s.x, box.y + s.y, { steps: 4 });
  }
  await page.mouse.up();
}

export async function strokeCount(page: Page): Promise<number> {
  return page.locator(STROKE).count();
}

/** The preview path's `d` attribute (null while not drawing). */
export async function penPreviewD(page: Page): Promise<string | null> {
  return page.locator(PEN_PREVIEW).getAttribute('d');
}

/** The first stroke's world box (position is the style; size is the SVG
 *    width/height attributes, both in world units). */
export async function strokeWorld(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.locator(STROKE).first().evaluate((el) => {
    return {
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      w: parseFloat(el.getAttribute('width') ?? '0'),
      h: parseFloat(el.getAttribute('height') ?? '0'),
    };
  });
}

/** The first sticky's world top-left (style values are world units). */
export async function stickyWorld(page: Page): Promise<{ x: number; y: number }> {
  return page.locator(NOTE).first().evaluate((el) => {
    const s = el.style;
    return { x: parseFloat(s.left), y: parseFloat(s.top) };
  });
}

/** Page coordinates for a world point under `camera` (viewport box offset). */
export async function pagePoint(page: Page, camera: Camera, wx: number, wy: number): Promise<{ x: number; y: number }> {
  const box = await viewportBox(page);
  const s = localOf(camera, wx, wy);
  return { x: box.x + s.x, y: box.y + s.y };
}
