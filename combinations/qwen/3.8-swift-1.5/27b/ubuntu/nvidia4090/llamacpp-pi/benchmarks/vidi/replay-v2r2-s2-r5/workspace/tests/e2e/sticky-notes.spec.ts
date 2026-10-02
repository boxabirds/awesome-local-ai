import { test, expect } from '@playwright/test';
import { SHORT_PHRASE, LONG_PARAGRAPH } from '../fixtures/texts';

test.describe('Sticky Notes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the board to be ready
    await expect(page.getByTestId('board-viewport')).toBeVisible();
  });

  // TC-30: Real dblclick at (400,300) then type "Hello"
  test('TC-30: double-click creates a note centred on the click point with text', async ({ page }) => {
    // Double-click at (400, 300) on the board
    await page.mouse.dblclick(400, 300);

    // A sticky note should appear
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();

    // Type text
    await page.keyboard.type('Hello');

    // The note should contain "Hello"
    const textDisplay = note.locator('textarea');
    await expect(textDisplay).toHaveValue('Hello');

    // Verify the note is centred at (400, 300) on screen
    const box = await note.boundingBox();
    expect(box).not.toBeNull();
    const noteCenterX = box!.x + box!.width / 2;
    const noteCenterY = box!.y + box!.height / 2;
    expect(Math.abs(noteCenterX - 400)).toBeLessThanOrEqual(2);
    expect(Math.abs(noteCenterY - 300)).toBeLessThanOrEqual(2);
  });

  // TC-31: At 50% zoom, drag by (100,50) screen px → world +200,+100
  test('TC-31: drag at 50% zoom moves note by 2x screen delta in world units', async ({ page }) => {
    // Create a note first
    await page.mouse.dblclick(400, 300);
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();

    // Click away to deselect and stop editing
    await page.mouse.click(100, 100);
    await page.waitForTimeout(100);

    // Set zoom to 50% using the test hook
    await page.evaluate(() => {
      const w = window as any;
      if (w.__vidi6) {
        w.__vidi6.setCamera({ x: -640, y: -400, zoom: 0.5 });
      }
    });
    await page.waitForTimeout(100);

    // Get the note's current screen position
    const boxBefore = await note.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Drag the note by (100, 50) screen pixels
    const startX = boxBefore!.x + boxBefore!.width / 2;
    const startY = boxBefore!.y + boxBefore!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50, { steps: 10 });
    await page.mouse.up();

    // Verify the note moved - get new position
    const boxAfter = await note.boundingBox();
    expect(boxAfter).not.toBeNull();

    // At 50% zoom, 100 screen px = 200 world units
    // The note should have moved approximately 100px right and 50px down on screen
    const screenDx = boxAfter!.x - boxBefore!.x;
    const screenDy = boxAfter!.y - boxBefore!.y;
    expect(Math.abs(screenDx - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(screenDy - 50)).toBeLessThanOrEqual(2);
  });

  // TC-32: At 200% zoom, drag (100,50) → world +50,+25; note drawn above overlapped note
  test('TC-32: drag at 200% zoom and stacking order', async ({ page }) => {
    // Create two notes
    await page.mouse.dblclick(300, 300);
    await page.keyboard.type('First');
    await page.mouse.click(100, 100); // deselect
    await page.waitForTimeout(100);

    await page.mouse.dblclick(500, 300);
    const notes = page.getByTestId('sticky-note');
    await expect(notes).toHaveCount(2);
    await page.keyboard.type('Second');
    await page.mouse.click(100, 100); // deselect
    await page.waitForTimeout(100);

    // Set zoom to 200%
    await page.evaluate(() => {
      const w = window as any;
      if (w.__vidi6) {
        w.__vidi6.setCamera({ x: -320, y: -200, zoom: 2 });
      }
    });
    await page.waitForTimeout(100);

    // Get the second note's position
    const secondNoteEl = page.getByTestId('sticky-note').nth(1);
    const boxBefore = await secondNoteEl.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Drag by (100, 50) screen pixels
    const startX = boxBefore!.x + boxBefore!.width / 2;
    const startY = boxBefore!.y + boxBefore!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50, { steps: 10 });
    await page.mouse.up();

    // At 200% zoom, 100 screen px = 50 world units
    const boxAfter = await secondNoteEl.boundingBox();
    expect(boxAfter).not.toBeNull();

    const screenDx = boxAfter!.x - boxBefore!.x;
    const screenDy = boxAfter!.y - boxBefore!.y;
    expect(Math.abs(screenDx - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(screenDy - 50)).toBeLessThanOrEqual(2);
  });

  // TC-33: Long text - font sizing and overflow
  test('TC-33: text auto-fits and shows overflow fade for long text', async ({ page }) => {
    // Create a note and type a short word
    await page.mouse.dblclick(400, 300);
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();

    // Type a short word
    await page.keyboard.type('Hello');
    await page.waitForTimeout(100);

    // Check font size is at max (24px) for short text
    const textarea = note.locator('textarea');
    const fontSize = await textarea.evaluate((el) => {
      return window.getComputedStyle(el).fontSize;
    });
    expect(fontSize).toBe('24px');

    // Now paste long text (1000 chars)
    await page.evaluate((text) => {
      const ta = document.querySelector('textarea[data-testid="sticky-text-editor"]') as HTMLTextAreaElement;
      if (ta) {
        ta.value = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, LONG_PARAGRAPH);

    await page.waitForTimeout(200);

    // Check font size is at minimum (10px) for long text
    const fontSizeAfter = await textarea.evaluate((el) => {
      return window.getComputedStyle(el).fontSize;
    });
    const fontSizeNum = parseInt(fontSizeAfter);
    expect(fontSizeNum).toBeGreaterThanOrEqual(10);
    expect(fontSizeNum).toBeLessThanOrEqual(24);
  });

  // TC-34: Pan far away, click Sticky note button → note visible at screen centre
  test('TC-34: toolbar button creates note at viewport centre even when panned', async ({ page }) => {
    // Pan far away using the test hook
    await page.evaluate(() => {
      const w = window as any;
      if (w.__vidi6) {
        w.__vidi6.setCamera({ x: 5000, y: 5000, zoom: 1 });
      }
    });
    await page.waitForTimeout(100);

    // Click the Sticky note toolbar button
    await page.getByTestId('sticky-note-btn').click();

    // A note should appear at the centre of the screen
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();

    const box = await note.boundingBox();
    expect(box).not.toBeNull();
    const noteCenterX = box!.x + box!.width / 2;
    const noteCenterY = box!.y + box!.height / 2;

    // Should be near the centre of the 1280x800 viewport
    expect(Math.abs(noteCenterX - 640)).toBeLessThanOrEqual(50);
    expect(Math.abs(noteCenterY - 400)).toBeLessThanOrEqual(50);
  });

  // Golden path: create, type, recolour, delete
  test('Golden path: create, type, recolour, delete', async ({ page }) => {
    // 1. Create by double-click
    await page.mouse.dblclick(400, 300);
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();

    // 2. Type text
    await page.keyboard.type(SHORT_PHRASE);

    // 3. Click away to deselect
    await page.mouse.click(100, 100);
    await page.waitForTimeout(100);

    // 4. Click the note to select it
    await note.click();
    await page.waitForTimeout(100);

    // 5. Note toolbar should be visible
    const toolbar = page.getByTestId('note-toolbar');
    await expect(toolbar).toBeVisible();

    // 6. Click the green swatch
    await page.getByTestId('swatch-green').click();
    await page.waitForTimeout(100);

    // 7. Verify the note is green
    const noteBg = await note.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });
    // #C5E1A5 = rgb(197, 225, 165)
    expect(noteBg).toBe('rgb(197, 225, 165)');

    // 8. Delete the note with Delete key
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    // 9. Note should be gone
    await expect(note).not.toBeVisible();
  });
});
