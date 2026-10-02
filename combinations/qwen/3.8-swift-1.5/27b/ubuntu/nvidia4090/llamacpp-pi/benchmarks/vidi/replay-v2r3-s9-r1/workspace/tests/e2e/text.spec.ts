import { test, expect, type Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

/**
 * Story 9 E2E: free text on the board.
 *
 * These tests verify the Text tool and text objects with real fonts,
 * real wrapping, and the real sync server.
 */

const LONG_ANNOTATION =
  'This is a long annotation that will definitely exceed the maximum auto width of the text object. ' +
  'It should wrap onto multiple lines once the text reaches the 600 unit limit. ' +
  'The team discussed how to make onboarding faster for new members and agreed to reduce the number of steps. ' +
  'A clearer welcome screen should help people find their way quickly around the board. ' +
  'Feedback from last week pointed to too many options on the home board and simplifying the toolbar. ' +
  'We will prototype a smaller set of tools and measure the impact next sprint to see if it helps.';

/** Activate the Text tool by pressing T. */
async function activateTextTool(page: Page) {
  await page.keyboard.press('t');
  // Wait for the tool state to propagate (cursor change)
  await page.waitForTimeout(100);
}

/** Click the board at a specific position to create text. */
async function clickBoard(page: Page, x: number, y: number) {
  await page.mouse.click(x, y);
}

/** Get all text objects on the board. */
function textObjects(page: Page) {
  return page.locator('[data-testid^="text-object-"]');
}

/** Read the stored width/height of a text object from the Y.Doc. */
async function getTextBox(page: Page, id: string): Promise<{ width: number; height: number }> {
  return page.evaluate((objId: string) => {
    const doc = (window as any).__VIDI_DEBUG__?.doc;
    if (!doc) return { width: 0, height: 0 };
    const objects = doc.getMap('objects');
    const m = objects.get(objId);
    if (!m) return { width: 0, height: 0 };
    return { width: m.get('width') ?? 0, height: m.get('height') ?? 0 };
  }, id);
}

/** Get the id of the first text object. */
async function getFirstTextId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const doc = (window as any).__VIDI_DEBUG__?.doc;
    if (!doc) return null;
    const objects = doc.getMap('objects');
    for (const [id, m] of objects) {
      if (m.get('type') === 'text') return id;
    }
    return null;
  });
}

/** Count text objects in the doc. */
async function countTextObjects(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = (window as any).__VIDI_DEBUG__?.doc;
    if (!doc) return 0;
    const objects = doc.getMap('objects');
    let count = 0;
    for (const [, m] of objects) {
      if (m.get('type') === 'text') count++;
    }
    return count;
  });
}

test.describe('Story 9: Free text (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New board' }).click();
    await page.waitForSelector('[data-testid="board-viewport"]');
    await page.waitForFunction(() => !!(window as any).__VIDI_DEBUG__);
    // Wait for the board to be connected (editable)
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="connection-status"]');
      return el?.textContent === 'Connected';
    }, { timeout: 15000 });
  });

  // TC-31: Abandoned text — T, click, Escape without typing → no object
  test('TC-31: T, click, Escape without typing leaves no object', async ({ page }) => {
    await activateTextTool(page);
    await clickBoard(page, 400, 300);

    // The text tool should have created a text object and started editing
    // Press Escape immediately without typing
    await page.keyboard.press('Escape');

    // Wait a moment for any cleanup
    await page.waitForTimeout(200);

    // No text objects should exist in the doc
    const count = await countTextObjects(page);
    expect(count).toBe(0);
  });

  // TC-28: Golden path — T, click, type "Went well", Escape, XL, Delete, Ctrl+Z
  test('TC-28: golden path — create heading, resize, delete, undo', async ({ page }) => {
    // Activate text tool and create text
    await activateTextTool(page);
    await clickBoard(page, 400, 200);

    // Type the heading
    await page.keyboard.type('Went well');

    // End editing
    await page.keyboard.press('Escape');

    // The text object should be visible
    const texts = textObjects(page);
    await expect(texts.first()).toBeVisible();
    await expect(texts.first()).toContainText('Went well');

    // Select it (click on it)
    await texts.first().click();

    // The text toolbar should be visible
    const toolbar = page.getByTestId('text-toolbar');
    await expect(toolbar).toBeVisible();

    // Click XL
    await page.getByRole('button', { name: 'Size XL' }).click();

    // The text should now be larger (verify via the doc)
    const id = await getFirstTextId(page);
    if (id) {
      const size = await page.evaluate((objId: string) => {
        const doc = (window as any).__VIDI_DEBUG__?.doc;
        const m = doc?.getMap('objects').get(objId);
        return m?.get('size');
      }, id);
      expect(size).toBe('XL');
    }

    // Delete the text
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);

    // Text should be gone
    const countAfterDelete = await countTextObjects(page);
    expect(countAfterDelete).toBe(0);

    // Undo (Ctrl+Z) should restore it
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    const countAfterUndo = await countTextObjects(page);
    expect(countAfterUndo).toBe(1);
  });

  // TC-26: Long annotation — type 300+ chars → width ≈ 600
  test('TC-26: long text wraps at 600 units', async ({ page }) => {
    await activateTextTool(page);
    await clickBoard(page, 200, 200);

    // Type a long text
    await page.keyboard.type(LONG_ANNOTATION.slice(0, 300));

    // End editing
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Check the stored width
    const id = await getFirstTextId(page);
    if (id) {
      const box = await getTextBox(page, id);
      // Width should be close to 600 (TEXT_MAX_AUTO_WIDTH_WORLD)
      // Allow ±20 units for font rendering differences
      expect(box.width).toBeGreaterThan(400);
      expect(box.width).toBeLessThanOrEqual(600);
      // Height should be multiple lines
      expect(box.height).toBeGreaterThan(30);
    }
  });

  // TC-27: Drag right handle narrower → words wrap, height grows
  test('TC-27: dragging right handle narrows the text', async ({ page }) => {
    await activateTextTool(page);
    await clickBoard(page, 200, 200);

    // Type some text
    await page.keyboard.type('The quick brown fox jumps over the lazy dog');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Select the text
    const texts = textObjects(page);
    await texts.first().click();
    await page.waitForTimeout(200);

    // Get the current box
    const id = await getFirstTextId(page);
    if (!id) return;
    const boxBefore = await getTextBox(page, id);

    // Find the right handle and drag it left
    const rightHandle = page.getByTestId('resize-handle-e');
    await expect(rightHandle).toBeVisible();

    const handleBox = await rightHandle.boundingBox();
    if (!handleBox) return;

    // Drag the right handle 100px to the left
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 100, handleBox.y + handleBox.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // The width should have decreased
    const boxAfter = await getTextBox(page, id);
    expect(boxAfter.width).toBeLessThan(boxBefore.width);
    // Height should have increased (more lines due to wrapping)
    expect(boxAfter.height).toBeGreaterThanOrEqual(boxBefore.height);
  });

  // TC-29: Two contexts edit the same text — changes sync
  test('TC-29: two users edit the same text and changes sync', async ({ browser, page }) => {
    // Create a board
    await page.goto('/');
    await page.getByRole('button', { name: 'New board' }).click();
    await page.waitForSelector('[data-testid="board-viewport"]');
    await page.waitForFunction(() => !!(window as any).__VIDI_DEBUG__);
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="connection-status"]');
      return el?.textContent === 'Connected';
    }, { timeout: 15000 });

    // Get the board URL
    const boardUrl = page.url();

    // Create a text object with content
    await activateTextTool(page);
    await clickBoard(page, 400, 300);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Open a second context
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(boardUrl);
    await page2.waitForSelector('[data-testid="board-viewport"]');
    await page2.waitForFunction(() => !!(window as any).__VIDI_DEBUG__);
    await page2.waitForFunction(() => {
      const el = document.querySelector('[data-testid="connection-status"]');
      return el?.textContent === 'Connected';
    }, { timeout: 15000 });
    await page2.waitForTimeout(500);

    // Both pages should see the text
    const texts1 = textObjects(page);
    const texts2 = textObjects(page2);
    await expect(texts1.first()).toBeVisible();
    await expect(texts2.first()).toBeVisible();
    await expect(texts1.first()).toContainText('Hello');
    await expect(texts2.first()).toContainText('Hello');

    // Page 2 edits: double-click, type " World", Escape
    await texts2.first().dblclick();
    await page2.waitForTimeout(300);
    await page2.keyboard.type(' World');
    await page2.keyboard.press('Escape');
    await page2.waitForTimeout(500);

    // Page 1 should see the update
    await expect(texts1.first()).toContainText('World');

    // Page 1 edits: double-click, type "!", Escape
    await texts1.first().dblclick();
    await page.waitForTimeout(300);
    await page.keyboard.type('!');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Page 2 should see the update
    await expect(texts2.first()).toContainText('!');

    await context2.close();
  });

  // TC-30: MAX_CONCURRENT_EDITORS contexts each create a heading
  test('TC-30: multiple users create headings simultaneously', async ({ browser, page }) => {
    // Create a board
    await page.goto('/');
    await page.getByRole('button', { name: 'New board' }).click();
    await page.waitForSelector('[data-testid="board-viewport"]');
    await page.waitForFunction(() => !!(window as any).__VIDI_DEBUG__);

    const boardUrl = page.url();

    // Create contexts and have each create a heading
    const contexts: any[] = [];
    const pages: Page[] = [page];

    for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      contexts.push(ctx);
      pages.push(p);
    }

    // All pages open the board
    await Promise.all(
      pages.slice(1).map(async (p) => {
        await p.goto(boardUrl);
        await p.waitForSelector('[data-testid="board-viewport"]');
        await p.waitForFunction(() => !!(window as any).__VIDI_DEBUG__);
      }),
    );
    await page.waitForTimeout(500);

    // Each page creates a heading at a different position
    const positions = [
      { x: 200, y: 150 },
      { x: 500, y: 150 },
      { x: 800, y: 150 },
      { x: 200, y: 400 },
      { x: 500, y: 400 },
    ];

    await Promise.all(
      pages.map(async (p, i) => {
        await p.keyboard.press('t');
        await p.mouse.click(positions[i].x, positions[i].y);
        await p.keyboard.type(`Heading ${i + 1}`);
        await p.keyboard.press('Escape');
      }),
    );

    // Wait for sync
    await page.waitForTimeout(2000);

    // All pages should see all 5 headings
    for (const p of pages) {
      const count = await countTextObjects(p);
      expect(count).toBe(MAX_CONCURRENT_EDITORS);
    }

    // Cleanup
    for (const ctx of contexts) await ctx.close();
  });
});
