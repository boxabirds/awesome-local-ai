// Story 11, e2e (TC-17..TC-20): live preview + persistence, the preview is
// local-only (the stroke reaches a second participant only on release), wheel
// navigation + drawing over a sticky while the pen is active, and selecting /
// aspect-resizing / moving / deleting a stroke on both screens.
// Runs against `wrangler dev`.

import { expect, test } from '@playwright/test';
import {
  newBoard,
  openParticipant,
  closeParticipant,
  expectWithin,
  type Participant,
} from './participants';
import { setCamera, originCenter } from './helpers/board';
import {
  NOTE,
  STROKE,
  VIEWPORT,
  drawPenStroke,
  isPenActive,
  loopPoints,
  pagePoint,
  penPreviewD,
  seedSticky,
  stickyWorld,
  strokeCount,
  strokeWorld,
  usePenTool,
  waitForViewport,
} from './helpers/story11';

// Camera with the origin at the viewport origin (world = screen).
const ZOOM1 = { x: 0, y: 0, zoom: 1 };

test.describe('story 11 e2e (TC-17..TC-20)', () => {
  test('TC-17: drawing a loop shows a live preview and persists the stroke on release', async ({ page, baseURL }) => {
    test.slow();
    const boardId = await newBoard(baseURL!);
    await page.goto(`/b/${boardId}`);
    await setCamera(page, ZOOM1);
    await waitForViewport(page);
    await usePenTool(page);

    // Start the drag and stream the first half of a loop.
    const loop = loopPoints(420, 320, 90);
    const start = await pagePoint(page, ZOOM1, loop[0].x, loop[0].y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const half = Math.floor(loop.length / 2);
    for (const p of loop.slice(1, half)) {
      const s = await pagePoint(page, ZOOM1, p.x, p.y);
      await page.mouse.move(s.x, s.y, { steps: 3 });
    }
    // While the pointer is still down, the preview is live with segments.
    await expect
      .poll(async () => (await penPreviewD(page)) ?? '', { timeout: 5_000 })
      .not.toBe('');
    const d = (await penPreviewD(page)) ?? '';
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain(' Q ');

    // Finish the loop and release: exactly one stroke persists.
    for (const p of loop.slice(half)) {
      const s = await pagePoint(page, ZOOM1, p.x, p.y);
      await page.mouse.move(s.x, s.y, { steps: 3 });
    }
    await page.mouse.up();
    await expect(page.locator(STROKE)).toHaveCount(1, { timeout: 10_000 });
  });

  test('TC-18: the second participant sees nothing during the drag, then the stroke on release', async ({ browser, baseURL }) => {
    test.slow();
    const boardId = await newBoard(baseURL!);
    const dana = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      await setCamera(dana.page, ZOOM1);
      await setCamera(sam.page, ZOOM1);
      await waitForViewport(dana.page);
      await waitForViewport(sam.page);
      expect(await strokeCount(sam.page)).toBe(0);

      await usePenTool(dana.page);
      const loop = loopPoints(420, 320, 80);
      const start = await pagePoint(dana.page, ZOOM1, loop[0].x, loop[0].y);
      await dana.page.mouse.move(start.x, start.y);
      await dana.page.mouse.down();
      for (const p of loop.slice(1)) {
        const s = await pagePoint(dana.page, ZOOM1, p.x, p.y);
        await dana.page.mouse.move(s.x, s.y, { steps: 2 });
      }
      // Mid-drag: the preview is Dana-local, so Sam still has no stroke.
      expect(await strokeCount(sam.page)).toBe(0);
      // Release: the finished stroke reaches Sam within the live budget.
      await dana.page.mouse.up();
      await expectWithin(() => strokeCount(sam.page), 1);
    } finally {
      await closeParticipant(dana);
      await closeParticipant(sam);
    }
  });

  test('TC-19: the wheel still pans while the pen is active, and a drag over a sticky draws without moving it', async ({ page, baseURL }) => {
    test.slow();
    const boardId = await newBoard(baseURL!);
    await seedSticky(baseURL!, boardId, 1);
    await page.goto(`/b/${boardId}`);
    await setCamera(page, ZOOM1);
    await waitForViewport(page);
    await expect(page.locator(NOTE)).toHaveCount(1, { timeout: 10_000 });

    await usePenTool(page);
    // The wheel pans the board while the pen stays active.
    const originBefore = await originCenter(page);
    const at = await pagePoint(page, ZOOM1, 300, 300);
    await page.mouse.move(at.x, at.y);
    // A plain (non-ctrl) wheel pans; a negative delta keeps the seeded sticky
    // (top-left of the board) inside the viewport for the drag that follows.
    // The camera settles on the next frame, so poll for the pan.
    await page.mouse.wheel(0, -150);
    await expect
      .poll(
        async () => {
          const o = await originCenter(page);
          return Math.hypot(o.x - originBefore.x, o.y - originBefore.y);
        },
        { timeout: 5_000 },
      )
      .toBeGreaterThan(20);
    expect(await isPenActive(page)).toBe(true);

    // A drag starting on the sticky draws a stroke; the sticky does not move.
    const noteBefore = await stickyWorld(page);
    const noteBox = (await page.locator(NOTE).first().boundingBox()) ?? undefined;
    expect(noteBox).toBeDefined();
    const sx = noteBox!.x + 50;
    const sy = noteBox!.y + 50;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 120, sy + 120, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator(STROKE)).toHaveCount(1, { timeout: 10_000 });
    const noteAfter = await stickyWorld(page);
    expect(noteAfter.x).toBeCloseTo(noteBefore.x, 0);
    expect(noteAfter.y).toBeCloseTo(noteBefore.y, 0);
  });

  test('TC-20: select a stroke, aspect-resize, move, delete — removed on both screens', async ({ browser, baseURL }) => {
    test.slow();
    const boardId = await newBoard(baseURL!);
    const dana = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      await setCamera(dana.page, ZOOM1);
      await setCamera(sam.page, ZOOM1);
      await waitForViewport(dana.page);
      await waitForViewport(sam.page);

      // Dana draws a loop; both see it.
      await usePenTool(dana.page);
      await drawPenStroke(dana.page, ZOOM1, loopPoints(420, 320, 90));
      await expect(dana.page.locator(STROKE)).toHaveCount(1, { timeout: 10_000 });
      await expect(sam.page.locator(STROKE)).toHaveCount(1, { timeout: 10_000 });

      // Dana switches to Select and clicks the line to select the stroke.
      await dana.page.keyboard.press('v');
      // The loop's leftmost point is world (420 - 90, 320) = (330, 320).
      const linePoint = await pagePoint(dana.page, ZOOM1, 330, 320);
      await dana.page.mouse.click(linePoint.x, linePoint.y);
      const seHandle = dana.page.locator('[aria-label="Resize se"]');
      await expect(seHandle).toHaveCount(1, { timeout: 10_000 });

      // Aspect-resize via the SE handle: the width/height ratio is preserved.
      const before = await strokeWorld(dana.page);
      const ratioBefore = before.w / before.h;
      const hb = (await seHandle.boundingBox()) ?? undefined;
      expect(hb).toBeDefined();
      await dana.page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2);
      await dana.page.mouse.down();
      await dana.page.mouse.move(hb!.x + 70, hb!.y + 70, { steps: 12 });
      await dana.page.mouse.up();
      const resized = await strokeWorld(dana.page);
      const ratioAfter = resized.w / resized.h;
      expect(Math.abs(ratioAfter - ratioBefore) / ratioBefore).toBeLessThanOrEqual(0.01);

      // Move the selected stroke: the shared story 7 gesture nudges the
      // selection with the arrow keys (Shift = 10 world units), which is robust
      // across browsers (a body-drag hit-test is flaky on some engines). 8 ×
      // 10 = 80 in each axis.
      for (let i = 0; i < 8; i++) await dana.page.keyboard.press('Shift+ArrowRight');
      for (let i = 0; i < 8; i++) await dana.page.keyboard.press('Shift+ArrowDown');
      await dana.page.waitForTimeout(200);
      const moved = await strokeWorld(dana.page);
      expect(moved.x).toBeCloseTo(resized.x + 80, 0);
      expect(moved.y).toBeCloseTo(resized.y + 80, 0);

      // Delete: removed on both screens.
      await dana.page.keyboard.press('Delete');
      await expect(dana.page.locator(STROKE)).toHaveCount(0, { timeout: 10_000 });
      await expect(sam.page.locator(STROKE)).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await closeParticipant(dana);
      await closeParticipant(sam);
    }
  });
});
