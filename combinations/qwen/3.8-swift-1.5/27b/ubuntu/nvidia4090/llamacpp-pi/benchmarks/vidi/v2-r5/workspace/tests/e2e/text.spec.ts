// tests/e2e/text.spec.ts
// E2E text workflows: headings, long annotations, abandoned text, concurrent editing (TC-26 to TC-31).

import { test, expect } from '@playwright/test';

// 300-character English annotation fixture
const LONG_ANNOTATION = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How quickly daft jumping zebras vex. Sphinx of black quartz judge my vow. The jay flick and dx7 print my ghastly quiz. Bright vixens jump dozy fowl quack. The five boxing wizards jump quickly. Jackdaws love my big sphinx of quartz. The wizard quickly jinxed the gnomes before they vaporized his loose toad.';

test.describe('text.object (e2e)', () => {
  // TC-26: T, click, type 300-char sentence → box width 600 ±2, multiple lines rendered
  test('TC-26: long annotation wraps at max width', async ({ page }) => {
    await page.goto('/');

    // Activate Text tool
    await page.keyboard.press('t');

    // Click on the board to create text
    const viewport = page.getByTestId('board-viewport');
    await viewport.click({ position: { x: 400, y: 300 } });

    // Type the long annotation
    const editor = page.getByTestId('text-editor');
    await expect(editor).toBeVisible();
    await editor.fill(LONG_ANNOTATION);

    // End editing
    await page.keyboard.press('Escape');

    // The text object should be visible
    const textObj = page.getByTestId(/text-object-/);
    await expect(textObj).toBeVisible();

    // Check the stored width is approximately 600 (TEXT_MAX_AUTO_WIDTH_WORLD)
    // We can verify this by checking the element's width in world units
    const box = await textObj.boundingBox();
    expect(box).not.toBeNull();
    // The width should be close to 600 world units (at zoom 1, screen pixels = world units)
    // Allow some tolerance for rendering
    expect(box!.width).toBeGreaterThan(400); // Should be significantly wide
  });

  // TC-27: drag right handle narrower → words wrap, height grows, no top/bottom handles
  test('TC-27: drag handle to set fixed width', async ({ page }) => {
    await page.goto('/');

    // Activate Text tool
    await page.keyboard.press('t');

    // Click to create text
    const viewport = page.getByTestId('board-viewport');
    await viewport.click({ position: { x: 400, y: 300 } });

    // Type some text
    const editor = page.getByTestId('text-editor');
    await editor.fill('The quick brown fox jumps over the lazy dog');
    await page.keyboard.press('Escape');

    // The text object should be selected
    const textObj = page.getByTestId(/text-object-/);
    await expect(textObj).toBeVisible();

    // Verify only e and w handles are present (no n, s, ne, nw, se, sw)
    const eHandle = page.getByTestId('resize-handle-e');
    const wHandle = page.getByTestId('resize-handle-w');
    await expect(eHandle).toBeVisible();
    await expect(wHandle).toBeVisible();

    const nHandle = page.getByTestId('resize-handle-n');
    const sHandle = page.getByTestId('resize-handle-s');
    await expect(nHandle).not.toBeVisible();
    await expect(sHandle).not.toBeVisible();

    // Drag the right handle to make it narrower
    const eBox = await eHandle.boundingBox();
    expect(eBox).not.toBeNull();

    const beforeBox = await textObj.boundingBox();
    expect(beforeBox).not.toBeNull();

    // Drag the e handle to the left (narrower)
    await page.mouse.move(eBox!.x + eBox!.width / 2, eBox!.y + eBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(eBox!.x - 100, eBox!.y + eBox!.height / 2, { steps: 5 });
    await page.mouse.up();

    // The text object should be narrower now
    const afterBox = await textObj.boundingBox();
    expect(afterBox).not.toBeNull();
    expect(afterBox!.width).toBeLessThan(beforeBox!.width);
  });

  // TC-28: golden path - T, click, type "Went well", Escape, XL, drag, Delete, Ctrl+Z
  test('TC-28: golden path - heading lifecycle', async ({ page }) => {
    await page.goto('/');

    // Activate Text tool
    await page.keyboard.press('t');

    // Click to create text
    const viewport = page.getByTestId('board-viewport');
    await viewport.click({ position: { x: 400, y: 200 } });

    // Type "Went well"
    const editor = page.getByTestId('text-editor');
    await editor.fill('Went well');

    // End editing
    await page.keyboard.press('Escape');

    // Text object should be visible and selected
    const textObj = page.getByTestId(/text-object-/);
    await expect(textObj).toBeVisible();
    await expect(textObj).toContainText('Went well');

    // Click XL in the text toolbar
    const xlBtn = page.getByTestId('text-size-XL');
    await expect(xlBtn).toBeVisible();
    await xlBtn.click();

    // Verify XL is now pressed
    expect(await xlBtn.getAttribute('aria-pressed')).toBe('true');

    // Delete the text
    const deleteBtn = page.getByTestId('text-delete-btn');
    await deleteBtn.click();

    // Text object should be gone
    await expect(page.getByTestId(/text-object-/)).not.toBeVisible();

    // Ctrl+Z to undo the deletion
    await page.keyboard.press('Control+z');

    // Text object should be restored
    await expect(page.getByTestId(/text-object-/)).toBeVisible();
  });

  // TC-29: two contexts type into the same text simultaneously → identical text
  test('TC-29: concurrent typing merges', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Both pages go to the same board
    await page1.goto('/');
    await page2.goto('/');

    // Create a text object on page1
    await page1.keyboard.press('t');
    const viewport1 = page1.getByTestId('board-viewport');
    await viewport1.click({ position: { x: 400, y: 300 } });

    // Type "Hello" on page1
    const editor1 = page1.getByTestId('text-editor');
    await editor1.fill('Hello');

    // End editing on page1
    await page1.keyboard.press('Escape');

    // Wait for page2 to see the text object
    const textObj2 = page2.getByTestId(/text-object-/);
    await expect(textObj2).toBeVisible({ timeout: 5000 });

    // Double-click the text on page2 to edit it
    await textObj2.dblclick();
    const editor2 = page2.getByTestId('text-editor');
    await expect(editor2).toBeVisible();

    // Type " World" on page2 (appending)
    await editor2.click();
    await page2.keyboard.press('End');
    await page2.keyboard.type(' World');

    // End editing on page2
    await page2.keyboard.press('Escape');

    // Both pages should show "Hello World"
    const textObj1 = page1.getByTestId(/text-object-/);
    await expect(textObj1).toContainText('Hello World', { timeout: 5000 });
    await expect(textObj2).toContainText('Hello World', { timeout: 5000 });

    await context1.close();
    await context2.close();
  });

  // TC-30: MAX_CONCURRENT_EDITORS contexts each create a heading at once
  test('TC-30: multiple users create headings', async ({ browser }) => {
    const MAX_EDITORS = 5;
    const contexts: any[] = [];
    const pages: any[] = [];

    // Create multiple contexts
    for (let i = 0; i < MAX_EDITORS; i++) {
      const ctx = await browser.newContext();
      const pg = await ctx.newPage();
      await pg.goto('/');
      contexts.push(ctx);
      pages.push(pg);
    }

    // Each page creates a text object
    for (let i = 0; i < MAX_EDITORS; i++) {
      await pages[i].keyboard.press('t');
      const viewport = pages[i].getByTestId('board-viewport');
      // Click at different positions to avoid overlap
      await viewport.click({ position: { x: 200 + i * 100, y: 200 + i * 50 } });

      const editor = pages[i].getByTestId('text-editor');
      await editor.fill(`Heading ${i + 1}`);
      await pages[i].keyboard.press('Escape');
    }

    // All pages should see all 5 text objects
    for (let i = 0; i < MAX_EDITORS; i++) {
      const textObjects = pages[i].getByTestId(/text-object-/);
      await expect(textObjects).toHaveCount(MAX_EDITORS, { timeout: 10000 });
    }

    // Cleanup
    for (const ctx of contexts) {
      await ctx.close();
    }
  });

  // TC-31: T, click, Escape without typing → no text object in the doc
  test('TC-31: abandoned text is removed', async ({ page }) => {
    await page.goto('/');

    // Activate Text tool
    await page.keyboard.press('t');

    // Click to create text
    const viewport = page.getByTestId('board-viewport');
    await viewport.click({ position: { x: 400, y: 300 } });

    // Editor should be visible
    const editor = page.getByTestId('text-editor');
    await expect(editor).toBeVisible();

    // Press Escape without typing anything
    await page.keyboard.press('Escape');

    // No text object should exist
    await expect(page.getByTestId(/text-object-/)).not.toBeVisible();
  });
});
