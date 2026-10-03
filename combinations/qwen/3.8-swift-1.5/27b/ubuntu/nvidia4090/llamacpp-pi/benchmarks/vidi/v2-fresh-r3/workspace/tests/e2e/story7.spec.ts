import { test, expect } from '@playwright/test';
import {
  openBoardPath,
  createNotesAt,
  getNotesState,
  noteBox,
  dragScreen,
  handleBox,
} from './helpers/board';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

/**
 * Story 7 — multi-selection E2E (TC-32, TC-33, TC-34, TC-36).
 *
 * At the default camera (0,0,1) world coordinates equal screen coordinates,
 * so notes created at world (x, y) are centred on screen (x, y).
 */
test.describe('select/move/resize/delete several objects at once (story 7, e2e)', () => {
  test('TC-32: shift-click selects two; dragging one moves both by the same delta', async ({ page }) => {
    await openBoardPath(page.context().request, page);
    const [a, b] = await createNotesAt(page, [
      { x: 200, y: 200 },
      { x: 600, y: 200 },
    ]);
    const before = new Map((await getNotesState(page)).map((n) => [n.id, n]));

    // select a, then shift-click b
    await page.mouse.click(200, 200);
    await page.locator(`[data-note-id="${b}"]`).click({ modifiers: ['Shift'] });

    await expect(page.locator(`[data-note-id="${a}"]`)).toHaveAttribute('data-selected', 'true');
    await expect(page.locator(`[data-note-id="${b}"]`)).toHaveAttribute('data-selected', 'true');
    // the bar (not the single-note toolbar) is shown for a multi-selection
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    await expect(page.getByTestId('selection-count')).toHaveText('2 selected');

    // drag a by (80, 40) → both move by the same delta
    await dragScreen(page, 200, 200, 80, 40);

    const after = new Map((await getNotesState(page)).map((n) => [n.id, n]));
    expect(after.get(a)!.x - before.get(a)!.x).toBeCloseTo(80, 0);
    expect(after.get(a)!.y - before.get(a)!.y).toBeCloseTo(40, 0);
    expect(after.get(b)!.x - before.get(b)!.x).toBeCloseTo(80, 0);
    expect(after.get(b)!.y - before.get(b)!.y).toBeCloseTo(40, 0);
  });

  test('TC-33: dragging a corner handle resizes the selected note', async ({ page }) => {
    await openBoardPath(page.context().request, page);
    const [a] = await createNotesAt(page, [{ x: 200, y: 200 }]); // 200×200, left-top (100,100)
    const before = (await getNotesState(page))[0];

    await page.mouse.click(200, 200); // select
    const hb = await handleBox(page, 'se');
    const hx = hb.x + hb.width / 2;
    const hy = hb.y + hb.height / 2;

    // drag the SE handle by (50, 50) → 250×250 from the same top-left
    await dragScreen(page, hx, hy, 50, 50);

    const after = (await getNotesState(page))[0];
    const box = await noteBox(page, a);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(box.width).toBeCloseTo(250, 0);
    expect(box.height).toBeCloseTo(250, 0);
  });

  test('TC-34: two selected — the bar’s Delete button removes both and clears the selection', async ({
    page,
  }) => {
    await openBoardPath(page.context().request, page);
    const [a, b] = await createNotesAt(page, [
      { x: 200, y: 200 },
      { x: 600, y: 200 },
    ]);

    await page.mouse.click(200, 200);
    await page.locator(`[data-note-id="${b}"]`).click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('selection-bar')).toBeVisible();

    await page.getByTestId('delete-selection-button').click();

    await expect(page.locator(`[data-note-id="${a}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-note-id="${b}"]`)).toHaveCount(0);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
    expect(await getNotesState(page)).toHaveLength(0);
  });

  test('TC-36: resizing cannot shrink a sticky below its minimum size', async ({ page }) => {
    await openBoardPath(page.context().request, page);
    const [a] = await createNotesAt(page, [{ x: 300, y: 300 }]); // 200×200
    await page.mouse.click(300, 300); // select

    // drag the SE handle far past the minimum (towards the top-left)
    const hb = await handleBox(page, 'se');
    await dragScreen(page, hb.x + hb.width / 2, hb.y + hb.height / 2, -400, -400);

    const box = await noteBox(page, a);
    expect(box.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0);
    expect(box.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0);
  });
});
