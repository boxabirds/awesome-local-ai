// Story 11 (pen.*) e2e: TC-15 to TC-17.
//
// Runs against the real serving path (wrangler dev + Durable Object) in
// test mode (window.__vidi6 hooks). The camera is pinned to (0,0,1) so
// screen == world coordinates.

import { expect, test } from '@playwright/test';
import { PEN_COLORS } from '../../src/shared/config';
import { openBoard, setCamera } from './helpers/board';
import { connectParticipants } from './helpers/participants';

interface StrokeInfo {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baseWidth: number;
  baseHeight: number;
  color: string;
  thickness: string;
  points: number[];
  z: number;
}

/** Dispatches a wheel event on the board (deterministic across browsers;
 *  Playwright's mouse.wheel does not report pixel deltaMode in firefox/
 *  webkit). */
async function wheel(
  page: import('@playwright/test').Page,
  opts: { clientX: number; clientY: number; deltaX: number; deltaY: number; ctrlKey?: boolean },
): Promise<void> {
  await page.evaluate((o) => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    el.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: o.clientX,
        clientY: o.clientY,
        deltaX: o.deltaX,
        deltaY: o.deltaY,
        ctrlKey: o.ctrlKey ?? false,
      }),
    );
  }, opts);
}

/** Reset the camera to (0,0,1) AFTER the initial load centring (unlike
 *  setCamera, whose pre-condition expects the origin on the viewport centre).
 *  Screen == world again. */
async function resetCamera(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => window.__vidi6?.setCamera(0, 0, 1));
  await expect
    .poll(async () => {
      const b = (await page.getByTestId('origin-marker').boundingBox())!;
      return [b.x + b.width / 2, b.y + b.height / 2];
    })
    .toEqual([0, 0]);
}

async function getStrokes(page: import('@playwright/test').Page): Promise<StrokeInfo[]> {
  return page.evaluate(() => window.__vidi6?.getStrokes() ?? []);
}

async function selectedIds(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => window.__vidi6?.getSelectedIds() ?? []);
}

/** Drags the given screen points (mouse down at the first, up at the last). */
async function drag(
  page: import('@playwright/test').Page,
  pts: [number, number][],
): Promise<void> {
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    await page.mouse.move(pts[i][0], pts[i][1], { steps: 2 });
  }
  await page.mouse.up();
}

test('TC-15: P → Pen active; a 5-point zigzag → 1 rendered stroke; the colour/thickness choices apply to the NEXT stroke; a second client sees it (pen.draw / pen.options / pen.share)', async ({ browser, page }) => {
  const boardId = await openBoard(page);
  await setCamera(page, 0, 0, 1);

  // P activates the Pen tool (button pressed, preview overlay + options).
  await page.keyboard.press('p');
  const penBtn = page.getByRole('button', { name: 'Pen (P)' });
  await expect(penBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('pen-tool')).toBeVisible();
  await expect(page.getByTestId('pen-toolbar')).toBeVisible();

  // A 5-point zigzag drag draws ONE stroke (default black/medium).
  await drag(page, [
    [100, 100],
    [140, 140],
    [120, 180],
    [180, 200],
    [220, 160],
  ]);
  let strokes = await getStrokes(page);
  expect(strokes).toHaveLength(1);
  expect(strokes[0].color).toBe('black');
  expect(strokes[0].thickness).toBe('medium');
  const s1 = strokes[0];

  // The stroke renders as an SVG path in the world layer.
  const path1 = page.locator(`[data-testid="stroke-object"][data-id="${s1.id}"] svg path`).first();
  await expect(path1).toBeVisible();
  expect((await path1.getAttribute('d')) ?? '').toMatch(/^M /);

  // Switch the pen: blue + thick → affects the NEXT stroke only.
  await page.getByRole('button', { name: 'blue pen' }).click();
  await page.getByRole('button', { name: 'Thick' }).click();
  await drag(page, [
    [300, 100],
    [360, 140],
    [330, 180],
  ]);
  strokes = await getStrokes(page);
  expect(strokes).toHaveLength(2);
  const s2 = strokes[1];
  expect(s2.color).toBe('blue');
  expect(s2.thickness).toBe('thick');
  // The first stroke is untouched.
  expect(strokes[0].color).toBe('black');
  // Rendered with the thick (8 world units) blue stroke.
  const path2 = page.locator(`[data-testid="stroke-object"][data-id="${s2.id}"] svg path`).first();
  await expect(path2).toHaveAttribute('stroke-width', '8');
  await expect(path2).toHaveAttribute('stroke', PEN_COLORS.blue);

  // A second client sees both strokes (pen.share).
  const parts = await connectParticipants(browser, boardId, 2);
  const remote = await parts[0].page.evaluate(() => window.__vidi6?.getStrokes() ?? []);
  expect(remote.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
  for (const p of parts) await p.dispose();
});

test('TC-16: a click within 5px of the line selects the stroke; a 2× corner drag scales the line (thickness unchanged); a point off the line becomes a hit (pen.select / pen.resize)', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);
  await page.keyboard.press('p');

  // Draw a 40×40 square loop → a 44×44 bbox (medium thickness pads 2).
  await drag(page, [
    [100, 100],
    [140, 100],
    [140, 140],
    [100, 140],
    [100, 100],
  ]);
  const strokes = await getStrokes(page);
  expect(strokes).toHaveLength(1);
  const s1 = strokes[0];
  expect(s1.x).toBe(98);
  expect(s1.y).toBe(98);
  expect(s1.width).toBe(44);
  expect(s1.height).toBe(44);
  const svg = page.locator(`[data-testid="stroke-object"][data-id="${s1.id}"] svg`);
  const path = svg.locator('path').first();
  const dBefore = await path.getAttribute('d');
  await expect(svg).toHaveAttribute('viewBox', '0 0 44 44');

  // Escape → Select.
  await page.keyboard.press('Escape');

  // A click ~7.6px from the line end (outside the 6px tolerance): no select.
  await page.mouse.click(147, 103);
  expect(await selectedIds(page)).toEqual([]);

  // A click 2px from the top line: selected (the bbox + handles appear).
  await page.mouse.click(120, 102);
  expect(await selectedIds(page)).toEqual([s1.id]);
  await expect(page.getByTestId('selection-box')).toBeVisible();

  // Drag the SE corner handle by (44,44): the box doubles (aspect-locked).
  const se = page.getByRole('button', { name: 'Resize bottom-right' });
  const box = (await se.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 44, cy + 44, { steps: 4 });
  await page.mouse.up();

  const s1b = (await getStrokes(page))[0];
  expect(s1b.width).toBe(88);
  expect(s1b.height).toBe(88);
  expect(s1b.thickness).toBe('medium'); // a field, never scaled
  // The stored line is unchanged; the viewBox→size mapping scales it.
  expect(await path.getAttribute('d')).toBe(dBefore);
  await expect(svg).toHaveAttribute('viewBox', '0 0 44 44');
  await expect(svg).toHaveAttribute('width', '88');
  await expect(svg).toHaveAttribute('height', '88');

  // The point that MISSED before the resize now HITS the scaled line:
  // (147,103) is 3px from the doubled top line (100,100)–(180,100).
  await page.mouse.click(300, 300); // clear the selection on empty space
  expect(await selectedIds(page)).toEqual([]);
  await page.mouse.click(147, 103);
  expect(await selectedIds(page)).toEqual([s1.id]);
});

test('TC-17: pen drags draw (no pan); wheel still pans; ctrl+wheel zooms and the stroke scales with zoom; the preview is local-only and updates on consecutive frames (pen.navigation)', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);
  await page.keyboard.press('p');
  await page.getByRole('button', { name: 'Thick' }).click();

  // Draw a horizontal THICK line: (100,100) → (200,100).
  await drag(page, [
    [100, 100],
    [200, 100],
  ]);
  const strokes = await getStrokes(page);
  expect(strokes).toHaveLength(1);
  expect(strokes[0].thickness).toBe('thick');
  const path = page.locator(`[data-testid="stroke-object"][data-id="${strokes[0].id}"] svg path`).first();

  // On-screen thickness at zoom 1 ≈ 8 px.
  const h1 = (await path.boundingBox())!.height;
  expect(h1).toBeGreaterThan(7);
  expect(h1).toBeLessThan(9.5);

  // A wheel over the board PANS (no stroke, camera moves).
  const markerBefore = await page
    .getByTestId('origin-marker')
    .boundingBox()
    .then((b) => [b!.x, b!.y] as [number, number]);
  await wheel(page, { clientX: 600, clientY: 400, deltaX: 0, deltaY: 200 });
  expect((await getStrokes(page)).length).toBe(1); // nothing drawn
  // The board panned (the deltaY wheel moves it vertically).
  await expect
    .poll(async () => {
      const b = (await page.getByTestId('origin-marker').boundingBox())!;
      return [b.x, b.y];
    })
    .not.toEqual(markerBefore);

  // Ctrl+wheel zooms in around (150,100); the stroke scales with zoom.
  await resetCamera(page);
  await wheel(page, { clientX: 150, clientY: 100, deltaX: 0, deltaY: -200, ctrlKey: true });
  // The zoom settles (React re-render).
  await expect
    .poll(async () => parseInt((await page.getByTestId('zoom-label').textContent()) ?? '100', 10))
    .toBeGreaterThan(100);
  const zoom = parseInt((await page.getByTestId('zoom-label').textContent()) ?? '100', 10) / 100;
  const h2 = (await path.boundingBox())!.height;
  expect(h2).toBeGreaterThan(8 * zoom - 2);
  expect(h2).toBeLessThan(8 * zoom + 2);

  // A NEW drag: the preview path is LOCAL-ONLY (no stroke appears mid-drag)
  // and its `d` changes on consecutive animation frames (sampled in-page
  // with requestAnimationFrame).
  await resetCamera(page);
  // Start clear of the fixed pen toolbar (left edge, vertical centre).
  await page.mouse.move(300, 550);
  await page.mouse.down();
  // Step the drag by hand and, after each move, sample the preview path on
  // two consecutive animation frames (in-page). WebKit delivers
  // duration-based mouse moves as an instant burst, so this keeps the
  // sampling in flight with the drawing (pen.navigation).
  // Each move adds a point, so the frame sampled AFTER the move (b) differs
  // from the one before it (a). (WebKit delivers duration-based moves as an
  // instant burst, so the drag is stepped by hand to keep the sampling in
  // flight with the drawing.)
  let dPair: readonly [string | null, string | null] = [null, null];
  for (let i = 1; i <= 40; i++) {
    const a = await page.evaluate(
      () =>
        document.querySelector('[data-testid="pen-preview"] path')?.getAttribute('d') ?? null,
    );
    await page.mouse.move(300 + i * 10, 550);
    const b = await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(r));
      return document.querySelector('[data-testid="pen-preview"] path')?.getAttribute('d') ?? null;
    });
    if (a !== null && b !== null && a !== b) {
      dPair = [a, b];
      break;
    }
  }
  expect((await getStrokes(page)).length).toBe(1); // preview is local-only
  expect(dPair[0]).not.toBeNull(); // the preview path exists during the drag
  expect(dPair[1]).not.toBeNull(); // its d changed on a later frame
  expect(dPair[1]).not.toBe(dPair[0]);
  await page.mouse.up();
  expect((await getStrokes(page)).length).toBe(2); // committed on release
});
