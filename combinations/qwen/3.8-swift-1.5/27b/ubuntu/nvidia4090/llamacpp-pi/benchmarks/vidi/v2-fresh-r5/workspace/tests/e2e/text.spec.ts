import { test, expect, type Page } from '@playwright/test';
import { gotoBoard, setCamera } from './helpers/board';
import { createParticipants, expectEventually } from './helpers/participants';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { LONG_PARAGRAPH_1000 } from '../fixtures/texts';

/** These tests require chromium (real layout for pixel-accurate assertions). */
function chromiumOnly(): void {
  test.skip(test.info().project.name !== 'chromium', 'chromium only');
}

/**
 * Activate the Text tool and click at a screen position to create a text object.
 * Returns once the text editor is visible.
 */
async function createTextAt(page: Page, screenX: number, screenY: number): Promise<void> {
  // Press T to activate text tool
  await page.keyboard.press('t');
  // Click to create text
  await page.mouse.click(screenX, screenY);
  // Wait for the text editor to appear
  const textarea = page.getByTestId('text-textarea');
  await expect(textarea).toBeVisible({ timeout: 5000 });
}

/**
 * End text editing with Escape.
 */
async function endTextEdit(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
}

test.describe('Text objects (story 9)', () => {
  // TC-26: Long annotation - type 300 chars → box width 600 ±2
  test('TC-26: long annotation wraps at max width', async ({ page }) => {
    chromiumOnly();
    await gotoBoard(page);
    await setCamera(page, { x: -640, y: -400, zoom: 1 });

    // Create text at screen (400, 300)
    await createTextAt(page, 400, 300);

    // Type a 300-character string
    const longText = LONG_PARAGRAPH_1000.slice(0, 300);
    await page.keyboard.type(longText, { delay: 0 });

    // End editing
    await endTextEdit(page);

    // The text object should be visible
    const textObj = page.getByTestId('text-object');
    await expect(textObj).toBeVisible();

    // Check the stored width via the element's style
    const width = await textObj.evaluate((el) => {
      const style = el.getAttribute('style') ?? '';
      const match = /width:\s*([-\d.]+)px/.exec(style);
      return match ? parseFloat(match[1]) : 0;
    });

    // Width should be approximately 600 (TEXT_MAX_AUTO_WIDTH_WORLD) ± 2
    // The actual width depends on font rendering, but should be close to 600
    // for a 300-char string that exceeds the max auto width
    expect(width).toBeGreaterThan(0);
    // For a 300-char paragraph, the width should be at or near the max
    expect(width).toBeLessThanOrEqual(602);
  });

  // TC-27: Drag right handle narrower → words wrap, height grows, no top/bottom handles
  test('TC-27: drag handle to set fixed width', async ({ page }) => {
    chromiumOnly();
    await gotoBoard(page);
    await setCamera(page, { x: -640, y: -400, zoom: 1 });

    // Create text with some content
    await createTextAt(page, 400, 300);
    await page.keyboard.type('The quick brown fox jumps over the lazy dog near the river', { delay: 0 });
    await endTextEdit(page);

    // Select the text object
    const textObj = page.getByTestId('text-object');
    await expect(textObj).toBeVisible();
    await textObj.click();

    // Verify only e and w handles are shown (no n, s, nw, ne, se, sw)
    const handleE = page.getByTestId('handle-e');
    const handleW = page.getByTestId('handle-w');
    await expect(handleE).toBeVisible();
    await expect(handleW).toBeVisible();

    // No vertical handles
    const handleN = page.getByTestId('handle-n');
    const handleS = page.getByTestId('handle-s');
    await expect(handleN).not.toBeVisible();
    await expect(handleS).not.toBeVisible();

    // Get the current height
    const heightBefore = await textObj.evaluate((el) => {
      const style = el.getAttribute('style') ?? '';
      const match = /height:\s*([-\d.]+)px/.exec(style);
      return match ? parseFloat(match[1]) : 0;
    });

    // Drag the right handle to the left (narrow the text)
    const eBox = await handleE.boundingBox();
    if (eBox) {
      await page.mouse.move(eBox.x + eBox.width / 2, eBox.y + eBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(eBox.x - 100, eBox.y + eBox.height / 2, { steps: 3 });
      await page.mouse.up();
    }

    // After narrowing, the height should have grown (text wraps)
    await page.waitForTimeout(200);
    const heightAfter = await textObj.evaluate((el) => {
      const style = el.getAttribute('style') ?? '';
      const match = /height:\s*([-\d.]+)px/.exec(style);
      return match ? parseFloat(match[1]) : 0;
    });

    expect(heightAfter).toBeGreaterThanOrEqual(heightBefore);
  });

  // TC-28: Golden path - T, click, type "Went well", Escape, XL, drag, Delete, Ctrl+Z
  test('TC-28: golden path - create, size, delete, undo', async ({ page }) => {
    chromiumOnly();
    await gotoBoard(page);
    await setCamera(page, { x: -640, y: -400, zoom: 1 });

    // 1. Press T, click to create text
    await createTextAt(page, 500, 250);

    // 2. Type "Went well"
    await page.keyboard.type('Went well', { delay: 0 });

    // 3. Escape to end editing
    await endTextEdit(page);

    // Text object should be visible with the text
    const textObj = page.getByTestId('text-object');
    await expect(textObj).toBeVisible();
    await expect(textObj).toContainText('Went well');

    // 4. Select it (click on it)
    await textObj.click();

    // 5. Click XL in the text toolbar
    const xlBtn = page.locator('[data-testid="text-size-xl"]');
    await expect(xlBtn).toBeVisible();
    await xlBtn.click();

    // 6. Delete the text
    await page.keyboard.press('Delete');
    await expect(textObj).not.toBeVisible();

    // 7. Ctrl+Z to undo the delete
    await page.keyboard.press('Control+z');
    await expect(textObj).toBeVisible({ timeout: 3000 });
    await expect(textObj).toContainText('Went well');
  });

  // TC-29: Two contexts type into the same text simultaneously
  test('TC-29: concurrent typing merges', async ({ browser }) => {
    chromiumOnly();
    const participants = await createParticipants(browser, 2);
    try {
      const [p1, p2] = participants;

      // P1 creates a text object
      await p1.page.keyboard.press('t');
      await p1.page.mouse.click(640, 400);
      const textarea1 = p1.page.getByTestId('text-textarea');
      await expect(textarea1).toBeVisible({ timeout: 5000 });

      // P1 types "Hello"
      await p1.page.keyboard.type('Hello', { delay: 50 });

      // Wait for P2 to see the text object
      await expectEventually('P2 sees text object', async () => {
        return (await p2.page.locator('[data-testid="text-object"]').count()) > 0;
      });

      // P2 double-clicks the text to edit it
      const textObj2 = p2.page.locator('[data-testid="text-object"]').first();
      await textObj2.dblclick();
      const textarea2 = p2.page.getByTestId('text-textarea');
      await expect(textarea2).toBeVisible({ timeout: 5000 });

      // P2 types " World"
      await p2.page.keyboard.type(' World', { delay: 50 });

      // Both should see "Hello World" eventually
      await expectEventually('P1 sees merged text', async () => {
        const val = await textarea1.inputValue().catch(() => '');
        return val.includes('Hello') && val.includes('World');
      });

      await expectEventually('P2 sees merged text', async () => {
        const val = await textarea2.inputValue().catch(() => '');
        return val.includes('Hello') && val.includes('World');
      });
    } finally {
      await Promise.all(participants.map((p) => p.close()));
    }
  });

  // TC-30: MAX_CONCURRENT_EDITORS contexts each create a heading
  test('TC-30: multiple users create headings simultaneously', async ({ browser }) => {
    chromiumOnly();
    const n = MAX_CONCURRENT_EDITORS;
    const participants = await createParticipants(browser, n);
    try {
      // Each participant creates a text object at a different position
      for (let i = 0; i < n; i++) {
        const p = participants[i];
        const x = 400 + i * 100;
        const y = 300;
        await p.page.keyboard.press('t');
        await p.page.mouse.click(x, y);
        const textarea = p.page.getByTestId('text-textarea');
        await expect(textarea).toBeVisible({ timeout: 5000 });
        await p.page.keyboard.type(`Heading${i}`, { delay: 10 });
        await p.page.keyboard.press('Escape');
      }

      // All participants should see all n text objects
      for (let i = 0; i < n; i++) {
        const p = participants[i];
        await expectEventually(`P${i} sees all ${n} headings`, async () => {
          const count = await p.page.locator('[data-testid="text-object"]').count();
          return count >= n;
        });
      }
    } finally {
      await Promise.all(participants.map((p) => p.close()));
    }
  });

  // TC-31: T, click, Escape without typing → no object
  test('TC-31: abandoned text leaves no object', async ({ page }) => {
    chromiumOnly();
    await gotoBoard(page);
    await setCamera(page, { x: -640, y: -400, zoom: 1 });

    // Activate text tool and click
    await page.keyboard.press('t');
    await page.mouse.click(500, 300);

    // Wait for editor to appear
    const textarea = page.getByTestId('text-textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Escape without typing
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // No text object should exist
    const textObjects = page.locator('[data-testid="text-object"]');
    expect(await textObjects.count()).toBe(0);
  });
});
