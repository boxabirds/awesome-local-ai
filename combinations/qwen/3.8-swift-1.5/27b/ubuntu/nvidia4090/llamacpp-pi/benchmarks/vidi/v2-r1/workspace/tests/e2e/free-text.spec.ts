import { test, expect, Page, Browser } from '@playwright/test';

/**
 * Story 9 e2e: free text workflows (TC-26..TC-31).
 *
 * The camera is set to (0, 0, 1) in every test, so screen coordinates equal
 * world coordinates (offset by the viewport centre: screen (640,400) is
 * world (0,0)).
 */

const BASE = 'http://localhost:8787';

/** Exactly 300 characters (PRD: long annotation fixture). */
const LONG_TEXT =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillu';

if (LONG_TEXT.length !== 300) {
  throw new Error(`LONG_TEXT must be exactly 300 characters, got ${LONG_TEXT.length}`);
}

async function createBoard(): Promise<string> {
  const resp = await fetch(`${BASE}/api/boards`, { method: 'POST' });
  if (resp.status !== 201) throw new Error(`board creation failed: ${resp.status}`);
  return ((await resp.json()) as { id: string }).id;
}

async function openBoardContext(browser: Browser, boardId: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/b/${boardId}`);
  await page.getByTestId('board-viewport').waitFor({ state: 'visible', timeout: 20_000 });
  await page.evaluate(() => (window as any).__vidi6.setCamera(0, 0, 1));
  return page;
}

/** Press the Text tool, then click the board at screen (x, y). */
async function startTextAt(page: Page, x: number, y: number): Promise<void> {
  await page.getByLabel('Text (T)').click();
  await page.mouse.click(x, y);
}

/** The stored box of the (single) text object, in world units. */
async function textBox(page: Page): Promise<{ w: number; h: number }> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="text-object"]');
    if (!el) return { w: -1, h: -1 };
    return { w: parseFloat(el.style.width), h: parseFloat(el.style.height) };
  });
}

async function textCount(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelectorAll('[data-testid="text-object"]').length,
  );
}

test.describe('TC-26: long annotation wraps at the max auto width', () => {
  test('300 characters produce a 600-unit-wide box with several lines', async ({ page }) => {
    const boardId = await createBoard();
    await page.goto(`${BASE}/b/${boardId}`);
    await page.getByTestId('board-viewport').waitFor({ state: 'visible', timeout: 20_000 });
    await page.evaluate(() => (window as any).__vidi6.setCamera(0, 0, 1));

    await startTextAt(page, 640, 400);
    await page.keyboard.type(LONG_TEXT);
    // Let the final re-measure land.
    await page.waitForTimeout(300);

    const box = await textBox(page);
    expect(box.w).toBeGreaterThanOrEqual(598);
    expect(box.w).toBeLessThanOrEqual(602);
    // Several rendered lines: one line at M is 26 world units tall.
    expect(box.h).toBeGreaterThan(26 * 3);
  });
});

test.describe('TC-27: narrowing a text rewraps it', () => {
  test('dragging the right handle narrower grows the height; no top/bottom handles', async ({ page }) => {
    const boardId = await createBoard();
    await page.goto(`${BASE}/b/${boardId}`);
    await page.getByTestId('board-viewport').waitFor({ state: 'visible', timeout: 20_000 });
    await page.evaluate(() => (window as any).__vidi6.setCamera(0, 0, 1));

    // ~40 chars ≈ one line wide.
    await startTextAt(page, 640, 400);
    await page.keyboard.type('The quick brown fox jumps over the lazy dog');
    await page.keyboard.press('Escape'); // end editing, text stays selected
    await page.waitForTimeout(200);

    const before = await textBox(page);

    // No top/bottom handles for a single text selection.
    expect(page.getByTestId('resize-handle-n')).toHaveCount(0);
    expect(page.getByTestId('resize-handle-s')).toHaveCount(0);
    expect(page.getByTestId('resize-handle-e')).toHaveCount(1);
    expect(page.getByTestId('resize-handle-w')).toHaveCount(1);

    // Drag the east handle left (narrower) by 150 world/screen units.
    const handle = page.getByTestId('resize-handle-e');
    const hb = await handle.boundingBox();
    expect(hb).not.toBeNull();
    const cx = hb!.x + hb!.width / 2;
    const cy = hb!.y + hb!.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 150, cy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await textBox(page);
    expect(after.w).toBeLessThan(before.w);
    // Words rewrapped into more lines → the box is taller.
    expect(after.h).toBeGreaterThan(before.h);
  });
});

test.describe('TC-28: golden path — heading, size, move, delete, undo', () => {
  test('XL heading above a cluster; drag it; Delete; Ctrl+Z restores it', async ({ page }) => {
    const boardId = await createBoard();
    await page.goto(`${BASE}/b/${boardId}`);
    await page.getByTestId('board-viewport').waitFor({ state: 'visible', timeout: 20_000 });
    await page.evaluate(() => (window as any).__vidi6.setCamera(0, 0, 1));

    // A cluster of stickies around the origin.
    await page.evaluate(() => (window as any).__vidi6.seedNotes([
      { x: -150, y: 50 }, { x: 150, y: 50 }, { x: 0, y: 200 },
    ]));

    // T, click above the cluster, type the heading, Escape.
    await startTextAt(page, 640, 400 - 250);
    await page.keyboard.type('Went well');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Click XL in the text toolbar.
    await page.getByLabel('Size XL').click();
    await page.waitForTimeout(200);

    const boxBefore = await textBox(page);
    expect(boxBefore.h).toBeGreaterThan(26); // XL line is 56*1.3 tall

    // Drag the heading down over the cluster.
    const el = page.getByTestId('text-object');
    const eb = await el.boundingBox();
    expect(eb).not.toBeNull();
    const topBefore = await el.evaluate((n) => parseFloat(n.style.top));
    await page.mouse.move(eb!.x + 10, eb!.y + 10);
    await page.mouse.down();
    await page.mouse.move(eb!.x + 10, eb!.y + 250, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const boxAfterMove = await textBox(page);
    expect(boxAfterMove.h).toBe(boxBefore.h);
    // It moved down ~250 world units.
    const topAfter = await el.evaluate((n) => parseFloat(n.style.top));
    expect(topAfter).toBeGreaterThan(topBefore + 100);

    // Delete the heading.
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    expect(await textCount(page)).toBe(0);

    // Ctrl+Z restores it (text, size and position).
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    expect(await textCount(page)).toBe(1);
    const restored = await page.getByTestId('text-object').textContent();
    expect(restored).toContain('Went well');
    const boxRestored = await textBox(page);
    expect(boxRestored.h).toBe(boxBefore.h);
  });
});

test.describe('TC-29: concurrent typing into one text', () => {
  test('two clients typing into the same text converge on all characters', async ({ browser }) => {
    const boardId = await createBoard();
    const a = await openBoardContext(browser, boardId);
    const b = await openBoardContext(browser, boardId);

    // A creates the text and starts editing.
    await startTextAt(a, 640, 400);
    await a.keyboard.type('Hello ');
    // Give B time to see the object, then B starts editing the same text.
    await a.waitForTimeout(500);
    await b.getByTestId('text-object').dblclick();
    await b.waitForTimeout(300);

    // Both type (interleaved) into the same object.
    await a.keyboard.type('brave');
    await b.keyboard.type(' new');

    await a.waitForTimeout(600);
    await b.waitForTimeout(600);

    const va = await a.getByTestId('text-editor').inputValue();
    const vb = await b.getByTestId('text-editor').inputValue();
    // Identical merged text on both screens, containing every character
    // typed (concurrent end-of-text insertions may interleave, so compare
    // the character multiset, not substring order).
    expect(va).toBe(vb);
    const sorted = (s: string) => [...s].sort().join('');
    expect(sorted(va)).toBe(sorted('Hello brave new'));

    await a.context().close();
    await b.context().close();
  });
});

test.describe('TC-30: MAX_CONCURRENT_EDITORS headings at once', () => {
  test('five contexts each create a heading; all are visible on every screen', async ({ browser }) => {
    const boardId = await createBoard();
    const pages: Page[] = [];
    for (let i = 0; i < 5; i++) {
      pages.push(await openBoardContext(browser, boardId));
    }

    // Each context creates a heading at its own spot.
    for (let i = 0; i < 5; i++) {
      await startTextAt(pages[i], 440 + i * 100, 400);
      // Wait for the editor to be focused before typing (no lost characters).
      const editor = pages[i].getByTestId('text-editor');
      await editor.waitFor({ state: 'visible', timeout: 5_000 });
      await editor.focus();
      await pages[i].keyboard.type(`H${i + 1}`);
      await expect(editor).toHaveValue(`H${i + 1}`);
      await pages[i].keyboard.press('Escape');
    }

    // Every screen shows all five headings.
    for (const p of pages) {
      await p.waitForTimeout(400);
      const count = await textCount(p);
      expect(count).toBe(5);
      const texts = await p.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[data-testid="text-object"]'))
          .map((el) => el.textContent)
          .sort(),
      );
      expect(texts).toEqual(['H1', 'H2', 'H3', 'H4', 'H5']);
    }

    for (const p of pages) await p.context().close();
  });
});

test.describe('TC-31: abandoned text leaves no object', () => {
  test('T, click, Escape without typing → no object; marquee selects nothing', async ({ page }) => {
    const boardId = await createBoard();
    await page.goto(`${BASE}/b/${boardId}`);
    await page.getByTestId('board-viewport').waitFor({ state: 'visible', timeout: 20_000 });
    await page.evaluate(() => (window as any).__vidi6.setCamera(0, 0, 1));

    await startTextAt(page, 640, 400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // No text object in the doc.
    expect(await textCount(page)).toBe(0);

    // A marquee over the spot selects nothing.
    await page.keyboard.down('Shift');
    await page.mouse.move(560, 320);
    await page.mouse.down();
    await page.mouse.move(760, 520, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(200);

    expect(page.getByTestId('selection-overlay')).toHaveCount(0);
  });
});
