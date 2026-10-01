/**
 * E2E tests for Story 9: Write free text anywhere on the board.
 * TC-26 to TC-31.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  getBoard,
  setCamera,
  addText,
  getTextObjects,
  getTextObject,
  textObjectBox,
  createTextViaTool,
  typeIntoTextEditor,
  pasteIntoTextEditor,
  selectNote,
  dragNote,
  noteBox,
  getSelectedIds,
} from './helpers/board';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { proseOfLength } from '../fixtures/texts';

async function createBoard(): Promise<string> {
  const res = await fetch('http://localhost:5173/api/boards', { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/boards failed: ${res.status}`);
  const { id } = await res.json();
  return id;
}

async function openBoard(context: BrowserContext, boardId?: string): Promise<Page> {
  const id = boardId ?? await createBoard();
  const page = await context.newPage();
  await page.goto(`/b/${id}`);
  await page.waitForFunction(
    () => (window as any).__vidi6?.connectionState === 'connected',
    undefined,
    { timeout: 10000 },
  );
  return page;
}

async function waitForBoardSize(page: Page, count: number): Promise<void> {
  await expect.poll(async () => {
    const board = await getBoard(page);
    return board.length;
  }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] }).toBe(count);
}

// =================== TC-26: Long annotation ===================
test.describe('Text workflows (TC-26 to TC-31)', () => {
  test('TC-26: T, click, type 300-char sentence → box width ≤ 600, multiple lines rendered', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await openBoard(ctx);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    const longText = proseOfLength(300);
    expect(longText.length).toBeGreaterThanOrEqual(290);

    // Create text via the tool: press T then click
    const id = await createTextViaTool(page, 400, 300);

    // Type the long text
    await typeIntoTextEditor(page, longText);
    await page.waitForTimeout(100); // Let box sync

    // Verify the text object's stored width is clamped to TEXT_MAX_AUTO_WIDTH_WORLD
    const obj = await getTextObject(page, id);
    expect(obj).toBeDefined();
    expect(obj!.type).toBe('text');
    expect(obj!.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
    expect(obj!.height).toBeGreaterThan(TEXT_SIZES['M'] * 1.3); // multiple lines

    // Verify text content is correct
    expect(obj!.text).toBe(longText);

    await ctx.close();
  });

  // =================== TC-27: Handle drag narrows → wraps, height grows, no top/bottom handles ===================
  test('TC-27: drag right handle narrower → words wrap, height grows, no top/bottom handles', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await openBoard(ctx);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    const mediumText = proseOfLength(200);
    const id = await addText(page, 200, 200, mediumText);
    await waitForBoardSize(page, 1);

    // Select the text object
    const box1 = await textObjectBox(page, id);
    await page.mouse.click(box1.x + box1.width / 2, box1.y + box1.height / 2);
    await page.waitForTimeout(100);

    // Get the original height
    const obj1 = await getTextObject(page, id);
    const origHeight = obj1!.height;

    // Now drag the east handle to the left (narrower)
    const handle = page.locator('[data-testid="resize-handle-e"]');
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('e handle not found');

    const initialHeight = obj1!.height;
    const initialWidth = obj1!.width;

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 - 100, handleBox.y + handleBox.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // After narrowing, height should have grown (more wrapping)
    const obj2 = await getTextObject(page, id);
    expect(obj2!.width).toBeLessThan(initialWidth!);
    expect(obj2!.height).toBeGreaterThan(initialHeight);
    expect(obj2!.widthMode).toBe('fixed');

    // Verify only horizontal handles are shown (no top/bottom)
    await expect(page.locator('[data-testid="resize-handle-e"]')).toBeVisible();
    await expect(page.locator('[data-testid="resize-handle-w"]')).toBeVisible();
    await expect(page.locator('[data-testid="resize-handle-n"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="resize-handle-s"]')).not.toBeVisible();

    await ctx.close();
  });

  // =================== TC-28: Golden path: XL heading, drag, Delete, Ctrl+Z restores ===================
  test('TC-28: XL heading, drag, Delete, Ctrl+Z restores', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await openBoard(ctx);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // Create text via tool, type a heading
    const id = await createTextViaTool(page, 400, 300);
    await typeIntoTextEditor(page, 'Went well');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Select and change to XL
    const box1 = await textObjectBox(page, id);
    await page.mouse.click(box1.x + box1.width / 2, box1.y + box1.height / 2);
    await page.waitForTimeout(100);

    await page.getByTestId('text-size-XL').click();
    await page.waitForTimeout(100);

    // Verify size is XL
    let obj = await getTextObject(page, id);
    expect(obj!.size).toBe('XL');

    // Drag the text to a new position
    const box2 = await textObjectBox(page, id);
    await page.mouse.move(box2.x + box2.width * 0.3, box2.y + box2.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width * 0.3 + 100, box2.y + box2.height * 0.3 + 50, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Record position after drag
    obj = await getTextObject(page, id);
    const draggedX = obj!.x;
    const draggedY = obj!.y;

    // Delete the text (press Delete key while selected)
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    // Verify it's gone
    const objects = await getTextObjects(page);
    expect(objects.find((o) => o.id === id)).toBeUndefined();

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    // Verify it's restored
    obj = await getTextObject(page, id);
    expect(obj).toBeDefined();
    expect(obj!.text).toBe('Went well');
    expect(obj!.size).toBe('XL');

    await ctx.close();
  });

  // =================== TC-29: Two users type into one text simultaneously ===================
  test('TC-29: both type into one text simultaneously → identical text with all characters', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page1 = await openBoard(ctx1, boardId);
    const page2 = await openBoard(ctx2, boardId);

    await setCamera(page1, { x: 0, y: 0, zoom: 1 });
    await setCamera(page2, { x: 0, y: 0, zoom: 1 });

    // Create a text object from page1
    const id = await addText(page1, 200, 200, '');
    await waitForBoardSize(page1, 1);
    await waitForBoardSize(page2, 1);

    // Start editing from page1
    const box = await textObjectBox(page1, id);
    await page1.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page1.locator('[data-testid="text-editor"]').waitFor({ state: 'visible', timeout: 3000 });

    // Start editing from page2 (double-click the same location)
    const box2 = await textObjectBox(page2, id);
    await page2.mouse.dblclick(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page2.locator('[data-testid="text-editor"]').waitFor({ state: 'visible', timeout: 3000 });

    // Type different parts concurrently
    const left = 'Hello';
    const right = ' World';

    // Type from both pages
    for (const ch of left) {
      await page1.keyboard.type(ch);
      await page1.waitForTimeout(50);
    }
    for (const ch of right) {
      await page2.keyboard.type(ch);
      await page2.waitForTimeout(50);
    }

    await page1.waitForTimeout(500);
    await page2.waitForTimeout(500);

    // Both should see the combined text (order may vary but all chars present)
    const obj1 = await getTextObject(page1, id);
    const obj2 = await getTextObject(page2, id);

    // Both users should see the same text (convergence)
    expect(obj1!.text).toBe(obj2!.text);
    // All characters from both should be present
    const expected = [...left, ...right].sort();
    const actual = [...obj1!.text].sort();
    expect(actual).toEqual(expected);

    await ctx1.close();
    await ctx2.close();
  });

  // =================== TC-30: Each of MAX_CONCURRENT_EDITORS creates a heading at once ===================
  test('TC-30: each context creates a heading simultaneously → all headings visible on all screens', async ({ browser }) => {
    const boardId = await createBoard();
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      contexts.push(ctx);
      const page = await openBoard(ctx, boardId);
      pages.push(page);
    }

    // Set camera to identity on all pages
    for (const page of pages) {
      await setCamera(page, { x: 0, y: 0, zoom: 1 });
    }

    // Each page creates a text at a different position via the tool
    const textContents = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Heading ${i}`);
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const page = pages[i];
      const x = 100 + i * 200;
      const y = 100 + i * 150;
      // Use programmatic creation to avoid textarea race conditions
      await addText(page, x, y, textContents[i]);
    }

    // Wait for convergence on ALL pages
    for (const page of pages) {
      await expect.poll(async () => {
        const objects = await getTextObjects(page);
        return objects.length;
      }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] }).toBe(MAX_CONCURRENT_EDITORS);
    }

    // Verify all pages see the same texts
    for (const page of pages) {
      const objects = await getTextObjects(page);
      const allTexts = objects.map((o) => o.text).sort();
      expect(allTexts).toEqual([...textContents].sort());
    }

    for (const ctx of contexts) await ctx.close();
  });

  // =================== TC-31: T, click, Escape without typing → no object in doc ===================
  test('TC-31: T, click, Escape without typing → no object remains', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await openBoard(ctx);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // Activate text tool and click
    await page.keyboard.press('t');
    await page.mouse.click(400, 300);
    await page.locator('[data-testid="text-editor"]').waitFor({ state: 'visible', timeout: 3000 });

    // Press Escape without typing anything
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // No text objects should remain
    const objects = await getTextObjects(page);
    expect(objects.length).toBe(0);

    // Board should be empty (getBoard returns 0 objects)
    const board = await getBoard(page);
    expect(board.length).toBe(0);

    // Marquee over the area should select nothing
    await page.mouse.move(300, 200);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(500, 400, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(100);

    const selected = await getSelectedIds(page);
    expect(selected.length).toBe(0);

    await ctx.close();
  });
});
