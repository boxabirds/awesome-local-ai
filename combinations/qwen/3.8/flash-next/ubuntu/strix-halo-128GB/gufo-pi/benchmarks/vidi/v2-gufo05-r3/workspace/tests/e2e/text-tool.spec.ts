/**
 * E2E tests for the Text tool (story 9): TC-26 to TC-31.
 */
import { expect, test } from '@playwright/test';
import { gotoBoard } from './helpers/board';

async function activateTextTool(page: Parameters<typeof gotoBoard>[0]): Promise<void> {
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
}

async function getTextObjects(page: Parameters<typeof gotoBoard>[0]): Promise<any[]> {
  return page.evaluate(() => {
    const board = (window as any).__vidi6?.getBoard?.() ?? [];
    return board.filter((o: any) => o.type === 'text');
  });
}

/** Click the board with text tool, then wait for the textarea editor to appear and focus it. */
async function createTextWithEditor(page: Parameters<typeof gotoBoard>[0]): Promise<void> {
  await page.mouse.click(640, 400);
  // Wait for the text editor textarea to appear
  const editor = page.locator('[data-text-editor]');
  await editor.waitFor({ state: 'attached', timeout: 5000 });
  // Click to ensure focus is in the editor
  await editor.click();
}

test.describe('text tool', () => {
  test('TC-26 T activates text tool, click creates text, editor opens', async ({ page }) => {
    await gotoBoard(page);
    await activateTextTool(page);

    // Click on the board surface (near centre)
    await createTextWithEditor(page);

    // Text tool should be back to Select
    await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'false');

    // A text object was created
    const texts = await getTextObjects(page);
    expect(texts.length).toBe(1);
    expect(texts[0].type).toBe('text');
    expect(texts[0].size).toBe('M');
    expect(texts[0].widthMode).toBe('auto');
  });

  test('TC-27 typing in text editor, then Escape ends editing', async ({ page }) => {
    await gotoBoard(page);
    await activateTextTool(page);

    // Create text at centre and wait for editor
    await createTextWithEditor(page);

    // Type something
    await page.keyboard.type('Hello World', { delay: 20 });

    // Verify text was typed
    const value = await page.locator('[data-text-editor]').inputValue();
    expect(value).toBe('Hello World');

    // Press Escape to end editing
    await page.keyboard.press('Escape');

    // Wait for editor to close
    await expect(page.locator('[data-text-editor]')).toHaveCount(0, { timeout: 5000 });

    // Check text content was saved
    const texts = await getTextObjects(page);
    expect(texts.length).toBe(1);
    expect(texts[0].text).toBe('Hello World');
  });

  test('TC-28 empty text is removed on blur', async ({ page }) => {
    await gotoBoard(page);
    await activateTextTool(page);

    // Create text at centre
    await createTextWithEditor(page);

    // Immediately press Escape without typing anything
    await page.keyboard.press('Escape');

    // Wait for editor to close
    await expect(page.locator('[data-text-editor]')).toHaveCount(0);

    // The text object should be gone (empty text is deleted)
    const texts = await getTextObjects(page);
    expect(texts.length).toBe(0);
  });

  test('TC-29 select text, resize handles are horizontal only', async ({ page }) => {
    await gotoBoard(page);
    await activateTextTool(page);

    // Create text at centre
    await createTextWithEditor(page);
    await page.keyboard.type('Resizing test', { delay: 20 });
    await page.keyboard.press('Escape');

    // Wait for editing to end
    await expect(page.locator('[data-text-editor]')).toHaveCount(0);

    // Click to select the text object
    await page.mouse.click(640, 400);

    // Horizontal handles should be present
    const handles = page.locator('[data-resize-handle="w"], [data-resize-handle="e"]');
    await expect(handles.first()).toBeVisible({ timeout: 3000 });

    // Vertical handles should NOT be present for text objects
    const vHandles = page.locator('[data-resize-handle="n"], [data-resize-handle="s"]');
    await expect(vHandles).toHaveCount(0);
  });

  test('TC-30 toolbar size buttons change text size', async ({ page }) => {
    await gotoBoard(page);
    await activateTextTool(page);

    // Create text
    await createTextWithEditor(page);
    await page.keyboard.type('Size test', { delay: 20 });
    await page.keyboard.press('Escape');

    // Wait for editing to end
    await expect(page.locator('[data-text-editor]')).toHaveCount(0);

    // Select the text
    await page.mouse.click(640, 400);

    // Size toolbar should be visible; click "L"
    const lBtn = page.locator('[data-text-size="L"]');
    await expect(lBtn).toBeVisible({ timeout: 3000 });
    await lBtn.click();

    // Check size changed
    const texts = await getTextObjects(page);
    expect(texts[0].size).toBe('L');
  });

  test('TC-31 two tabs share text objects live', async ({ browser }) => {
    const context1 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Both tabs open the same board
    await page1.goto('/');
    await page1.getByRole('button', { name: 'New board' }).click();
    await page1.waitForSelector('[data-board-surface]');

    const url = page1.url();
    await page2.goto(url);
    await page2.waitForSelector('[data-board-surface]');

    // Tab 1 creates a text object
    await page1.keyboard.press('t');
    await page1.waitForSelector('[data-text-editor]', { state: 'attached', timeout: 5000 }).catch(() => {});
    // Use the text tool click approach
    await page1.mouse.click(640, 400);
    const editor1 = page1.locator('[data-text-editor]');
    await editor1.waitFor({ state: 'attached', timeout: 5000 });
    await editor1.click();
    await page1.keyboard.type('Shared text', { delay: 20 });
    await page1.keyboard.press('Escape');
    await expect(page1.locator('[data-text-editor]')).toHaveCount(0);

    // Tab 2 should see it
    await expect(async () => {
      const texts = await page2.evaluate(() => {
        const board = (window as any).__vidi6?.getBoard?.() ?? [];
        return board.filter((o: any) => o.type === 'text');
      });
      expect(texts.length).toBe(1);
      expect(texts[0].text).toBe('Shared text');
    }).toPass({ timeout: 5000 });

    await context1.close();
    await context2.close();
  });
});
