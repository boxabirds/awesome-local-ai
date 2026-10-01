import { expect, test, type Locator, type Page } from '@playwright/test';
import { getCamera, setCamera, settled } from './helpers/board';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { LONG_TEXT } from '../fixtures/texts';

const TOL = 1;
const notes = (page: Page) => page.getByRole('group', { name: 'Sticky note' });

async function worldPos(note: Locator): Promise<{ x: number; y: number }> {
  return note.evaluate((el) => ({ x: Number(el.getAttribute('data-x')), y: Number(el.getAttribute('data-y')) }));
}

async function rgb(note: Locator): Promise<string> {
  return note.evaluate((el) => getComputedStyle(el).backgroundColor);
}

function toRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  await settled(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await settled(page);
});

test('workflow 1: brainstorm golden path (TC-30, TC-31)', async ({ page }) => {
  await page.mouse.dblclick(400, 300);
  await page.keyboard.type('Hello');
  const note = notes(page).first();
  await expect(note.locator('textarea')).toBeFocused();
  const box = (await note.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 400)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(box.y + box.height / 2 - 300)).toBeLessThanOrEqual(TOL);
  expect(await rgb(note)).toBe(toRgb(STICKY_COLORS.yellow));

  await page.mouse.click(900, 600); // empty board ends editing and deselects
  await expect(note).toContainText('Hello');
  await expect(note).toHaveAttribute('data-selected', 'false');

  // zoom to 50% about the screen centre via the camera hook, then drag
  const cam = await getCamera(page);
  await setCamera(page, { x: cam.x, y: cam.y, zoom: 0.5 });
  await settled(page);
  const start = await worldPos(note);
  const b = (await note.boundingBox())!;
  const grab = { x: b.x + 30, y: b.y + 40 };
  await drag(page, grab, 100, 50);
  const end = await worldPos(note);
  expect(end.x - start.x).toBeCloseTo(200, 0);
  expect(end.y - start.y).toBeCloseTo(100, 0);
  const b2 = (await note.boundingBox())!;
  expect(Math.abs(b2.x + 30 - (grab.x + 100))).toBeLessThanOrEqual(TOL);
  expect(Math.abs(b2.y + 40 - (grab.y + 50))).toBeLessThanOrEqual(TOL);
  expect(await getCamera(page)).toEqual({ x: cam.x, y: cam.y, zoom: 0.5 });
  await expect(note).toHaveAttribute('data-selected', 'true');

  await page.getByRole('button', { name: 'Green colour' }).click();
  expect(await rgb(note)).toBe(toRgb(STICKY_COLORS.green));
  await expect(note).toHaveAttribute('data-selected', 'true');

  await page.keyboard.press('Delete');
  await expect(notes(page)).toHaveCount(0);
});

test('TC-32 drag at 200% zoom and stacking', async ({ page }) => {
  const cam = await getCamera(page);
  await setCamera(page, { x: cam.x, y: cam.y, zoom: 2 });
  await settled(page);
  await page.mouse.dblclick(300, 300);
  await page.keyboard.press('Escape');
  await page.mouse.dblclick(650, 330);
  await page.keyboard.press('Escape');
  const ids = await page.locator('.sticky-note').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')!));
  const first = page.locator(`[data-id="${ids[0]}"]`);
  const start = await worldPos(first);
  const b = (await first.boundingBox())!;
  await drag(page, { x: b.x + 20, y: b.y + 20 }, 100, 50);
  const end = await worldPos(first);
  expect(end.x - start.x).toBeCloseTo(50, 0);
  expect(end.y - start.y).toBeCloseTo(25, 0);
  // the dragged note is now above the overlapped one: the point they share hits the dragged note
  const overlap = (await first.boundingBox())!;
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-sticky]')?.getAttribute('data-id'),
    [overlap.x + overlap.width - 5, overlap.y + overlap.height / 2],
  );
  expect(hit).toBe(ids[0]);
  const z = await page.locator('.sticky-note').evaluateAll(
    (els) => els.map((e) => [e.getAttribute('data-id'), Number(getComputedStyle(e).zIndex)]),
  );
  const zOf = (id: string) => z.find(([i]) => i === id)![1] as number;
  expect(zOf(ids[0])).toBeGreaterThan(zOf(ids[1]));
});

test('TC-33 text shrinks to the minimum, then clips with a fade', async ({ page }) => {
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await page.keyboard.type('Word');
  const note = notes(page).first();
  const text = note.locator('.sticky-text');
  await expect(text).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);

  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(LONG_TEXT);
  await expect(note.getByTestId('sticky-counter')).toHaveText('1000/1000');
  const size = parseFloat(await text.evaluate((el) => getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(size).toBeLessThan(STICKY_FONT_MAX_PX);
  await expect(note.locator('.sticky-fade')).toHaveCount(1);
  const noteBox = (await note.boundingBox())!;
  const boxBox = (await note.locator('.sticky-text-box').boundingBox())!;
  expect(boxBox.y + boxBox.height).toBeLessThanOrEqual(noteBox.y + noteBox.height + 0.5);
  expect(boxBox.width).toBeLessThanOrEqual(STICKY_SIZE_WORLD);
});

test('TC-34 button creates a note at screen centre after panning far away', async ({ page }) => {
  const cam = await getCamera(page);
  await setCamera(page, { ...cam, x: cam.x + 500_000, y: cam.y - 300_000 });
  await settled(page);
  await page.getByRole('button', { name: 'Sticky note' }).click();
  const box = (await notes(page).first().boundingBox())!;
  const vp = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(box.y + box.height / 2 - vp.height / 2)).toBeLessThanOrEqual(TOL);
  await page.keyboard.type('far away');
  await expect(notes(page).first().locator('textarea')).toHaveValue('far away');
});
