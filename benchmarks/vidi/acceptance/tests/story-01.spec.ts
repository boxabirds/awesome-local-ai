// Story 1 — Pan and zoom around an infinite board.
import { test, expect, requires, openBoard, zoomLabel, zoomPercent, hint, notes, createNote,
         box, drag, shot, mod, BOARD_CENTRE, zoomStep } from './fixtures';

const ZOOM_STEP_PCT = 125;
const ZOOM_MIN_PCT = 10;
const ZOOM_MAX_PCT = 400;
const MAX_STEPS = 30;
const PIXEL_TOLERANCE = 1.5;

test.describe('story 1 @s01', () => {
  test.beforeEach(() => requires(1));

  test('golden path: controls and hint visible at 100% @ref prd:golden-path', async ({ page }) => {
    await openBoard(page);
    await expect(hint(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
    expect(await zoomPercent(page)).toBe(100);
    await shot(page, 's01-golden');
  });

  test('zoom buttons step 100 → 125 → 100 @ref prd:zoom.step', async ({ page }) => {
    await openBoard(page);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_STEP_PCT}%`);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
  });

  test('zoom limits clamp and disable buttons @ref prd:zoom.limits', async ({ page }) => {
    await openBoard(page);
    const out = page.getByRole('button', { name: 'Zoom out' });
    const inn = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < MAX_STEPS && await out.isEnabled(); i++) await zoomStep(page, 'Zoom out');
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_MIN_PCT}%`);
    await expect(out).toBeDisabled();
    for (let i = 0; i < MAX_STEPS && await inn.isEnabled(); i++) await zoomStep(page, 'Zoom in');
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_MAX_PCT}%`);
    await expect(inn).toBeDisabled();
    await expect(out).toBeEnabled();
  });

  test('keyboard zoom and reset do not zoom the page @ref prd:zoom.no_page_zoom', async ({ page }) => {
    await openBoard(page);
    await page.mouse.click(BOARD_CENTRE.x, BOARD_CENTRE.y);
    const zoomOutBox = await box(page.getByRole('button', { name: 'Zoom out' }));
    await page.keyboard.press(`${mod}+Equal`);
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_STEP_PCT}%`);
    await page.keyboard.press(`${mod}+Digit0`);
    await expect(zoomLabel(page)).toHaveText('100%');
    const after = await box(page.getByRole('button', { name: 'Zoom out' }));
    expect(Math.abs(after.width - zoomOutBox.width)).toBeLessThan(PIXEL_TOLERANCE);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
  });

  test('ctrl+wheel zooms the board @ref prd:zoom.pointer', async ({ page }) => {
    await openBoard(page);
    await page.mouse.move(BOARD_CENTRE.x, BOARD_CENTRE.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(100);
  });

  test('hint disappears after first pan and stays gone @ref prd:nav.hint', async ({ page }) => {
    await openBoard(page);
    await expect(hint(page)).toBeVisible();
    await drag(page, BOARD_CENTRE, { x: BOARD_CENTRE.x + 100, y: BOARD_CENTRE.y + 50 });
    await expect(hint(page)).toBeHidden();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(hint(page)).toBeHidden();
  });

  test('drag pans content exactly with the pointer @ref prd:pan.drag', async ({ page }) => {
    requires(2);
    await openBoard(page);
    const note = await createNote(page, { x: 500, y: 300 }, 'anchor');
    const before = await box(note);
    await drag(page, { x: 900, y: 600 }, { x: 1100, y: 700 });
    const after = await box(note);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThan(PIXEL_TOLERANCE);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThan(PIXEL_TOLERANCE);
  });

  test('wheel scroll pans in scroll direction @ref prd:pan.scroll', async ({ page }) => {
    requires(2);
    await openBoard(page);
    const note = await createNote(page, { x: 500, y: 300 }, 'anchor');
    const before = await box(note);
    await page.mouse.move(900, 600);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await box(note)).y).toBeLessThan(before.y);
  });

  test('zoom keeps the point under the pointer fixed @ref prd:zoom.pointer', async ({ page }) => {
    requires(2);
    await openBoard(page);
    const note = await createNote(page, { x: 500, y: 300 }, 'anchor');
    const b = await box(note);
    const pointer = { x: b.x + 10, y: b.y + 10 };
    await page.mouse.move(pointer.x, pointer.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -150);
    await page.keyboard.up('Control');
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(100);
    const z = (await zoomPercent(page)) / 100;
    const after = await box(note);
    // The note's top-left is 10 screen px from the pointer before; after zoom it is 10*z px away.
    expect(Math.abs(pointer.x - after.x - 10 * z)).toBeLessThan(z * 2);
    expect(Math.abs(pointer.y - after.y - 10 * z)).toBeLessThan(z * 2);
  });

  test('reset view returns to 100% with origin centred @ref prd:view.reset', async ({ page }) => {
    requires(2);
    await openBoard(page);
    await page.getByRole('button', { name: 'Reset view' }).click();
    const note = await createNote(page, BOARD_CENTRE, 'origin');
    const home = await box(note);
    await drag(page, { x: 1000, y: 650 }, { x: 300, y: 100 });
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    const back = await box(note);
    expect(Math.abs(back.x - home.x)).toBeLessThan(PIXEL_TOLERANCE);
    expect(Math.abs(back.y - home.y)).toBeLessThan(PIXEL_TOLERANCE);
    await expect(notes(page)).toHaveCount(1);
  });
});
