// Story 9 — write free text anywhere on the board. Real fonts decide wrapping,
// and only the real sync server proves concurrent typing merges.
import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { ANNOTATION_300, HEADING_TO_IMPROVE, HEADING_WENT_WELL } from '../fixtures/texts';
import { getCamera, openBoard, viewport } from './helpers/board';
import { closeAll, openParticipants, type Participant } from './helpers/participants';

interface TextState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  size: string;
  widthMode: string;
  text: string;
}

/** Every text object in the board document (via the test hook). */
async function textStates(page: Page): Promise<TextState[]> {
  return page.evaluate(() => {
    const out: TextState[] = [];
    window.__vidi6!.doc.getMap('objects').forEach((value, id) => {
      const m = value as unknown as { get(k: string): unknown };
      if (m.get('type') !== 'text') return;
      out.push({
        id,
        x: m.get('x') as number,
        y: m.get('y') as number,
        width: m.get('width') as number,
        height: m.get('height') as number,
        size: m.get('size') as string,
        widthMode: m.get('widthMode') as string,
        text: String(m.get('text')),
      });
    });
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  });
}

async function onlyText(page: Page): Promise<TextState> {
  const all = await textStates(page);
  expect(all).toHaveLength(1);
  return all[0];
}

function textEl(page: Page, id: string) {
  return page.locator(`[data-text-id="${id}"]`);
}

/** Rendered line count of a text object's content (real browser layout). */
async function renderedLines(page: Page, id: string, fontPx: number): Promise<number> {
  const h = await textEl(page, id)
    .locator('[data-testid="text-content"]')
    .evaluate((el) => (el as HTMLElement).offsetHeight);
  return Math.round(h / (fontPx * TEXT_LINE_HEIGHT));
}

/** T, then a click at `p`: returns the id of the new text (being edited). */
async function placeText(page: Page, p: { x: number; y: number }): Promise<string> {
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(p.x, p.y);
  await expect(page.getByRole('textbox', { name: 'Text' })).toBeFocused();
  // Other people may be adding text at the same time: the new one is the one being edited here.
  const id = await page.locator('[data-text-id][data-editing="true"]').getAttribute('data-text-id');
  expect(id).toBeTruthy();
  expect((await textStates(page)).map((t) => t.id)).toContain(id);
  return id!;
}

test.describe('Workflow 1: title a retro section', () => {
  test('TC-28 XL heading, drag, Delete, Ctrl/Cmd+Z restores it', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('t');
    await expect(viewport(page)).toHaveCSS('cursor', 'text');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(viewport(page)).not.toHaveCSS('cursor', 'text');

    const cam = await getCamera(page);
    const id = await placeText(page, { x: 400, y: 200 });
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    const placed = await onlyText(page);
    expect(placed.x).toBeCloseTo(400 / cam.zoom + cam.x, 6);
    expect(placed.y).toBeCloseTo(200 / cam.zoom + cam.y, 6);
    expect(placed.size).toBe('M');

    await page.keyboard.type(HEADING_WENT_WELL);
    await page.keyboard.press('Escape');
    await expect(textEl(page, id)).toHaveAttribute('data-selected', 'true');
    const typed = await onlyText(page);
    expect(typed.text).toBe(HEADING_WENT_WELL);
    // Just wider than the words, one line tall.
    const wordsWidth = await textEl(page, id)
      .locator('[data-testid="text-content"]')
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect().width;
      });
    expect(typed.width).toBeGreaterThanOrEqual(wordsWidth / cam.zoom - 2);
    expect(typed.width).toBeLessThan(wordsWidth / cam.zoom + 12);
    expect(typed.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
    await expect(textEl(page, id)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    await page.getByRole('button', { name: 'Size XL' }).click();
    await expect(page.getByRole('button', { name: 'Size XL' })).toHaveAttribute('aria-pressed', 'true');
    const big = await onlyText(page);
    expect(big).toMatchObject({ size: 'XL', x: typed.x, y: typed.y });
    expect(big.width).toBeGreaterThan(typed.width * 2);
    expect(big.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT, 6);
    await expect(textEl(page, id)).toHaveCSS('font-size', `${TEXT_SIZES.XL}px`);

    // Drag it over the cluster.
    const box = (await textEl(page, id).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    const moved = await onlyText(page);
    expect(moved.x).toBeCloseTo(big.x + 60 / cam.zoom, 0);
    expect(moved.y).toBeCloseTo(big.y + 40 / cam.zoom, 0);
    await expect(textEl(page, id)).toHaveAttribute('data-selected', 'true');

    await page.keyboard.press('Delete');
    await expect(textEl(page, id)).toHaveCount(0);
    expect(await textStates(page)).toHaveLength(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(textEl(page, id)).toHaveCount(1);
    expect(await onlyText(page)).toMatchObject({ text: HEADING_WENT_WELL, size: 'XL', x: moved.x, y: moved.y });
  });
});

test.describe('Workflow 2: long annotation', () => {
  test('TC-26 → TC-27 a 300-character sentence wraps at 600; a narrower fixed width rewraps and grows', async ({ page }) => {
    await openBoard(page);
    const id = await placeText(page, { x: 200, y: 150 });
    await page.keyboard.type(ANNOTATION_300);
    await page.keyboard.press('Escape');
    const long = await onlyText(page);
    expect(long.text).toBe(ANNOTATION_300);
    // TC-26: stored width is the maximum auto width, several rendered lines.
    expect(Math.abs(long.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
    expect(long.widthMode).toBe('auto');
    const lines = await renderedLines(page, id, TEXT_SIZES.M);
    expect(lines).toBeGreaterThanOrEqual(2);
    // The stored height follows the rendered content.
    expect(Math.abs(long.height - lines * TEXT_SIZES.M * TEXT_LINE_HEIGHT)).toBeLessThanOrEqual(TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // TC-27: only side handles; drag the right one narrower.
    await expect(textEl(page, id)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByRole('button', { name: 'Resize right' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resize left' })).toBeVisible();
    for (const name of ['Resize top', 'Resize bottom', 'Resize top-left', 'Resize bottom-right']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    const cam = await getCamera(page);
    const handle = (await page.getByRole('button', { name: 'Resize right' }).boundingBox())!;
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx - 350 * cam.zoom, hy, { steps: 10 });
    await page.mouse.up();
    const narrow = await onlyText(page);
    expect(narrow.widthMode).toBe('fixed');
    expect(narrow.width).toBeCloseTo(long.width - 350, 0);
    expect(narrow.x).toBe(long.x);
    expect(narrow.height).toBeGreaterThan(long.height);
    const narrowLines = await renderedLines(page, id, TEXT_SIZES.M);
    expect(narrowLines).toBeGreaterThan(lines);
    expect(Math.abs(narrow.height - narrowLines * TEXT_SIZES.M * TEXT_LINE_HEIGHT)).toBeLessThanOrEqual(
      TEXT_SIZES.M * TEXT_LINE_HEIGHT,
    );
    await expect(page.getByRole('button', { name: 'Resize bottom', exact: true })).toHaveCount(0);
  });
});

test.describe('Workflow 4: abandoned text', () => {
  test('TC-31 T, click, Escape without typing leaves no object; box select there finds nothing', async ({ page }) => {
    await openBoard(page);
    await placeText(page, { x: 500, y: 400 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Text' })).toHaveCount(0);
    expect(await textStates(page)).toHaveLength(0);
    await page.keyboard.down('Shift');
    await page.mouse.move(450, 350);
    await page.mouse.down();
    await page.mouse.move(600, 480, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(page.locator('[data-selected="true"]')).toHaveCount(0);
    await expect(page.getByTestId('selection-announcer')).toHaveText('');
    // Nothing to undo either.
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
});

test.describe('Workflow 3: collaboration', () => {
  let participants: Participant[] = [];
  test.afterEach(async () => {
    await closeAll(participants);
    participants = [];
  });

  test('TC-29 two people type into the same text at once; both screens end identical with every character', async ({ browser }) => {
    participants = await openParticipants(browser, ['ava', 'ben']);
    const [ava, ben] = participants;
    const id = await placeText(ava.page, { x: 400, y: 300 });
    await ava.page.keyboard.type(HEADING_TO_IMPROVE);
    await ava.page.keyboard.press('Escape');
    await expect(textEl(ben.page, id)).toHaveAccessibleName(HEADING_TO_IMPROVE, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    await textEl(ava.page, id).dblclick();
    await textEl(ben.page, id).dblclick();
    await expect(ava.page.getByRole('textbox', { name: 'Text' })).toBeFocused();
    await expect(ben.page.getByRole('textbox', { name: 'Text' })).toBeFocused();
    const aText = ' first sprint';
    const bText = ' next quarter';
    await Promise.all([ava.page.keyboard.type(aText, { delay: 30 }), ben.page.keyboard.type(bText, { delay: 30 })]);
    await ava.page.keyboard.press('Escape');
    await ben.page.keyboard.press('Escape');

    const sorted = (s: string) => [...s].sort().join('');
    const expected = sorted(HEADING_TO_IMPROVE + aText + bText);
    for (const p of participants) {
      await expect
        .poll(async () => sorted((await textStates(p.page))[0]?.text ?? ''), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(expected);
    }
    await expect
      .poll(async () => (await textStates(ava.page))[0].text, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe((await textStates(ben.page))[0].text);
    const final = (await textStates(ava.page))[0].text;
    expect(final.startsWith(HEADING_TO_IMPROVE)).toBe(true);
    await expect(textEl(ben.page, id).locator('[data-testid="text-content"]')).toHaveText(final);
    await expect(textEl(ava.page, id).locator('[data-testid="text-content"]')).toHaveText(final);
    expect(ava.consoleErrors).toEqual([]);
    expect(ben.consoleErrors).toEqual([]);
  });

  test('TC-30 every editor adds a heading at once; all headings are visible on every screen', async ({ browser }) => {
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `p${i + 1}`);
    participants = await openParticipants(browser, names);
    const headings = names.map((n) => `Heading from ${n}`);
    await Promise.all(
      participants.map(async (p, i) => {
        await placeText(p.page, { x: 200 + (i % 2) * 400, y: 120 + i * 110 });
        await p.page.keyboard.type(headings[i]);
        await p.page.keyboard.press('Escape');
      }),
    );
    for (const p of participants) {
      await expect
        .poll(async () => (await textStates(p.page)).map((t) => t.text).sort(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toEqual([...headings].sort());
      for (const h of headings) {
        await expect(p.page.getByRole('group', { name: h, exact: true })).toBeVisible();
      }
    }
  });
});
