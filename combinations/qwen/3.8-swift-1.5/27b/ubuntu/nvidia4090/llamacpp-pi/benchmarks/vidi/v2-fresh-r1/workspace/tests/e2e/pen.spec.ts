// E2E tests for the Pen tool (story 11): TC-17 to TC-20.
//
// The harness camera centres the origin, so world (0,0) maps to screen
// (640, 400) in the default 1280×800 viewport.

import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  PEN_THICKNESS_WORLD,
} from '../../src/shared/config';
import { gotoFreshBoard } from './helpers/goto-board';
import {
  openParticipant,
  joinBoard,
  closeParticipant,
} from './helpers/participants';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';

const VIEWPORT = { width: 1280, height: 800 };
const TOLERANCE_PX = 2;

/** World → screen (origin centred at the viewport centre). */
const toScreen = (p: { x: number; y: number }) => ({
  x: VIEWPORT.width / 2 + p.x,
  y: VIEWPORT.height / 2 + p.y,
});

async function activatePen(page: Page): Promise<void> {
  await page.getByTestId('pen-tool-btn').click();
}

function strokeLocator(page: Page) {
  return page.locator('[data-testid="stroke-object"]');
}

/** Centre (screen) of the origin marker at world (0,0). */
async function originCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('[data-testid="origin-marker"]').boundingBox();
  if (!box) throw new Error('origin marker not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Drag a freehand path (world coordinates) with the Pen, sampling the local
 * preview's `d` attribute along the way. Returns the distinct `d` values seen.
 */
async function penDragWithSamples(
  page: Page,
  points: { x: number; y: number }[],
): Promise<Set<string>> {
  const s0 = toScreen(points[0]);
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  const samples = new Set<string>();
  for (let i = 1; i < points.length; i++) {
    const s = toScreen(points[i]);
    await page.mouse.move(s.x, s.y);
    if (i % 8 === 0) {
      const d = await page.evaluate(
        () =>
          document
            .querySelector('[data-testid="pen-preview"] path')
            ?.getAttribute('d') ?? null,
      );
      if (d) samples.add(d);
    }
  }
  const last = toScreen(points[points.length - 1]);
  await page.mouse.move(last.x, last.y);
  await page.mouse.up();
  return samples;
}

/** Dispatch a plain (non-Ctrl) wheel over the point at (x, y). */
async function wheelAt(
  page: Page,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  await page.evaluate(
    ({ x, y, deltaX, deltaY }) => {
      const el = document.elementFromPoint(x, y) as HTMLElement;
      el.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          ctrlKey: false,
          deltaX,
          deltaY,
          deltaMode: 0,
          clientX: x,
          clientY: y,
        }),
      );
    },
    { x, y, deltaX, deltaY },
  );
}

test.describe('story 11: sketch freehand with a pen', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFreshBoard(page);
  });

  // TC-17: a real drag draws a loop; the local preview updates per frame and
  // the finished stroke persists.
  test('TC-17 a real drag draws a loop; the preview updates per frame', async ({ page }) => {
    await activatePen(page);

    const samples = await penDragWithSamples(page, handwrittenLoop);

    // The preview existed during the drag and its path changed across frames.
    expect(samples.size).toBeGreaterThan(1);

    // After release: no local preview remains, and the stroke persists.
    await expect(page.locator('[data-testid="pen-preview"]')).toHaveCount(0);
    await expect(strokeLocator(page)).toHaveCount(1);
  });

  // TC-18: an in-progress stroke is local only; the finished stroke is
  // shared within the live-update latency budget.
  test('TC-18 the finished stroke is shared; the in-progress stroke is not', async ({
    browser,
  }) => {
    const priya = await openParticipant(browser);
    const sam = await openParticipant(browser);
    await joinBoard(sam.page, priya.boardId);

    try {
      await activatePen(priya.page);

      // Start a stroke and leave it in progress (no release).
      const start = toScreen(underline[0]);
      await priya.page.mouse.move(start.x, start.y);
      await priya.page.mouse.down();
      for (let i = 1; i < 40; i++) {
        const s = toScreen(underline[i]);
        await priya.page.mouse.move(s.x, s.y);
      }

      // While in progress, neither participant has a committed stroke object.
      await expect(strokeLocator(sam.page)).toHaveCount(0);
      await expect(strokeLocator(priya.page)).toHaveCount(0);

      // Finish it.
      const end = toScreen(underline[39]);
      await priya.page.mouse.move(end.x, end.y);
      const t0 = Date.now();
      await priya.page.mouse.up();

      await expect
        .poll(() => strokeLocator(sam.page).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(1);
      const latencyMs = Date.now() - t0;
      expect(latencyMs).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);
      await expect(strokeLocator(priya.page)).toHaveCount(1);
    } finally {
      await closeParticipant(priya);
      await closeParticipant(sam);
    }
  });

  // TC-19: while the Pen is active, wheel pans the board; a pen drag that
  // starts over a sticky creates a stroke and does not move the sticky.
  test('TC-19 wheel pans while Pen is active; a drag over a sticky draws, not moves', async ({
    page,
  }) => {
    // Create a sticky near the centre.
    await page.mouse.dblclick(VIEWPORT.width / 2, VIEWPORT.height / 2);
    const sticky = page.locator('[data-testid="sticky-note"]').first();
    await sticky.waitFor({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const stickyBefore = (await sticky.boundingBox())!;
    const originBefore = await originCenter(page);

    await activatePen(page);

    // Wheel over the board pans it (the Pen overlay forwards wheel to the
    // camera). Scrolling down (positive deltaY) moves the content up by 120.
    await wheelAt(page, VIEWPORT.width / 2, VIEWPORT.height / 2, 0, 120);
    await page.waitForTimeout(150);
    const originAfter = await originCenter(page);
    expect(Math.abs(originAfter.y - (originBefore.y - 120))).toBeLessThanOrEqual(TOLERANCE_PX);

    // A pen drag that starts over the (now-panned) sticky draws a stroke and
    // leaves the sticky where it is.
    const stickyAfterPan = (await sticky.boundingBox())!;
    const sx = stickyAfterPan.x + 20;
    const sy = stickyAfterPan.y + 20;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 120, sy + 40, { steps: 8 });
    await page.mouse.up();

    await expect(strokeLocator(page)).toHaveCount(1);
    const stickyAfterDrag = (await sticky.boundingBox())!;
    expect(Math.abs(stickyAfterDrag.x - stickyAfterPan.x)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(stickyAfterDrag.y - stickyAfterPan.y)).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  // TC-20: select by the line, proportional resize (aspect locked, thickness
  // unchanged), move the body, then delete — gone on both screens.
  test('TC-20 select by line, proportional resize, move, delete', async ({ browser }) => {
    const dana = await openParticipant(browser);
    const sam = await openParticipant(browser);
    await joinBoard(sam.page, dana.boardId);

    try {
      const page = dana.page;
      await activatePen(page);

      // Draw a straight line from world (-100,-50) to (100,50).
      const a = toScreen({ x: -100, y: -50 });
      const b = toScreen({ x: 100, y: 50 });
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 10 });
      await page.mouse.up();
      await expect(strokeLocator(page)).toHaveCount(1);
      await expect(strokeLocator(sam.page)).toHaveCount(1, { timeout: 5000 });

      // Switch to Select and click on the line (its midpoint, world (0,0)).
      await page.keyboard.press('v');
      const mid = toScreen({ x: 0, y: 0 });
      await page.mouse.click(mid.x, mid.y);
      const selCount = page.locator('[data-testid="selection-count"]');
      await expect(selCount).toHaveText('1 selected');

      const stroke = strokeLocator(page);
      const boxBefore = (await stroke.boundingBox())!;
      const aspectBefore = boxBefore.width / boxBefore.height;

      // Read the drawn thickness (world units) before resizing.
      const thicknessBefore = await stroke
        .locator('path')
        .first()
        .getAttribute('stroke-width');

      // Proportional resize: drag the SE handle.
      const se = page.getByTestId('resize-handle-se');
      const seBox = (await se.boundingBox())!;
      await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(seBox.x + seBox.width / 2 + 120, seBox.y + seBox.height / 2 + 60, {
        steps: 10,
      });
      await page.mouse.up();

      const boxAfter = (await stroke.boundingBox())!;
      const aspectAfter = boxAfter.width / boxAfter.height;
      // Aspect ratio preserved within 1%.
      expect(Math.abs(aspectAfter - aspectBefore) / aspectBefore).toBeLessThanOrEqual(0.01);
      // Thickness is unchanged.
      const thicknessAfter = await stroke.locator('path').first().getAttribute('stroke-width');
      expect(thicknessAfter).toBe(thicknessBefore);
      expect(Number(thicknessAfter)).toBe(PEN_THICKNESS_WORLD.medium);

      // Move the body: drag from a point on the line.
      const linePt = toScreen({ x: -60, y: -30 });
      await page.mouse.move(linePt.x, linePt.y);
      await page.mouse.down();
      await page.mouse.move(linePt.x + 80, linePt.y + 40, { steps: 8 });
      await page.mouse.up();
      const boxMoved = (await stroke.boundingBox())!;
      expect(Math.abs(boxMoved.x - (boxAfter.x + 80))).toBeLessThanOrEqual(TOLERANCE_PX + 1);

      // Delete: gone on both screens.
      await page.keyboard.press('Delete');
      await expect(strokeLocator(page)).toHaveCount(0);
      await expect(strokeLocator(sam.page)).toHaveCount(0, { timeout: 5000 });
    } finally {
      await closeParticipant(dana);
      await closeParticipant(sam);
    }
  });
});
