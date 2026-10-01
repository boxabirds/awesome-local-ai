import { test, expect, type Page } from '@playwright/test';
import {
  createBoard,
  openBoardInPage,
  getWorldLayer,
  getCamera,
  scrollBoard,
} from './helpers/board';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';

/**
 * Story 11: Sketch freehand with a pen.
 *
 * E2E tests TC-17 through TC-20.
 *
 * The camera is set to (-640, -400, 1) so the world origin is at the centre
 * of the 1280×800 viewport: screen = world + (640, 400).
 */

async function setCamera(page: Page, x: number, y: number, zoom: number) {
  await page.evaluate(
    ({ x, y, zoom }) => (window as any).__vidi6?.setCamera?.({ x, y, zoom }),
    { x, y, zoom },
  );
}

/** Replay a list of screen points as a pen drag (mouse down → moves → up). */
async function drawPenPath(page: Page, pts: { x: number; y: number }[]) {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    await page.mouse.move(pts[i].x, pts[i].y, { steps: 1 });
  }
  await page.mouse.up();
}

/** Offset+scale fixture points into screen coordinates. */
function toScreen(
  pts: { x: number; y: number }[],
  origin: { x: number; y: number },
  scale = 1,
): { x: number; y: number }[] {
  return pts.map((p) => ({ x: origin.x + p.x * scale, y: origin.y + p.y * scale }));
}

/** The `d` attribute of the first stroke's path in the world layer. */
async function firstStrokeD(page: Page): Promise<string | null> {
  return page
    .getByTestId('world-layer')
    .locator('[data-testid^="stroke-object-"] path')
    .first()
    .getAttribute('d');
}

test.describe('story 11: pen (e2e)', () => {
  test('TC-17: draw with the pen; the preview updates per frame and the stroke persists', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await openBoardInPage(page, boardId);
    await setCamera(page, -640, -400, 1);

    // Activate the pen with the P shortcut.
    await page.keyboard.press('p');
    const penButton = page.getByLabel('Pen (P)');
    await expect(penButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('pen-tool-overlay')).toBeVisible();
    // The options bar appears above the toolbar.
    await expect(page.getByTestId('pen-toolbar')).toBeVisible();

    // Sample the preview path every animation frame while we draw.
    const sampler = page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const out: string[] = [];
          const started = performance.now();
          const tick = () => {
            const el = document.querySelector(
              '[data-testid="pen-preview"]',
            ) as SVGPathElement | null;
            const d = el?.getAttribute('d');
            if (d) out.push(d);
            if (performance.now() - started < 3000) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
    );

    const pts = toScreen(handwrittenLoop, { x: 300, y: 200 }, 2);
    await drawPenPath(page, pts);

    const samples = await sampler;
    const distinct = new Set(samples);
    expect(
      distinct.size,
      `preview should change across frames (got ${distinct.size} distinct values)`,
    ).toBeGreaterThanOrEqual(3);

    // The preview is gone after release; the stroke object is there.
    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    const world = await getWorldLayer(page);
    const stroke = world.locator('[data-testid^="stroke-object-"]');
    await expect(stroke).toHaveCount(1);
    expect(await stroke.first().getAttribute('data-color')).toBe('black');
    expect(await stroke.first().getAttribute('data-thickness')).toBe('medium');

    // The pen stays active.
    await expect(penButton).toHaveAttribute('aria-pressed', 'true');

    // The stroke survives a reload.
    await page.reload();
    await page.getByTestId('board-viewport').waitFor();
    await expect(
      (await getWorldLayer(page)).locator('[data-testid^="stroke-object-"]').first(),
    ).toBeVisible();

    await ctx.close();
  });

  test('TC-18: the second participant sees the stroke only after release', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const pageA = await ctx.newPage();
    const pageB = await ctx.newPage();
    await openBoardInPage(pageA, boardId);
    await openBoardInPage(pageB, boardId);
    await setCamera(pageA, -640, -400, 1);
    await setCamera(pageB, -640, -400, 1);

    await pageA.keyboard.press('p');
    await expect(pageA.getByTestId('pen-tool-overlay')).toBeVisible();

    const worldB = await getWorldLayer(pageB);
    expect(await worldB.locator('[data-testid^="stroke-object-"]').count()).toBe(0);

    // A draws partway through the underline…
    const pts = toScreen(underline, { x: 300, y: 300 }, 2);
    await pageA.mouse.move(pts[0].x, pts[0].y);
    await pageA.mouse.down();
    const mid = pts[Math.floor(pts.length / 2)];
    await pageA.mouse.move(mid.x, mid.y, { steps: 10 });

    // …and B still has no stroke (nothing is committed until release).
    expect(await worldB.locator('[data-testid^="stroke-object-"]').count()).toBe(0);

    // A finishes.
    await pageA.mouse.move(pts[pts.length - 1].x, pts[pts.length - 1].y, { steps: 10 });
    await pageA.mouse.up();

    // B now has exactly one stroke, identical to A's.
    await expect(worldB.locator('[data-testid^="stroke-object-"]')).toHaveCount(1);
    const dA = await firstStrokeD(pageA);
    const dB = await firstStrokeD(pageB);
    expect(dA).not.toBeNull();
    expect(dB).toBe(dA);

    await ctx.close();
  });

  test('TC-19: wheel pans while the pen is active; drags over a sticky create a stroke, not a move', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await openBoardInPage(page, boardId);
    await setCamera(page, -640, -400, 1);

    // A sticky note at the view centre.
    await page.keyboard.press('n');
    const world = await getWorldLayer(page);
    const sticky = world.locator('[data-testid^="sticky-note-"]').first();
    await expect(sticky).toBeVisible();
    await page.keyboard.press('Escape'); // end text editing
    const stickyWorld = await sticky.evaluate((el) => ({
      x: (el as HTMLElement).style.left,
      y: (el as HTMLElement).style.top,
    }));

    // Activate the pen.
    await page.keyboard.press('p');
    await expect(page.getByTestId('pen-tool-overlay')).toBeVisible();

    // Wheel pans the view (the pen does not eat the wheel).
    const camBefore = await getCamera(page);
    await scrollBoard(page, 120, 80, 640, 400);
    const camAfter = await getCamera(page);
    expect(camAfter.x).not.toBe(camBefore.x);
    expect(camAfter.y).not.toBe(camBefore.y);

    // A drag over the sticky's (new) screen position creates a stroke…
    const zoom = camAfter.zoom;
    const stickyScreenX = (parseFloat(stickyWorld.x) - camAfter.x) * zoom;
    const stickyScreenY = (parseFloat(stickyWorld.y) - camAfter.y) * zoom;
    const vpBox = await page.getByTestId('board-viewport').boundingBox();
    if (!vpBox) throw new Error('Viewport not found');
    const pts = toScreen(underline, { x: vpBox.x + stickyScreenX + 10, y: vpBox.y + stickyScreenY + 90 }, 2);
    await drawPenPath(page, pts);

    await expect(world.locator('[data-testid^="stroke-object-"]')).toHaveCount(1);
    // …and the sticky did not move.
    const stickyWorldAfter = await sticky.evaluate((el) => ({
      x: (el as HTMLElement).style.left,
      y: (el as HTMLElement).style.top,
    }));
    expect(stickyWorldAfter.x).toBe(stickyWorld.x);
    expect(stickyWorldAfter.y).toBe(stickyWorld.y);

    await ctx.close();
  });

  test('TC-20: select by line, resize proportionally, move, delete — on both screens', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const pageA = await ctx.newPage();
    const pageB = await ctx.newPage();
    await openBoardInPage(pageA, boardId);
    await openBoardInPage(pageB, boardId);
    await setCamera(pageA, -640, -400, 1);
    await setCamera(pageB, -640, -400, 1);

    // A draws a loop and goes back to the select tool.
    await pageA.keyboard.press('p');
    const pts = toScreen(handwrittenLoop, { x: 300, y: 200 }, 2);
    await drawPenPath(pageA, pts);
    await pageA.keyboard.press('Escape');

    const worldA = await getWorldLayer(pageA);
    const worldB = await getWorldLayer(pageB);
    await expect(worldB.locator('[data-testid^="stroke-object-"]')).toHaveCount(1);

    // Select by clicking a point that lies exactly on the line (the first
    // point of the drawn path).
    const firstPt = toScreen(handwrittenLoop, { x: 300, y: 200 }, 2)[0];
    const vpBox = await pageA.getByTestId('board-viewport').boundingBox();
    if (!vpBox) throw new Error('Viewport not found');
    await pageA.mouse.click(vpBox.x + firstPt.x, vpBox.y + firstPt.y);
    const strokeA = worldA.locator('[data-testid^="stroke-object-"]').first();
    await expect(strokeA).toHaveAttribute('data-selected', 'true');

    // The selection overlay with handles is visible.
    const overlay = worldA.locator('[data-testid="selection-overlay"]');
    await expect(overlay).toBeVisible();
    const se = worldA.locator('[data-testid="resize-handle-se"]');
    await expect(se).toBeVisible();

    // Move first: drag from a point on the line (the rightmost point of the
    // loop: bbox right edge minus the 2px half-thickness padding).
    // (Move is tested before resize because Firefox drops synthetic pointer
    // moves that follow a pointer-captured resize gesture — an app-correct
    // behaviour verified with synthetic events, so the order is swapped.)
    const box = await overlay.boundingBox();
    if (!box) throw new Error('Overlay not found');
    const moveX = box.x + box.width - 2;
    const moveY = box.y + box.height / 2;
    await pageA.mouse.move(moveX, moveY);
    await pageA.mouse.down();
    await pageA.mouse.move(moveX + 90, moveY + 40, { steps: 5 });
    await pageA.mouse.up();
    const boxAfterMove = await overlay.boundingBox();
    if (!boxAfterMove) throw new Error('Overlay not found after move');
    expect(boxAfterMove.x).toBeCloseTo(box.x + 90, -1);
    expect(boxAfterMove.y).toBeCloseTo(box.y + 40, -1);

    // Proportional resize from the SE handle.
    const sizeBefore = await overlay.evaluate((el) => ({
      w: (el as HTMLElement).offsetWidth,
      h: (el as HTMLElement).offsetHeight,
    }));
    const seBox = await se.boundingBox();
    if (!seBox) throw new Error('SE handle not found');
    await pageA.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
    await pageA.mouse.down();
    await pageA.mouse.move(seBox.x + seBox.width / 2 + 80, seBox.y + seBox.height / 2 + 60, { steps: 5 });
    await pageA.mouse.up();

    const sizeAfter = await overlay.evaluate((el) => ({
      w: (el as HTMLElement).offsetWidth,
      h: (el as HTMLElement).offsetHeight,
    }));
    expect(sizeAfter.w).toBeGreaterThan(sizeBefore.w);
    expect(sizeAfter.h).toBeGreaterThan(sizeBefore.h);
    const ratioBefore = sizeBefore.w / sizeBefore.h;
    const ratioAfter = sizeAfter.w / sizeAfter.h;
    expect(Math.abs(ratioAfter - ratioBefore) / ratioBefore).toBeLessThan(0.01);

    // Delete: the stroke disappears on both screens.
    await pageA.keyboard.press('Delete');
    await expect(worldA.locator('[data-testid^="stroke-object-"]')).toHaveCount(0);
    await expect(worldB.locator('[data-testid^="stroke-object-"]')).toHaveCount(0);

    await ctx.close();
  });
});
