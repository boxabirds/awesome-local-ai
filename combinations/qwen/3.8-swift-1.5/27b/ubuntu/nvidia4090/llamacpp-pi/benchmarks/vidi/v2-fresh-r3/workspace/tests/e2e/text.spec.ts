import { test, expect, type Page } from '@playwright/test';
import {
  openBoardPath,
  createNotesAt,
  getNotesState,
} from './helpers/board';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';

/**
 * Story 9 — free text E2E (TC-26 to TC-31).
 *
 * Real browsers + real sync server. At the default camera (0,0,1) world
 * coordinates equal screen coordinates, so text created at world (x, y) is at
 * screen (x, y).
 */

/** A 300-character fixture of words (for the long-annotation tests). */
const LONG_300 = ('The quick brown fox jumps over the lazy dog. ').repeat(7).slice(0, 300);

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

/** Reads the text objects straight from the Yjs document. */
function getTextState(page: Page): Promise<TextState[]> {
  return page.evaluate(() => {
    const doc = (window as any).__vidi6.getDoc();
    const out: TextState[] = [];
    doc.getMap('objects').forEach((obj: any, id: string) => {
      if (obj.get('type') !== 'text') return;
      out.push({
        id,
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: obj.get('width') as number,
        height: obj.get('height') as number,
        size: obj.get('size') as string,
        widthMode: obj.get('widthMode') as string,
        text: (obj.get('text') as any)?.toString() ?? '',
      });
    });
    return out;
  });
}

/** Creates text objects via the test hook and returns their ids. */
function createTextAt(
  page: Page,
  specs: { x: number; y: number; text?: string; size?: string }[],
): Promise<string[]> {
  return page.evaluate((s) => (window as any).__vidi6.createTextAt(s), specs);
}

/**
 * Polls `fn` until `pred` is true (Playwright's `expect.poll` has no
 * `toSatisfy`, so a small helper covers the async-convergence assertions).
 */
async function pollFor<T>(
  fn: () => Promise<T>,
  pred: (v: T) => boolean,
  timeoutMs = 10000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (pred(v)) return v;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`pollFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Shift+drag marquee from (x1,y1) by (dx,dy). */
async function marqueeDrag(page: Page, x1: number, y1: number, dx: number, dy: number) {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + dx, y1 + dy, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

test.describe('text.e2e (@playwright/test, chromium)', () => {
  test('TC-26: long annotation — 300 chars cap the auto width at 600 and wrap to several lines', async ({
    page,
  }) => {
    await openBoardPath(page.context().request, page);

    // Press T, click, type the fixture.
    await page.keyboard.press('t');
    await page.mouse.click(100, 100);
    const textarea = page.getByTestId('text-textarea');
    await textarea.waitFor();
    await page.keyboard.type(LONG_300);
    await page.keyboard.press('Escape');

    const [t] = await pollFor(
      async () => getTextState(page),
      (ts) => ts.length === 1 && ts[0].text.length === 300,
    );

    // Width capped at the auto max (±2 for font metrics).
    expect(t.width).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 2);
    expect(t.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);

    // Several rendered lines (height = lines × size × line-height).
    const lineH = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
    const lines = Math.round(t.height / lineH);
    expect(lines).toBeGreaterThanOrEqual(3);

    // Auto width mode.
    expect(t.widthMode).toBe('auto');
  });

  test('TC-27: dragging the east handle narrower rewraps (height grows); no n/s handles', async ({
    page,
  }) => {
    await openBoardPath(page.context().request, page);

    // A long text at (100,100) → auto width 600.
    const [id] = await createTextAt(page, [{ x: 100, y: 100, text: LONG_300 }]);
    await pollFor(
      async () => getTextState(page),
      (ts) => (ts.find((x) => x.id === id)?.width ?? 0) > 500,
    );

    // Select the text (click inside its box).
    await page.mouse.click(300, 110);
    await expect(page.locator(`[data-text-id="${id}"]`)).toHaveAttribute('data-selected', 'true');

    // Only horizontal handles exist.
    await expect(page.getByTestId('resize-handle-e')).toBeVisible();
    await expect(page.getByTestId('resize-handle-w')).toBeVisible();
    await expect(page.getByTestId('resize-handle-n')).toHaveCount(0);
    await expect(page.getByTestId('resize-handle-s')).toHaveCount(0);

    const before = (await getTextState(page)).find((x) => x.id === id)!;
    expect(before.widthMode).toBe('auto');

    // Drag the east handle 200px to the left → fixed width ~400.
    const hb = await page
      .getByTestId('resize-handle-e')
      .boundingBox();
    const hx = hb!.x + hb!.width / 2;
    const hy = hb!.y + hb!.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx - 200, hy, { steps: 10 });
    await page.mouse.up();

    const after = (await getTextState(page)).find((x) => x.id === id)!;
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeCloseTo(before.width - 200, 0);
    // Rewrapping to a narrower box grows the height.
    expect(after.height).toBeGreaterThan(before.height);
  });

  test('TC-28: title a retro section — create, XL, marquee with the cluster, delete, undo restores', async ({
    page,
  }) => {
    await openBoardPath(page.context().request, page);

    // A cluster of three notes.
    const [a, b, c] = await createNotesAt(page, [
      { x: 400, y: 450 },
      { x: 600, y: 450 },
      { x: 500, y: 600 },
    ]);

    // T, click above the cluster, type a title, Escape.
    await page.keyboard.press('t');
    await page.mouse.click(350, 250);
    const textarea = page.getByTestId('text-textarea');
    await textarea.waitFor();
    await page.keyboard.type('Went well');
    await page.keyboard.press('Escape');

    const [title] = await pollFor(
      async () => getTextState(page),
      (ts) => ts.length === 1 && ts[0].text === 'Went well',
    );

    // Select the title → the text toolbar shows; click XL.
    await page.mouse.click(350, 250);
    await expect(page.getByTestId('text-toolbar')).toBeVisible();
    await page.getByLabel('Size XL').click();
    await pollFor(
      async () => getTextState(page),
      (ts) => ts.find((x) => x.id === title.id)?.size === 'XL',
    );

    // Marquee over the title and the cluster → 4 selected (the rect must
    // fully contain all four objects: notes span x 300–700, y 350–700;
    // the XL title spans roughly x 350–550, y 250–300). marqueeDrag takes
    // start + delta: (290,240) → (710,710).
    await marqueeDrag(page, 290, 240, 420, 470);
    await expect(page.getByTestId('selection-count')).toHaveText('4 selected');

    // Delete removes all four.
    await page.keyboard.press('Delete');
    await pollFor(
      async () => ({
        texts: (await getTextState(page)).length,
        notes: (await getNotesState(page)).length,
      }),
      (v) => v.texts === 0 && v.notes === 0,
    );
    await expect(page.locator(`[data-note-id="${a}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-note-id="${b}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-note-id="${c}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-text-id="${title.id}"]`)).toHaveCount(0);

    // Ctrl+Z restores the deletion (one step). getNotesState lists every
    // object, so 4 = the three notes + the text.
    await page.keyboard.press('Control+z');
    await pollFor(
      async () => ({
        texts: (await getTextState(page)).length,
        objects: (await getNotesState(page)).length,
      }),
      (v) => v.texts === 1 && v.objects === 4,
    );
    const restored = (await getTextState(page))[0];
    expect(restored.text).toBe('Went well');
    expect(restored.size).toBe('XL');
  });

  test('TC-29: two contexts type into the same text simultaneously → identical text with every character', async ({
    page,
    browser,
  }) => {
    const boardId = await openBoardPath(page.context().request, page);

    // A second context opens the same board.
    const ctx = await browser.newContext();
    const pageB = await ctx.newPage();
    await pageB.goto(`/b/${boardId}`);
    await expect(pageB.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });

    // One shared text with a short seed so both can click into it.
    const [id] = await createTextAt(page, [{ x: 200, y: 200, text: 'Hi ' }]);
    // Both contexts see it.
    await expect
      .poll(async () => pageB.locator(`[data-text-id="${id}"]`).count(), { timeout: 10000 })
      .toBe(1);

    // Both start editing the same object.
    await page.mouse.click(215, 210);
    await page.keyboard.press('Enter');
    await page.getByTestId('text-textarea').waitFor();

    await pageB.mouse.click(215, 210);
    await pageB.keyboard.press('Enter');
    await pageB.getByTestId('text-textarea').waitFor();

    // Simultaneous typing on one Y.Text: A at the end, B at the start
    // (non-colliding positions; each side's merge keeps the local view
    // current, so every character survives).
    await page.keyboard.type('Hello');
    await pageB.keyboard.press('Control+Home');
    await pageB.keyboard.type('world');

    await page.keyboard.press('Escape');
    await pageB.keyboard.press('Escape');

    // Both documents converge to the identical string containing every char:
    // seed 'Hi ' + 'Hello' + 'world' = 13 characters.
    const [ta, tb] = await pollFor(
      async () => [
        (await getTextState(page)).find((x) => x.id === id)?.text ?? '',
        (await getTextState(pageB)).find((x) => x.id === id)?.text ?? '',
      ],
      ([xa, xb]) => xa === xb && xa.length === 13,
    );

    expect(ta).toBe(tb);
    for (const chunk of ['Hi', 'Hello', 'world']) {
      expect(ta).toContain(chunk);
    }
    await ctx.close();
  });

  test('TC-30: five contexts each create a heading at once → all headings visible on every screen', async ({
    page,
    browser,
  }) => {
    const boardId = await openBoardPath(page.context().request, page);

    // Five contexts (MAX_CONCURRENT_EDITORS), each driving the Text tool.
    const pages: Page[] = [page];
    const ctxs = [];
    for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
      const c = await browser.newContext();
      ctxs.push(c);
      const p = await c.newPage();
      await p.goto(`/b/${boardId}`);
      await expect(p.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });
      pages.push(p);
    }

    await Promise.all(
      pages.map(async (p, i) => {
        await p.keyboard.press('t');
        await p.mouse.click(100 + i * 150, 100);
        const ta = p.getByTestId('text-textarea');
        await ta.waitFor();
        await p.keyboard.type(`Heading ${i + 1}`);
        await p.keyboard.press('Escape');
      }),
    );

    // Every screen shows all five headings.
    for (const p of pages) {
      await pollFor(
        async () => getTextState(p),
        (ts) =>
          ts.length === MAX_CONCURRENT_EDITORS &&
          Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Heading ${i + 1}`).every(
            (h) => ts.some((t) => t.text === h),
          ),
        15000,
      );
      // All five are rendered in the DOM on this screen.
      await expect
        .poll(async () => p.locator(`[data-text-id]`).count(), { timeout: 10000 })
        .toBe(MAX_CONCURRENT_EDITORS);
    }

    for (const c of ctxs) await c.close();
  });

  test('TC-31: abandoned text — T, click, Escape without typing → no object; marquee selects nothing', async ({
    page,
  }) => {
    await openBoardPath(page.context().request, page);

    // T, click, Escape without typing.
    await page.keyboard.press('t');
    await page.mouse.click(300, 300);
    await page.getByTestId('text-textarea').waitFor();
    await page.keyboard.press('Escape');

    // No text object in the doc (and the tool is back to Select).
    expect(await getTextState(page)).toHaveLength(0);
    await expect(page.getByLabel('Select (V)')).toHaveAttribute('aria-pressed', 'true');

    // A marquee over the spot selects nothing.
    await marqueeDrag(page, 250, 250, 100, 100);
    await expect(page.getByTestId('selection-overlay')).toHaveCount(0);
    await expect(page.getByTestId('selection-count')).toHaveCount(0);
  });
});
