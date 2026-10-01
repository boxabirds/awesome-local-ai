import { expect, test, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MIN_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { LONG_TEXT } from '../fixtures/texts';
import { openNewBoard, setCamera } from './helpers/board';
import { closeAll, expectEventually, openParticipants } from './helpers/participants';
import { seedBoard } from './helpers/seed';

const texts = (page: Page) => page.locator('[data-text-id]');
const handles = (page: Page) => page.locator('[data-handle]');
const ANNOTATION = LONG_TEXT.slice(0, 300);

interface TextView { text: string; x: number; y: number; w: number; h: number; mode: string }

async function views(page: Page): Promise<TextView[]> {
  return texts(page).evaluateAll((els) =>
    els.map((el) => {
      const e = el as HTMLElement;
      return {
        text: e.querySelector('[data-testid="text-content"]')?.textContent ?? '',
        x: parseFloat(e.style.left),
        y: parseFloat(e.style.top),
        w: parseFloat(e.style.width),
        h: parseFloat(e.style.height),
        mode: e.dataset.widthMode ?? '',
      };
    }),
  );
}

async function centreView(page: Page) {
  await setCamera(page, -640, -400, 1); // world (0,0) at the centre of the 1280x800 viewport
  return (wx: number, wy: number) => ({ x: 640 + wx, y: 400 + wy });
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

async function placeText(page: Page, at: { x: number; y: number }, content?: string) {
  await page.keyboard.press('t');
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole('textbox', { name: 'Text' })).toBeFocused();
  if (content !== undefined) await page.keyboard.type(content);
}

test.describe('long annotation', () => {
  test('TC-26 / TC-27 a 300-character sentence wraps at 600; a side handle narrows it', async ({ page }) => {
    await openNewBoard(page);
    const at = await centreView(page);
    await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('t');
    await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.click(at(-300, -150).x, at(-300, -150).y);
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type(ANNOTATION);
    await page.keyboard.press('Escape');

    await expect.poll(async () => (await views(page))[0]?.w).toBeGreaterThan(TEXT_MAX_AUTO_WIDTH_WORLD - 3);
    const long = (await views(page))[0];
    expect(long.w).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
    expect(long.text).toBe(ANNOTATION);
    expect(long.h).toBeGreaterThan(TEXT_SIZES.M * 1.3 * 1.5); // several lines
    const renderedHeight = await texts(page).first().evaluate((el) => (el.querySelector('[data-testid="text-content"]') as HTMLElement).offsetHeight);
    expect(Math.abs(renderedHeight - long.h)).toBeLessThanOrEqual(TEXT_SIZES.M * 1.3 + 1); // layout agrees with the browser's wrapping

    // Selected after Escape: only left and right handles.
    await expect(handles(page)).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Resize top' })).toHaveCount(0);
    const right = page.getByRole('button', { name: 'Resize right' });
    const hb = (await right.boundingBox())!;
    await drag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: at(-300, 0).x + 200, y: hb.y + hb.height / 2 });
    await expect.poll(async () => (await views(page))[0].mode).toBe('fixed');
    await expect.poll(async () => Math.round((await views(page))[0].w)).toBeLessThan(260);
    const narrow = (await views(page))[0];
    expect(narrow.w).toBeGreaterThanOrEqual(TEXT_MIN_WIDTH_WORLD);
    expect(narrow.h).toBeGreaterThan(long.h);
    expect(narrow.x).toBe(long.x);
    expect(narrow.y).toBe(long.y);
    await expect(handles(page)).toHaveCount(2);
  });
});

test.describe('title a retro section', () => {
  test('TC-28 XL heading, drag, delete, undo', async ({ page }) => {
    const boardId = newBoardId();
    const seed = new Y.Doc();
    for (let i = 0; i < 4; i++) createSticky(seed, { x: (i % 2) * 230, y: 200 + Math.floor(i / 2) * 230 });
    await seedBoard('http://localhost:8791', boardId, seed);
    await page.goto(`/b/${boardId}`);
    await expect(page.getByRole('group', { name: 'Sticky note' })).toHaveCount(4);
    const at = await centreView(page);

    await placeText(page, at(-100, 0), 'Went well');
    await page.keyboard.press('Escape');
    await expect(texts(page)).toHaveCount(1);
    await expect(page.getByRole('toolbar', { name: 'Text tools' })).toBeVisible();
    const m = (await views(page))[0];
    expect(m.w).toBeGreaterThan(60);
    expect(m.w).toBeLessThan(140);

    await page.getByRole('button', { name: 'XL' }).click();
    await expect.poll(async () => (await views(page))[0].h).toBeCloseTo(TEXT_SIZES.XL * 1.3, 0);
    const xl = (await views(page))[0];
    expect([xl.x, xl.y]).toEqual([m.x, m.y]);
    expect(xl.w).toBeGreaterThan(m.w * 2);

    // Drag it over the cluster.
    const from = { x: at(xl.x, 0).x + 20, y: at(0, xl.y).y + 20 };
    await drag(page, from, { x: from.x + 150, y: from.y + 120 });
    await expect.poll(async () => Math.round((await views(page))[0].x)).toBe(Math.round(xl.x + 150));
    expect(Math.round((await views(page))[0].y)).toBe(Math.round(xl.y + 120));

    await page.keyboard.press('Delete');
    await expect(texts(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(texts(page)).toHaveCount(1);
    expect((await views(page))[0]).toMatchObject({ text: 'Went well', x: xl.x + 150, y: xl.y + 120 });
  });
});

test.describe('abandoned text', () => {
  test('TC-31 T, click, Escape leaves nothing behind', async ({ page }) => {
    await openNewBoard(page);
    const at = await centreView(page);
    await placeText(page, at(0, 0));
    await page.keyboard.press('Escape');
    await expect(texts(page)).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);

    // Shift+drag over the spot selects nothing.
    await page.keyboard.down('Shift');
    await drag(page, at(-100, -100), at(100, 100));
    await page.keyboard.up('Shift');
    await expect(page.locator('[data-selected="true"]')).toHaveCount(0);
    await expect(page.getByTestId('selection-box')).toHaveCount(0);
  });
});

test.describe('shared headings', () => {
  test('TC-29 two people type into the same text at once: every character survives', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [a, b] = people;
    const atA = await centreView(a.page);
    await centreView(b.page);
    await placeText(a.page, atA(0, 0), 'Heading');
    await a.page.keyboard.press('Escape');
    await expect(texts(b.page)).toHaveCount(1);
    await expectEventually('heading reaches B', async () => (await views(b.page))[0]?.text, 'Heading');

    for (const p of [a, b]) {
      await texts(p.page).first().dblclick();
      await expect(p.page.getByRole('textbox', { name: 'Text' })).toBeFocused();
    }
    await Promise.all([a.page.keyboard.type('AAAAAAAA', { delay: 20 }), b.page.keyboard.type('BBBBBBBB', { delay: 20 })]);
    for (const p of [a, b]) await p.page.keyboard.press('Escape');

    await expect
      .poll(async () => {
        const [ta, tb] = await Promise.all([views(a.page), views(b.page)]);
        return ta[0]?.text === tb[0]?.text ? ta[0].text : `${ta[0]?.text} != ${tb[0]?.text}`;
      }, { timeout: 15_000 })
      .not.toContain(' != ');
    const final = (await views(a.page))[0].text;
    expect(final).toBe((await views(b.page))[0].text);
    expect(final.split('A').length - 1).toBe(8);
    expect(final.split('B').length - 1).toBe(8);
    expect(final).toContain('Heading');
    await closeAll(people);
  });

  test('TC-30 everyone adds a heading at once: all are visible on every screen', async ({ browser }) => {
    const { people } = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    const ats = await Promise.all(people.map((p) => centreView(p.page)));
    await Promise.all(
      people.map(async (p, i) => {
        const pt = ats[i](-400 + i * 180, -100);
        await placeText(p.page, pt, `Heading ${i + 1}`);
        await p.page.keyboard.press('Escape');
      }),
    );
    const expected = people.map((_, i) => `Heading ${i + 1}`);
    for (const p of people) {
      await expectEventually(`${p.name} sees all headings`, async () => (await views(p.page)).map((v) => v.text).sort(), expected);
    }
    await closeAll(people);
  });
});
