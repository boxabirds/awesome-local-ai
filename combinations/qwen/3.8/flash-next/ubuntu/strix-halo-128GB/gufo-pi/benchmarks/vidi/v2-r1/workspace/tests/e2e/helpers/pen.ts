/**
 * Shared helpers for pen/stroke e2e tests (story 11).
 */
import { expect, type Page } from '@playwright/test';

export interface StrokeSnapshot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  thickness: string;
  baseWidth: number;
  baseHeight: number;
  pointCount: number; // number of coordinate pairs in points array
}

/** Read stroke objects from the document via the test hook. */
export async function getStrokeObjectsFromDoc(page: Page): Promise<StrokeSnapshot[]> {
  return page.evaluate(() => {
    const doc = (window as any).__vidi6?.getDoc?.();
    if (!doc) throw new Error('__vidi6.getDoc missing');
    const objects = doc.getMap('objects');
    const strokes: StrokeSnapshot[] = [];
    for (const [id, entry] of objects) {
      const type = (entry as any).get?.('type');
      if (type === 'stroke') {
        const pts = (entry as any).get?.('points') as number[];
        strokes.push({
          id,
          x: (entry as any).get?.('x'),
          y: (entry as any).get?.('y'),
          width: (entry as any).get?.('width'),
          height: (entry as any).get?.('height'),
          color: (entry as any).get?.('color') ?? 'black',
          thickness: (entry as any).get?.('thickness') ?? 'medium',
          baseWidth: (entry as any).get?.('baseWidth') ?? 0,
          baseHeight: (entry as any).get?.('baseHeight') ?? 0,
          pointCount: pts ? Math.floor(pts.length / 2) : 0,
        });
      }
    }
    return strokes.sort((a: StrokeSnapshot, b: StrokeSnapshot) => (a.id < b.id ? -1 : 1));
  });
}

/** Wait for stroke objects to stabilize in the document. */
export async function waitForStrokesStable(page: Page, expectedCount?: number): Promise<StrokeSnapshot[]> {
  let prev: StrokeSnapshot[] | null = null;
  for (let i = 0; i < 20; i++) {
    const current = await getStrokeObjectsFromDoc(page);
    if (expectedCount !== undefined && current.length >= expectedCount) return current;
    if (prev && JSON.stringify(prev) === JSON.stringify(current)) return current;
    prev = current;
    await page.waitForTimeout(50);
  }
  return prev!;
}

/** Activate the pen tool by clicking the toolbar button. */
export async function activatePenTool(page: Page): Promise<void> {
  await page.getByTestId('tool-pen').click();
  // Verify pen toolbar is visible
  await expect(page.getByTestId('pen-toolbar')).toBeVisible();
}

/** Set pen colour by clicking the swatch. */
export async function setPenColor(page: Page, color: string): Promise<void> {
  await page.getByTestId(`pen-color-${color}`).click();
}

/** Set pen thickness. */
export async function setPenThickness(page: Page, thickness: string): Promise<void> {
  await page.getByTestId(`pen-thickness-${thickness}`).click();
}

/**
 * Draw a stroke by performing mouse drag through a sequence of points.
 * Points are in screen (viewport) coordinates.
 */
export async function drawStroke(page: Page, points: Array<{ x: number; y: number }>): Promise<void> {
  if (points.length < 2) throw new Error('Need at least 2 points to draw a stroke');

  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();

  for (let i = 1; i < points.length; i++) {
    await page.mouse.move(points[i]!.x, points[i]!.y);
    // Small delay to let the browser process coalesced events
    if (i % 5 === 0) {
      await page.waitForTimeout(5);
    }
  }

  await page.mouse.up();
}

/** Draw a simple circle stroke at a given screen centre and radius. */
export async function drawCircleStroke(
  page: Page,
  cx: number,
  cy: number,
  radius: number,
  numPoints = 60,
): Promise<void> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < numPoints; i++) {
    const t = (i / numPoints) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(t) * radius,
      y: cy + Math.sin(t) * radius,
    });
  }
  await drawStroke(page, points);
}

/** Count SVG stroke elements visible in the world layer. */
export async function getStrokeSvgCount(page: Page): Promise<number> {
  return page.locator('[data-board-surface] svg[aria-label="Drawing"]').count();
}

/** Get the `d` attribute of a stroke's visible path. */
export async function getStrokePathD(page: Page, index: number): Promise<string | null> {
  const svg = page.locator('[data-board-surface] svg[aria-label="Drawing"]').nth(index);
  // The visible path is the first path (not the hit-area path)
  const path = svg.locator('path').first();
  return path.getAttribute('d');
}
