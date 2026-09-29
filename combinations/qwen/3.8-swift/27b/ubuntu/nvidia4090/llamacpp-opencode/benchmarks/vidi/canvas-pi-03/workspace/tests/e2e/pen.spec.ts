import { test, expect } from '@playwright/test';
import { createBoardIdForPage } from './helpers/board';
import { handwrittenLoop } from '../fixtures/pen-paths';
import { distanceToPolyline } from 'src/shared/geometry/polyline';
import { STROKE_SIMPLIFY_TOLERANCE_PX } from 'src/shared/config';

/**
 * Story 11 e2e — freehand pen (TC-17 … TC-20): real-pointer freehand drawing
 * with RDP simplification, click dots, per-stroke colour/thickness from the
 * pen toolbar, and select-then-resize (aspect-locked) + delete.
 *
 * Viewport: Desktop Chrome 1280x720; the default camera is
 * resetCamera(viewport), so world (0,0) sits at screen (640,360) and
 * screen = world + (640,360) at zoom 1.
 */

async function openBoard(page: import('@playwright/test').Page) {
  const id = await createBoardIdForPage(page);
  await page.goto(`/b/${id}`);
  await page.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 5000 });
}

interface StrokeRow {
  id: string;
  color: string;
  thickness: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** flattened world points (absolute). */
  points: number[];
}

async function getStrokes(page: import('@playwright/test').Page): Promise<StrokeRow[]> {
  return page.evaluate(() => {
    const objects = (window as any).__vidi6.doc.getMap('objects');
    const out: any[] = [];
    for (const key of objects.keys()) {
      const o: any = objects.get(key);
      if (o.get('type') !== 'stroke') continue;
      out.push({
        id: key,
        color: o.get('color'),
        thickness: o.get('thickness'),
        x: o.get('x'),
        y: o.get('y'),
        width: o.get('width'),
        height: o.get('height'),
        points: o.get('points') ?? [],
      });
    }
    return out;
  });
}

/** world → screen at zoom 1 with the default camera. */
const W = (x: number, y: number) => ({ x: x + 640, y: y + 360 });

test.describe('pen.freehand (e2e)', () => {
  test('TC-17: a real freehand loop is stored as ONE simplified stroke within 1 px of the raw path, rendered as a smooth curve', async ({ page }) => {
    await openBoard(page);

    // P, then replay the handwritten loop with real pointer moves.
    await page.keyboard.press('p');
    const first = W(handwrittenLoop[0].x, handwrittenLoop[0].y);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (let i = 1; i < handwrittenLoop.length; i++) {
      const p = W(handwrittenLoop[i].x, handwrittenLoop[i].y);
      await page.mouse.move(p.x, p.y);
    }
    await page.mouse.up();

    const strokes = await getStrokes(page);
    expect(strokes).toHaveLength(1);
    const s = strokes[0];

    // The stored points are a SIMPLIFIED subset (fewer than the raw ones) ...
    const pts = s.points;
    expect(pts.length / 2).toBeLessThan(handwrittenLoop.length);
    expect(pts.length / 2).toBeGreaterThanOrEqual(2);

    // ... and every raw sample is within the 1 px tolerance of the stored
    // polyline (RDP guarantee, zoom 1).
    const stored: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) {
      // Stored points are bbox-relative; shift to world for the distance check.
      stored.push({ x: s.x + pts[i], y: s.y + pts[i + 1] });
    }
    let maxDist = 0;
    for (const p of handwrittenLoop) {
      maxDist = Math.max(maxDist, distanceToPolyline(stored, p));
    }
    expect(maxDist).toBeLessThanOrEqual(STROKE_SIMPLIFY_TOLERANCE_PX + 1e-6);

    // Rendered as a smooth (M…Q…) curve, not a jagged L-only path.
    const path = page.getByTestId('stroke-path');
    const d = (await path.getAttribute('d'))!;
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    // Thickness NOT changed (medium default) — the path keeps it.
    expect(path).toHaveAttribute('stroke-width', '4');
  });

  test('TC-18: a click without moving leaves a thickness-sized dot', async ({ page }) => {
    await openBoard(page);

    await page.keyboard.press('p');
    const c = W(0, 0);
    await page.mouse.click(c.x, c.y);

    const strokes = await getStrokes(page);
    expect(strokes).toHaveLength(1);
    const s = strokes[0];
    // One point, bbox = the medium (4) thickness square.
    expect(s.points.length).toBe(2);
    expect(s.width).toBeCloseTo(4, 0);
    expect(s.height).toBeCloseTo(4, 0);
    expect(s.x).toBeCloseTo(-2, 0);
    expect(s.y).toBeCloseTo(-2, 0);
  });

  test('TC-19: toolbar choices apply to subsequent strokes (purple+thick, then red+thin)', async ({ page }) => {
    await openBoard(page);

    await page.keyboard.press('p');

    // Stroke 1: purple, thick.
    await page.getByTestId('pen-color-purple').click();
    await page.getByTestId('pen-thickness-thick').click();
    const a = W(-100, -60);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 60, a.y + 20, { steps: 4 });
    await page.mouse.up();
    // The pen stays active after the commit (keep sketching).
    await expect(page.getByTestId('pen-tool-layer')).toBeVisible();

    // Stroke 2: red, thin.
    await page.getByTestId('pen-color-red').click();
    await page.getByTestId('pen-thickness-thin').click();
    const b = W(40, 20);
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 60, b.y + 20, { steps: 4 });
    await page.mouse.up();

    const strokes = await getStrokes(page);
    expect(strokes).toHaveLength(2);
    const byColor = (c: string) => strokes.find((s) => s.color === c)!;
    const purple = byColor('purple');
    const red = byColor('red');
    expect(purple.thickness).toBe('thick');
    expect(red.thickness).toBe('thin');
  });

  test('TC-20: V + click on the line selects the stroke; a corner resize scales both axes by the same ratio (thickness unchanged); Delete removes it', async ({ page }) => {
    await openBoard(page);

    // Draw a straight horizontal stroke from world (0,0) → (200,0):
    // bbox (-2,-2) 204x4, ratio 51.
    await page.keyboard.press('p');
    const a = W(0, 0);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 200, a.y, { steps: 8 });
    await page.mouse.up();

    let strokes = await getStrokes(page);
    expect(strokes).toHaveLength(1);
    const initial = strokes[0];
    expect(initial.width).toBeCloseTo(204, 0);
    expect(initial.height).toBeCloseTo(4, 0);
    expect(initial.thickness).toBe('medium');

    // V (Select), then click a point ON the line: the stroke is selected.
    await page.keyboard.press('v');
    await page.mouse.click(W(100, 0).x, W(100, 0).y);
    await expect(page.getByTestId('stroke-object')).toHaveAttribute('data-selected', 'true');

    // Drag the SE corner handle: width grows by 204 (→ 408); the aspect lock
    // scales height by the same factor (→ 8).
    const se = page.locator('[data-testid="resize-handle"][data-handle="se"]');
    const hb = (await se.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 204, hb.y + hb.height / 2 + 8, { steps: 8 });
    await page.mouse.up();

    strokes = await getStrokes(page);
    expect(strokes).toHaveLength(1);
    const resized = strokes[0];
    expect(resized.width).toBeCloseTo(408, 0);
    expect(resized.height).toBeCloseTo(8, 0);
    // Same scale factor on both axes ...
    expect(resized.width / initial.width).toBeCloseTo(resized.height / initial.height, 1);
    // ... and the thickness is NOT scaled.
    expect(resized.thickness).toBe('medium');
    // The path stroke-width in world units is unchanged.
    await expect(page.getByTestId('stroke-path')).toHaveAttribute('stroke-width', '4');

    // Delete removes the selected stroke; nothing crashes.
    await page.keyboard.press('Delete');
    expect(await getStrokes(page)).toHaveLength(0);
    expect(page.locator('[data-testid="stroke-object"]')).toHaveCount(0);
  });
});
