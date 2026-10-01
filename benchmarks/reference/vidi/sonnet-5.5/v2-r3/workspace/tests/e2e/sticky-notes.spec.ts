import { expect, test, type Locator, type Page } from '@playwright/test';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { LONG_TEXT, SHORT_TEXT } from '../fixtures/texts';
import { drag, originCentre, setCamera, zoomLabel } from './helpers/board';

const notes = (page: Page) => page.getByRole('group', { name: 'Sticky note' });
const emptySpot = { x: 1100, y: 700 };

async function centreOf(loc: Locator) {
  const b = await loc.boundingBox();
  if (!b) throw new Error('not visible');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function worldPos(loc: Locator) {
  return loc.evaluate((el) => ({ x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top) }));
}

async function clickEmpty(page: Page) {
  await page.mouse.click(emptySpot.x, emptySpot.y);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(zoomLabel(page)).toHaveText('100%');
});

test('brainstorm golden path: create, type, move at 50% zoom, recolour, delete', async ({ page }) => {
  // TC-30
  await page.mouse.dblclick(400, 300);
  await expect(notes(page)).toHaveCount(1);
  await page.keyboard.type('Hello');
  const note = notes(page).first();
  const c = await centreOf(note);
  expect(Math.abs(c.x - 400)).toBeLessThanOrEqual(1);
  expect(Math.abs(c.y - 300)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('textbox')).toHaveValue('Hello');
  await expect(note).toHaveCSS('background-color', 'rgb(255, 245, 157)');
  await expect(note.locator('.sticky-textarea')).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);

  await clickEmpty(page);
  await expect(note).toHaveAttribute('data-selected', 'false');
  await expect(note).toContainText('Hello');

  // TC-31: at 50% zoom the grabbed point stays under the pointer.
  const origin = await originCentre(page);
  void origin;
  await setCamera(page, -640 * 2, -400 * 2, 0.5);
  await expect(zoomLabel(page)).toHaveText('50%');
  const before = await worldPos(note);
  const grab = await centreOf(note);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 50, grab.y + 25, { steps: 4 });
  await page.mouse.move(grab.x + 100, grab.y + 50, { steps: 4 });
  await expect(page.getByRole('button', { name: 'Delete note' })).toHaveCount(0); // toolbar hidden while dragging
  await page.mouse.up();
  const after = await worldPos(note);
  expect(after.x - before.x).toBeCloseTo(200, 0);
  expect(after.y - before.y).toBeCloseTo(100, 0);
  const grabbedAfter = await centreOf(note);
  expect(Math.abs(grabbedAfter.x - (grab.x + 100))).toBeLessThanOrEqual(1);
  expect(Math.abs(grabbedAfter.y - (grab.y + 50))).toBeLessThanOrEqual(1);
  await expect(note).toHaveAttribute('data-selected', 'true');

  // Colour: green swatch keeps text, position and selection.
  await page.getByRole('button', { name: 'Green colour' }).click();
  await expect(note).toHaveCSS('background-color', 'rgb(197, 225, 165)');
  expect(STICKY_COLORS.green).toBe('#C5E1A5');
  await expect(note).toHaveAttribute('data-selected', 'true');
  await expect(note).toContainText('Hello');
  expect(await worldPos(note)).toEqual(after);

  // Delete via keyboard.
  await page.keyboard.press('Delete');
  await expect(notes(page)).toHaveCount(0);
});

test('keyboard: Enter edits, Backspace while editing edits text, bin deletes', async ({ page }) => {
  await page.mouse.dblclick(400, 300);
  await page.keyboard.type('ab');
  await page.keyboard.press('Escape');
  const note = notes(page).first();
  await expect(note).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await page.keyboard.type('z');
  await expect(page.getByRole('textbox')).toHaveValue('a\nz');
  await expect(notes(page)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Delete note' }).click();
  await expect(notes(page)).toHaveCount(0);
});

test('drag at 200% zoom moves by delta/zoom and draws the note on top', async ({ page }) => {
  // TC-32
  await setCamera(page, -320, -200, 2);
  await expect(zoomLabel(page)).toHaveText('200%');
  await page.mouse.dblclick(400, 400);
  await expect(notes(page)).toHaveCount(1);
  const idA = (await notes(page).first().getAttribute('data-id'))!;
  await clickEmpty(page);
  await page.mouse.dblclick(700, 400);
  await expect(notes(page)).toHaveCount(2);
  await clickEmpty(page);
  const idB = (await page.locator(`[data-sticky-note]:not([data-id="${idA}"])`).getAttribute('data-id'))!;
  const a = page.locator(`[data-id="${idA}"]`);
  const b = page.locator(`[data-id="${idB}"]`);
  const zA = Number(await a.evaluate((el) => (el as HTMLElement).style.zIndex));
  const zB = Number(await b.evaluate((el) => (el as HTMLElement).style.zIndex));
  expect(zA).toBeLessThan(zB);
  const before = await worldPos(a);
  await drag(page, { x: 300, y: 400 }, 100, 50);
  await expect.poll(async () => (await worldPos(a)).x - before.x).toBeCloseTo(50, 0);
  const after = await worldPos(a);
  expect(after.y - before.y).toBeCloseTo(25, 0);
  const zA2 = Number(await a.evaluate((el) => (el as HTMLElement).style.zIndex));
  expect(zA2).toBeGreaterThan(zB);
  // Hit-testing agrees: the point where they overlap belongs to the dragged note.
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-sticky-note]')?.getAttribute('data-id'), [
    580, 400,
  ]);
  expect(hit).toBe(idA);
  // The board itself did not pan.
  const o = await originCentre(page);
  expect(o.x).toBeCloseTo(320 * 2, 0);
  expect(o.y).toBeCloseTo(200 * 2, 0);
});

test('long text shrinks, then clips with a fade at the minimum size', async ({ page }) => {
  // TC-33
  await page.mouse.dblclick(400, 300);
  await page.keyboard.type(SHORT_TEXT.split(' ')[0]);
  const area = page.getByRole('textbox');
  await expect(area).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);
  await area.fill(LONG_TEXT);
  await expect(page.getByText('1000/1000')).toBeVisible();
  const note = notes(page).first();
  const size = await area.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(size).toBeLessThan(STICKY_FONT_MAX_PX);
  await expect(note).toHaveClass(/sticky-overflow/);
  await expect(page.getByTestId('sticky-fade')).toBeVisible();
  await area.fill(LONG_TEXT + ' more');
  await expect(area).toHaveValue(LONG_TEXT);
  // Nothing is drawn outside the note box.
  const box = await note.boundingBox();
  const content = await note.locator('.sticky-content').boundingBox();
  expect(content!.x).toBeGreaterThanOrEqual(box!.x - 1);
  expect(content!.y + content!.height).toBeLessThanOrEqual(box!.y + box!.height + 1);
  await expect(note.locator('.sticky-content')).toHaveCSS('overflow', 'hidden');
  expect(box!.width).toBeCloseTo(STICKY_SIZE_WORLD, 0);
  // Text is kept after ending the edit.
  await page.keyboard.press('Escape');
  await expect(note.locator('.sticky-text')).toHaveText(LONG_TEXT);
});

test('Sticky note button creates a visible, editable note at screen centre when panned far away', async ({ page }) => {
  // TC-34
  await setCamera(page, 50_000, -30_000, 1);
  await page.getByRole('button', { name: 'Sticky note' }).click();
  const note = notes(page).first();
  await expect(note).toBeVisible();
  const c = await centreOf(note);
  expect(Math.abs(c.x - 640)).toBeLessThanOrEqual(1);
  expect(Math.abs(c.y - 400)).toBeLessThanOrEqual(1);
  await page.keyboard.type('Far away');
  await expect(page.getByRole('textbox')).toHaveValue('Far away');
});
