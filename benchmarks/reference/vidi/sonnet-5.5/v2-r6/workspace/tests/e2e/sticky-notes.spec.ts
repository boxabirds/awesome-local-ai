import { expect, test, type Locator, type Page } from '@playwright/test';
import { createBoardId } from './helpers/create';
import { LONG_TEXT } from '../fixtures/texts';
import { nextFrames, setCamera } from './helpers/board';

const notesOf = (page: Page): Locator => page.getByRole('group', { name: 'Sticky note' });

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('not visible');
  return b;
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  await nextFrames(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto(`/b/${await createBoardId()}`);
  await expect(page.getByTestId("board-viewport")).toBeVisible();
  await setCamera(page, 0, 0, 1);
});

test('brainstorm golden path: create, move at 50%, recolour, delete', async ({ page }) => {
  // TC-30
  await page.mouse.dblclick(400, 300);
  await page.keyboard.type('Hello');
  const note = notesOf(page).first();
  let b = await box(note);
  expect(b.x + b.width / 2).toBeCloseTo(400, 0);
  expect(b.y + b.height / 2).toBeCloseTo(300, 0);
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue('Hello');
  await page.mouse.click(1000, 700);
  await expect(note).toContainText('Hello');
  await expect(note).toHaveAttribute('data-selected', 'false');

  // TC-31: 50% zoom
  await setCamera(page, 0, 0, 0.5);
  b = await box(note);
  const grab = { x: b.x + b.width / 4, y: b.y + b.height / 4 };
  const before = b;
  await dragBy(page, grab, 100, 50);
  b = await box(note);
  expect(b.x - before.x).toBeCloseTo(100, 0);
  expect(b.y - before.y).toBeCloseTo(50, 0);
  // world position moved +200,+100
  expect(await note.evaluate((el) => [parseFloat(el.style.left), parseFloat(el.style.top)]))
    .toEqual([300 + 200, 200 + 100]);

  // recolour
  await page.getByRole('button', { name: 'Green colour' }).click();
  await expect(note).toHaveCSS('background-color', 'rgb(197, 225, 165)');
  await expect(note).toHaveAttribute('data-selected', 'true');

  // delete
  await page.keyboard.press('Delete');
  await expect(notesOf(page)).toHaveCount(0);
});

test('TC-32 drag at 200% zoom moves +50,+25 world units and draws above an overlapped note', async ({ page }) => {
  await page.mouse.dblclick(300, 300);
  await page.mouse.click(1100, 700);
  await page.mouse.dblclick(450, 330);
  await page.mouse.click(1100, 700);
  await setCamera(page, 0, 0, 2);
  const [first, second] = [notesOf(page).nth(0), notesOf(page).nth(1)];
  const startLeft = await first.evaluate((el) => parseFloat(el.style.left));
  const startTop = await first.evaluate((el) => parseFloat(el.style.top));
  const fb = await box(first);
  const grab = { x: fb.x + 20, y: fb.y + 20 };
  await dragBy(page, grab, 100, 50);
  const after = await box(first);
  expect(after.x - fb.x).toBeCloseTo(100, 0);
  expect(await first.evaluate((el) => parseFloat(el.style.left))).toBeCloseTo(startLeft + 50, 1);
  expect(await first.evaluate((el) => parseFloat(el.style.top))).toBeCloseTo(startTop + 25, 1);
  const z = (l: Locator) => l.evaluate((el) => Number(getComputedStyle(el).zIndex));
  expect(await z(first)).toBeGreaterThan(await z(second));
  // hit test at the overlap resolves to the dragged note
  const sb = await box(second);
  const overlap = {
    x: (Math.max(after.x, sb.x) + Math.min(after.x + after.width, sb.x + sb.width)) / 2,
    y: (Math.max(after.y, sb.y) + Math.min(after.y + after.height, sb.y + sb.height)) / 2,
  };
  const topId = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-note-id]')?.getAttribute('data-note-id'),
    overlap,
  );
  expect(topId).toBe(await first.getAttribute('data-note-id'));
});

test('TC-33 text shrinks to fit, then clips with a fade', async ({ page }) => {
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await page.keyboard.type('Word');
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toHaveCSS('font-size', '24px');
  await editor.fill(LONG_TEXT);
  await expect(editor).toHaveValue(LONG_TEXT);
  const size = await editor.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(10);
  expect(size).toBeLessThan(24);
  await expect(page.getByText('1000/1000')).toBeVisible();
  const textBox = page.getByTestId('sticky-text');
  await expect(textBox).toHaveClass(/sticky-overflow/);
  await expect(page.getByTestId('sticky-fade')).toBeVisible();
  const note = notesOf(page).first();
  const nb = await box(note);
  const tb = await box(textBox);
  expect(tb.height).toBeLessThanOrEqual(nb.height + 0.5);
  expect(await textBox.evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden');
});

test('TC-34 the Sticky note button creates a note at the screen centre after panning far away', async ({ page }) => {
  await setCamera(page, 500_000, -300_000, 1);
  await page.getByRole('button', { name: 'Sticky note' }).click();
  const note = notesOf(page).first();
  await expect(note).toBeVisible();
  const b = await box(note);
  const vp = page.viewportSize()!;
  expect(b.x + b.width / 2).toBeCloseTo(vp.width / 2, 0);
  expect(b.y + b.height / 2).toBeCloseTo(vp.height / 2, 0);
  await page.keyboard.type('Typed');
  await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveValue('Typed');
});
