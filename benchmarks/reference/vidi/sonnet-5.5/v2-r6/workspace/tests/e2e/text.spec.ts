import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS, TEXT_MAX_AUTO_WIDTH_WORLD,
} from '../../src/shared/config';
import { boardWithNotes, type PlacedNote } from '../fixtures/boards';
import { LONG_TEXT } from '../fixtures/texts';
import { nextFrames } from './helpers/board';
import { createBoardId, E2E_ORIGIN } from './helpers/create';
import { openParticipants } from './helpers/participants';
import { seedBoard } from './helpers/seed';

const eventually = { timeout: E2E_EVENTUAL_TIMEOUT_MS };
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const textsOf = (page: Page): Locator => page.locator('[data-text-object]');

async function openOne(page: Page, id?: string): Promise<void> {
  const board = id ?? (await createBoardId());
  await page.goto(`/b/${board}`);
  await expect.poll(() => page.evaluate(() => window.__vidi6?.connectionState), eventually).toBe('connected');
  await page.evaluate(() => window.__vidi6!.setCamera({ x: 0, y: 0, zoom: 1 }));
  await nextFrames(page);
}


/** Text tool: press T, click the board at a screen point. */
async function placeText(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(x, y);
  await expect(page.getByRole('textbox', { name: 'Text' })).toBeFocused();
}

const box = async (el: Locator) => (await el.evaluate((e) => {
  const s = (e as HTMLElement).style;
  return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height), font: parseFloat(s.fontSize) };
}));

test('TC-26 a long annotation grows to 600 units wide and wraps', async ({ page }) => {
  await openOne(page);
  await placeText(page, 300, 200);
  await page.keyboard.type(LONG_TEXT.slice(0, 300));
  await page.keyboard.press('Escape');
  const t = textsOf(page).first();
  await expect(t).toHaveAttribute('data-selected', 'true');
  const b = await box(t);
  expect(Math.abs(b.w - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
  expect(b.h).toBeGreaterThan(b.font * 1.3 * 2);
  const lines = await t.getByTestId('text-content').evaluate((e) => {
    const r = document.createRange();
    r.selectNodeContents(e);
    return new Set([...r.getClientRects()].map((c) => Math.round(c.top))).size;
  });
  expect(lines).toBeGreaterThan(1);
  expect(b.x).toBe(300);
  expect(b.y).toBe(200);
});

test('TC-27 dragging the right handle narrower rewraps; there are no top or bottom handles', async ({ page }) => {
  await openOne(page);
  await placeText(page, 200, 200);
  await page.keyboard.type(LONG_TEXT.slice(0, 120));
  await page.keyboard.press('Escape');
  const t = textsOf(page).first();
  const before = await box(t);
  await expect(page.getByRole('button', { name: 'Resize top' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resize bottom' })).toHaveCount(0);
  const handle = page.getByRole('button', { name: 'Resize right' });
  const hb = (await handle.boundingBox())!;
  const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 100, from.y, { steps: 4 });
  await page.mouse.move(from.x - 200, from.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await box(t)).w).toBeLessThan(before.w - 150);
  const after = await box(t);
  expect(after.h).toBeGreaterThan(before.h);
  expect(after.x).toBe(before.x);
  await expect(t).toHaveAttribute('data-width-mode', 'fixed');
});

test('TC-28 title a retro section: XL heading, move, delete, undo', async ({ page }) => {
  const notes: PlacedNote[] = [];
  for (let i = 0; i < 6; i++) notes.push({ x: 300 + (i % 3) * 260, y: 300 + Math.floor(i / 3) * 260, text: `note ${i}` });
  const id = await createBoardId();
  await seedBoard(E2E_ORIGIN, id, boardWithNotes(notes).updates, notes.length);
  await openOne(page, id);
  await expect(page.locator('[data-sticky-note]')).toHaveCount(6, eventually);

  await placeText(page, 400, 150);
  await page.keyboard.type('Went well');
  await page.keyboard.press('Escape');
  const t = textsOf(page).first();
  await expect(t).toHaveAccessibleName('Went well');
  const small = await box(t);
  expect(small.w).toBeLessThan(150);
  await page.getByRole('button', { name: 'XL', exact: true }).click();
  const xl = await box(t);
  expect(xl.font).toBe(56);
  expect([xl.x, xl.y]).toEqual([small.x, small.y]);
  expect(xl.w).toBeGreaterThan(small.w);

  const b = (await t.boundingBox())!;
  await page.mouse.move(b.x + 10, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 110, b.y + 90, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await box(t)).x).toBeGreaterThan(xl.x + 90);

  await page.keyboard.press('Delete');
  await expect(textsOf(page)).toHaveCount(0);
  await page.keyboard.press(`${mod}+z`);
  await expect(textsOf(page)).toHaveCount(1);
  await expect(textsOf(page).first()).toHaveAccessibleName('Went well');
});

test('TC-29 two people typing into one text keep every character', async ({ browser }) => {
  const [a, b] = await openParticipants(browser, 2);
  await placeText(a.page, 300, 300);
  await a.page.keyboard.type('start ');
  await a.page.keyboard.press('Escape');
  await expect(textsOf(b.page)).toHaveCount(1, eventually);
  await a.page.keyboard.press('Enter');
  await textsOf(b.page).first().dblclick();
  await expect(b.page.getByRole('textbox', { name: 'Text' })).toBeFocused();
  await Promise.all([
    a.page.keyboard.type('AAAAAAAAAA', { delay: 25 }),
    b.page.keyboard.type('BBBBBBBBBB', { delay: 25 }),
  ]);
  await a.page.keyboard.press('Escape');
  await b.page.keyboard.press('Escape');
  const read = (p: Page) => textsOf(p).first().getAttribute('aria-label');
  await expect.poll(async () => (await read(a.page)) === (await read(b.page)), eventually).toBe(true);
  const text = (await read(a.page)) ?? '';
  expect(text.startsWith('start ')).toBe(true);
  expect(text.split('A').length - 1).toBe(10);
  expect(text.split('B').length - 1).toBe(10);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  await a.context.close();
  await b.context.close();
});

test('TC-30 everyone adds a heading at once and all headings show everywhere', async ({ browser }) => {
  const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
  await Promise.all(people.map(async (p, i) => {
    await placeText(p.page, 150 + i * 200, 200);
    await p.page.keyboard.type(`Heading ${i}`);
    await p.page.keyboard.press('Escape');
  }));
  for (const p of people) {
    await expect(textsOf(p.page)).toHaveCount(MAX_CONCURRENT_EDITORS, eventually);
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      await expect(p.page.getByRole('group', { name: `Heading ${i}`, exact: true })).toHaveCount(1, eventually);
    }
    expect(p.errors).toEqual([]);
  }
  await Promise.all(people.map((p) => p.context.close()));
});

test('TC-31 abandoned text leaves nothing behind', async ({ page }) => {
  await openOne(page);
  await placeText(page, 400, 300);
  await page.keyboard.press('Escape');
  await expect(textsOf(page)).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.keyboard.down('Shift');
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(600, 450, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('selection-box')).toHaveCount(0);
});

test('Escape or V leaves the Text tool without creating anything', async ({ page }) => {
  await openOne(page);
  const textButton = page.getByRole('button', { name: 'Text (T)' });
  await page.keyboard.press('t');
  await expect(textButton).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(textButton).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('t');
  await page.keyboard.press('v');
  await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(400, 300);
  await expect(textsOf(page)).toHaveCount(0);
});

test('N creates a sticky note at the centre of the view', async ({ page }) => {
  await openOne(page);
  await page.keyboard.press('n');
  await expect(page.locator('[data-sticky-note]')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
});
