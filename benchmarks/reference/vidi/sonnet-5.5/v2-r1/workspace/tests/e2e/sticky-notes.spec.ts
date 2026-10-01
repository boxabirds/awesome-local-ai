import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { LONG_TEXT } from '../fixtures/texts';
import { openBoard, setCamera } from './helpers/board';

const TOLERANCE_PX = 1;
const VIEWPORT = { width: 1280, height: 800 };

const notes = (page: Page) => page.getByRole('group', { name: 'Sticky note' });

async function centre(page: Page, index = 0) {
  const box = await notes(page).nth(index).boundingBox();
  if (!box) throw new Error('note not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height };
}

async function worldPos(page: Page, index = 0) {
  return notes(page)
    .nth(index)
    .evaluate((el) => ({ x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top) }));
}

async function createAt(page: Page, x: number, y: number) {
  await page.mouse.dblclick(x, y);
  await expect(page.getByRole('textbox')).toBeFocused();
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

test.describe('sticky notes', () => {
  test('brainstorm golden path: create, move at 50%, recolour, delete', async ({ page }) => {
    await openBoard(page);
    // TC-30
    await createAt(page, 400, 300);
    await page.keyboard.type('Hello');
    let c = await centre(page);
    expect(Math.abs(c.x - 400)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(c.y - 300)).toBeLessThanOrEqual(TOLERANCE_PX);
    await expect(notes(page).first()).toContainText('Hello');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(notes(page).first()).toContainText('Hello');

    // TC-31: 50% zoom, camera keeps the origin centred
    await setCamera(page, { x: -VIEWPORT.width, y: -VIEWPORT.height, zoom: 0.5 });
    c = await centre(page);
    expect(c.width).toBeCloseTo(STICKY_SIZE_WORLD * 0.5, 0);
    const before = await worldPos(page);
    const grab = { x: c.x + 20, y: c.y + 10 };
    await drag(page, grab, 100, 50);
    const after = await centre(page);
    expect(Math.abs(after.x - (c.x + 100))).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(after.y - (c.y + 50))).toBeLessThanOrEqual(TOLERANCE_PX);
    const moved = await worldPos(page);
    expect(moved.x - before.x).toBeCloseTo(200, 0);
    expect(moved.y - before.y).toBeCloseTo(100, 0);

    // Dragging a note never pans.
    expect((await page.evaluate(() => window.__vidi6?.getCamera()))?.x).toBe(-VIEWPORT.width);

    // Recolour
    await page.getByRole('button', { name: 'Green colour' }).click();
    await expect(notes(page).first()).toHaveCSS('background-color', hexToRgb(STICKY_COLORS.green));
    await expect(notes(page).first()).toHaveAttribute('data-selected', 'true');
    await expect(notes(page).first()).toContainText('Hello');

    // Delete
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(0);
  });

  test('TC-32 drag at 200% moves 50,25 world units and draws above an overlapped note', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: -VIEWPORT.width / 4, y: -VIEWPORT.height / 4, zoom: 2 });
    await createAt(page, 400, 400);
    await page.keyboard.press('Escape');
    await createAt(page, 800, 400);
    await page.keyboard.press('Escape');
    await page.mouse.click(1200, 100);
    const dragged = page.locator('[data-sticky-note][data-selected=true]');
    const leftOf = (loc: typeof dragged) =>
      loc.evaluate((el) => ({ x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top) }));
    const grabbedId = await page.evaluate(
      () => (document.elementFromPoint(400, 400)?.closest('[data-sticky-note]') as HTMLElement).dataset.noteId,
    );
    const mover = page.locator(`[data-note-id="${grabbedId}"]`);
    const before = await leftOf(mover);
    await drag(page, { x: 400, y: 400 }, 100, 50);
    await expect(dragged).toHaveCount(1);
    await expect.poll(async () => (await leftOf(mover)).x - before.x).toBeCloseTo(50, 0);
    await expect.poll(async () => (await leftOf(mover)).y - before.y).toBeCloseTo(25, 0);
    // The overlap region (x 600..700 on screen) shows the dragged note on top.
    await expect
      .poll(() =>
        page.evaluate(
          () => (document.elementFromPoint(650, 450)?.closest('[data-sticky-note]') as HTMLElement | null)?.dataset.noteId,
        ),
      )
      .toBe(grabbedId);
  });

  test('TC-33 text shrinks to fit, then clips with a fade at the minimum size', async ({ page }) => {
    await openBoard(page);
    await createAt(page, 640, 400);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
    const text = page.getByTestId('sticky-text');
    await expect(text).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);
    await expect(page.getByTestId('sticky-fade')).toHaveCount(0);

    await page.keyboard.press('Enter');
    await page.getByRole('textbox').fill(LONG_TEXT);
    await expect(page.getByTestId('sticky-counter')).toHaveText('1000/1000');
    await page.keyboard.press('Escape');
    const size = parseFloat(await text.evaluate((el) => getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(size).toBeLessThan(STICKY_FONT_MAX_PX);
    await expect(page.getByTestId('sticky-fade')).toBeVisible();
    // Nothing is drawn outside the note: it clips its overflow.
    await expect(notes(page).first()).toHaveCSS('overflow', 'hidden');
    expect(await text.evaluate((el) => el.scrollHeight >= el.clientHeight)).toBe(true);
  });

  test('TC-34 toolbar creates a visible, centred note after panning far away', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 500_000, y: -300_000, zoom: 1 });
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await expect(page.getByRole('textbox')).toBeFocused();
    const c = await centre(page);
    expect(Math.abs(c.x - VIEWPORT.width / 2)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(c.y - VIEWPORT.height / 2)).toBeLessThanOrEqual(TOLERANCE_PX);
    await page.keyboard.type('Far away');
    await expect(notes(page).first()).toContainText('Far away');
  });
});

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
