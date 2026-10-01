import { expect, test, type Locator, type Page } from '@playwright/test';
import { STICKY_COLORS, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { LONG_TEXT } from '../fixtures/texts';
import { setCamera } from './helpers/board';

const TOLERANCE = 1;

function notesOf(page: Page) {
  return page.getByRole('group', { name: 'Sticky note' });
}

async function centreOf(note: Locator) {
  const box = await note.boundingBox();
  if (!box) throw new Error('note not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width };
}

async function worldPos(note: Locator) {
  return note.evaluate((el) => ({
    x: parseFloat((el as HTMLElement).style.left),
    y: parseFloat((el as HTMLElement).style.top),
  }));
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
}

async function createAt(page: Page, x: number, y: number) {
  const before = await notesOf(page).count();
  await page.mouse.dblclick(x, y);
  await expect(notesOf(page)).toHaveCount(before + 1);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('origin-marker')).toBeVisible();
});

test('brainstorm golden path: create, move at 50% zoom, recolour, delete', async ({ page }) => {
  // TC-30
  await createAt(page, 400, 300);
  await page.keyboard.type('Hello');
  const note = notesOf(page).first();
  const c0 = await centreOf(note);
  expect(Math.abs(c0.x - 400)).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(c0.y - 300)).toBeLessThanOrEqual(TOLERANCE);
  await expect(note).toContainText('Hello');
  await expect(note.locator('textarea')).toHaveValue('Hello');

  // Escape ends editing, keeping the note selected
  await page.keyboard.press('Escape');
  await expect(note.locator('textarea')).toHaveCount(0);
  await expect(note).toHaveAttribute('data-selected', 'true');

  // TC-31: 50% zoom, drag by (100,50)
  await setCamera(page, { x: -1280, y: -800, zoom: 0.5 });
  await expect.poll(async () => (await centreOf(note)).width).toBeCloseTo(STICKY_SIZE_WORLD * 0.5, 0);
  const grab = await centreOf(note);
  const worldBefore = await worldPos(note);
  await dragBy(page, grab, 100, 50);
  await expect.poll(async () => (await centreOf(note)).x).toBeCloseTo(grab.x + 100, 0);
  const after = await centreOf(note);
  expect(Math.abs(after.x - (grab.x + 100))).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(after.y - (grab.y + 50))).toBeLessThanOrEqual(TOLERANCE);
  const worldAfter = await worldPos(note);
  expect(worldAfter.x - worldBefore.x).toBeCloseTo(200, 0);
  expect(worldAfter.y - worldBefore.y).toBeCloseTo(100, 0);

  // recolour via the toolbar
  await page.getByRole('button', { name: 'Green colour' }).click();
  await expect(note).toHaveCSS('background-color', 'rgb(197, 225, 165)');
  expect(STICKY_COLORS.green).toBe('#C5E1A5');
  await expect(note).toContainText('Hello');
  await expect(note).toHaveAttribute('data-selected', 'true');

  // delete via the keyboard
  await page.keyboard.press('Delete');
  await expect(notesOf(page)).toHaveCount(0);
});

test('dragged note is drawn above an overlapped note at 200% zoom', async ({ page }) => {
  await createAt(page, 600, 400);
  await page.keyboard.press('Escape');
  await createAt(page, 700, 430);
  await page.keyboard.press('Escape');
  await setCamera(page, { x: -320, y: -200, zoom: 2 });
  // DOM order is stacking order, so address the notes by id rather than by index
  const ids = await page.locator('[data-note-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-note-id')));
  const firstId = ids[0];
  const first = page.locator(`[data-note-id="${ids[0]}"]`);
  const second = page.locator(`[data-note-id="${ids[1]}"]`);
  await expect.poll(async () => (await centreOf(first)).width).toBeCloseTo(STICKY_SIZE_WORLD * 2, 0);

  const worldBefore = await worldPos(first);
  // grab the part of the first note that the second one does not cover
  const firstBox = (await first.boundingBox())!;
  const grab = { x: firstBox.x + 30, y: firstBox.y + 30 };
  await dragBy(page, grab, 100, 50);
  await expect.poll(async () => (await worldPos(first)).x - worldBefore.x).toBeCloseTo(50, 0);
  const worldAfter = await worldPos(first);
  expect(worldAfter.x - worldBefore.x).toBeCloseTo(50, 0);
  expect(worldAfter.y - worldBefore.y).toBeCloseTo(25, 0);

  const overlap = await centreOf(second);
  const topId = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-sticky-note]')?.getAttribute('data-note-id'),
    { x: (overlap.x + (await centreOf(first)).x) / 2, y: (overlap.y + (await centreOf(first)).y) / 2 },
  );
  expect(topId).toBe(firstId);
});

test('long text shrinks to the minimum, then clips with a fade', async ({ page }) => {
  await createAt(page, 640, 400);
  await page.keyboard.type('Hello');
  const note = notesOf(page).first();
  const text = note.getByTestId('note-text');
  await expect(text).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);
  await expect(note.locator('.sticky-fade')).toHaveCount(0);

  await page.keyboard.insertText(LONG_TEXT);
  await expect(note.getByTestId('note-counter')).toHaveText('1000/1000');
  await expect(text).toHaveCSS('font-size', `${STICKY_FONT_MIN_PX}px`);
  await expect(note.locator('.sticky-fade')).toHaveCount(1);
  await expect(text).toHaveCSS('overflow', 'hidden');
  const clipped = await text.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(clipped).toBe(true);
  // nothing is drawn outside the note: the clipping frame has exactly the note's size
  const noteBox = await note.boundingBox();
  const textBox = await text.boundingBox();
  expect(textBox?.width).toBeCloseTo(noteBox!.width, 0);
  expect(textBox?.height).toBeCloseTo(noteBox!.height, 0);

  // a medium amount of text lands between the two limits
  await page.keyboard.press('Escape');
  await expect(note.locator('textarea')).toHaveCount(0);
  await expect(note.getByText(LONG_TEXT.slice(0, 30), { exact: false })).toBeVisible();
});

test('the Sticky note button creates a visible note after panning far away', async ({ page }) => {
  await setCamera(page, { x: 500_000, y: -300_000, zoom: 1 });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="world-layer"]')!).transform))
    .not.toBe('none');
  await page.getByRole('button', { name: 'Sticky note' }).click();
  const note = notesOf(page).first();
  await expect(note).toBeVisible();
  const c = await centreOf(note);
  expect(Math.abs(c.x - 640)).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(c.y - 400)).toBeLessThanOrEqual(TOLERANCE);
  await page.keyboard.type('Far away');
  await expect(note.locator('textarea')).toHaveValue('Far away');
});
