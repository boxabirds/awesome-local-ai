import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createBoard } from './helpers/board';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
  E2E_EVENTUAL_TIMEOUT_MS,
} from '../../src/shared/config';
import { ANNOTATION_300 } from '../fixtures/texts';

/**
 * Story 9 E2E: free text on the board.
 *
 * TC-26: 300-char annotation → stored width 600 ±2, renders multi-line
 * TC-27: drag the east handle narrower → re-wrap, height grows, no n/s handles
 * TC-28: Text tool above a sticky cluster → XL, move over cluster, delete, undo
 * TC-29: two contexts type the same text at once → identical, all characters
 * TC-30: 5 contexts create headings at once → all visible on every screen
 * TC-31: T, click, Escape without typing → no object; shift-drag selects nothing
 */

interface TextState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  size: string;
  text: string;
}

/** Read the board's text objects from the Y.Doc debug hook. */
async function getTexts(page: Page): Promise<TextState[]> {
  return page.evaluate(() => {
    const hook = (window as any).__VIDI_DEBUG__;
    if (!hook) throw new Error('Debug hook not available');
    const objects = hook.doc.getMap('objects');
    const texts: TextState[] = [];
    objects.forEach((obj: any, key: string) => {
      if (obj.get('type') === 'text') {
        texts.push({
          id: key,
          x: obj.get('x'),
          y: obj.get('y'),
          width: obj.get('width'),
          height: obj.get('height'),
          size: obj.get('size'),
          text: obj.get('text')?.toString() ?? '',
        });
      }
    });
    return texts;
  });
}

/** Create a sticky directly on the doc (test helper, like multi-select). */
async function createStickyOn(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.evaluate((p) => {
    const hook = (window as any).__VIDI_DEBUG__;
    const Y = (window as any).__VIDI_Y__;
    const doc = hook.doc;
    const objects = doc.getMap('objects');
    const id = Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
    let z = 1;
    objects.forEach((o: any) => {
      const oz = o.get('z');
      if (typeof oz === 'number' && oz >= z) z = oz + 1;
    });
    doc.transact(() => {
      objects.set(
        id,
        new Y.Map(
          Object.entries({
            id,
            type: 'sticky',
            x: p.x - 100,
            y: p.y - 100,
            color: 'yellow',
            text: new Y.Text(),
            z,
            createdAt: Date.now(),
          }),
        ),
      );
    });
  }, at);
}

async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  await page.evaluate((c) => (window as any).__vidi6.setCamera(c), cam);
  await page.waitForFunction(
    (c) => {
      const cur = (window as any).__vidi6.getCamera();
      return cur.x === c.x && cur.y === c.y && cur.zoom === c.zoom;
    },
    cam,
  );
}

/** Open a board in a context and wait for the hooks. */
async function openBoard(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await page.waitForFunction(() => !!(window as any).__VIDI_DEBUG__, undefined, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
  return page;
}

/** Activate the Text tool, click at screen (x, y) → a text object with an open editor. */
async function createTextAt(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('t');
  await page.mouse.click(x, y);
  await page.getByRole('textbox').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
}

/** End the text editor with Escape. */
async function endEdit(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
}

test.describe('story 9: free text', () => {
  // TC-26
  test('TC-26: 300-char annotation → stored width 600 ±2, renders multi-line', async ({ browser }) => {
    const boardId = await createBoard();
    const page = await openBoard(await browser.newContext(), boardId);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    await createTextAt(page, 400, 300);
    await page.keyboard.insertText(ANNOTATION_300);
    await endEdit(page);

    const texts = await getTexts(page);
    expect(texts).toHaveLength(1);
    const t = texts[0];
    expect(t.text).toBe(ANNOTATION_300);
    expect(t.width).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 2);
    expect(t.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
    // Multiple lines: taller than one line at M.
    expect(t.height).toBeGreaterThan(TEXT_SIZES.M * TEXT_LINE_HEIGHT * 1.5);
    // The rendered box shows the wrapped text.
    const el = page.getByTestId(`text-object-${t.id}`);
    await expect(el).toBeVisible();
    // Async: the post-Escape remeasure re-render is a tick later.
    await expect(el).toContainText(ANNOTATION_300.slice(0, 40));
  });

  // TC-27
  test('TC-27: drag the east handle narrower → re-wrap, height grows, no vertical handles', async ({ browser }) => {
    const boardId = await createBoard();
    const page = await openBoard(await browser.newContext(), boardId);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    await createTextAt(page, 300, 300);
    await page.keyboard.insertText(ANNOTATION_300);
    await endEdit(page);

    const before = (await getTexts(page))[0];
    expect(before.width).toBeCloseTo(TEXT_MAX_AUTO_WIDTH_WORLD, 0);

    // Select the text → only e/w handles exist.
    const obj = page.getByTestId(`text-object-${before.id}`);
    await obj.click();
    expect(await page.getByTestId('resize-handle-e').count()).toBe(1);
    expect(await page.getByTestId('resize-handle-w').count()).toBe(1);
    expect(await page.getByTestId('resize-handle-n').count()).toBe(0);
    expect(await page.getByTestId('resize-handle-s').count()).toBe(0);

    // Drag the east handle 200px to the left (narrower).
    const handle = page.getByTestId('resize-handle-e');
    const hb = (await handle.boundingBox())!;
    const hx = hb.x + hb.width / 2;
    const hy = hb.y + hb.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx - 200, hy, { steps: 8 });
    await page.mouse.up();

    const after = (await getTexts(page))[0];
    expect(after.width).toBeLessThan(before.width - 100);
    expect(after.height).toBeGreaterThan(before.height);
    // Now in fixed mode: still no vertical handles.
    expect(await page.getByTestId('resize-handle-n').count()).toBe(0);
    expect(await page.getByTestId('resize-handle-s').count()).toBe(0);
  });

  // TC-28
  test('TC-28: heading above a sticky cluster → XL, move, delete, undo restores', async ({ browser }) => {
    const boardId = await createBoard();
    const page = await openBoard(await browser.newContext(), boardId);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // A cluster of two stickies.
    await createStickyOn(page, { x: 500, y: 450 });
    await createStickyOn(page, { x: 700, y: 450 });

    // Text tool, click above the cluster, type a heading.
    await createTextAt(page, 560, 250);
    await page.keyboard.type('Went well');
    await endEdit(page);

    const [t] = await getTexts(page);
    expect(t.text).toBe('Went well');
    expect(t.size).toBe('M');

    // The text is selected after editing → the TextToolbar is shown.
    await page.getByRole('button', { name: 'Size XL' }).click();
    expect((await getTexts(page))[0].size).toBe('XL');

    // Drag the heading down over the cluster.
    const el = page.getByTestId(`text-object-${t.id}`);
    const box = (await el.boundingBox())!;
    const sx = box.x + box.width / 2;
    const sy = box.y + box.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 40, sy + 160, { steps: 8 });
    await page.mouse.up();
    const moved = (await getTexts(page))[0];
    expect(moved.y).toBeGreaterThan(t.y + 100);

    // Delete it…
    await page.keyboard.press('Delete');
    expect(await getTexts(page)).toHaveLength(0);

    // …and undo brings it back.
    await page.keyboard.press('Control+z');
    const restored = await getTexts(page);
    expect(restored).toHaveLength(1);
    expect(restored[0].text).toBe('Went well');
    expect(restored[0].size).toBe('XL');
  });

  // TC-29
  test('TC-29: two contexts type the same text at once → identical, all characters', async ({ browser }) => {
    const boardId = await createBoard();
    const page1 = await openBoard(await browser.newContext(), boardId);
    const page2 = await openBoard(await browser.newContext(), boardId);
    await setCamera(page1, { x: 0, y: 0, zoom: 1 });
    await setCamera(page2, { x: 0, y: 0, zoom: 1 });

    // Context 1 creates the text and starts typing.
    await createTextAt(page1, 400, 300);
    await page1.keyboard.type('Hello ');

    // Context 2 sees the object, opens it, and types at the same time.
    await expect
      .poll(async () => (await getTexts(page2)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(1);
    const id = (await getTexts(page2))[0].id;
    await page2.mouse.dblclick(410, 310);
    await page2.getByRole('textbox').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await page2.keyboard.type('world');

    await page2.keyboard.press('Escape');
    await page1.keyboard.press('Escape');

    // CRDT guarantee: both docs converge to the SAME text containing every
    // character both sides typed (interleaving at the shared caret is fine).
    const sorted = (s: string) => [...s].sort().join('');
    await expect
      .poll(
        async () => {
          const t1 = (await getTexts(page1))[0];
          const t2 = (await getTexts(page2))[0];
          return t1.text === t2.text && sorted(t1.text) === sorted('Hello world');
        },
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      )
      .toBe(true);

    // Both screens show the object with the merged text.
    await expect(page1.getByTestId(`text-object-${id}`)).toBeVisible();
    await expect(page2.getByTestId(`text-object-${id}`)).toBeVisible();
  });

  // TC-30
  test('TC-30: 5 contexts create headings at once → all visible on every screen', async ({ browser }) => {
    const boardId = await createBoard();
    const words = ['Alpha', 'Bravo', 'Cedar', 'Delta', 'Ember'];
    const pages: Page[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      pages.push(await openBoard(await browser.newContext(), boardId));
    }
    for (const p of pages) await setCamera(p, { x: 0, y: 0, zoom: 1 });

    // Each context creates its own heading with the Text tool.
    await Promise.all(
      pages.map(async (p, i) => {
        await createTextAt(p, 200 + i * 200, 200);
        await p.keyboard.type(words[i]);
        await p.keyboard.press('Escape');
      }),
    );

    // Every screen shows all five headings (poll: sync is eventually
    // consistent across the five contexts).
    for (let i = 0; i < pages.length; i++) {
      await expect
        .poll(
          async () => {
            const texts = await getTexts(pages[i]);
            const all = texts.map((t) => t.text).join('|');
            return texts.length === words.length && words.every((w) => all.includes(w));
          },
          { timeout: E2E_EVENTUAL_TIMEOUT_MS },
        )
        .toBe(true);
    }
  });

  // TC-31
  test('TC-31: T, click, Escape without typing → no object; shift-drag selects nothing', async ({ browser }) => {
    const boardId = await createBoard();
    const page = await openBoard(await browser.newContext(), boardId);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    await createTextAt(page, 400, 300);
    await endEdit(page);

    // No text object was created (and no invisible empty text lingers).
    expect(await getTexts(page)).toHaveLength(0);

    // Shift-drag over the position → empty marquee → no selection.
    await page.mouse.move(380, 280);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(500, 400, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    expect(await page.getByTestId('selection-overlay').count()).toBe(0);
    expect(await getTexts(page)).toHaveLength(0);
  });
});
