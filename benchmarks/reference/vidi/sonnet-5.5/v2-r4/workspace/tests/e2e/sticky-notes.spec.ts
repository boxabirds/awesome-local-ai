import { expect, test, type Locator, type Page } from '@playwright/test';
import { STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { LONG_TEXT } from '../fixtures/texts';
import { openNewBoard, setCamera } from './helpers/board';

const TOL = 1;

const notes = (page: Page) => page.getByRole('group', { name: 'Sticky note' });

async function centre(loc: Locator) {
  const b = (await loc.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}

async function worldPos(loc: Locator) {
  return loc.evaluate((el) => ({ x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top) }));
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await openNewBoard(page);
  await page.getByTestId('board-viewport').waitFor();
});

test('brainstorm golden path: create, move at 50%, recolour, delete', async ({ page }) => {
  // TC-30
  await page.mouse.dblclick(400, 300);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  const note = notes(page).first();
  await expect(note).toContainText('Hello');
  const c = await centre(note);
  expect(Math.abs(c.x - 400)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(c.y - 300)).toBeLessThanOrEqual(TOL);
  await expect(note).toHaveCSS('background-color', 'rgb(255, 245, 157)');

  // TC-31: 50% zoom
  await page.mouse.click(900, 600);
  await setCamera(page, -400 * 2 + 400 / 1, -300 * 2 + 300 / 1, 0.5);
  await page.waitForTimeout(100);
  const before = await worldPos(note);
  const grab = await centre(note);
  await dragBy(page, grab, 100, 50);
  const after = await centre(note);
  expect(Math.abs(after.x - grab.x - 100)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(after.y - grab.y - 50)).toBeLessThanOrEqual(TOL);
  const w = await worldPos(note);
  expect(Math.abs(w.x - before.x - 200)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(w.y - before.y - 100)).toBeLessThanOrEqual(TOL);

  // recolour
  await expect(note).toHaveAttribute('data-selected', 'true');
  await page.getByRole('button', { name: 'Green colour' }).click();
  await expect(note).toHaveCSS('background-color', 'rgb(197, 225, 165)');
  await expect(note).toHaveAttribute('data-selected', 'true');

  // delete
  await page.keyboard.press('Delete');
  await expect(notes(page)).toHaveCount(0);
});

test('TC-32 dragging at 200% moves by delta/zoom and draws on top', async ({ page }) => {
  const vp = page.viewportSize()!;
  await setCamera(page, -vp.width / 4, -vp.height / 4, 2);
  await page.waitForTimeout(100);
  await page.mouse.dblclick(500, 300);
  await page.keyboard.press('Escape');
  await page.mouse.dblclick(800, 300);
  await page.keyboard.press('Escape');
  await page.mouse.click(1100, 650);
  await expect(notes(page)).toHaveCount(2);
  const firstId = (await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="group"]')?.getAttribute('data-note-id'),
    { x: 350, y: 200 },
  ))!;
  const first = page.locator(`[data-note-id="${firstId}"]`);
  const before = await worldPos(first);
  await dragBy(page, { x: 350, y: 200 }, 100, 50);
  const w = await worldPos(first);
  expect(Math.abs(w.x - before.x - 50)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(w.y - before.y - 25)).toBeLessThanOrEqual(TOL);
  const topId = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="group"]')?.getAttribute('data-note-id'), { x: 650, y: 350 });
  expect(topId).toBe(firstId);
});

test('TC-33 text shrinks to fit then clips with a fade', async ({ page }) => {
  await page.mouse.dblclick(500, 350);
  await page.keyboard.type('Hello');
  const text = page.getByTestId('note-text');
  await expect(text).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);
  await page.getByRole('textbox').fill(LONG_TEXT);
  await expect(page.getByTestId('char-counter')).toHaveText(`${LONG_TEXT.length}/1000`);
  const px = parseFloat(await text.evaluate((el) => getComputedStyle(el).fontSize));
  expect(px).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(px).toBeLessThan(STICKY_FONT_MAX_PX);
  await expect(page.getByTestId('note-fade')).toBeVisible();
  const note = notes(page).first();
  const box = (await note.boundingBox())!;
  expect(box.width).toBeCloseTo(STICKY_SIZE_WORLD, 0);
  // nothing the note renders sits outside its box
  const outside = await note.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const t = el.querySelector('[data-testid="note-text"]')!.parentElement!;
    const pr = t.getBoundingClientRect();
    return pr.top < r.top - 1 || pr.bottom > r.bottom + 1 || getComputedStyle(t).overflow !== 'hidden';
  });
  expect(outside).toBe(false);
});

test('TC-34 the Sticky note button creates a visible note at screen centre when panned far away', async ({ page }) => {
  await setCamera(page, 1_000_000, 1_000_000, 1);
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Sticky note' }).click();
  const note = notes(page).first();
  await expect(note).toBeVisible();
  const vp = page.viewportSize()!;
  const c = await centre(note);
  expect(Math.abs(c.x - vp.width / 2)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(c.y - vp.height / 2)).toBeLessThanOrEqual(TOL);
  await page.keyboard.type('Far away');
  await expect(note).toContainText('Far away');
});
