/**
 * Story 9 e2e (TC-26 to TC-31): the Text tool and text objects in real browsers with real
 * fonts, against `wrangler dev`. The camera is set to 100% at the origin so screen pixels
 * are world units.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS, TEXT_MAX_AUTO_WIDTH_WORLD } from '../../src/shared/config';
import type { Camera, Point } from '../../src/client/canvas/camera';
import { ANNOTATION_300, HEADINGS } from '../fixtures/texts';
import { openBoard, setCamera } from './helpers/board';
import { closeAll, expectWithin, openParticipants, type Participant } from './helpers/participants';

const CAM: Camera = { x: 0, y: 0, zoom: 1 };
const WIDTH_TOLERANCE = 2;
const MULTI_CONTEXT_TIMEOUT_MS = 120_000;
const UNDO = 'ControlOrMeta+z';

interface RenderedText {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  size: string;
  text: string;
  lines: number;
}

function texts(page: Page): Locator {
  return page.locator('.text-object');
}

async function renderedTexts(page: Page): Promise<RenderedText[]> {
  return texts(page).evaluateAll((els) =>
    els.map((el) => {
      const h = el as HTMLElement;
      return {
        id: h.dataset.id ?? '',
        x: parseFloat(h.style.left),
        y: parseFloat(h.style.top),
        width: parseFloat(h.style.width),
        height: parseFloat(h.style.height),
        size: h.dataset.size ?? '',
        text: h.getAttribute('aria-label') ?? '',
        lines: h.querySelectorAll('.text-line').length,
      };
    }),
  );
}

async function onlyText(page: Page): Promise<RenderedText> {
  const list = await renderedTexts(page);
  expect(list).toHaveLength(1);
  return list[0]!;
}

function editor(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Text' });
}

/** T, click at `at`, type `content` (optional), Escape. Returns the new text's id. */
async function placeText(page: Page, at: Point, content: string): Promise<string> {
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(at.x, at.y);
  await expect(editor(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  const id = await editor(page).evaluate((el) => (el.closest('[data-id]') as HTMLElement).dataset.id!);
  if (content !== '') await page.keyboard.type(content);
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  return id;
}

async function dragBy(page: Page, from: Point, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
}

async function centre(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('text.object', () => {
  test('TC-26 long annotation: 300 characters make a 600-wide box with several lines', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAM);
    await placeText(page, { x: 200, y: 150 }, ANNOTATION_300);
    const t = await onlyText(page);
    expect(t.text).toBe(ANNOTATION_300);
    expect(Math.abs(t.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(WIDTH_TOLERANCE);
    expect(t.lines).toBeGreaterThan(1);
    expect({ x: t.x, y: t.y }).toEqual({ x: 200, y: 150 });
    // Every rendered line fits the box (real font wrapping agrees with the stored box).
    const widest = await texts(page)
      .locator('.text-line')
      .evaluateAll((els) => Math.max(...els.map((e) => (e as HTMLElement).getBoundingClientRect().width)));
    expect(widest).toBeLessThanOrEqual(t.width + WIDTH_TOLERANCE);
    const contentHeight = await texts(page).locator('.text-object-content').evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.abs(contentHeight - t.height)).toBeLessThanOrEqual(WIDTH_TOLERANCE);
  });

  test('TC-27 dragging the right handle narrower rewraps, height grows, no top/bottom handles', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAM);
    await placeText(page, { x: 200, y: 150 }, ANNOTATION_300);
    const before = await onlyText(page);
    // Still selected after Escape: only side handles.
    await expect(page.locator('[data-handle]')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Resize top' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Resize bottom' })).toHaveCount(0);
    const handle = page.getByRole('button', { name: 'Resize right' });
    await dragBy(page, await centre(handle), -300, 40);
    await expect.poll(async () => (await onlyText(page)).width).toBeLessThan(before.width - 250);
    const after = await onlyText(page);
    expect(Math.abs(after.width - (before.width - 300))).toBeLessThanOrEqual(WIDTH_TOLERANCE);
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.lines).toBeGreaterThan(before.lines);
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    await expect(texts(page)).toHaveAttribute('data-width-mode', 'fixed');
  });

  test('TC-28 golden path: XL heading, drag, Delete, Ctrl/Cmd+Z restores it', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAM);
    // A cluster of two notes.
    for (const x of [400, 620]) {
      await page.mouse.dblclick(x, 400);
      await page.keyboard.type('Idea');
      await page.keyboard.press('Escape');
    }
    await expect(page.getByRole('group', { name: 'Sticky note' })).toHaveCount(2);

    // Text cursor while the tool is active.
    await page.keyboard.press('t');
    await expect(page.getByTestId('board-viewport')).toHaveCSS('cursor', 'text');
    await page.keyboard.press('Escape');

    const id = await placeText(page, { x: 300, y: 150 }, HEADINGS[0]);
    const m = await onlyText(page);
    expect(m.size).toBe('M');
    await expect(page.getByRole('button', { name: 'Size M' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Size XL' }).click();
    await expect(texts(page)).toHaveAttribute('data-size', 'XL');
    const xl = await onlyText(page);
    expect({ x: xl.x, y: xl.y }).toEqual({ x: m.x, y: m.y });
    expect(xl.width).toBeGreaterThan(m.width * 2);
    await expect(texts(page)).toHaveCSS('font-size', '56px');

    await dragBy(page, await centre(texts(page)), 150, 60);
    const moved = await onlyText(page);
    expect(moved.x).toBeCloseTo(xl.x + 150, 0);
    expect(moved.y).toBeCloseTo(xl.y + 60, 0);

    await page.keyboard.press('Delete');
    await expect(texts(page)).toHaveCount(0);
    await page.keyboard.press(UNDO);
    await expect(texts(page)).toHaveCount(1);
    const restored = await onlyText(page);
    expect(restored).toMatchObject({ id, text: HEADINGS[0], size: 'XL', x: moved.x, y: moved.y });
  });

  test('TC-31 abandoned text: T, click, Escape leaves nothing behind', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAM);
    await placeText(page, { x: 500, y: 300 }, '');
    await expect(texts(page)).toHaveCount(0);
    // A box selection over the spot selects nothing.
    await page.keyboard.down('Shift');
    await dragBy(page, { x: 450, y: 250 }, 200, 150);
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('selection-outline')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
});

let people: Participant[] = [];

test.afterEach(async () => {
  await closeAll(people);
  people = [];
});

test.describe('text.concurrent', () => {
  test('TC-29 two people type into the same text at once: identical text with every character', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    people = await openParticipants(browser, ['Ava', 'Ben']);
    const [ava, ben] = people as [Participant, Participant];
    for (const p of people) await setCamera(p.page, CAM);
    await placeText(ava.page, { x: 300, y: 200 }, 'Heading');
    await expect(texts(ben.page)).toHaveCount(1);

    for (const p of people) {
      await texts(p.page).dblclick();
      await expect(editor(p.page)).toBeFocused();
    }
    await Promise.all([
      ava.page.keyboard.type(' aaaaa', { delay: 40 }),
      ben.page.keyboard.type(' bbbbb', { delay: 40 }),
    ]);
    for (const p of people) await p.page.keyboard.press('Escape');

    const read = async (p: Participant) => (await onlyText(p.page)).text;
    await expect.poll(async () => (await read(ava)) === (await read(ben))).toBe(true);
    const merged = await read(ava);
    expect(merged.startsWith('Heading')).toBe(true);
    expect([...merged].filter((c) => c === 'a')).toHaveLength(5 + 1); // "Heading" has one 'a'
    expect([...merged].filter((c) => c === 'b')).toHaveLength(5);
    expect(merged).toHaveLength('Heading'.length + 12);
    for (const p of people) expect(p.errors).toEqual([]);
  });

  test('TC-30 MAX_CONCURRENT_EDITORS people each add a heading at once: all visible everywhere', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `P${i + 1}`);
    people = await openParticipants(browser, names);
    for (const p of people) await setCamera(p.page, CAM);
    const headings = names.map((n) => `Heading from ${n}`);
    await Promise.all(people.map((p, i) => placeText(p.page, { x: 200 + (i % 3) * 300, y: 150 + Math.floor(i / 3) * 200 }, headings[i]!)));
    for (const p of people) {
      await expectWithin(async () => (await renderedTexts(p.page)).map((t) => t.text).sort()).toEqual([...headings].sort());
    }
  });
});
