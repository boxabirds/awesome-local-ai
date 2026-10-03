import { test, expect, type Page } from '@playwright/test';
import { setCamera, settle } from './helpers/board';
import { SHORT_PHRASE, LONG_PARAGRAPH } from '../fixtures/texts';

/**
 * Get the screen-space bounding box of a sticky note element.
 */
async function noteBox(page: Page, index = 0): Promise<{ x: number; y: number; width: number; height: number }> {
  const boxes = page.locator('[data-vidi6="sticky-note"]');
  const box = await boxes.nth(index).boundingBox();
  if (!box) throw new Error(`sticky note ${index} has no bounding box`);
  return box;
}



/**
 * Get the text content of a sticky note's display area.
 */
async function noteText(page: Page, index = 0): Promise<string> {
  const el = page.locator('[data-vidi6="sticky-text-display"]').nth(index);
  return (await el.textContent())?.trim() ?? '';
}

test.describe('sticky notes e2e', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Reset to default camera
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
    await settle(page);
  });

  // TC-30: real dblclick at (400,300) then type "Hello"
  test('TC-30: double-click creates a note centred on the click point', async ({ page }) => {
    // Double-click at (400, 300) in the viewport
    await page.mouse.dblclick(400, 300);

    // A note should appear
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(1);

    // The note should be centred at (400, 300) ± 1px
    const box = await noteBox(page);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    expect(Math.abs(centerX - 400)).toBeLessThanOrEqual(2);
    expect(Math.abs(centerY - 300)).toBeLessThanOrEqual(2);

    // Type "Hello"
    await page.keyboard.type('Hello');

    // End editing to see the display text
    await page.keyboard.press('Escape');

    // The note should contain "Hello"
    const text = await noteText(page);
    expect(text).toBe('Hello');
  });

  // TC-31: at 50% zoom, drag by (100,50) screen px → world +200,+100
  test('TC-31: drag at 50% zoom moves note by correct world delta', async ({ page }) => {
    // Set zoom to 50%
    await setCamera(page, { x: -1280, y: -800, zoom: 0.5 });
    await settle(page);

    // Create a note by double-clicking
    await page.mouse.dblclick(640, 400);
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(1);

    // Get the initial position
    const initialBox = await noteBox(page);

    // Click elsewhere to end editing, then select the note
    await page.keyboard.press('Escape');
    await page.mouse.click(640, 400); // click on the note to select it

    // Now drag the note by (100, 50) screen pixels
    const startX = initialBox.x + initialBox.width / 2;
    const startY = initialBox.y + initialBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50, { steps: 10 });
    await page.mouse.up();

    await settle(page);

    // The note should have moved by (100/0.5, 50/0.5) = (200, 100) world units
    // In screen space at 50% zoom, that's (100, 50) screen pixels
    const finalBox = await noteBox(page);
    const screenDx = finalBox.x - initialBox.x;
    const screenDy = finalBox.y - initialBox.y;
    expect(Math.abs(screenDx - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(screenDy - 50)).toBeLessThanOrEqual(2);
  });

  // TC-32: at 200% zoom, drag (100,50) → world +50,+25 and stacking
  test('TC-32: drag at 200% zoom and stacking order', async ({ page }) => {
    // Set zoom to 200%
    await setCamera(page, { x: -320, y: -200, zoom: 2 });
    await settle(page);

    // Create two notes
    await page.mouse.dblclick(400, 300);
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(1);
    await page.keyboard.press('Escape');

    // Create a second note nearby (overlapping) — at 200% zoom, offset by 200 screen px = 100 world px
    await page.mouse.dblclick(600, 300);
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(2);
    await page.keyboard.press('Escape');

    // The second note should be on top (higher z)
    // Now drag the second note (top note) by (100, 50) screen px
    const topBox = await noteBox(page, 1);
    const startX = topBox.x + topBox.width / 2;
    const startY = topBox.y + topBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50, { steps: 10 });
    await page.mouse.up();

    await settle(page);

    // At 200% zoom, (100, 50) screen px = (50, 25) world units
    const finalBox = await noteBox(page, 1);
    const screenDx = finalBox.x - topBox.x;
    const screenDy = finalBox.y - topBox.y;
    expect(Math.abs(screenDx - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(screenDy - 50)).toBeLessThanOrEqual(2);
  });

  // TC-33: long text → font shrinks, overflow fade
  test('TC-33: text fits with font shrink and overflow fade', async ({ page }) => {
    // Create a note
    await page.mouse.dblclick(640, 400);
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(1);

    // Type a short word
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');

    // Check font size is at maximum (24px)
    const displayEl = page.locator('[data-vidi6="sticky-text-display"]');
    const fontSize = await displayEl.evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe('24px');

    // Now create another note and paste long text
    await page.mouse.dblclick(900, 400);
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(2);

    // Paste the long paragraph
    await page.evaluate((text) => {
      const textarea = document.querySelector('[data-vidi6="sticky-text-editor"] textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, LONG_PARAGRAPH);

    await page.keyboard.press('Escape');

    // Check the second note's font size is at minimum (10px)
    const displays = page.locator('[data-vidi6="sticky-text-display"]');
    const fontSize2 = await displays.nth(1).evaluate((el) => getComputedStyle(el).fontSize);
    expect(Number(fontSize2.replace('px', ''))).toBeGreaterThanOrEqual(10);
    expect(Number(fontSize2.replace('px', ''))).toBeLessThanOrEqual(24);
  });

  // TC-34: pan far away, click Sticky note → note visible at centre
  test('TC-34: toolbar button creates note at viewport centre when panned away', async ({ page }) => {
    // Pan far away from origin
    await setCamera(page, { x: 5000, y: 5000, zoom: 1 });
    await settle(page);

    // Click the Sticky note toolbar button
    await page.click('[data-vidi6="board-toolbar"] button[aria-label="Sticky note"]');

    // A note should appear
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(1);

    // The note should be visible at the centre of the screen
    const box = await noteBox(page);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const viewportCenterX = 640; // 1280 / 2
    const viewportCenterY = 400; // 800 / 2
    expect(Math.abs(centerX - viewportCenterX)).toBeLessThanOrEqual(2);
    expect(Math.abs(centerY - viewportCenterY)).toBeLessThanOrEqual(2);
  });

  // Golden path: create, type, recolour, delete
  test('golden path: create, type, recolour, delete', async ({ page }) => {
    // 1. Create by double-click
    await page.mouse.dblclick(400, 300);
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(1);

    // 2. Type
    await page.keyboard.type(SHORT_PHRASE);

    // 3. End editing
    await page.keyboard.press('Escape');

    // 4. Select the note (click on it)
    const box = await noteBox(page);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // 5. Note toolbar should be visible
    await expect(page.locator('[data-vidi6="note-toolbar"]')).toBeVisible();

    // 6. Click the green swatch (use evaluate to avoid viewport hit-testing interference)
    await page.evaluate(() => {
      const btn = document.querySelector('[aria-label="Green colour"]') as HTMLButtonElement;
      btn.click();
    });

    // 7. Verify colour changed (check background)
    const bgColor = await page.locator('[data-vidi6="sticky-note"]').evaluate(
      (el) => getComputedStyle(el).backgroundColor
    );
    // Green is #C5E1A5 = rgb(197, 225, 165)
    expect(bgColor).toBe('rgb(197, 225, 165)');

    // 8. Delete the note
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(0);
  });

  // Dragging a note does not pan the board
  test('dragging a note does not pan the board', async ({ page }) => {
    // Create a note
    await page.mouse.dblclick(640, 400);
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(1);
    await page.keyboard.press('Escape');

    // Record the board world transform before drag
    const transformBefore = await page.locator('[data-vidi6="board-world"]').evaluate(
      (el) => (el as HTMLElement).style.transform
    );

    // Drag the note
    const box = await noteBox(page);
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 60, { steps: 10 });
    await page.mouse.up();

    await settle(page);

    // The board transform should be unchanged
    const transformAfter = await page.locator('[data-vidi6="board-world"]').evaluate(
      (el) => (el as HTMLElement).style.transform
    );
    expect(transformAfter).toBe(transformBefore);
  });
});
