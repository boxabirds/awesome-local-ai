// Story 9 e2e: free text on the board with real fonts, real browsers and the real sync service
// (wrangler dev) — TC-26 to TC-31.
import { type Page, expect, test } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
} from '../../src/shared/config';
import { SELECTION_GRID, selectionBoard } from '../fixtures/boards';
import { ANNOTATION_300, PASTE_5001 } from '../fixtures/texts';
import { getCamera, openBoard, setCamera, waitForFrame } from './helpers/board';
import { openParticipants, waitForConnected } from './helpers/participants';
import { createBoardViaApi, seedBoard } from './helpers/seed';

// 100% zoom with world (0, 0) at page (0, 0): page pixels are world units.
const CAMERA = { x: 0, y: 0, zoom: 1 };

interface TextObj {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  size: string;
  widthMode: string;
}

/** Sets the camera and waits until it is applied (setCamera's own wait cannot see a 100% → 100% change). */
async function showCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  await setCamera(page, cam);
  await expect.poll(() => getCamera(page)).toEqual(cam);
  await waitForFrame(page);
}

async function texts(page: Page): Promise<TextObj[]> {
  return page.evaluate(
    () => (window.__vidi6!.getObjects!() as unknown as TextObj[]).filter((o) => o.type === 'text'),
  );
}
async function objectCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__vidi6!.getObjects!().length);
}

const textButton = (page: Page) => page.getByRole('button', { name: 'Text (T)' });
const selectButton = (page: Page) => page.getByRole('button', { name: 'Select (V)' });
const textEditor = (page: Page) => page.getByRole('textbox', { name: 'Text' });
const textEls = (page: Page) => page.locator('[data-text-id]');
const selectionStatus = (page: Page) => page.getByTestId('selection-status');

/** Text tool, click at a page point: a new text being edited. */
async function placeText(page: Page, at: { x: number; y: number }) {
  await page.keyboard.press('t');
  await expect(textButton(page)).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(at.x, at.y);
  await expect(textEditor(page)).toBeFocused();
  await expect(selectButton(page)).toHaveAttribute('aria-pressed', 'true');
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
  await waitForFrame(page);
}

test.describe('Workflow: Long annotation', () => {
  test('TC-26 a 300-character sentence grows to the maximum width and wraps; TC-27 a narrower handle drag rewraps', async ({
    page,
  }) => {
    await openBoard(page);
    await showCamera(page, CAMERA);
    await placeText(page, { x: 200, y: 150 });
    await page.keyboard.type(ANNOTATION_300);
    await page.keyboard.press('Escape');

    await expect(textEls(page)).toHaveCount(1);
    const [t] = await texts(page);
    expect(t.text).toBe(ANNOTATION_300);
    expect(t).toMatchObject({ x: 200, y: 150, size: 'M', widthMode: 'auto' });
    expect(Math.abs(t.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
    const lineHeight = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
    const storedLines = Math.round(t.height / lineHeight);
    expect(storedLines).toBeGreaterThanOrEqual(3);
    // The browser renders the same number of lines as were measured.
    const rendered = await textEls(page)
      .locator('.text-content')
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.round(rendered / lineHeight)).toBe(storedLines);

    // TC-27: selected (Escape keeps it selected) — side handles only.
    await expect(textEls(page).first()).toHaveAttribute('data-selected', 'true');
    await expect(page.getByRole('button', { name: 'Resize right' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resize left' })).toBeVisible();
    for (const name of ['top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      await expect(page.getByRole('button', { name: `Resize ${name}` })).toHaveCount(0);
    }
    const handle = await page.getByRole('button', { name: 'Resize right' }).boundingBox();
    await dragBy(page, { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 }, -300, 0);
    await expect
      .poll(async () => (await texts(page))[0].widthMode, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe('fixed');
    const [narrow] = await texts(page);
    expect(Math.abs(narrow.width - (t.width - 300))).toBeLessThanOrEqual(2);
    expect(narrow).toMatchObject({ x: 200, y: 150 });
    expect(narrow.height).toBeGreaterThan(t.height);
    const renderedNarrow = await textEls(page)
      .locator('.text-content')
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.round(renderedNarrow / lineHeight)).toBe(Math.round(narrow.height / lineHeight));
  });

  test('pasting more than the limit keeps the first TEXT_MAX_CHARS characters', async ({ page }) => {
    await openBoard(page);
    await showCamera(page, CAMERA);
    await placeText(page, { x: 100, y: 100 });
    await page.keyboard.insertText(PASTE_5001);
    await page.keyboard.press('Escape');
    const [t] = await texts(page);
    expect(t.text).toBe(PASTE_5001.slice(0, TEXT_MAX_CHARS));
  });
});

test.describe('Workflow: Title a retro section', () => {
  test('TC-28 XL heading above a cluster, dragged, deleted and restored with undo', async ({
    page,
    baseURL,
  }) => {
    const fixture = selectionBoard();
    const id = await createBoardViaApi(baseURL!);
    await seedBoard(baseURL!, id, fixture.updates);
    await page.goto(`/b/${id}`);
    await waitForConnected(page);
    await expect(page.locator('[data-sticky-id]')).toHaveCount(20);
    // Grid cluster top-left at page (150, 250).
    const camera = { x: SELECTION_GRID.left - 150, y: SELECTION_GRID.top - 250, zoom: 1 };
    await showCamera(page, camera);
    const page2world = (p: { x: number; y: number }) => ({ x: p.x + camera.x, y: p.y + camera.y });

    await placeText(page, { x: 170, y: 120 });
    await page.keyboard.type('Went well');
    await page.keyboard.press('Escape');
    let [heading] = await texts(page);
    expect(heading).toMatchObject({ text: 'Went well', size: 'M', ...page2world({ x: 170, y: 120 }) });
    await expect(page.getByRole('group', { name: 'Went well' })).toHaveAttribute('data-selected', 'true');

    await page.getByRole('button', { name: /^Text size XL / }).click();
    await expect.poll(async () => (await texts(page))[0].size).toBe('XL');
    const xl = (await texts(page))[0];
    expect(xl).toMatchObject({ x: heading.x, y: heading.y });
    expect(xl.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT, 1);
    expect(xl.width).toBeGreaterThan(heading.width);
    heading = xl;

    // Drag it to the right, over the middle of the cluster.
    const box = await page.getByRole('group', { name: 'Went well' }).boundingBox();
    await dragBy(page, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }, 200, 0);
    const moved = (await texts(page))[0];
    expect(moved.x).toBeCloseTo(heading.x + 200, 0);
    expect(moved.y).toBeCloseTo(heading.y, 0);

    await page.keyboard.press('Delete');
    await expect(textEls(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(textEls(page)).toHaveCount(1);
    expect((await texts(page))[0]).toEqual(moved);
  });
});

test.describe('Workflow: Abandoned text', () => {
  test('TC-31 T, click, Escape without typing leaves nothing on the board', async ({ page }) => {
    await openBoard(page);
    await showCamera(page, CAMERA);
    await placeText(page, { x: 400, y: 300 });
    await page.keyboard.press('Escape');
    await expect(textEditor(page)).toHaveCount(0);
    await expect(textEls(page)).toHaveCount(0);
    expect(await objectCount(page)).toBe(0);

    // Shift+drag over the spot selects nothing.
    await page.keyboard.down('Shift');
    await page.mouse.move(350, 250);
    await page.mouse.down();
    await page.mouse.move(420, 320, { steps: 4 });
    await page.mouse.move(500, 400, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(selectionStatus(page)).toHaveText('');
  });
});

test.describe('Workflow: Two people edit one heading; everyone adds headings', () => {
  test('TC-29 two people typing in the same text at once keep every character', async ({
    browser,
  }, testInfo) => {
    const session = await openParticipants(browser, testInfo, ['Ava', 'Ben']);
    try {
      const [ava, ben] = session.participants;
      for (const p of session.participants) await showCamera(p.page, CAMERA);
      await placeText(ava.page, { x: 300, y: 200 });
      await ava.page.keyboard.type('Retro');
      await expect(textEls(ben.page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      await expect(ben.page.getByRole('group', { name: 'Retro' })).toBeVisible({
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      });
      await ben.page.getByRole('group', { name: 'Retro' }).dblclick();
      await expect(textEditor(ben.page)).toBeFocused();

      await Promise.all([
        ava.page.keyboard.type(' aaaa aaaa', { delay: 30 }),
        ben.page.keyboard.type(' bbbb bbbb', { delay: 30 }),
      ]);
      await ava.page.keyboard.press('Escape');
      await ben.page.keyboard.press('Escape');

      await expect
        .poll(
          async () => {
            const [a, b] = await Promise.all([texts(ava.page), texts(ben.page)]);
            return a[0]?.text === b[0]?.text ? a[0]?.text : null;
          },
          { timeout: E2E_EVENTUAL_TIMEOUT_MS },
        )
        .not.toBeNull();
      const final = (await texts(ava.page))[0].text;
      expect(final.startsWith('Retro')).toBe(true);
      expect(final.length).toBe('Retro'.length + 20);
      expect([...final].filter((c) => c === 'a').length).toBe(8);
      expect([...final].filter((c) => c === 'b').length).toBe(8);
      await expect(ava.page.locator('[data-text-id] .text-content')).toHaveText(final);
      await expect(ben.page.locator('[data-text-id] .text-content')).toHaveText(final);
      for (const p of session.participants) expect(p.problems, `${p.name} problems`).toEqual([]);
    } finally {
      await session.close();
    }
  });

  test('TC-30 MAX_CONCURRENT_EDITORS people each add a heading at once; all see every heading', async ({
    browser,
  }, testInfo) => {
    const names = ['Ava', 'Ben', 'Cai', 'Dee', 'Eli'].slice(0, MAX_CONCURRENT_EDITORS);
    const session = await openParticipants(browser, testInfo, names);
    try {
      for (const p of session.participants) await showCamera(p.page, CAMERA);
      await Promise.all(
        session.participants.map(async (p, i) => {
          await placeText(p.page, { x: 150 + (i % 3) * 300, y: 120 + Math.floor(i / 3) * 200 });
          await p.page.keyboard.type(`Heading by ${p.name}`);
          await p.page.keyboard.press('Escape');
        }),
      );
      const expected = names.map((n) => `Heading by ${n}`).sort();
      for (const p of session.participants) {
        await expect
          .poll(async () => (await texts(p.page)).map((t) => t.text).sort(), {
            timeout: E2E_EVENTUAL_TIMEOUT_MS,
          })
          .toEqual(expected);
        for (const text of expected) {
          await expect(p.page.getByRole('group', { name: text })).toBeVisible();
        }
      }
      for (const p of session.participants) expect(p.problems, `${p.name} problems`).toEqual([]);
    } finally {
      await session.close();
    }
  });
});
