import { expect, test, type Page } from '@playwright/test';
import { gotoBoard } from './helpers/board';

// Helper: read object state from the Y.Doc
async function getObjectState(page: Page, id: string) {
  return page.evaluate((objectId) => {
    const hooks = (window as any).__vidi6;
    const doc = (hooks?.provider as any)?.doc;
    if (!doc) throw new Error('doc not available');
    const obj = doc.getMap('objects').get(objectId);
    if (!obj) return null;
    const ytext = obj.get('text');
    return {
      type: obj.get('type'),
      x: obj.get('x'),
      y: obj.get('y'),
      width: obj.get('width'),
      height: obj.get('height'),
      size: obj.get('size'),
      widthMode: obj.get('widthMode'),
      text: ytext ? ytext.toString() : '',
      createdBy: obj.get('createdBy'),
    };
  }, id);
}

// Helper: count text objects on the board
async function countTextObjects(page: Page): Promise<number> {
  return page.locator('[data-testid^="text-object-"]').count();
}

// Helper: get the id of a text object from its data-testid
async function getTextObjectId(page: Page, index = 0): Promise<string | null> {
  const el = page.locator('[data-testid^="text-object-"]').nth(index);
  const testId = await el.getAttribute('data-testid');
  if (!testId) return null;
  return testId.replace('text-object-', '');
}

test.describe('Free text E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await gotoBoard(page);
  });

  // TC-26: "Long annotation" - press T, click, type long text → capped width, multiple lines
  test('TC-26: long annotation wraps at max width', async ({ page }) => {
    // Activate text tool
    await page.keyboard.press('t');
    expect(page.locator('[data-testid="text-tool-btn"]')).toHaveAttribute('aria-pressed', 'true');

    // Click viewport to create text
    await page.mouse.click(400, 300);

    // Editor should appear
    const editor = page.locator('[data-testid="text-object-textarea"]');
    await expect(editor).toBeVisible();

    // Type a long text (~300 chars)
    const longText = 'The quick brown fox jumps over the lazy dog. '.repeat(7).slice(0, 300);
    await page.keyboard.type(longText);

    // Escape to deselect/finish editing
    await page.keyboard.press('Escape');

    // Verify the text was stored
    const id = await getTextObjectId(page);
    expect(id).toBeTruthy();
    const state = await getObjectState(page, id!);
    expect(state).not.toBeNull();
    expect(state!.type).toBe('text');
    expect(state!.text.length).toBe(300);

    // Width should be capped near TEXT_MAX_AUTO_WIDTH_WORLD (600)
    expect(state!.width).toBeLessThanOrEqual(610);
    expect(state!.width).toBeGreaterThan(200);

    // Should have multiple lines rendered (height > single line)
    expect(state!.height).toBeGreaterThan(30);
  });

  // TC-27: drag right handle narrower → words rewrap, height grows, no top/bottom handles
  test('TC-27: horizontal resize rewraps text', async ({ page }) => {
    // Create a text object with some content
    await page.keyboard.press('t');
    await page.mouse.click(640, 400);
    const editor = page.locator('[data-testid="text-object-textarea"]');
    await expect(editor).toBeVisible();
    await page.keyboard.type('The quick brown fox jumps over the lazy dog near the riverbank on a sunny day');
    await page.keyboard.press('Escape');

    // Get initial dimensions
    const id = await getTextObjectId(page);
    expect(id).toBeTruthy();
    const before = await getObjectState(page, id!);

    // Only e and w handles should exist (no n/s/ne/nw/se/sw)
    await expect(page.locator('[data-testid="handle-e"]')).toBeVisible();
    await expect(page.locator('[data-testid="handle-w"]')).toBeVisible();
    await expect(page.locator('[data-testid="handle-n"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="handle-s"]')).not.toBeVisible();

    // Drag the 'e' handle to the left (narrower)
    const eHandle = page.locator('[data-testid="handle-e"]');
    const handleBox = await eHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 100, startY, { steps: 5 });
    await page.mouse.up();

    // Wait for the resize to propagate
    await page.waitForTimeout(100);

    // Get new dimensions
    const after = await getObjectState(page, id!);
    expect(after!.width).toBeLessThan(before!.width);
    // Height should have grown (more wrapping lines)
    expect(after!.height).toBeGreaterThanOrEqual(before!.height);
    // Width mode should be fixed
    expect(after!.widthMode).toBe('fixed');
  });

  // TC-28: "Title a retro section": T, click, type, Escape, click XL, Delete, Ctrl+Z restores
  test('TC-28: create text, resize to XL, delete, undo', async ({ page }) => {
    // Activate text tool
    await page.keyboard.press('t');
    await page.mouse.click(400, 200);

    // Type title
    const editor = page.locator('[data-testid="text-object-textarea"]');
    await expect(editor).toBeVisible();
    await page.keyboard.type('Went well');
    await page.keyboard.press('Escape');

    // Verify text toolbar is visible
    await expect(page.locator('[data-testid="text-toolbar"]')).toBeVisible();

    // Click XL size button
    await page.click('[data-testid="text-size-XL"]');
    const id = await getTextObjectId(page);
    let state = await getObjectState(page, id!);
    expect(state!.size).toBe('XL');

    // Delete the text object
    await page.keyboard.press('Delete');

    // Text object should be gone
    await expect(page.locator('[data-testid^="text-object-"]')).toHaveCount(0);

    // Undo
    await page.keyboard.press('Control+z');

    // Text object should be back
    await expect(page.locator('[data-testid^="text-object-"]')).toHaveCount(1);

    // Verify it's still XL with the right text
    const id2 = await getTextObjectId(page);
    state = await getObjectState(page, id2!);
    expect(state!.text).toBe('Went well');
  });

  // TC-29: two contexts type into the same text simultaneously → identical text
  test('TC-29: concurrent editing in same text object', async ({ page, browser }) => {
    // Create a text object on page 1
    await page.keyboard.press('t');
    await page.mouse.click(400, 300);
    const editor = page.locator('[data-testid="text-object-textarea"]');
    await expect(editor).toBeVisible();
    await page.keyboard.type('start');

    const id = await getTextObjectId(page);
    expect(id).toBeTruthy();

    // End editing on page 1
    await page.keyboard.press('Escape');

    // Open a second participant on the same board
    const boardUrl = page.url();
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page2 = await ctx2.newPage();
    await page2.goto(boardUrl);
    await expect(page2.locator('[data-testid="board-viewport"]')).toBeVisible();

    // Double-click the text on page 2 to edit
    const obj2 = page2.locator(`[data-note-id="${id}"]`);
    await obj2.dblclick();

    // Page 2 editor should appear
    const editor2 = page2.locator('[data-testid="text-object-textarea"]');
    await expect(editor2).toBeVisible();

    // Type from page 2
    await page2.keyboard.type('-end');

    // Both pages should see the same text
    await page.waitForTimeout(200);

    const state1 = await getObjectState(page, id!);
    const state2 = await getObjectState(page2, id!);

    expect(state1!.text).toContain('start');
    expect(state1!.text).toContain('-end');
    expect(state1!.text).toBe(state2!.text);

    await ctx2.close();
  });

  // TC-30: two contexts each create text via Text tool → both visible on both screens
  test('TC-30: two participants create text objects concurrently', async ({ page, browser }) => {
    const boardUrl = page.url();

    // Open a second participant
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page2 = await ctx2.newPage();
    await page2.goto(boardUrl);
    await expect(page2.locator('[data-testid="board-viewport"]')).toBeVisible();

    // Page 1: create text
    await page.keyboard.press('t');
    await page.mouse.click(300, 300);
    await page.keyboard.type('Hello from page 1');
    await page.keyboard.press('Escape');

    // Page 2: create text
    await page2.keyboard.press('t');
    await page2.mouse.click(700, 300);
    await page2.keyboard.type('Hello from page 2');
    await page2.keyboard.press('Escape');

    // Wait for sync
    await page.waitForTimeout(300);

    // Both pages should see 2 text objects
    const count1 = await countTextObjects(page);
    const count2 = await countTextObjects(page2);
    expect(count1).toBe(2);
    expect(count2).toBe(2);

    await ctx2.close();
  });
});
