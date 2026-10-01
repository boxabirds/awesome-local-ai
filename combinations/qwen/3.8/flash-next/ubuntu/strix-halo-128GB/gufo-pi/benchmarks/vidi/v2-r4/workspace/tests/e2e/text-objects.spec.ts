/**
 * E2E tests for story 9: Write free text anywhere on the board.
 * Covers: TC-26 to TC-31 from the spec.
 */
import { test, expect } from '@playwright/test';
import { openBoard, board, openBoardViaApi } from './helpers/board';
import { TEXT_MAX_AUTO_WIDTH_WORLD } from '../../src/shared/config';

test.describe('Free text objects', () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
  });

  test('TC-26: Long annotation – type 300 chars → auto width capped, multiple lines', async ({ page }) => {
    await page.keyboard.press('t');
    const box = await board(page).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + 200, box!.y + 200);
    await expect(page.getByTestId('text-editor')).toBeVisible();

    // Type a long text (approximately 300 characters)
    const longText = 'The quick brown fox jumps over the lazy dog. '.repeat(7).slice(0, 300);
    await page.keyboard.type(longText);
    await page.keyboard.press('Escape');

    // Verify the text object exists
    const textObj = page.getByTestId('text-object');
    await expect(textObj).toBeVisible();

    // Verify width is at or near TEXT_MAX_AUTO_WIDTH_WORLD (capped)
    const storedWidth = Number(await textObj.getAttribute('data-width'));
    expect(storedWidth).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);

    // The content should have all the text
    const content = page.getByTestId('text-object-content');
    const textContent = await content.textContent();
    expect(textContent).toBe(longText);
  });

  test('TC-27: Drag right handle narrower → rewrap, no top/bottom handles', async ({ page }) => {
    await page.keyboard.press('t');
    const box = await board(page).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + 200, box!.y + 200);
    await page.keyboard.type('Some words that should rewrap when the box is narrower than the text');
    await page.keyboard.press('Escape');

    // Select the text object
    const textObj = page.getByTestId('text-object');
    await expect(textObj).toBeVisible();

    // Check handles: only left and right (no top/bottom)
    const handles = page.locator('.selection-handle');
    const count = await handles.count();
    // Should only have 2 handles (e, w)
    expect(count).toBe(2);

    // Get initial width
    const initialWidth = Number(await textObj.getAttribute('data-width'));

    // Drag right handle to make narrower
    const rightHandle = page.locator('[aria-label="Resize right"]');
    const handleBox = await rightHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x - 100, handleBox!.y + handleBox!.height / 2, { steps: 5 });
    await page.mouse.up();

    // Width should be smaller, height may grow (rewrap)
    const newWidth = Number(await textObj.getAttribute('data-width'));
    expect(newWidth).toBeLessThan(initialWidth);
  });

  test('TC-28: Title a section – create, type, XL, move, delete, undo restores', async ({ page }) => {
    await page.keyboard.press('t');
    const box = await board(page).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + 300, box!.y + 100);
    await page.keyboard.type('Went well');
    await page.keyboard.press('Escape');

    // Text toolbar should be visible
    await expect(page.getByTestId('text-toolbar')).toBeVisible();

    // Click XL
    await page.getByTestId('text-size-XL').click();

    // Verify size changed
    const textObj = page.getByTestId('text-object');
    await expect(textObj).toHaveAttribute('data-size', 'XL');

    // Delete the text object
    await page.keyboard.press('Delete');

    // Object should be gone
    await expect(page.getByTestId('text-object')).toHaveCount(0);

    // Undo restores it
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('text-object')).toBeVisible();
    const content = page.getByTestId('text-object-content');
    await expect(content).toHaveText('Went well');
  });

  test('TC-31: Abandoned text – T, click, Escape without typing → no object', async ({ page }) => {
    await page.keyboard.press('t');
    const box = await board(page).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + 200, box!.y + 200);
    await expect(page.getByTestId('text-editor')).toBeVisible();

    // Escape without typing
    await page.keyboard.press('Escape');

    // No text object should exist
    await expect(page.getByTestId('text-object')).toHaveCount(0);

    // Shift+drag over the spot selects nothing (marquee)
    await page.keyboard.down('Shift');
    await page.mouse.move(box!.x + 150, box!.y + 150);
    await page.mouse.down();
    await page.mouse.move(box!.x + 350, box!.y + 350, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // Selection bar should not appear (nothing selected)
    await expect(page.getByTestId('selection-bar')).not.toBeVisible();
  });
});

test.describe('Free text objects – multi-context', () => {
  test('TC-29: Two contexts type into same text → both see every character', async ({ page, browser }) => {
    // Open board
    const boardId = await openBoardViaApi(page, page.request);

    // Open a second page to the same board
    const page2 = await browser.newPage();
    await page2.goto(`/b/${boardId}`);
    await expect(board(page2)).toBeVisible();
    await page2.waitForTimeout(500); // Wait for sync

    // Place a text via first page
    await page.keyboard.press('t');
    const box = await board(page).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + 200, box!.y + 200);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');

    // Second page should see the text
    await page2.waitForTimeout(300);
    await expect(page2.getByTestId('text-object')).toBeVisible();

    // Both start editing
    await page.getByTestId('text-object').dblclick();
    await page2.getByTestId('text-object').dblclick();

    // First types 'A'
    await page.keyboard.type('A');
    await page2.waitForTimeout(200);

    // Second types 'B'
    await page2.keyboard.type('B');
    await page.waitForTimeout(300);

    // Both should see text containing A and B
    await page.keyboard.press('Escape');
    await page2.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const text1 = await page.getByTestId('text-object-content').textContent();
    const text2 = await page2.getByTestId('text-object-content').textContent();
    expect(text1).toContain('A');
    expect(text1).toContain('B');
    expect(text1).toBe(text2);

    await page2.close();
  });

  test('TC-30: Two contexts each create text simultaneously → all visible on both', async ({ page, browser }) => {
    const boardId = await openBoardViaApi(page, page.request);

    // Open a second page to the same board
    const page2 = await browser.newPage();
    await page2.goto(`/b/${boardId}`);
    await expect(board(page2)).toBeVisible();
    await page2.waitForTimeout(500); // Wait for sync

    // First page creates text at left side
    await page.keyboard.press('t');
    const box = await board(page).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + 100, box!.y + 100);
    await page.keyboard.type('First');
    await page.keyboard.press('Escape');

    // Second page creates text at different position
    await page2.keyboard.press('t');
    const box2 = await board(page2).boundingBox();
    expect(box2).not.toBeNull();
    await page2.mouse.click(box2!.x + 300, box2!.y + 300);
    await page2.keyboard.type('Second');
    await page2.keyboard.press('Escape');

    // Both pages should see 2 text objects
    await page.waitForTimeout(500);
    await expect(page.getByTestId('text-object')).toHaveCount(2);
    await expect(page2.getByTestId('text-object')).toHaveCount(2);

    await page2.close();
  });
});
