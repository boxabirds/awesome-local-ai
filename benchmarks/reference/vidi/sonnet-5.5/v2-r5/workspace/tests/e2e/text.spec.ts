import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES,
} from '../../src/shared/config';
import { settled } from './helpers/board';
import { createBoardVia } from './helpers/create';
import { drag, notesOf, openParticipants } from './helpers/participants';

const EVENTUALLY = { timeout: E2E_EVENTUAL_TIMEOUT_MS };
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
// 1280x800 viewport, camera starts with the world origin in the centre: screen = world + (640, 400).
const screenOf = (wx: number, wy: number) => ({ x: wx + 640, y: wy + 400 });

const ANNOTATION = 'The team gathered around the board to talk through what had gone well during the sprint, '
  + 'which blockers kept reappearing, and how small experiments might improve the way work flows. '
  + 'Everyone agreed that pairing sessions were the most valuable part of the week for new joiners. ';
const LONG_ANNOTATION = ANNOTATION.slice(0, 300);

const texts = (page: Page) => page.locator('[data-text-object]');

async function placeText(page: Page, at: { x: number; y: number }, content?: string) {
  await page.keyboard.press('t');
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole('textbox', { name: 'Text' })).toBeFocused();
  if (content !== undefined) await page.keyboard.insertText(content);
}

test.beforeEach(async ({ page, request }) => {
  const id = await createBoardVia(request);
  await page.goto(`/b/${id}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible(EVENTUALLY);
  await settled(page);
});

test('TC-26 a 300-character annotation grows to the maximum width, then wraps', async ({ page }) => {
  await placeText(page, screenOf(-300, -100), LONG_ANNOTATION);
  await page.keyboard.press('Escape');
  const t = texts(page).first();
  await expect(t).toHaveAttribute('data-selected', 'true');
  const width = Number(await t.getAttribute('data-width'));
  expect(Math.abs(width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
  const box = (await t.boundingBox())!;
  expect(Math.abs(box.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
  const lineHeight = TEXT_SIZES.M * 1.3;
  const rendered = await t.locator('.text-object-content').evaluate((e) => e.getBoundingClientRect().height);
  expect(rendered).toBeGreaterThanOrEqual(2 * lineHeight - 1);
  expect(Number(await t.getAttribute('data-height'))).toBeGreaterThanOrEqual(2 * lineHeight - 1);
});

test('short text is just wider than its words', async ({ page }) => {
  await placeText(page, screenOf(-100, -100), 'Went well');
  await page.keyboard.press('Escape');
  const width = Number(await texts(page).first().getAttribute('data-width'));
  expect(width).toBeGreaterThan(40);
  expect(width).toBeLessThan(150);
  const box = (await texts(page).first().boundingBox())!;
  expect(box.x).toBeCloseTo(screenOf(-100, -100).x, 0);
  expect(box.y).toBeCloseTo(screenOf(-100, -100).y, 0);
});

test('TC-27 dragging the right handle fixes the width, rewraps, and offers no vertical handles', async ({ page }) => {
  await placeText(page, screenOf(-300, -100), 'alpha beta gamma delta epsilon zeta eta theta');
  await page.keyboard.press('Escape');
  const t = texts(page).first();
  const before = (await t.boundingBox())!;
  await expect(page.getByRole('button', { name: /^Resize/ })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Resize top' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resize bottom' })).toHaveCount(0);
  const handle = (await page.getByRole('button', { name: 'Resize right' }).boundingBox())!;
  await drag(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, -(before.width - 100), 0);
  await settled(page);
  await expect(t).toHaveAttribute('data-width-mode', 'fixed');
  const after = (await t.boundingBox())!;
  expect(after.width).toBeCloseTo(100, 0);
  expect(Number(await t.getAttribute('data-height'))).toBeGreaterThan(before.height + 5);
  expect(after.x).toBeCloseTo(before.x, 0);
});

test('TC-28 title a retro section: XL, move, delete, undo', async ({ page }) => {
  await page.getByRole('button', { name: 'Sticky note (N)' }).click();
  await page.keyboard.type('a note');
  await page.keyboard.press('Escape');
  await page.mouse.click(screenOf(400, 300).x, screenOf(400, 300).y); // deselect
  await placeText(page, screenOf(-300, -250), 'Went well');
  await page.keyboard.press('Escape');
  const t = texts(page).first();
  await expect(t).toHaveAttribute('data-size', 'M');
  const start = (await t.boundingBox())!;
  const widthM = Number(await t.getAttribute('data-width'));
  await page.getByRole('button', { name: 'XL', exact: true }).click();
  await expect(t).toHaveAttribute('data-size', 'XL');
  expect(Number(await t.getAttribute('data-width'))).toBeGreaterThan(widthM * 2);
  const xl = (await t.boundingBox())!;
  expect(xl.x).toBeCloseTo(start.x, 0);
  expect(xl.y).toBeCloseTo(start.y, 0);

  await drag(page, { x: xl.x + 10, y: xl.y + 10 }, 150, 80);
  await settled(page);
  const moved = (await t.boundingBox())!;
  expect(moved.x).toBeCloseTo(xl.x + 150, 0);
  expect(moved.y).toBeCloseTo(xl.y + 80, 0);

  await page.keyboard.press('Delete');
  await expect(texts(page)).toHaveCount(0);
  await page.keyboard.press(`${MOD}+z`);
  await expect(texts(page)).toHaveCount(1);
  const restored = (await texts(page).first().boundingBox())!;
  expect(restored.x).toBeCloseTo(moved.x, 0);
  expect(await texts(page).first().getAttribute('data-size')).toBe('XL');
});

test('Enter edits text and N still creates a sticky', async ({ page }) => {
  await placeText(page, screenOf(0, 0), 'abc');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.keyboard.type('def');
  await page.keyboard.press('Escape');
  await expect(texts(page).first()).toHaveAccessibleName('abcdef');
  await page.keyboard.press('n');
  await expect(notesOf(page)).toHaveCount(1);
});

test('TC-29 two people typing into one text keep every character', async ({ browser, request }) => {
  const id = await createBoardVia(request);
  const [ava, ben] = await openParticipants(browser, ['Ava', 'Ben'], id);
  await placeText(ava.page, screenOf(-100, -100), 'Heading');
  await ava.page.keyboard.press('Escape');
  await expect(texts(ben.page)).toHaveCount(1, EVENTUALLY);
  await ben.page.locator('[data-text-object]').dblclick();
  await ava.page.locator('[data-text-object]').dblclick();
  await Promise.all([
    ava.page.keyboard.type('AAAAAAAAAA', { delay: 20 }),
    ben.page.keyboard.type('bbbbbbbbbb', { delay: 20 }),
  ]);
  await ava.page.keyboard.press('Escape');
  await ben.page.keyboard.press('Escape');
  const read = (p: Page) => texts(p).first().evaluate((e) => e.textContent ?? '');
  await expect.poll(async () => (await read(ava.page)) === (await read(ben.page)), EVENTUALLY).toBe(true);
  const final = await read(ava.page);
  expect(final.length).toBe('Heading'.length + 20);
  expect(final.split('A').length - 1).toBe(10);
  expect(final.split('b').length - 1).toBe(10);
  expect(ava.errors).toEqual([]);
  expect(ben.errors).toEqual([]);
  await ava.context.close(); await ben.context.close();
});

test('TC-30 every editor adds a heading at once and all are visible everywhere', async ({ browser, request }) => {
  const id = await createBoardVia(request);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `P${i}`);
  const people = await openParticipants(browser, names, id);
  await Promise.all(people.map(async (p, i) => {
    await placeText(p.page, screenOf(-500 + i * 200, -200), `Heading ${i}`);
    await p.page.keyboard.press('Escape');
  }));
  for (const p of people) {
    await expect(texts(p.page)).toHaveCount(MAX_CONCURRENT_EDITORS, EVENTUALLY);
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      await expect(p.page.getByText(`Heading ${i}`, { exact: true })).toBeVisible(EVENTUALLY);
    }
    expect(p.errors).toEqual([]);
  }
  await Promise.all(people.map((p) => p.context.close()));
});

test('TC-31 abandoned text leaves nothing behind', async ({ page }) => {
  const at = screenOf(-100, -100);
  await placeText(page, at);
  await page.keyboard.press('Escape');
  await expect(texts(page)).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Text tools' })).toHaveCount(0);
  await page.keyboard.down('Shift');
  await page.mouse.move(at.x - 50, at.y - 50);
  await page.mouse.down();
  await page.mouse.move(at.x + 200, at.y + 100, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.getByText(/selected/)).toHaveCount(0);
  await page.keyboard.press(`${MOD}+z`); // nothing to undo for the abandoned text
  await expect(texts(page)).toHaveCount(0);
});

test('Escape and V leave the Text tool without creating anything', async ({ page }) => {
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('t');
  await page.keyboard.press('v');
  await page.mouse.click(300, 300);
  await expect(texts(page)).toHaveCount(0);
});
