// Story 8 — Undo and redo my own changes without undoing anyone else's.
import { test, expect, requires, openBoard, joinBoard, notes, createNote, clickEmpty, box, drag, shot, mod } from './fixtures';

const LIVE_MS = 2_000;
const PIXEL_TOLERANCE = 1.5;
const TYPING_PAUSE_MS = 700;

test.describe('story 8 @s08', () => {
  test.beforeEach(() => requires(8));

  test('buttons disabled with empty history @ref prd:undo.buttons', async ({ page }) => {
    await openBoard(page);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  test('golden path: undo group delete restores all, redo deletes again @ref prd:golden-path', async ({ page }) => {
    await openBoard(page);
    for (let i = 0; i < 4; i++) await createNote(page, { x: 250 + i * 230, y: 300 }, `u${i}`);
    await clickEmpty(page);
    await page.keyboard.press(`${mod}+KeyA`);
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(0);
    await page.keyboard.press(`${mod}+KeyZ`);
    await expect(notes(page)).toHaveCount(4);
    await shot(page, 's08-restored');
    await page.keyboard.press(`${mod}+Shift+KeyZ`);
    await expect(notes(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(notes(page)).toHaveCount(4);
  });

  test('a whole drag is one step @ref prd:undo.steps', async ({ page }) => {
    await openBoard(page);
    const a = await createNote(page, { x: 400, y: 300 }, 'dragme');
    const a0 = await box(a);
    await drag(page, { x: a0.x + 20, y: a0.y + 20 }, { x: a0.x + 320, y: a0.y + 120 }, { steps: 25 });
    await clickEmpty(page);
    await page.keyboard.press(`${mod}+KeyZ`);
    const a1 = await box(a);
    expect(Math.abs(a1.x - a0.x)).toBeLessThan(PIXEL_TOLERANCE);
    expect(Math.abs(a1.y - a0.y)).toBeLessThan(PIXEL_TOLERANCE);
    await expect(notes(page)).toHaveCount(1);
  });

  test('new change clears redo @ref prd:undo.redo_cleared', async ({ page }) => {
    await openBoard(page);
    await createNote(page, { x: 400, y: 300 }, 'first');
    await clickEmpty(page);
    await page.keyboard.press(`${mod}+KeyZ`);
    await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
    await createNote(page, { x: 700, y: 300 }, 'second');
    await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  test('typing bursts undo separately while editing @ref prd:undo.typing', async ({ page }) => {
    await openBoard(page);
    await page.mouse.dblclick(400, 300);
    await page.keyboard.type('one');
    await page.waitForTimeout(TYPING_PAUSE_MS);
    await page.keyboard.type(' two');
    await page.keyboard.press(`${mod}+KeyZ`);
    await page.keyboard.press('Escape');
    await expect(notes(page).first()).toContainText('one');
    await expect(notes(page).first()).not.toContainText('two');
  });

  test('undo does not reverse other people\'s changes @ref prd:undo.own_only', async ({ newPerson }) => {
    const mia = await newPerson();
    const raj = await newPerson();
    const url = await openBoard(mia);
    await joinBoard(raj, url);
    const a = await createNote(mia, { x: 300, y: 300 }, 'miaA');
    await clickEmpty(mia);
    const a0 = await box(a);
    await drag(mia, { x: a0.x + 20, y: a0.y + 20 }, { x: a0.x + 220, y: a0.y + 20 });
    await expect(notes(raj).filter({ hasText: 'miaA' })).toHaveCount(1, { timeout: LIVE_MS });
    await createNote(raj, { x: 900, y: 500 }, 'rajB');
    await expect(notes(mia).filter({ hasText: 'rajB' })).toHaveCount(1, { timeout: LIVE_MS });
    await clickEmpty(mia);
    await mia.keyboard.press(`${mod}+KeyZ`);
    await expect.poll(async () => Math.abs((await box(a)).x - a0.x), { timeout: LIVE_MS }).toBeLessThan(PIXEL_TOLERANCE);
    await expect(notes(mia).filter({ hasText: 'rajB' })).toHaveCount(1);
    await expect(notes(raj).filter({ hasText: 'rajB' })).toHaveCount(1);
  });

  test('history does not survive reload @ref prd:undo.no_reload', async ({ page }) => {
    await openBoard(page);
    await createNote(page, { x: 400, y: 300 }, 'persisted');
    await page.waitForTimeout(LIVE_MS);
    await page.reload();
    await expect(notes(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
});
