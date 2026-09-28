/**
 * E2E tests for story 7 — multi-select, group move/resize, marquee, keyboard.
 * Runs against the test-mode build served by `wrangler dev`.
 */
import { expect, test, type Page } from '@playwright/test';
import { boardLocator, readCamera, type Dot } from './helpers/board';
import { NUDGE_STEP_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const centre = (b: Box): Dot => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function noteBoxes(page: Page): Promise<string[]> {
  return page.locator('[data-note-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-note-id')!));
}
async function boxOf(page: Page, id: string): Promise<Box> {
  const b = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (!b) throw new Error(`note ${id} not visible`);
  return b;
}

/** Create a board via the home page and wait for the camera to settle. */
async function waitForBoard(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a board' }).click();
  await expect(boardLocator(page)).toBeVisible();
  await expect
    .poll(
      async () => {
        const cam = await boardLocator(page).evaluate((el) => ({
          x: Number(el.dataset.cameraX),
          y: Number(el.dataset.cameraY),
        }));
        return cam.x !== 0 || cam.y !== 0;
      },
      { timeout: 4000 },
    )
    .toBe(true);
}

/** Create a note centred on a screen point (and leave edit mode). */
async function createNote(page: Page, at: Dot): Promise<void> {
  await page.mouse.dblclick(at.x, at.y);
  await page.keyboard.press('Escape');
}

/** Drag the mouse while holding Shift (for marquee selection). */
async function shiftDrag(page: Page, from: Dot, to: Dot): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(60);
}

test.describe('story 7 multi-selection', () => {
  test('reorganise a cluster: group move preserves relative layout', async ({ page }) => {
    await waitForBoard(page);
    await createNote(page, { x: 300, y: 300 });
    await createNote(page, { x: 300, y: 700 });
    await createNote(page, { x: 800, y: 300 });
    const ids = await noteBoxes(page);
    expect(ids).toHaveLength(3);

    // Select all and drag one member: the whole group moves together.
    await page.keyboard.press('Control+a');
    await expect(page.getByTestId('selection-count')).toHaveText('3 selected');

    const before = new Map<string, Dot>();
    for (const id of ids) before.set(id, centre(await boxOf(page, id)));

    const grab = centre(await boxOf(page, ids[0]));
    const dx = 120;
    const dy = -90;
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + dx / 2, grab.y + dy / 2, { steps: 6 });
    await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(60);

    for (const id of ids) {
      const moved = centre(await boxOf(page, id));
      const origin = before.get(id)!;
      expect(Math.round(moved.x - origin.x)).toBe(dx);
      expect(Math.round(moved.y - origin.y)).toBe(dy);
    }
  });

  test('keyboard: select-all nudges the group, Delete removes all', async ({ page }) => {
    await waitForBoard(page);
    await createNote(page, { x: 300, y: 300 });
    await createNote(page, { x: 700, y: 500 });
    const ids = await noteBoxes(page);
    expect(ids).toHaveLength(2);

    await page.keyboard.press('Control+a');
    await expect(page.getByTestId('selection-count')).toHaveText('2 selected');

    const cam = await readCamera(page);
    const before = await boxOf(page, ids[0]);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(40);
    const after = await boxOf(page, ids[0]);
    // Screen delta equals world step scaled by zoom.
    expect(Math.round(after.x - before.x)).toBe(Math.round(NUDGE_STEP_WORLD * cam.zoom));

    await page.keyboard.press('Delete');
    await expect(page.locator('[data-note-id]')).toHaveCount(0);
    await expect(page.getByTestId('selection-count')).toHaveCount(0);
  });

  test('marquee selects a subset and leaves the outside note unselected', async ({ page }) => {
    await waitForBoard(page);
    await createNote(page, { x: 300, y: 300 }); // A
    await createNote(page, { x: 300, y: 500 }); // B
    await createNote(page, { x: 950, y: 300 }); // C (kept out of the marquee)
    expect(await noteBoxes(page)).toHaveLength(3);

    // Clear any selection left behind by note creation.
    await page.mouse.click(700, 720);
    await expect(page.getByTestId('selection-count')).toHaveCount(0);

    // Shift-drag a rectangle fully enclosing A and B (each spans 200px) only.
    await shiftDrag(page, { x: 190, y: 190 }, { x: 410, y: 610 });
    await expect(page.getByTestId('selection-count')).toHaveText('2 selected');

    const selected = await page.locator('[data-note-id][data-selected="true"]').count();
    expect(selected).toBe(2);
  });

  test('resize handle clamps a sticky to its minimum size', async ({ page }) => {
    await waitForBoard(page);
    await createNote(page, { x: 500, y: 400 });
    const id = (await noteBoxes(page))[0];
    const cam = await readCamera(page);

    const box = await boxOf(page, id);
    await page.mouse.click(centre(box).x, centre(box).y);
    const handle = page.locator('[data-resize-handle="se"]');
    await expect(handle).toBeVisible();

    const h = await handle.boundingBox();
    if (!h) throw new Error('handle not visible');
    // Drag the SE corner well toward the anchor (past the minimum).
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x - 150, h.y - 150, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(60);

    const shrunk = await boxOf(page, id);
    expect(Math.round(shrunk.width)).toBe(Math.round(STICKY_MIN_SIZE_WORLD * cam.zoom));
  });
});
