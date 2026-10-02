/**
 * End-to-end text workflows (story 9): the Text tool, titling a retro section,
 * long annotations that wrap at the automatic width limit, sideways resizing,
 * two people typing into one text, everybody adding headings at once and text
 * abandoned without a single character.
 *
 * TC-26 is written to run in any browser (see the commented-out firefox and
 * webkit projects in playwright.config.ts — they cannot start on this machine,
 * see NOTES.md): where the text wraps is the browser's decision, so it must be
 * right in all of them. The remaining workflows drag handles around and are
 * scripted for chromium only.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { addSticky, getSelectedIds, marqueeDrag } from './helpers/board';
import { proseOfLength } from '../fixtures/texts';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

/** The 300-character annotation fixture: an English paragraph, not filler. */
const ANNOTATION_300 = proseOfLength(300);

interface TextObjectState {
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

interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

/** The board document's objects, straight from the app's Y.Doc. */
async function getObjects(page: Page): Promise<TextObjectState[]> {
  return page.evaluate(() => [...((window as any).__vidi6?.getObjects?.() ?? [])]);
}

async function textObjects(page: Page): Promise<TextObjectState[]> {
  return (await getObjects(page)).filter((obj) => obj.type === 'text');
}

async function textObject(page: Page, id: string): Promise<TextObjectState | undefined> {
  return (await textObjects(page)).find((obj) => obj.id === id);
}

async function createBoard(): Promise<string> {
  const res = await fetch('http://localhost:5173/api/boards', { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/boards failed: ${res.status}`);
  const { id } = await res.json();
  return id;
}

async function openBoardOnId(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(
    () => (window as any).__vidi6?.connectionState === 'connected',
    undefined,
    { timeout: 10000 },
  );
  return page;
}

async function textBox(page: Page, id: string): Promise<ScreenBox> {
  const box = await page.locator(`[data-text-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`text ${id} has no bounding box`);
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/**
 * Press T, click the board at (x, y) and wait for the new text to be ready for
 * typing.
 */
async function createTextAt(page: Page, x: number, y: number): Promise<string> {
  const before = new Set((await textObjects(page)).map((obj) => obj.id));
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(x, y);
  await page.locator('[data-testid="text-editor"]').waitFor({ state: 'visible', timeout: 5000 });
  const created = (await textObjects(page)).find((obj) => !before.has(obj.id));
  if (!created) throw new Error('the Text tool did not create a text object');
  return created.id;
}

/** Open an existing text object for editing by double-clicking it. */
async function editTextAt(page: Page, id: string): Promise<void> {
  const box = await textBox(page, id);
  await page.mouse.dblclick(box.cx, box.cy);
  await page.locator('[data-testid="text-editor"]').waitFor({ state: 'visible', timeout: 5000 });
}

/** Replace the editor's content the way a paste does (one input event). */
async function pasteIntoText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const el = document.querySelector<HTMLTextAreaElement>('[data-testid="text-editor"]');
    if (!el) throw new Error('no text editor open');
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

/** How many lines the rendered text is broken into. */
async function renderedLines(page: Page, id: string): Promise<number> {
  return page.evaluate((textId) => {
    const el = document.querySelector<HTMLElement>(
      `[data-text-id="${textId}"] [data-testid="text-object-content"]`,
    );
    if (!el) throw new Error('text element not found');
    const range = document.createRange();
    range.selectNodeContents(el);
    // Browsers hand out one client rect per fragment, so count line positions.
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  }, id);
}

async function dragFrom(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx * 0.5, from.y + dy * 0.5, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

async function dragText(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const box = await textBox(page, id);
  await dragFrom(page, { x: box.cx, y: box.cy }, dx, dy);
}

async function dragHandle(page: Page, handle: string, dx: number, dy: number): Promise<void> {
  const box = await page.getByTestId(`resize-handle-${handle}`).boundingBox();
  if (!box) throw new Error(`handle ${handle} has no bounding box`);
  await dragFrom(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, dx, dy);
}

/** The stored height of `lines` lines of `size`. */
function lineHeight(size: string): number {
  return (TEXT_SIZES as Record<string, number>)[size] * TEXT_LINE_HEIGHT;
}

test.describe('Free text on the board (every browser)', () => {
  test('TC-26: a 300-character annotation grows, then wraps at the width limit', async ({
    browser,
  }) => {
    const boardId = await createBoard();
    const page = await openBoardOnId(await browser.newContext(), boardId);

    // A short note is one line and as wide as its text: nothing is clipped.
    const shortId = await createTextAt(page, 120, 120);
    await page.keyboard.type('Shipped the beta');
    await page.keyboard.press('Escape');
    const short = await textObject(page, shortId);
    const shortLines = await renderedLines(page, shortId);
    expect(shortLines).toBe(1);
    expect(Math.abs(short!.height - lineHeight('M'))).toBeLessThanOrEqual(2);
    const shortBox = await textBox(page, shortId);
    const contentWidth = await page.evaluate((id) => {
      const el = document.querySelector<HTMLElement>(
        `[data-text-id="${id}"] [data-testid="text-object-content"]`,
      )!;
      return el.scrollWidth;
    }, shortId);
    expect(shortBox.width).toBeGreaterThanOrEqual(contentWidth - 1);

    // A 300-character annotation stops growing sideways and wraps instead.
    const id = await createTextAt(page, 120, 220);
    await pasteIntoText(page, ANNOTATION_300);
    await page.keyboard.press('Escape');

    const wrapped = await textObject(page, id);
    expect(wrapped).toBeDefined();
    expect(Math.abs(wrapped!.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
    const lines = await renderedLines(page, id);
    expect(lines).toBeGreaterThanOrEqual(3);
    // The stored height is exactly that many lines of the medium size.
    expect(Math.abs(wrapped!.height - lineHeight('M') * lines)).toBeLessThanOrEqual(2);
    expect(lines).toBe(Math.round(wrapped!.height / lineHeight('M')));
    // Nothing was cut off: the whole annotation is on screen.
    const visible = await page.locator(`[data-text-id="${id}"] [data-testid="text-object-content"]`).innerText();
    expect(visible.replace(/\s+/g, ' ').trim()).toBe(ANNOTATION_300.replace(/\s+/g, ' ').trim());
  });

  test('TC-26: title a retro section — T, click, type, XL, drag over the cluster, Delete, Ctrl+Z', async ({
    browser,
  }) => {
    const boardId = await createBoard();
    const page = await openBoardOnId(await browser.newContext(), boardId);

    // The cluster of notes the heading belongs to.
    await addSticky(page, 100, 300, 'Shipped the beta');
    await addSticky(page, 300, 300, 'Import tool timed out');
    await page.mouse.click(700, 700); // deselect

    const id = await createTextAt(page, 110, 150);
    await page.keyboard.type('Went well');
    await page.keyboard.press('Escape');

    const created = await textObject(page, id);
    expect(created!.text).toBe('Went well');
    expect(created!.size).toBe('M');

    // The toolbar of the selected text offers the four sizes; XL is one click
    // and re-measures the text in place.
    await expect(page.getByRole('button', { name: 'Extra large text (XL)' })).toBeVisible();
    await page.getByRole('button', { name: 'Extra large text (XL)' }).click();
    const sized = await textObject(page, id);
    expect(sized!.size).toBe('XL');
    expect(sized!.x).toBe(created!.x);
    expect(sized!.y).toBe(created!.y);
    expect(sized!.height).toBeGreaterThan(created!.height);
    await expect(page.getByRole('button', { name: 'Extra large text (XL)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Drag the heading down over the cluster.
    await dragText(page, id, 20, 130);
    const moved = await textObject(page, id);
    expect(moved!.x).toBeGreaterThan(created!.x);
    expect(moved!.y).toBeGreaterThan(created!.y);
    const note = await page.locator('[data-note-id]').first().boundingBox();
    expect(moved!.y + moved!.height).toBeLessThan(note!.y + note!.height);

    // Delete it, then undo: the heading comes back with its text and size.
    await page.keyboard.press('Delete');
    await expect.poll(() => textObject(page, id)).toBeUndefined();

    await page.keyboard.press('ControlOrMeta+z');
    const restored = await textObject(page, id);
    expect(restored).toBeDefined();
    expect(restored!.text).toBe('Went well');
    expect(restored!.size).toBe('XL');
    expect(Math.round(restored!.y)).toBe(Math.round(moved!.y));
  });
});

test.describe('Free text on the board (chromium)', () => {
  // These workflows drag handles around; they are scripted for chromium only.
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'handle dragging is scripted for chromium only',
  );

  test('TC-27: dragging the right handle rewraps the words and grows the height', async ({
    browser,
  }) => {
    const boardId = await createBoard();
    const page = await openBoardOnId(await browser.newContext(), boardId);

    const id = await createTextAt(page, 300, 200);
    await pasteIntoText(page, ANNOTATION_300);
    await page.keyboard.press('Escape');
    const wrapped = await textObject(page, id);
    const lines = await renderedLines(page, id);

    // Only the sideways handles exist: the height is never resized directly.
    const box = await textBox(page, id);
    await page.mouse.click(box.cx, box.cy);
    await expect(page.getByTestId('resize-handle-e')).toBeVisible();
    await expect(page.getByTestId('resize-handle-w')).toBeVisible();
    for (const h of ['n', 's', 'nw', 'ne', 'se', 'sw']) {
      await expect(page.getByTestId(`resize-handle-${h}`)).toHaveCount(0);
    }

    await dragHandle(page, 'e', -260, 0);

    const narrowed = await textObject(page, id);
    expect(narrowed!.widthMode).toBe('fixed');
    expect(narrowed!.width).toBeLessThan(wrapped!.width - 200);
    expect(narrowed!.height).toBeGreaterThan(wrapped!.height);
    expect(await renderedLines(page, id)).toBeGreaterThan(lines);
    // The words were rewrapped, not clipped: every character is still there.
    expect(narrowed!.text).toBe(ANNOTATION_300);
  });

  test('TC-29: two people typing into one text keep every character', async ({ browser }) => {
    const boardId = await createBoard();
    const ada = await openBoardOnId(await browser.newContext(), boardId);
    const bob = await openBoardOnId(await browser.newContext(), boardId);

    // Ada starts the heading; Bob joins in while it is still being typed.
    const id = await createTextAt(ada, 250, 220);
    await ada.keyboard.type('Retro');
    await expect.poll(() => textObject(bob, id).then((obj) => obj?.text)).toBe('Retro');

    await editTextAt(bob, id);
    for (let i = 0; i < 6; i += 1) {
      await ada.keyboard.type('a');
      await bob.keyboard.type('b');
      await ada.waitForTimeout(120);
    }

    // Both screens end up with the same text, holding all of it.
    await expect
      .poll(
        async () => {
          const a = await textObject(ada, id);
          const b = await textObject(bob, id);
          return a && b && a.text === b.text ? a.text : null;
        },
        { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] },
      )
      .toMatch(/^Retro/);

    const final = (await textObject(ada, id))!.text;
    expect((final.match(/a/g) ?? []).length).toBe(6);
    expect((final.match(/b/g) ?? []).length).toBe(6);
    expect((await textObject(bob, id))!.text).toBe(final);
  });

  test('TC-30: everyone adds a heading at the same time and all are visible everywhere', async ({
    browser,
  }) => {
    const boardId = await createBoard();
    const pages: Page[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
      pages.push(await openBoardOnId(await browser.newContext(), boardId));
    }

    // All of them place a heading at the same moment, each in their own spot.
    await Promise.all(
      pages.map(async (page, i) => {
        await createTextAt(page, 120 + i * 30, 120 + i * 90);
        await page.keyboard.type(`Heading ${i + 1}`);
      }),
    );

    const expectedTexts = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Heading ${i + 1}`);
    let shared: string[] | null = null;
    for (const page of pages) {
      await expect
        .poll(async () => (await textObjects(page)).map((obj) => obj.text).sort(), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
          intervals: [100],
        })
        .toEqual(expectedTexts);
      const ids = (await textObjects(page)).map((obj) => obj.id).sort();
      expect(new Set(ids).size).toBe(MAX_CONCURRENT_EDITORS);
      await expect(page.getByTestId('text-object')).toHaveCount(MAX_CONCURRENT_EDITORS);
      if (shared === null) shared = ids;
      else expect(ids).toEqual(shared); // every screen holds the same objects
    }
  });

  test('TC-31: text abandoned without a character leaves nothing behind', async ({ browser }) => {
    const boardId = await createBoard();
    const page = await openBoardOnId(await browser.newContext(), boardId);

    const id = await createTextAt(page, 400, 300);
    await expect.poll(() => textObject(page, id)).toBeDefined();

    // Escape with zero characters: the object is removed, not left invisible.
    await page.keyboard.press('Escape');
    await expect.poll(() => textObjects(page).then((list) => list.length)).toBe(0);
    await expect(page.getByTestId('text-object')).toHaveCount(0);

    // A marquee over the same spot selects nothing.
    await marqueeDrag(page, 350, 250, 620, 460);
    expect(await getSelectedIds(page)).toHaveLength(0);
  });
});
