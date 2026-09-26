import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { MAX_CONCURRENT_EDITORS, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { startBoard, joinBoard, expectConnected, setCamera } from './helpers/live';

/**
 * Story 9 e2e (TC-26 to TC-31): the Text tool and text objects in real
 * browsers — real fonts measure the box, the real sync server carries edits.
 */

const VIEWPORT = { width: 1280, height: 800 };
const cameraPin = { x: 0, y: 0, zoom: 1 };

async function pinCamera(page: Page): Promise<void> {
  await setCamera(page, cameraPin);
}

/** Press T, click at a screen point; returns the id of the new text object. */
async function createTextAt(page: Page, at: { x: number; y: number }): Promise<string> {
  const before = new Set(await textIds(page));
  await page.keyboard.press('t');
  await page.mouse.click(at.x, at.y);
  let id = '';
  await expect
    .poll(async () => {
      id = (await textIds(page)).find((candidate) => !before.has(candidate)) ?? '';
      return id;
    })
    .not.toBe('');
  return id;
}

async function textIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="text-object-"]')].map((element) =>
      String(element.getAttribute('data-testid')).slice('text-object-'.length),
    ),
  );
}

const textObject = (page: Page, id: string) =>
  page.locator(`[data-testid="text-object-${id}"]`);
const textareaOf = (page: Page, id: string) =>
  page.locator(`[data-testid="text-textarea-${id}"]`);

async function textBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await textObject(page, id).boundingBox();
  if (box === null) throw new Error(`text object ${id} is not on screen`);
  return box;
}

async function openClients(
  browser: Browser,
  count: number,
): Promise<{ pages: Page[]; close(): Promise<void> }> {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  let boardId = '';
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext({ viewport: VIEWPORT });
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    if (i === 0) {
      boardId = await startBoard(page);
      await expectConnected(page);
    } else {
      await joinBoard(page, boardId);
    }
  }
  for (const p of pages) await pinCamera(p);
  return {
    pages,
    async close() {
      await Promise.all(contexts.map((c) => c.close()));
    },
  };
}

test.describe('Text e2e (single board)', () => {
  test('TC-26: a long annotation caps at the auto width and renders several lines', async ({
    page,
  }) => {
    await startBoard(page);
    await pinCamera(page);
    const id = await createTextAt(page, { x: 340, y: 200 });
    const sentence =
      'The quick brown fox jumps over the lazy dog near the riverbank while the sun sets behind the distant mountains casting long golden shadows across the quiet meadow and nobody writes anything shorter than this line on this board at all. ';
    const fixture = (sentence + ' ').repeat(3).slice(0, 300);
    expect(fixture.length).toBe(300);
    await page.keyboard.type(fixture, { delay: 0 });
    await page.keyboard.press('Escape');

    const box = await textBox(page, id);
    expect(Math.abs(box.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
    const lineHeight = TEXT_SIZES.M * 1.3;
    expect(box.height).toBeGreaterThanOrEqual(3 * lineHeight);
    // The whole annotation is present in the rendered text.
    const rendered = ((await textObject(page, id).innerText()) ?? '').trim();
    expect(rendered).toBe(fixture.trimEnd());
  });

  test('TC-27: dragging the right handle narrower rewraps and grows the height', async ({
    page,
  }) => {
    await startBoard(page);
    await pinCamera(page);
    const id = await createTextAt(page, { x: 340, y: 200 });
    await page.keyboard.type(
      'The quick brown fox jumps over the lazy dog near the riverbank while the sun sets behind the mountains',
      { delay: 0 },
    );
    await page.keyboard.press('Escape');

    const before = await textBox(page, id);
    // Only side handles exist for a text selection.
    await expect(page.locator('[data-testid="resize-handle-n"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="resize-handle-s"]')).toHaveCount(0);
    const handle = page.locator('[data-testid="resize-handle-e"]');
    await expect(handle).toHaveCount(1);
    const hb = await handle.boundingBox();
    if (hb === null) throw new Error('no e handle');

    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 - 200, hb.y + hb.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = await textBox(page, id);
    expect(Math.abs(after.width - (before.width - 200))).toBeLessThanOrEqual(2);
    expect(after.height).toBeGreaterThan(before.height);
  });

  test('TC-28 golden path: title, size XL, drag, delete, undo restores', async ({
    page,
  }) => {
    await startBoard(page);
    await pinCamera(page);
    const id = await createTextAt(page, { x: 300, y: 300 });
    await page.keyboard.type('Went well', { delay: 5 });
    await page.keyboard.press('Escape');

    // Still selected: the size toolbar shows XL.
    await expect(page.locator('[data-testid="text-toolbar"]')).toBeVisible();
    await page.locator('[data-testid="text-size-XL"]').click();
    await expect(textObject(page, id)).toContainText('Went well');
    const grown = await textBox(page, id);
    expect(grown.height).toBeGreaterThan(TEXT_SIZES.XL);

    // Drag it away from the cluster.
    const box = await textBox(page, id);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 250, box.y + box.height / 2 - 80, {
      steps: 8,
    });
    await page.mouse.up();
    const moved = await textBox(page, id);
    expect(moved.x).toBeGreaterThan(box.x + 100);

    // Delete removes it; Ctrl+Z puts the text back.
    await page.keyboard.press('Delete');
    await expect(textObject(page, id)).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(textObject(page, id)).toHaveCount(1);
    await expect(textObject(page, id)).toContainText('Went well');
    const restored = await textBox(page, id);
    expect(Math.abs(restored.x - moved.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(restored.y - moved.y)).toBeLessThanOrEqual(2);
  });

  test('TC-29: two people typing into one text keep every character', async ({
    browser,
  }) => {
    const { pages, close } = await openClients(browser, 2);
    const ann = pages[0];
    const raj = pages[1];
    try {
      const id = await createTextAt(ann, { x: 400, y: 300 });
      await ann.keyboard.type('start:', { delay: 5 });
      // Both join the same text at the same time.
      await textObject(raj, id).dblclick();
      await expect(textareaOf(raj, id)).toBeVisible();
      await Promise.all([
        ann.keyboard.type('AAA', { delay: 40 }),
        raj.keyboard.type('bbb', { delay: 40 }),
      ]);
      await ann.keyboard.press('Escape');
      await raj.keyboard.press('Escape');

      const merged = async (page: Page): Promise<string> =>
        ((await textObject(page, id).innerText()) ?? '').trim();
      await expect
        .poll(async () => (await merged(ann)) === (await merged(raj)), { timeout: 5000 })
        .toBe(true);
      const text = await merged(ann);
      expect([...text].filter((c) => c === 'A').length).toBe(3);
      expect([...text].filter((c) => c === 'b').length).toBe(3);
      expect(text).toContain('start:');
    } finally {
      await close();
    }
  });

  test('TC-30: every editor places a heading at once', async ({ browser }) => {
    const { pages, close } = await openClients(browser, MAX_CONCURRENT_EDITORS);
    try {
      await Promise.all(
        pages.map(async (page, index) => {
          // A grid so no two headings share a spot.
          const at = { x: 180 + (index % 3) * 380, y: 220 + Math.floor(index / 3) * 260 };
          await page.keyboard.press('t');
          await page.mouse.click(at.x, at.y);
          await page.keyboard.type(`Heading ${index + 1}`, { delay: 5 });
          await page.keyboard.press('Escape');
        }),
      );
      const want = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Heading ${i + 1}`);
      for (const page of pages) {
        await expect(page.locator('[data-testid^="text-object-"]')).toHaveCount(
          MAX_CONCURRENT_EDITORS,
          { timeout: 10_000 },
        );
        for (const heading of want) {
          await expect(
            page.locator(`[data-testid^="text-object-"]:has-text("${heading}")`),
          ).toHaveCount(1);
        }
      }
    } finally {
      await close();
    }
  });

  test('TC-31: abandoned text leaves nothing behind', async ({ page }) => {
    await startBoard(page);
    await pinCamera(page);
    const before = await textIds(page);
    await page.keyboard.press('t');
    await page.mouse.click(500, 400);
    await expect(page.locator('[data-testid^="text-textarea-"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid^="text-textarea-"]')).toHaveCount(0);
    expect(await textIds(page)).toEqual(before);

    // A marquee over the spot selects nothing.
    await page.mouse.move(350, 300);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(750, 550, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(page.locator('[data-testid="selection-bar"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="text-object-"][data-selected="true"]')).toHaveCount(0);
    await expect(page.locator('[data-selected="true"]')).toHaveCount(0);
  });
});
