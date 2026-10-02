/**
 * Story 9 end-to-end: free text anywhere on the board.
 * TC-26 to TC-31 — heading next to a note, a long multi-line annotation sized
 * XL and rewrapped by hand, abandoned text, two people typing in the same
 * window, five people creating text at once, and IME composition.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { addSticky, createBoard, getBoard } from './helpers/board';
import { MAX_CONCURRENT_EDITORS, TEXT_LINE_HEIGHT, TEXT_SIZES } from '../../src/shared/config';

/** A text object as stored (the shared snapshot, untyped on purpose). */
interface TextObj {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  size?: string;
  widthMode?: string;
  text?: string;
}

async function openBoard(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(
    () => (window as any).__vidi6?.connectionState === 'connected',
    undefined,
    { timeout: 10000 },
  );
  return page;
}

async function objects(page: Page): Promise<TextObj[]> {
  return (await getBoard(page)) as unknown as TextObj[];
}

async function textObjects(page: Page): Promise<TextObj[]> {
  return (await objects(page)).filter((o) => o.type === 'text');
}

async function textObject(page: Page, id: string): Promise<TextObj | undefined> {
  return (await textObjects(page)).find((o) => o.id === id);
}

/** Activate the text tool and click empty board space; returns the new text id. */
async function createTextAt(page: Page, x: number, y: number): Promise<string> {
  await page.keyboard.press('t');
  await page.mouse.click(x, y);
  await page.getByTestId('text-editor').waitFor({ state: 'visible', timeout: 5000 });
  // Ask this client which object it opened: another participant's text may have
  // arrived in the meantime, so diffing the board would be ambiguous.
  const id = (await page.evaluate(() => (window as any).__vidi6.getEditingId())) as string | null;
  if (!id) throw new Error('the text tool did not open a new text object');
  return id;
}

/** Stored box plus what the browser actually rendered for one text object. */
async function textMetrics(
  page: Page,
  id: string,
): Promise<{
  stored: TextObj;
  fontSize: number;
  rootHeight: number;
  scrollHeight: number;
  scrollWidth: number;
  clientWidth: number;
  background: string;
}> {
  return page.evaluate((objId) => {
    const root = document.querySelector<HTMLElement>(
      `[data-testid="text-object"][data-object-id="${objId}"]`,
    );
    if (!root) throw new Error(`text object ${objId} is not rendered`);
    const text = root.querySelector<HTMLElement>(`[data-testid="text-object-text"]`)!;
    const stored = (window as any).__vidi6
      .getBoard()
      .find((o: any) => o.id === objId);
    return {
      stored,
      fontSize: parseFloat(getComputedStyle(text).fontSize),
      rootHeight: root.getBoundingClientRect().height,
      scrollHeight: text.scrollHeight,
      scrollWidth: text.scrollWidth,
      clientWidth: text.clientWidth,
      background: getComputedStyle(root).backgroundColor,
    };
  }, id);
}

async function handleBox(page: Page, side: 'e' | 'w'): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(`resize-handle-${side}`).boundingBox();
  if (!box) throw new Error(`handle ${side} not found`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function selectText(page: Page, id: string): Promise<void> {
  // Click the object itself (the text tool is off, so objects take pointers).
  const b = await page.locator(`[data-object-id="${id}"]`).boundingBox();
  if (!b) throw new Error(`text ${id} not rendered`);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

async function waitForTextCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => (await textObjects(page)).length, { timeout: 10000, intervals: [150] })
    .toBe(count);
}

test.describe('Free text on the board', () => {
  test('TC-26: a heading created next to a note has no background of its own', async ({
    page,
  }) => {
    const boardId = await createBoard();
    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected');

    // A sticky note for comparison.
    const noteId = await addSticky(page, 300, 300, 'Retro');
    await page.mouse.move(10, 10);

    const id = await createTextAt(page, 620, 330);
    await page.keyboard.type('Kickoff');
    await page.keyboard.press('Escape');

    const stored = (await textObject(page, id))!;
    expect(stored.text).toBe('Kickoff');
    expect(stored.size).toBe('M');
    // Plain text, unlike the note's paper.
    const m = await textMetrics(page, id);
    expect(m.background).toBe('rgba(0, 0, 0, 0)');
    expect(m.fontSize).toBeCloseTo(TEXT_SIZES.M, 1);
    expect(m.rootHeight).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 0);
    // The note keeps its background.
    const noteBg = await page.evaluate(
      (nid) => getComputedStyle(document.querySelector<HTMLElement>(`[data-note-id="${nid}"]`)!).backgroundColor,
      noteId,
    );
    expect(noteBg).not.toBe('rgba(0, 0, 0, 0)');
    // Board coordinates, not screen coordinates.
    const board = await objects(page);
    expect(board).toHaveLength(2);
    expect(stored.x).toBeGreaterThan(0);
  });

  test('TC-27: a long multi-line annotation fits its box, sizes up and rewraps', async ({
    page,
  }) => {
    const boardId = await createBoard();
    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected');

    const long =
      'The retry budget was too small for the cold start path, so the first request after a deploy failed while the worker was still warming up.';
    const id = await createTextAt(page, 120, 120);
    await page.keyboard.type(long);
    await page.keyboard.press('Escape');

    let m = await textMetrics(page, id);
    expect(m.stored.text).toBe(long);
    expect(m.stored.widthMode).toBe('auto');
    expect(m.stored.width!).toBeLessThanOrEqual(600);
    // Nothing is clipped or overflowing: the box is the text.
    expect(m.scrollHeight).toBeLessThanOrEqual(m.stored.height! + 1);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth + 1);
    expect(m.rootHeight).toBeCloseTo(m.stored.height!, 0);
    const lines = Math.round(m.stored.height! / (TEXT_SIZES.M * TEXT_LINE_HEIGHT));
    expect(lines).toBeGreaterThan(1);

    // XL from the toolbar: the font changes and the box re-measures in place.
    await selectText(page, id);
    const before = (await textObject(page, id))!;
    await page.getByTestId('text-size-XL').click();
    await expect
      .poll(async () => (await textObject(page, id))!.size)
      .toBe('XL');
    m = await textMetrics(page, id);
    expect(m.fontSize).toBeCloseTo(TEXT_SIZES.XL, 1);
    expect(m.stored.x).toBeCloseTo(before.x, 0);
    expect(m.stored.y).toBeCloseTo(before.y, 0);
    // Fewer characters fit per line, so the same words take more lines.
    expect(m.stored.height!).toBeGreaterThan(before.height!);
    expect(Math.round(m.stored.height! / (TEXT_SIZES.XL * TEXT_LINE_HEIGHT))).toBeGreaterThan(1);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth + 1);

    // Drag the east handle inwards: the width follows the pointer, the height rewraps.
    const wide = (await textObject(page, id))!;
    const pos = await handleBox(page, 'e');
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    await page.mouse.move(pos.x - 120, pos.y, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => (await textObject(page, id))!.widthMode)
      .toBe('fixed');
    m = await textMetrics(page, id);
    expect(m.stored.width!).toBeCloseTo(wide.width! - 120, 0);
    expect(m.stored.height!).toBeGreaterThan(wide.height!);
    expect(Math.round(m.stored.height! / (TEXT_SIZES.XL * TEXT_LINE_HEIGHT))).toBeGreaterThan(
      Math.round(wide.height! / (TEXT_SIZES.XL * TEXT_LINE_HEIGHT)),
    );
    // Still no overflow: the stored height is the wrapped text.
    expect(m.scrollHeight).toBeLessThanOrEqual(m.stored.height! + 1);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth + 1);
  });

  test('TC-28: text that is never typed into disappears and can be retried', async ({ page }) => {
    const boardId = await createBoard();
    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected');

    // First attempt, abandoned with Escape.
    await createTextAt(page, 400, 300);
    await page.keyboard.press('Escape');
    expect(await objects(page)).toHaveLength(0);

    // Second attempt, abandoned with an outside click.
    await createTextAt(page, 500, 300);
    await page.mouse.click(200, 600);
    await expect.poll(async () => (await objects(page)).length).toBe(0);

    // Third attempt is typed into and stays.
    const id = await createTextAt(page, 600, 300);
    await page.keyboard.type('Keep me');
    await page.keyboard.press('Escape');
    const board = await objects(page);
    expect(board).toHaveLength(1);
    expect((await textObject(page, id))!.text).toBe('Keep me');
  });

  test('TC-29: two people typing in different text at once both keep their own words', async ({
    browser,
  }) => {
    const boardId = await createBoard();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await openBoard(ctxA, boardId);
    const b = await openBoard(ctxB, boardId);

    // Each creates their own text through the Text tool, at the same time.
    const [idA, idB] = await Promise.all([createTextAt(a, 200, 300), createTextAt(b, 700, 300)]);
    await waitForTextCount(a, 2);
    await waitForTextCount(b, 2);
    expect(idA).not.toBe(idB);

    // Both type into their own text inside the same window.
    await Promise.all([a.keyboard.type('Going well'), b.keyboard.type('Blocked')]);

    // Exactly what each typed, on both screens — no interleaving.
    await expect.poll(async () => (await textObject(a, idA))!.text, { timeout: 10000 }).toBe('Going well');
    await expect.poll(async () => (await textObject(b, idA))!.text, { timeout: 10000 }).toBe('Going well');
    await expect.poll(async () => (await textObject(a, idB))!.text, { timeout: 10000 }).toBe('Blocked');
    await expect.poll(async () => (await textObject(b, idB))!.text, { timeout: 10000 }).toBe('Blocked');

    // One author's box is theirs: A sizes their text up, B's is untouched.
    await selectText(a, idA);
    // A sizes their own text up from the toolbar, without leaving the caret.
    await a.getByTestId('text-size-L').click();
    await expect.poll(async () => (await textObject(a, idA))!.size, { timeout: 5000 }).toBe('L');
    await expect.poll(async () => (await textObject(b, idA))!.size, { timeout: 10000 }).toBe('L');
    expect((await textObject(b, idB))!.size).toBe('M');

    // Undo is per author: A undoes their own text change and B's words stay.
    await a.keyboard.press('Control+z');
    await expect.poll(async () => (await textObject(b, idA))!.text, { timeout: 10000 }).toBe('');
    expect((await textObject(a, idB))!.text).toBe('Blocked');
    expect((await textObject(b, idB))!.text).toBe('Blocked');

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-30: every participant sees the headings the others create at the same moment', async ({
    browser,
  }) => {
    const boardId = await createBoard();
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      pages.push(await openBoard(ctx, boardId));
    }

    // Everybody switches to the Text tool and clicks at the same moment.
    await Promise.all(
      pages.map(async (p, i) => {
        await p.keyboard.press('t');
        await p.mouse.click(200 + i * 90, 150 + i * 70);
        await p.keyboard.type(`Heading ${i}`);
        await p.keyboard.press('Escape');
      }),
    );

    // All headings are visible on every screen.
    for (const p of pages) {
      await expect
        .poll(
          async () =>
            (await textObjects(p))
              .map((o) => o.text)
              .sort()
              .join('|'),
          { timeout: 15000, intervals: [200] },
        )
        .toBe(
          Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Heading ${i}`)
            .sort()
            .join('|'),
        );
    }

    for (const ctx of contexts) await ctx.close();
  });

  test('TC-31: an IME composition only lands in the document once it is committed', async ({
    page,
  }) => {
    const boardId = await createBoard();
    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected');

    const id = await createTextAt(page, 400, 400);

    // Synthetic composition: candidate text, then the commit.
    const compose = async (phase: 'start' | 'update' | 'end', data: string) => {
      await page.evaluate(
        ({ phase, value }) => {
          const el = document.querySelector<HTMLTextAreaElement>('[data-testid="text-editor"]')!;
          el.focus();
          el.value = value;
          const init: any = { bubbles: true, data: value };
          if (phase === 'start') el.dispatchEvent(new CompositionEvent('compositionstart', init));
          if (phase === 'update') {
            el.dispatchEvent(new CompositionEvent('compositionupdate', init));
            el.dispatchEvent(new InputEvent('input', { ...init, isComposing: true }));
          }
          if (phase === 'end') {
            el.dispatchEvent(new CompositionEvent('compositionend', init));
            el.dispatchEvent(new InputEvent('input', { ...init, isComposing: false }));
          }
        },
        { phase, value: data },
      );
    };

    await compose('start', '');
    await compose('update', '\u4f60'); // candidate in the textarea only
    expect((await textObject(page, id))!.text ?? '').toBe('');

    await compose('end', '\u4f60\u597d'); // committed
    await expect.poll(async () => (await textObject(page, id))!.text).toBe('\u4f60\u597d');
    const m = await textMetrics(page, id);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth + 1);

    // A keystroke while composing or while editing reaches the text, never the tool.
    await page.keyboard.press('t');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA');
    expect((await textObject(page, id))!.text).toBe('\u4f60\u597dt');
    const pressed = await page.evaluate(() => (window as any).__vidi6.getTool());
    expect(pressed).toBe('select');

    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (window as any).__vidi6.getTool())).toBe('select');
  });
});
