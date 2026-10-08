// Story 11 e2e (pen config): sketching freehand with the pen.
//
//   TC-17  a real drag drawing a loop: the preview path is present during the
//          drag and its `d` changes between animation frames; one stroke
//          persists after release and the preview is gone. Chromium +
//          firefox.
//   TC-18  Priya draws while Sam watches: Sam sees no stroke during the drag;
//          the finished stroke appears for Sam after release. The delivery
//          time is logged against LIVE_UPDATE_LATENCY_BUDGET_MS (reported,
//          not asserted — shared machine). Chromium-only.
//   TC-19  while the Pen tool is active the wheel still pans, and a drag
//          starting on a sticky creates a stroke without moving the sticky.
//          Chromium-only.
//   TC-20  V, click the line, drag the bottom-right handle (aspect ratio
//          preserved within ±1%, rendered thickness unchanged), drag the body
//          (moved), Delete (removed on both screens). Chromium-only.
//
// Each test runs its own `wrangler dev` (tests/e2e/wrangler-process.ts).
// The camera is pinned to the origin at 100% unless noted. (webkit is not in
// the matrix on this host — it needs the system library `libavif13`; see
// NOTES.md.)

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import { createWranglerProcess, type WranglerProcess } from './wrangler-process';
import {
  createBoard,
  getCamera,
  getObjects,
  openBoard,
  objectsOf,
  setCamera,
  type ObjectInfo,
} from './shape-helpers';

function chromiumOnly(): void {
  test.skip(test.info().project.name !== 'chromium', 'chromium-only');
}

interface StrokeInfo extends ObjectInfo {
  points?: number[];
  baseWidth?: number;
  baseHeight?: number;
  thickness?: string;
}

/** The rendered (visible) stroke width of the stroke on `page`. */
async function strokeWidthOf(page: Page): Promise<string | null> {
  return page.$eval('[data-testid="stroke-path"]', (el) => el.getAttribute('stroke-width')).catch(
    () => null,
  );
}

test.describe('story 11: sketch freehand with a pen (wrangler)', () => {
  test('TC-17: drawing a loop shows a live preview that updates; the stroke persists', async ({ browser }) => {
    const ctxs: BrowserContext[] = [];
    const wrangler: WranglerProcess = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const ctx = await browser.newContext();
      ctxs.push(ctx);
      const page = await ctx.newPage();
      await openBoard(page, boardId);

      // 100% zoom, camera at the origin: screen == world.
      await setCamera(page, { x: 0, y: 0, zoom: 1 });
      await page.keyboard.press('p');

      // Draw a loop, sampling the preview path's `d` while dragging.
      const ds: string[] = [];
      await page.mouse.move(150, 150);
      await page.mouse.down();
      for (let i = 1; i <= 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        await page.mouse.move(150 + 40 * Math.cos(a), 150 + 40 * Math.sin(a));
        const d = await page
          .$eval('[data-testid="pen-preview"]', (el) => el.getAttribute('d') ?? '')
          .catch(() => '');
        ds.push(d);
      }

      // The preview was on screen during the drag and updated between frames.
      expect(ds[0]).toBeTruthy();
      expect(new Set(ds).size).toBeGreaterThanOrEqual(2);

      await page.mouse.up();
      await expect
        .poll(async () => (await objectsOf(page, 'stroke')).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(1);
      const [s] = (await objectsOf(page, 'stroke')) as StrokeInfo[];
      expect(s.points).toBeDefined();
      expect((s.points ?? []).length).toBeGreaterThanOrEqual(4);
      // The preview is gone once the stroke is committed.
      await expect
        .poll(async () => (await page.$('[data-testid="pen-preview"]')) === null, {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe(true);

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });

  test('TC-18: Sam sees nothing while Priya draws; the finished stroke appears after release', async ({ browser }) => {
    chromiumOnly();
    const ctxs: BrowserContext[] = [];
    const wrangler: WranglerProcess = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const priyaCtx = await browser.newContext();
      const samCtx = await browser.newContext();
      ctxs.push(priyaCtx, samCtx);
      const priya = await priyaCtx.newPage();
      const sam = await samCtx.newPage();
      await openBoard(priya, boardId);
      await openBoard(sam, boardId);
      await setCamera(priya, { x: 0, y: 0, zoom: 1 });
      await setCamera(sam, { x: 0, y: 0, zoom: 1 });
      await priya.keyboard.press('p');

      const t0 = Date.now();
      // A slow stroke so the watcher can be sampled while it is in flight.
      await priya.mouse.move(100, 100);
      await priya.mouse.down();
      let samSawDuringDrag = false;
      for (let i = 1; i <= 20; i += 1) {
        await priya.mouse.move(100 + i * 8, 100 + (i % 5) * 6);
        await priya.waitForTimeout(40);
        if ((await objectsOf(sam, 'stroke')).length > 0) samSawDuringDrag = true;
      }
      expect(samSawDuringDrag).toBe(false);

      await priya.mouse.up();
      await expect
        .poll(async () => (await objectsOf(sam, 'stroke')).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(1);
      const deliveryMs = Date.now() - t0;
      test.info().annotations.push({
        type: 'stroke-delivery-time',
        description: `${deliveryMs}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`,
      });
      console.log(
        `TC-18 stroke delivery: ${deliveryMs}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, reported not asserted)`,
      );
      await expect
        .poll(async () => (await objectsOf(priya, 'stroke')).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(1);

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });

  test('TC-19: the wheel still pans with the pen active; a drag over a sticky draws without moving it', async ({ browser }) => {
    chromiumOnly();
    const ctxs: BrowserContext[] = [];
    const wrangler: WranglerProcess = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const ctx = await browser.newContext();
      ctxs.push(ctx);
      const page = await ctx.newPage();
      await openBoard(page, boardId);
      // Seed a sticky at world (400, 200).
      await page.evaluate(() => {
        (window as unknown as { __vidi6: { createNoteAt(x: number, y: number, c: string, t: string): string | null } }).__vidi6.createNoteAt(
          400, 200, 'yellow', 'hi',
        );
      });
      await setCamera(page, { x: 0, y: 0, zoom: 1 });
      await page.keyboard.press('p');

      // The wheel pans the board even though the Pen tool is active.
      const camBefore = await getCamera(page);
      await page.mouse.move(640, 400);
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(100);
      const camAfterWheel = await getCamera(page);
      expect(
        camAfterWheel.x !== camBefore.x || camAfterWheel.y !== camBefore.y,
      ).toBe(true);

      // Re-pin the camera, then drag starting on the sticky's centre.
      await setCamera(page, { x: 0, y: 0, zoom: 1 });
      const sticky = [...(await getObjects(page)).values()].find((o) => o.type === 'sticky')!;
      expect(sticky).toBeDefined();

      await page.mouse.move(400, 200);
      await page.mouse.down();
      await page.mouse.move(500, 260, { steps: 10 });
      await page.mouse.up();

      await expect
        .poll(async () => (await objectsOf(page, 'stroke')).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(1);
      // The sticky was not moved and the board was not panned by the drag.
      const stickyAfter = [...(await getObjects(page)).values()].find((o) => o.type === 'sticky')!;
      expect(stickyAfter.x).toBeCloseTo(sticky.x, 5);
      expect(stickyAfter.y).toBeCloseTo(sticky.y, 5);
      const camAfterDrag = await getCamera(page);
      expect(camAfterDrag.x).toBeCloseTo(0, 5);
      expect(camAfterDrag.y).toBeCloseTo(0, 5);

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });

  test('TC-20: select by line, aspect-locked resize keeps thickness, move, delete — both screens', async ({ browser }) => {
    chromiumOnly();
    const ctxs: BrowserContext[] = [];
    const wrangler: WranglerProcess = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const priyaCtx = await browser.newContext();
      const samCtx = await browser.newContext();
      ctxs.push(priyaCtx, samCtx);
      const priya = await priyaCtx.newPage();
      const sam = await samCtx.newPage();
      await openBoard(priya, boardId);
      await openBoard(sam, boardId);
      await setCamera(priya, { x: 0, y: 0, zoom: 1 });
      await setCamera(sam, { x: 0, y: 0, zoom: 1 });

      // Priya draws a diagonal stroke: (100,100) → (300,300).
      await priya.keyboard.press('p');
      await priya.mouse.move(100, 100);
      await priya.mouse.down();
      await priya.mouse.move(300, 300, { steps: 10 });
      await priya.mouse.up();
      await expect
        .poll(async () => (await objectsOf(sam, 'stroke')).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(1);

      // Select the stroke by its line (V, then a click on the line).
      await priya.keyboard.press('v');
      await priya.mouse.click(200, 200);
      await expect(priya.locator('[data-testid="selection-overlay"]')).toBeVisible();
      const before = ((await objectsOf(priya, 'stroke')) as StrokeInfo[])[0];
      const widthBefore = await strokeWidthOf(priya);
      expect(widthBefore).toBeTruthy();

      // Drag the bottom-right (se) handle of the selection by (+100, +100).
      const handle = priya.getByRole('button', { name: 'Resize bottom-right' });
      const box = await handle.boundingBox();
      if (!box) throw new Error('se handle not found');
      const hx = box.x + box.width / 2;
      const hy = box.y + box.height / 2;
      await priya.mouse.move(hx, hy);
      await priya.mouse.down();
      await priya.mouse.move(hx + 100, hy + 100, { steps: 10 });
      await priya.mouse.up();
      await expect
        .poll(async () => ((await objectsOf(priya, 'stroke')) as StrokeInfo[])[0]?.width ?? 0, {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBeGreaterThan(before.width + 50);

      const after = ((await objectsOf(priya, 'stroke')) as StrokeInfo[])[0];
      // Aspect ratio preserved within 1%.
      const ratioBefore = before.width / before.height;
      const ratioAfter = after.width / after.height;
      expect(Math.abs(ratioAfter - ratioBefore) / ratioBefore).toBeLessThanOrEqual(0.01);
      // Rendered line thickness unchanged (stored thickness, world units).
      expect(await strokeWidthOf(priya)).toBe(widthBefore);
      expect(after.thickness).toBe(before.thickness);

      // Drag the body: the stroke moves.
      const cx = after.x + after.width / 2;
      const cy = after.y + after.height / 2;
      await priya.mouse.move(cx, cy);
      await priya.mouse.down();
      await priya.mouse.move(cx + 50, cy + 30, { steps: 10 });
      await priya.mouse.up();
      const moved = ((await objectsOf(priya, 'stroke')) as StrokeInfo[])[0];
      expect(moved.x).toBeCloseTo(after.x + 50, 1);
      expect(moved.y).toBeCloseTo(after.y + 30, 1);

      // Delete: removed on both screens.
      await priya.keyboard.press('Delete');
      await expect
        .poll(async () => (await objectsOf(priya, 'stroke')).length + (await objectsOf(sam, 'stroke')).length, {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe(0);

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });
});
