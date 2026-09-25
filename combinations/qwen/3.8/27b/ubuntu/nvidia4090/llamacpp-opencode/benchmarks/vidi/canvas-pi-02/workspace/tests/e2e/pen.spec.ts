/**
 * Story 11 e2e tests: sketch freehand with a pen (TC-17 to TC-20).
 *
 *  - TC-17: a real mouse drag drawing a loop — the preview path is present
 *    and updates while the drag is in flight; the stroke persists after
 *    release; the pen stays active.
 *  - TC-18: Priya draws while Sam watches — Sam sees nothing while the drag
 *    is in flight (in-progress strokes are never sent); the finished stroke
 *    arrives within the live-update budget.
 *  - TC-19: navigation and objects coexist with the pen — the wheel still
 *    pans, and a drag starting on a sticky draws a stroke without moving
 *    the sticky.
 *  - TC-20: select by clicking the line, resize (aspect ratio preserved),
 *    move, delete — the deletion lands on both screens.
 *
 * Coordinate model: 1280x800 viewport, home camera {-640, -400, 1}, so
 * screen = world + (640, 400).
 */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  expectConnected,
  expectWithin,
  freshBoardId,
  HOME_CAMERA,
  join,
  type Participant,
} from './helpers/participants';
import { createBoard } from './helpers/participants';
import { dragBy, getNotes, gridBackgroundPosition, setCamera } from './helpers/board';
import { HANDWRITTEN_LOOP } from '../fixtures/pen-paths';

/** All board objects (every type) via the test hook. */
function getObjects(page: Page): Promise<any[]> {
  return page.evaluate(() => [...((window as any).__vidi6?.getNotes() ?? [])]);
}

async function strokes(page: Page): Promise<any[]> {
  return (await getObjects(page)).filter((o) => o.type === 'stroke');
}

const W2S = (wx: number, wy: number) => ({ x: wx + 640, y: wy + 400 });

/** Open a fresh board on `page`, synced and parked on the home camera. */
async function openBoard(page: Page, request: APIRequestContext): Promise<void> {
  const boardId = await createBoard(request);
  await page.goto(`/b/${boardId}`);
  await expectConnected(page);
  await setCamera(page, HOME_CAMERA);
}

/** Close every participant, whatever the outcome. */
async function closeAll(...ps: Participant[]): Promise<void> {
  for (const p of ps) await p.close();
}

/** Replay a world-space path as mouse moves (home camera: +640/+400). */
async function replayPath(
  page: Page,
  pts: readonly { x: number; y: number }[],
  from: number,
  to?: number,
): Promise<void> {
  const last = to ?? pts.length;
  for (let i = from; i < last; i += 1) {
    const p = W2S(pts[i]!.x, pts[i]!.y);
    await page.mouse.move(p.x, p.y);
  }
}

/** The in-progress preview path's `d`, or null while no preview is shown. */
async function previewD(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.querySelector('[data-testid="pen-preview"]')?.getAttribute('d') ?? null,
  );
}

test.describe('Story 11: sketch freehand with a pen', () => {
  test('TC-17 a real drag drawing a loop: preview present and updating during the drag; the stroke persists after release; the pen stays active', async ({
    page,
    request,
  }) => {
    await openBoard(page, request);

    await page.keyboard.press('p');
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');

    const start = W2S(HANDWRITTEN_LOOP[0]!.x, HANDWRITTEN_LOOP[0]!.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();

    // First half of the loop, then let frames render.
    const half = Math.floor(HANDWRITTEN_LOOP.length / 2);
    await replayPath(page, HANDWRITTEN_LOOP, 1, half);
    await page.waitForTimeout(100);
    const d1 = await previewD(page);
    expect(d1).toBeTruthy();

    // The rest of the loop: the preview must have grown (different `d`).
    await replayPath(page, HANDWRITTEN_LOOP, half);
    await page.waitForTimeout(100);
    const d2 = await previewD(page);
    expect(d2).toBeTruthy();
    expect(d2).not.toBe(d1);

    await page.mouse.up();

    // The preview is gone and exactly one stroke persisted.
    await expect(page.locator('[data-testid="pen-preview"]')).toHaveCount(0);
    await expect.poll(() => strokes(page).then((s) => s.length)).toBe(1);
    const s = (await strokes(page))[0]!;
    expect(s.color).toBe('black');
    expect(s.thickness).toBe('medium');

    // The pen stays active after the commit (pen.stay_active).
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    expect(page.locator('[data-testid="stroke-object"]')).toHaveCount(1);
  });

  test('TC-18 Priya draws while Sam watches: Sam sees nothing during the drag; the stroke is visible within the live-update budget after release', async ({
    browser,
  }) => {
    const boardId = freshBoardId();
    const priya = await join(browser, boardId);
    const sam = await join(browser, boardId);
    try {
      await priya.page.keyboard.press('p');
      const start = W2S(HANDWRITTEN_LOOP[0]!.x, HANDWRITTEN_LOOP[0]!.y);
      await priya.page.mouse.move(start.x, start.y);
      await priya.page.mouse.down();

      // Draw a quarter of the loop and hold the pointer down.
      const quarter = Math.floor(HANDWRITTEN_LOOP.length / 4);
      await replayPath(priya.page, HANDWRITTEN_LOOP, 1, quarter);
      await priya.page.waitForTimeout(150);
      // Priya is mid-stroke: her preview is on screen…
      expect(await previewD(priya.page)).toBeTruthy();
      // …and Sam must see neither a stroke in the doc nor one rendered.
      expect((await strokes(sam.page)).length).toBe(0);
      expect(sam.page.locator('[data-testid="stroke-object"]')).toHaveCount(0);

      // Finish the loop and release.
      await replayPath(priya.page, HANDWRITTEN_LOOP, quarter);
      await priya.page.mouse.up();
      expect(await previewD(priya.page)).toBeNull();

      // Sam sees the finished stroke within the live-update budget.
      await expectWithin(() => strokes(sam.page).then((s) => s.length), 1);
      const [mine, theirs] = [(await strokes(priya.page))[0]!, (await strokes(sam.page))[0]!];
      expect(theirs.id).toBe(mine.id);
      expect(theirs.points).toEqual(mine.points);
      expect(theirs.color).toBe(mine.color);
      expect(theirs.thickness).toBe(mine.thickness);
    } finally {
      await closeAll(priya, sam);
    }
  });

  test('TC-19 wheel pans while the pen is active; a drag starting on a sticky creates a stroke and never moves the sticky', async ({
    page,
    request,
  }) => {
    await openBoard(page, request);

    // A sticky at the board centre (world origin), edit ended.
    await page.mouse.dblclick(640, 400);
    await page.keyboard.press('Escape');
    await expect.poll(() => getNotes(page).then((n) => n.length)).toBe(1);
    const before = (await getNotes(page))[0]!;

    await page.keyboard.press('p');
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');

    // The wheel (no Ctrl) still pans the board (pen.navigation).
    const gridBefore = await gridBackgroundPosition(page);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(80);
    const gridAfter = await gridBackgroundPosition(page);
    expect(gridAfter.y).not.toBe(gridBefore.y);

    // Park the camera back at home for stable geometry.
    await setCamera(page, HOME_CAMERA);
    await page.waitForTimeout(80);

    // A drag starting on the sticky: with the pen active it draws — the
    // sticky never moves and a stroke is created (pen.over_objects).
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(760, 460, { steps: 8 });
    await page.mouse.up();

    expect((await strokes(page)).length).toBe(1);
    const after = (await getNotes(page))[0]!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  test('TC-20 select the line, resize keeps the aspect ratio within 1%, drag moves it, Delete removes it on both screens', async ({
    browser,
  }) => {
    const boardId = freshBoardId();
    const drawer = await join(browser, boardId);
    const watcher = await join(browser, boardId);
    try {
      const page = drawer.page;

      // Draw a straight stroke from world (0,0) to (200,50).
      await page.keyboard.press('p');
      await page.mouse.move(640, 400);
      await page.mouse.down();
      await page.mouse.move(840, 450, { steps: 10 });
      await page.mouse.up();
      let s = (await strokes(page))[0]!;
      expect(s).toBeDefined();
      // The watcher sees it too (live sync of the finished stroke).
      await expectWithin(() => strokes(watcher.page).then((x) => x.length), 1);

      // Switch to select and click the line (its midpoint is the bbox centre).
      await page.keyboard.press('v');
      const mid = W2S(s.x + s.width / 2, s.y + s.height / 2);
      await page.mouse.click(mid.x, mid.y);
      const seHandle = page.getByRole('button', { name: 'Resize bottom-right' });
      await expect(seHandle).toBeVisible();

      // Resize: drag the se handle by (w/4, h/4) — a uniform 1.25 scale under
      // any aspect-lock rule, so the aspect ratio must be preserved ±1% and
      // both dimensions must grow by exactly 25%.
      const aspectBefore = s.width / s.height;
      const oldW = s.width;
      const oldH = s.height;
      const se = W2S(s.x + s.width, s.y + s.height);
      await dragBy(page, s.width / 4, s.height / 4, { x: se.x, y: se.y });
      s = (await strokes(page))[0]!;
      const aspectAfter = s.width / s.height;
      expect(Math.abs(aspectAfter - aspectBefore)).toBeLessThan(0.01 * aspectBefore);
      expect(s.width).toBeGreaterThanOrEqual(oldW * 1.24);
      expect(s.width).toBeLessThanOrEqual(oldW * 1.26);
      expect(s.height).toBeGreaterThanOrEqual(oldH * 1.24);
      expect(s.height).toBeLessThanOrEqual(oldH * 1.26);
      // The base size is unchanged: geometry scales from the stored points.
      expect(s.baseWidth).toBe(oldW);
      expect(s.baseHeight).toBe(oldH);

      // Move: drag the body (the line's new midpoint) by (+100, 0).
      const mid2 = W2S(s.x + s.width / 2, s.y + s.height / 2);
      await dragBy(page, 100, 0, { x: mid2.x, y: mid2.y });
      const moved = (await strokes(page))[0]!;
      expect(moved.x).toBeCloseTo(s.x + 100, 3);
      expect(moved.y).toBeCloseTo(s.y, 3);

      // Delete: the selection bar's Delete (the stroke is still selected
      // after the move) removes it on both screens.
      await page.keyboard.press('Delete');
      await expect.poll(() => strokes(page).then((x) => x.length)).toBe(0);
      await expectWithin(() => strokes(watcher.page).then((x) => x.length), 0);

      expect(drawer.pageErrors).toEqual([]);
      expect(watcher.pageErrors).toEqual([]);
    } finally {
      await closeAll(drawer, watcher);
    }
  });
});
