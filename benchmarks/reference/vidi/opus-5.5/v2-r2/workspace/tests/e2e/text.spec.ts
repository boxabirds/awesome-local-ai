import { type Page, expect, test } from '@playwright/test';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
} from '../../src/shared/config';
import { ANNOTATION_300, HEADINGS, PARAGRAPH_5001, RETRO_NOTES } from '../fixtures/text-board';
import { nextFrames, openBoard, setCamera } from './helpers/board';
import { closeParticipants, openParticipants } from './helpers/participants';

// Camera at world (0, 0), 100%: screen pixels = world units.
const CAMERA = { x: 0, y: 0, zoom: 1 };

async function objects(page: Page): Promise<ObjectSnapshot[]> {
  return page.evaluate(() => [...(window.__vidi6?.getObjects?.() ?? [])]);
}

async function texts(page: Page): Promise<ObjectSnapshot[]> {
  return (await objects(page)).filter((o) => o.type === 'text');
}

async function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window.__vidi6?.getSelection?.() ?? [])]);
}

/** Text tool: T, click at `at` (screen = world), type, Escape. Returns the new text object. */
async function placeText(page: Page, at: { x: number; y: number }, content: string, opts: { type?: boolean } = {}) {
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(at.x, at.y);
  const editor = page.getByRole('textbox', { name: 'Text' });
  await expect(editor).toBeFocused();
  await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  if (opts.type === false) await editor.fill(content);
  else await page.keyboard.type(content);
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  const found = (await texts(page)).find((t) => t.text === content);
  if (!found) throw new Error(`text "${content.slice(0, 20)}…" not found`);
  return found;
}

function textLocator(page: Page, id: string) {
  return page.locator(`[data-text-object][data-id="${id}"]`);
}

async function renderedLines(page: Page, id: string, size: keyof typeof TEXT_SIZES) {
  const height = await textLocator(page, id)
    .getByTestId('text-content')
    .evaluate((el) => el.getBoundingClientRect().height);
  return Math.round(height / (TEXT_SIZES[size] * TEXT_LINE_HEIGHT));
}

async function textById(page: Page, id: string) {
  return (await texts(page)).find((t) => t.id === id);
}

test.describe('story 9: free text', () => {
  test('TC-26 long annotation: auto width stops at the maximum and wraps', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAMERA);
    const text = await placeText(page, { x: 200, y: 150 }, ANNOTATION_300);
    expect(text).toMatchObject({ x: 200, y: 150, size: 'M', widthMode: 'auto' });
    expect(Math.abs(text.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
    const lines = await renderedLines(page, text.id, 'M');
    expect(lines).toBeGreaterThan(1);
    // Stored height follows the content.
    expect(Math.round(text.height / (TEXT_SIZES.M * TEXT_LINE_HEIGHT))).toBe(lines);
    const box = await textLocator(page, text.id).boundingBox();
    expect(Math.abs(box!.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
  });

  test('TC-27 dragging the right handle narrower rewraps; no top or bottom handles', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAMERA);
    const text = await placeText(page, { x: 200, y: 150 }, 'Went well this sprint');
    expect(await renderedLines(page, text.id, 'M')).toBe(1);
    expect(await selection(page)).toEqual([text.id]);
    await expect(page.locator('.selection-handle')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Resize top' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Resize bottom' })).toHaveCount(0);
    const handle = await page.getByRole('button', { name: 'Resize right' }).boundingBox();
    const from = { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 };
    const targetWidth = 90;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(200 + targetWidth, from.y, { steps: 8 });
    await page.mouse.up();
    await nextFrames(page);
    await expect.poll(async () => (await textById(page, text.id))?.widthMode).toBe('fixed');
    const after = (await textById(page, text.id))!;
    expect(Math.abs(after.width - targetWidth)).toBeLessThanOrEqual(1);
    expect(after.x).toBe(200);
    expect(after.height).toBeGreaterThan(text.height);
    const lines = await renderedLines(page, text.id, 'M');
    expect(lines).toBeGreaterThan(1);
    expect(Math.round(after.height / (TEXT_SIZES.M * TEXT_LINE_HEIGHT))).toBe(lines);
    await expect(page.getByRole('button', { name: 'Resize top' })).toHaveCount(0);
  });

  test('TC-28 title a retro section: XL heading, move, delete, undo', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAMERA);
    await page.evaluate((notes) => window.__vidi6!.seedNotes!(notes), [...RETRO_NOTES]);
    await expect.poll(async () => (await objects(page)).length).toBe(RETRO_NOTES.length);

    // Above cluster A.
    const heading = await placeText(page, { x: 300, y: 220 }, HEADINGS[0]);
    expect(await selection(page)).toEqual([heading.id]);
    const toolbar = page.getByRole('toolbar', { name: 'Text' });
    await expect(toolbar.getByRole('button', { name: 'Size M' })).toHaveAttribute('aria-pressed', 'true');
    await toolbar.getByRole('button', { name: 'Size XL' }).click();
    await expect.poll(async () => (await textById(page, heading.id))?.size).toBe('XL');
    const xl = (await textById(page, heading.id))!;
    expect(xl).toMatchObject({ x: 300, y: 220 });
    expect(xl.width).toBeGreaterThan(heading.width * 2);
    expect(xl.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT, 0);
    await expect(textLocator(page, heading.id)).toHaveCSS('font-size', `${TEXT_SIZES.XL}px`);

    // Centre it over the cluster by dragging.
    await page.mouse.move(310, 240);
    await page.mouse.down();
    await page.mouse.move(360, 200, { steps: 8 });
    await page.mouse.up();
    await nextFrames(page);
    await expect.poll(async () => (await textById(page, heading.id))?.x).toBe(350);
    expect((await textById(page, heading.id))!.y).toBe(180);

    await page.keyboard.press('Delete');
    await expect.poll(async () => (await textById(page, heading.id)) ?? null).toBeNull();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await textById(page, heading.id))?.text).toBe(HEADINGS[0]);
    expect(await textById(page, heading.id)).toMatchObject({ x: 350, y: 180, size: 'XL' });
    await expect(textLocator(page, heading.id)).toBeVisible();
  });

  test('pasting a 5,001-character paragraph keeps 5,000 characters', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAMERA);
    await page.keyboard.press('t');
    await page.mouse.click(200, 150);
    await page.getByRole('textbox', { name: 'Text' }).fill(PARAGRAPH_5001);
    await page.keyboard.press('Escape');
    const [text] = await texts(page);
    expect(text!.text).toHaveLength(TEXT_MAX_CHARS);
    expect(text!.text).toBe(PARAGRAPH_5001.slice(0, TEXT_MAX_CHARS));
  });

  test('TC-31 abandoned text: T, click, Escape → nothing left on the board', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAMERA);
    await page.keyboard.press('t');
    await expect(page.getByTestId('board-viewport')).toHaveCSS('cursor', 'text');
    await page.mouse.click(500, 300);
    await expect(page.getByRole('textbox', { name: 'Text' })).toBeFocused();
    expect(await texts(page)).toHaveLength(1);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await objects(page)).length).toBe(0);
    await expect(page.locator('[data-text-object]')).toHaveCount(0);
    // Shift+drag over the spot selects nothing.
    await page.keyboard.down('Shift');
    await page.mouse.move(450, 250);
    await page.mouse.down();
    await page.mouse.move(600, 380, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await nextFrames(page);
    expect(await selection(page)).toEqual([]);
    // Undo never brings back an invisible empty text.
    await page.keyboard.press('Control+z');
    expect(await objects(page)).toHaveLength(0);
  });

  test('TC-29 two people typing in the same text keep every character', async ({ browser }) => {
    const [ava, raj] = await openParticipants(browser, 2);
    try {
      for (const p of [ava!, raj!]) await setCamera(p.page, CAMERA);
      const text = await placeText(ava!.page, { x: 300, y: 200 }, 'Heading');
      await expect.poll(async () => (await textById(raj!.page, text.id))?.text, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('Heading');
      for (const p of [ava!, raj!]) {
        await p.page.mouse.dblclick(310, 210);
        await expect(p.page.getByRole('textbox', { name: 'Text' })).toBeFocused();
      }
      await Promise.all([
        ava!.page.keyboard.type(' aaaaa', { delay: 20 }),
        raj!.page.keyboard.type(' bbbbb', { delay: 20 }),
      ]);
      const expectAll = (s: string | undefined) =>
        !!s && s.startsWith('Heading') && (s.match(/a/g) ?? []).length === 5 + 1 && (s.match(/b/g) ?? []).length === 5;
      for (const p of [ava!, raj!]) {
        await expect
          .poll(async () => expectAll((await textById(p.page, text.id))?.text), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
          .toBe(true);
      }
      await expect
        .poll(async () => (await textById(ava!.page, text.id))?.text === (await textById(raj!.page, text.id))?.text, {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe(true);
      const final = (await textById(ava!.page, text.id))!.text!;
      expect(final).toHaveLength('Heading'.length + 12);
      for (const p of [ava!, raj!]) {
        await p.page.keyboard.press('Escape');
        expect(p.problems).toEqual([]);
      }
    } finally {
      await closeParticipants([ava!, raj!].filter(Boolean));
    }
  });

  test('TC-30 MAX_CONCURRENT_EDITORS people add headings at once; all see all', async ({ browser }) => {
    const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    try {
      for (const p of people) await setCamera(p.page, CAMERA);
      const names = people.map((p, i) => `${p.name} heading ${i + 1}`);
      await Promise.all(people.map((p, i) => placeText(p.page, { x: 200, y: 120 + i * 80 }, names[i]!)));
      for (const p of people) {
        await expect
          .poll(async () => (await texts(p.page)).map((t) => t.text).sort(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
          .toEqual([...names].sort());
        for (const name of names) await expect(p.page.getByRole('group', { name })).toBeVisible();
        expect(p.problems).toEqual([]);
      }
    } finally {
      await closeParticipants(people);
    }
  });
});
