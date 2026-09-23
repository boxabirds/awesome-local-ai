// Story 11 — Sketch freehand with a pen.
import { test, expect, requires, openBoard, joinBoard, createNote, box, drag, shot, mod } from './fixtures';
import type { Page } from '@playwright/test';

const LIVE_MS = 2_000;
const PIXEL_TOLERANCE = 1.5;
const PEN_COLOURS = ['black', 'blue', 'red', 'green', 'orange', 'purple'];

const strokes = (p: Page) => p.locator('[aria-label="Drawing"]');

async function scribble(p: Page, x: number, y: number) {
  await p.mouse.move(x, y);
  await p.mouse.down();
  for (let i = 1; i <= 20; i++) await p.mouse.move(x + i * 10, y + Math.sin(i / 3) * 40);
  await p.mouse.up();
}

test.describe('story 11 @s11', () => {
  test.beforeEach(() => requires(11));

  test('golden path: P shows pen toolbar, drag draws, pen stays active @ref prd:pen.draw prd:pen.stays', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('p');
    for (const c of PEN_COLOURS) await expect(page.locator(`button[aria-label="${c} pen" i]`)).toBeVisible();
    for (const t of ['Thin', 'Medium', 'Thick']) await expect(page.getByRole('button', { name: t, exact: true })).toBeVisible();
    await scribble(page, 300, 300);
    await expect(strokes(page)).toHaveCount(1);
    await page.locator('button[aria-label="red pen" i]').click();
    await page.getByRole('button', { name: 'Thick', exact: true }).click();
    await scribble(page, 300, 500);
    await expect(strokes(page)).toHaveCount(2);
    await shot(page, 's11-golden');
  });

  test('click without moving draws a dot @ref prd:pen.dot', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('p');
    await page.mouse.click(500, 400);
    await expect(strokes(page)).toHaveCount(1);
  });

  test('pen drag over a note neither pans nor moves the note @ref prd:pen.navigation', async ({ page }) => {
    await openBoard(page);
    const n = await createNote(page, { x: 500, y: 400 }, 'under');
    const b0 = await box(n);
    await page.keyboard.press('p');
    await drag(page, { x: b0.x + 20, y: b0.y + 20 }, { x: b0.x + 180, y: b0.y + 150 });
    const b1 = await box(n);
    expect(Math.abs(b1.x - b0.x)).toBeLessThan(PIXEL_TOLERANCE);
    expect(Math.abs(b1.y - b0.y)).toBeLessThan(PIXEL_TOLERANCE);
    await page.mouse.move(900, 600);
    await page.mouse.wheel(0, 100);
    await expect.poll(async () => (await box(n)).y).toBeLessThan(b0.y);
  });

  test('finished strokes reach the other person @ref prd:pen.share', async ({ newPerson }) => {
    const a = await newPerson();
    const b = await newPerson();
    const url = await openBoard(a);
    await joinBoard(b, url);
    await a.keyboard.press('p');
    await scribble(a, 300, 300);
    await expect(strokes(b)).toHaveCount(1, { timeout: LIVE_MS });
  });

  test('stroke is selectable, deletable and undoable @ref prd:pen.select', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('p');
    await scribble(page, 300, 300);
    await page.keyboard.press('Escape');
    await page.keyboard.press(`${mod}+KeyA`);
    await page.keyboard.press('Delete');
    await expect(strokes(page)).toHaveCount(0);
    await page.keyboard.press(`${mod}+KeyZ`);
    await expect(strokes(page)).toHaveCount(1);
  });
});
