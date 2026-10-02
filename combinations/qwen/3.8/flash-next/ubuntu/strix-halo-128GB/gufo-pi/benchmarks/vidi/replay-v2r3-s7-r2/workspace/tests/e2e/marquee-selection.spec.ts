import { test, expect, type Page } from '@playwright/test';
import { addStickyAt, getBoard, getSelectedIds, marquee, selectionBarText } from './helpers/board';

/**
 * Story 7, TC-32: a marquee selects what lies fully inside it. The same file runs
 * in chromium, firefox and webkit, because pixel containment must hold in every
 * engine's layout.
 */

async function createBoard(): Promise<string> {
  const res = await fetch('http://localhost:5173/api/boards', { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/boards failed: ${res.status}`);
  const { id } = await res.json();
  return id;
}

async function expectSelected(page: Page, ids: string[]): Promise<void> {
  await expect
    .poll(async () => (await getSelectedIds(page)).slice().sort().join(','), { timeout: 10000 })
    .toBe([...ids].sort().join(','));
}

test.describe('Story 7: marquee selection', () => {
  test.beforeEach(async ({ page }) => {
    const id = await createBoard();
    await page.goto(`/b/${id}`);
    await page.waitForSelector('[data-testid="board-viewport"]');
  });

  test('TC-32: a marquee selects only what lies fully inside it', async ({ page }) => {
    const a = await addStickyAt(page, { x: 300, y: 300 }); // 200..400
    const b = await addStickyAt(page, { x: 450, y: 300 }); // 350..550
    const c = await addStickyAt(page, { x: 700, y: 650 }); // 600..800
    await expect.poll(() => getBoard(page)).toHaveLength(3);

    await marquee(page, { x: 150, y: 150 }, { x: 500, y: 450 });
    await expectSelected(page, [a]);

    // Widening the box adds the note it now fully holds, and keeps the first.
    await marquee(page, { x: 150, y: 150 }, { x: 600, y: 500 });
    await expectSelected(page, [a, b]);

    // A note only touched by the box is never selected.
    expect((await getSelectedIds(page)).includes(c)).toBe(false);
    // The bar keeps its own count of the group. Polled through the page rather than
    // a locator, so a busy renderer cannot report a half-read node.
    await expect.poll(() => selectionBarText(page)).toContain('2 selected');
  });

  test('TC-32: the marquee box is drawn while dragging and gone afterwards', async ({ page }) => {
    await addStickyAt(page, { x: 300, y: 300 });
    await page.keyboard.down('Shift');
    await page.mouse.move(120, 120);
    await page.mouse.down();
    await page.mouse.move(520, 520, { steps: 6 });
    await expect(page.getByTestId('marquee-rect')).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('marquee-rect')).toHaveCount(0);
  });


});
