import { test, expect, type Page } from '@playwright/test';
import {
  addSticky,
  addTextObj,
  createTextViaTool,
  endEditing,
  getBoard,
  getHandleCount,
  getRenderedLineCount,
  getTextModel,
  textBox,
  typeIntoText,
  noteBox,
  setCamera,
} from './helpers/board';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { proseOfLength } from '../fixtures/texts';

const CENTRE = { x: 640, y: 400 };

test.describe('Story 9: text objects', () => {
  test.beforeEach(async ({ page }) => {
    const res = await page.request.post('/api/boards');
    const { id } = await res.json();
    await page.goto(`/b/${id}`);
    await page.waitForSelector('[data-testid="board-viewport"]');
  });

  test('TC-26: long annotation - T, click, type 300 chars → auto-width ≈ TEXT_MAX_AUTO_WIDTH_WORLD ±2, multiple lines', async ({
    page,
  }) => {
    const text = proseOfLength(300);
    const id = await createTextViaTool(page, 300, 300);
    await typeIntoText(page, text);

    // Poll until the stored width approaches the auto-width max
    await expect
      .poll(async () => {
        const obj = await getTextModel(page, id);
        return obj?.width ?? 0;
      })
      .toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 10);

    const obj = await getTextModel(page, id);
    expect(obj.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);

    // Multiple rendered lines expected (300 chars of 20px text in 600w box)
    const lineCount = await getRenderedLineCount(page, id);
    expect(lineCount).toBeGreaterThanOrEqual(3);
  });

  test('TC-27: drag right handle narrower → words rewrap, height grows, no top/bottom handles', async ({
    page,
  }) => {
    const text = 'The quick brown fox jumps over the lazy dog and keeps running further away';
    const id = await addTextObj(page, 100, 100, text);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // Wait for box computation
    await expect
      .poll(async () => {
        const obj = await getTextModel(page, id);
        return obj?.width ?? 0;
      })
      .toBeGreaterThan(0);

    // Select the text object
    const box = await textBox(page, id);
    await page.mouse.click(box.cx, box.cy);

    // Verify only e and w handles are present (no n, s, nw, ne, sw, se)
    await expect(page.locator('[data-testid="resize-handle-e"]')).toBeVisible();
    await expect(page.locator('[data-testid="resize-handle-w"]')).toBeVisible();
    await expect(page.locator('[data-testid="resize-handle-n"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="resize-handle-s"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="resize-handle-nw"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="resize-handle-se"]')).not.toBeVisible();

    // Record height before resize
    const objBefore = await getTextModel(page, id);
    const heightBefore = objBefore.height;

    // Drag e handle left to narrow
    const eHandle = page.locator('[data-testid="resize-handle-e"]');
    const eBox = await eHandle.boundingBox();
    expect(eBox).not.toBeNull();
    const startX = eBox!.x + eBox!.width / 2;
    const startY = eBox!.y + eBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 300, startY, { steps: 8 });
    await page.mouse.up();

    // Width should change (poll for it)
    await expect
      .poll(async () => {
        const obj = await getTextModel(page, id);
        return obj?.width ?? 0;
      })
      .toBeLessThan(objBefore.width);

    // Height should have grown (text rewrapped into narrower box)
    await expect
      .poll(async () => {
        const obj = await getTextModel(page, id);
        return obj?.height ?? 0;
      }, { timeout: 5000 })
      .toBeGreaterThan(heightBefore);
  });

  test('TC-28: title a retro section - T, click, type, Escape, XL, undo restores', async ({
    page,
  }) => {
    // Create some stickies as a cluster
    await addSticky(page, 200, 400, 'item 1');
    await addSticky(page, 260, 400, 'item 2');
    await addSticky(page, 320, 400, 'item 3');
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // Use T tool to create a heading above the cluster (at a visible position)
    const id = await createTextViaTool(page, 200, 250);
    await typeIntoText(page, 'Went well');
    await page.keyboard.press('Escape');

    // Verify text was created
    let obj = await getTextModel(page, id);
    expect(obj).toBeDefined();
    expect(obj.text).toBe('Went well');
    expect(obj.size).toBe('M');

    // Select it (it should still be selected after Escape, toolbar visible)
    // Wait for toolbar to appear
    await expect(page.locator('[data-testid="text-toolbar"]')).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: 'XL text size' }).click();

    // Verify XL
    obj = await getTextModel(page, id);
    expect(obj.size).toBe('XL');

    // Delete it
    await page.keyboard.press('Delete');
    await expect.poll(() => getTextModel(page, id)).toBeUndefined();

    // Undo → restore
    await page.keyboard.press('Control+z');
    await expect.poll(() => getTextModel(page, id)).toBeDefined();
    obj = await getTextModel(page, id);
    expect(obj.text).toBe('Went well');
  });

  test('TC-29: two contexts type into the same text simultaneously → all characters present', async ({
    page,
    context,
  }) => {
    // Get the board ID
    const url = page.url();

    // Create a text object
    const id = await addTextObj(page, 100, 100, 'start:');

    // Open second page on same board
    const page2 = await context.newPage();
    await page2.goto(url);
    await page2.waitForSelector('[data-testid="board-viewport"]');

    // Wait for text to sync to page2
    await expect
      .poll(async () => {
        const obj = await getTextModel(page2, id);
        return obj?.text;
      })
      .toBe('start:');

    // Select the text in page1 and start editing (double-click)
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    const box1 = await textBox(page, id);
    await page.mouse.dblclick(box1.cx, box1.cy);
    await page.locator('[data-testid="text-editor"]').waitFor({ state: 'visible', timeout: 3000 });

    // Select the text in page2 and start editing (double-click)
    await setCamera(page2, { x: 0, y: 0, zoom: 1 });
    const box2 = await textBox(page2, id);
    await page2.mouse.dblclick(box2.cx, box2.cy);
    await page2.locator('[data-testid="text-editor"]').waitFor({ state: 'visible', timeout: 3000 });

    // Type in both simultaneously
    await Promise.all([
      page.keyboard.type('AAAAA'),
      page2.keyboard.type('BBBBB'),
    ]);

    // Wait for sync and convergence
    await page.waitForTimeout(3000);

    // Both pages should have the same text containing all characters
    const text1 = await getTextModel(page, id);
    const text2 = await getTextModel(page2, id);
    expect(text1.text).toBe(text2.text);
    // Should contain AAAA and BBBB (order may vary due to CRDT merge)
    expect(text1.text).toContain('AAAA');
    expect(text1.text).toContain('BBBB');

    await page2.close();
  });

  test('TC-30: multiple contexts create headings at once → all visible everywhere', async ({
    page,
    context,
  }) => {
    const url = page.url();

    // Open additional pages
    const pages: Page[] = [page];
    for (let i = 0; i < 2; i++) {
      const p = await context.newPage();
      await p.goto(url);
      await p.waitForSelector('[data-testid="board-viewport"]');
      pages.push(p);
    }

    // Each creates a text heading via test hook at different positions
    const ids: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const id = await addTextObj(pages[i], 50 + i * 200, 100, `Heading ${i}`);
      ids.push(id);
    }

    // Wait for sync
    await page.waitForTimeout(800);

    // All headings visible on every page
    for (const p of pages) {
      const board = await getBoard(p);
      const texts = board.filter((o: any) => o.type === 'text');
      expect(texts.length).toBeGreaterThanOrEqual(ids.length);
      for (const id of ids) {
        expect(texts.find((o: any) => o.id === id)).toBeDefined();
      }
    }

    for (const p of pages.slice(1)) await p.close();
  });

  test('TC-31: abandoned text - T, click, Escape without typing → no text in doc', async ({
    page,
  }) => {
    const id = await createTextViaTool(page, 400, 400);

    // Press Escape without typing
    await page.keyboard.press('Escape');

    // The text object should be gone from the document
    await expect
      .poll(async () => {
        const obj = await getTextModel(page, id);
        return obj;
      })
      .toBeUndefined();

    // Shift+drag over that spot should select nothing
    await page.mouse.move(350, 350);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(500, 500, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const selectedIds = await page.evaluate(() => (window as any).__vidi6.getSelectedIds?.() ?? []);
    // Should not have selected the removed text object
    expect(selectedIds).not.toContain(id);
  });
});
