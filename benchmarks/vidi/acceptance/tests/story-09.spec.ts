// Story 9 — Write free text anywhere on the board.
import { test, expect, requires, openBoard, notes, clickEmpty, box, drag, shot, mod, zoomOutBy } from './fixtures';
import type { Page } from '@playwright/test';

const PIXEL_TOLERANCE = 1.5;
const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
const LONG_SENTENCE_CHARS = 300;
const TEXT_MIN_WIDTH_WORLD = 40;

const textTool = (p: Page) => p.getByRole('button', { name: 'Text (T)' });
const selectTool = (p: Page) => p.getByRole('button', { name: 'Select (V)' });
// Text objects have no declared role; find the board element that renders exactly this text.
const textObject = (p: Page, s: string) =>
  p.getByText(s, { exact: true }).and(p.locator(':not([aria-label="Sticky note"] *)')).first();

async function placeText(p: Page, at: { x: number; y: number }, s: string) {
  await p.keyboard.press('t');
  await p.mouse.click(at.x, at.y);
  await p.keyboard.type(s);
  await p.keyboard.press('Escape');
}

test.describe('story 9 @s09', () => {
  test.beforeEach(() => requires(9));

  test('T activates Text tool; Escape returns to Select without creating @ref prd:text.tool', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('t');
    await expect(textTool(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(selectTool(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(textTool(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('golden path: place text, type, tool returns to Select, XL keeps top-left @ref prd:golden-path', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('t');
    await page.mouse.click(400, 250);
    await expect(selectTool(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('Went well');
    await page.keyboard.press('Escape');
    const t = textObject(page, 'Went well');
    await expect(t).toBeVisible();
    const b0 = await box(t);
    expect(Math.abs(b0.x - 400)).toBeLessThan(PIXEL_TOLERANCE * 4);
    await page.getByRole('button', { name: 'XL', exact: true }).click();
    await expect.poll(async () => (await box(t)).height).toBeGreaterThan(b0.height * 1.5);
    const b1 = await box(t);
    expect(Math.abs(b1.x - b0.x)).toBeLessThan(PIXEL_TOLERANCE * 4);
    await shot(page, 's09-golden');
  });

  test('auto width wraps at 600 units @ref prd:text.autowidth', async ({ page }) => {
    await openBoard(page);
    const zoom = await zoomOutBy(page, 2);
    const words = Array.from({ length: LONG_SENTENCE_CHARS / 6 }, (_, i) => `word${i % 10}`).join(' ');
    await placeText(page, { x: 200, y: 200 }, words);
    await clickEmpty(page); // (1200,750) was the Reset view button, which reset the zoom
    const w = (await box(page.getByText(/word0 word1/).first())).width;
    expect(w).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD * zoom + PIXEL_TOLERANCE * 4);
    expect(w).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD * zoom * 0.8);
  });

  test('empty text is removed when editing ends @ref prd:text.empty_removed', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('t');
    await page.mouse.click(400, 300);
    await page.keyboard.press('Escape');
    await clickEmpty(page);
    await page.keyboard.press(`${mod}+KeyA`);
    await expect(page.getByText(/\d+ selected/)).toHaveCount(0);
    await expect(page.locator('[aria-label^="Resize "]')).toHaveCount(0);
  });

  test('selected text shows only left and right handles; side handle sets width @ref prd:text.fixed_width', async ({ page }) => {
    await openBoard(page);
    await placeText(page, { x: 300, y: 300 }, 'alpha beta gamma delta');
    const t = textObject(page, 'alpha beta gamma delta');
    const before = await box(t);
    const handles = page.locator('[aria-label^="Resize "]');
    await expect(handles).toHaveCount(2);
    const right = page.locator('[aria-label="Resize e" i], [aria-label*="right" i]').first();
    const h = await box(right);
    await drag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: before.x + TEXT_MIN_WIDTH_WORLD * 2, y: h.y + h.height / 2 });
    const after = await box(t);
    expect(after.width).toBeLessThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
  });

  test('text behaves like other objects: select all + delete + undo @ref prd:text.like_objects', async ({ page }) => {
    await openBoard(page);
    await placeText(page, { x: 300, y: 300 }, 'heading');
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await page.keyboard.type('note');
    await page.keyboard.press('Escape');
    await clickEmpty(page);
    await page.keyboard.press(`${mod}+KeyA`);
    await expect(page.getByText('2 selected').first()).toBeVisible();
    await page.keyboard.press('Delete');
    await expect(page.getByText('heading', { exact: true })).toHaveCount(0);
    await expect(notes(page)).toHaveCount(0);
    await page.keyboard.press(`${mod}+KeyZ`);
    await expect(page.getByText('heading', { exact: true })).toHaveCount(1);
  });
});
