import { expect, test, type Page } from '@playwright/test';
import { createBoard, openFreshBoard, readCamera, settle } from './helpers/board';
import { boxOf, centerOf } from './helpers/shapes';
import { expectEventually, openParticipant } from './helpers/participants';
import { handwrittenLoop } from '../fixtures/pen-paths';

interface P {
  x: number;
  y: number;
}

async function dragPenPath(page: Page, points: P[]): Promise<void> {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i += 1) {
    await page.mouse.move(points[i].x, points[i].y);
  }
  await page.mouse.up();
}

function strokeCount(page: Page): () => Promise<number> {
  return () => page.locator('[data-testid^="stroke-"]:not([data-testid^="stroke-hit-"])').count();
}

async function stickyWorldPos(page: Page, id: string): Promise<{ left: string; top: string }> {
  return page.getByTestId(`sticky-${id}`).evaluate((el) => ({
    left: (el as HTMLElement).style.left,
    top: (el as HTMLElement).style.top
  }));
}

test.describe('story 11: sketch freehand with a pen', () => {
  test('TC-17 a real loop drag previews live and persists one stroke', async ({ page }) => {
    await openFreshBoard(page);
    await page.getByRole('button', { name: 'Pen (P)' }).click();

    const loop = handwrittenLoop();
    await page.mouse.move(loop[0].x, loop[0].y);
    await page.mouse.down();
    for (let i = 1; i < 200; i += 1) {
      await page.mouse.move(loop[i].x, loop[i].y);
    }
    await settle(page);
    await expect(page.getByTestId('pen-preview')).toHaveCount(1);

    for (let i = 200; i < loop.length; i += 1) {
      await page.mouse.move(loop[i].x, loop[i].y);
    }
    await page.mouse.up();
    await settle(page);

    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    await expect.poll(strokeCount(page)).toBe(1);
    const id = await firstStrokeId(page);
    const box = await boxOf(page, `stroke-${id}`);
    // Handwritten loop around (640, 400) with radius ~150: bbox keeps that scale.
    expect(box.width).toBeGreaterThan(250);
    expect(box.width).toBeLessThan(400);
    expect(box.height).toBeGreaterThan(150);
    expect(box.height).toBeLessThan(330);
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(20);
    expect(Math.abs(box.y + box.height / 2 - 400)).toBeLessThanOrEqual(20);
  });

  test('TC-18 others see nothing until the stroke is finished', async ({ browser, page: _page }) => {
    const boardId = await createBoard(_page.request);
    const priya = await openParticipant(browser, 'Priya', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);

    await priya.page.getByRole('button', { name: 'Pen (P)' }).click();
    const loop = handwrittenLoop();
    await priya.page.mouse.move(loop[0].x, loop[0].y);
    await priya.page.mouse.down();
    for (let i = 1; i < 150; i += 1) {
      await priya.page.mouse.move(loop[i].x, loop[i].y);
    }
    await settle(priya.page);
    // Mid-drag: the drawer previews, the watcher sees no stroke and no preview.
    await expect(priya.page.getByTestId('pen-preview')).toHaveCount(1);
    expect(await strokeCount(sam.page)()).toBe(0);
    await expect(sam.page.getByTestId('pen-preview')).toHaveCount(0);

    for (let i = 150; i < loop.length; i += 1) {
      await priya.page.mouse.move(loop[i].x, loop[i].y);
    }
    await priya.page.mouse.up();

    await expectEventually('pen stroke to other participant', async () => {
      await expect(sam.page.locator('[data-testid^="stroke-"]:not([data-testid^="stroke-hit-"])')).toHaveCount(1, {
        timeout: 10000
      });
    });
    expect(priya.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
  });

  test('TC-19 wheel pans with the Pen armed; a drag over a sticky draws without moving it', async ({ page }) => {
    await openFreshBoard(page);
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await settle(page);
    // Creation enters edit mode; leave it before switching to the Pen.
    await page.keyboard.press('Escape');
    await settle(page);
    const sticky = page.locator(
      '[data-testid^="sticky-"]:not([data-testid^="sticky-text-"]):not([data-testid^="sticky-fade-"]):not([data-testid^="sticky-editor-"]):not([data-testid^="sticky-counter-"])'
    );
    await expect(sticky).toHaveCount(1);
    const stickyId = (await sticky.first().getAttribute('data-testid'))?.replace('sticky-', '') ?? '';
    const stickyBefore = await stickyWorldPos(page, stickyId);

    await page.getByRole('button', { name: 'Pen (P)' }).click();
    await page.mouse.move(900, 300);
    const camBefore = await readCamera(page);
    await page.mouse.wheel(0, 200);
    await settle(page);
    const camAfter = await readCamera(page);
    // wheel(dy) pans panBy(-dx, -dy) → camera.y grows by the wheel delta.
    expect(Math.abs(camAfter.y - (camBefore.y + 200))).toBeLessThanOrEqual(1);
    // The sticky keeps its world position while the board pans.
    expect(await stickyWorldPos(page, stickyId)).toEqual(stickyBefore);

    // A Pen drag starting on top of the sticky draws a stroke and leaves the sticky put.
    const center = await centerOf(page, `sticky-${stickyId}`);
    await dragPenPath(page, [
      center,
      { x: center.x + 60, y: center.y - 40 },
      { x: center.x + 130, y: center.y + 30 },
      { x: center.x + 200, y: center.y - 10 }
    ]);
    await settle(page);
    await expect.poll(strokeCount(page)).toBe(1);
    expect(await stickyWorldPos(page, stickyId)).toEqual(stickyBefore);
  });

  test('TC-20 select by line, resize proportionally, move, delete for everyone', async ({ browser, page: _page }) => {
    const boardId = await createBoard(_page.request);
    const priya = await openParticipant(browser, 'Priya', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);
    const page = priya.page;

    await page.getByRole('button', { name: 'Pen (P)' }).click();
    await dragPenPath(page, [
      { x: 400, y: 500 },
      { x: 500, y: 480 },
      { x: 600, y: 520 },
      { x: 720, y: 490 },
      { x: 880, y: 505 }
    ]);
    await settle(page);
    await expect.poll(strokeCount(page)).toBe(1);
    const id = await firstStrokeId(page);
    await expectEventually('stroke appears for Sam', async () => {
      await expect(sam.page.locator(`[data-testid="stroke-${id}"]`)).toBeVisible({ timeout: 10000 });
    });

    // Click the line itself to select. (550, 500) is the midpoint of two path
    // vertices, which the smoothed curve passes through exactly.
    await page.getByRole('button', { name: 'Select (V)' }).click();
    await page.mouse.click(550, 500);
    await expect(page.getByTestId(`stroke-${id}`)).toHaveAttribute('data-selected', 'true');

    // Drag the corner handle: the aspect ratio is preserved within 1%.
    const before = await boxOf(page, `stroke-${id}`);
    const handle = page.getByTestId('resize-handle-se');
    await expect(handle).toBeVisible();
    const hb = await handle.boundingBox();
    if (hb === null) throw new Error('resize handle not visible');
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 100, hb.y + hb.height / 2 + 100, { steps: 5 });
    await page.mouse.up();
    await settle(page);
    const resized = await boxOf(page, `stroke-${id}`);
    expect(resized.width).toBeGreaterThan(before.width);
    const ratioBefore = before.width / before.height;
    const ratioAfter = resized.width / resized.height;
    expect(Math.abs(ratioAfter / ratioBefore - 1)).toBeLessThanOrEqual(0.01);

    // Drag the body: the same on-line point, mapped through the uniform scale.
    const s = resized.width / before.width;
    const mid = { x: resized.x + (550 - before.x) * s, y: resized.y + (500 - before.y) * s };
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x + 60, mid.y - 40, { steps: 5 });
    await page.mouse.up();
    await settle(page);
    const moved = await boxOf(page, `stroke-${id}`);
    expect(Math.abs(moved.x - (resized.x + 60))).toBeLessThanOrEqual(3);
    expect(Math.abs(moved.y - (resized.y - 40))).toBeLessThanOrEqual(3);

    // Delete removes it on both screens.
    await page.keyboard.press('Delete');
    await settle(page);
    await expect.poll(strokeCount(page)).toBe(0);
    await expectEventually('stroke delete reaches Sam', async () => {
      await expect(sam.page.locator(`[data-testid="stroke-${id}"]`)).toHaveCount(0, { timeout: 10000 });
    });
    expect(priya.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
  });
});

async function firstStrokeId(page: Page): Promise<string> {
  const testId = await page
    .locator('[data-testid^="stroke-"]:not([data-testid^="stroke-hit-"])')
    .first()
    .getAttribute('data-testid');
  return (testId ?? '').replace('stroke-', '');
}
