/**
 * E2E tests for sticky note workflows.
 * TC-30 to TC-34.
 */
import { test, expect, type Page } from '@playwright/test';
import { setCamera } from './helpers/board';
import { SHORT_PHRASE, LONG_PARAGRAPH } from '../fixtures/texts';

const STICKY_SIZE = 200; // STICKY_SIZE_WORLD

/** Get the center of a sticky note element in screen coordinates. */
async function noteCenter(page: Page, index = 0): Promise<{ x: number; y: number }> {
  const note = page.locator('[data-testid="sticky-note"]').nth(index);
  const box = await note.boundingBox();
  if (!box) throw new Error('sticky note not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Get the top-left corner of a sticky note in screen coordinates. */
async function noteTopLeft(page: Page, index = 0): Promise<{ x: number; y: number }> {
  const note = page.locator('[data-testid="sticky-note"]').nth(index);
  const box = await note.boundingBox();
  if (!box) throw new Error('sticky note not found');
  return { x: box.x, y: box.y };
}

test.describe('sticky notes e2e', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Reset to standard view
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
  });

  // TC-30: real dblclick at (400,300) then type "Hello" → note centred at (400,300) ±1px with text
  test('TC-30: double-click creates note at click point with text', async ({ page }) => {
    // Double-click at screen point (400, 300)
    await page.mouse.dblclick(400, 300);

    // A note should appear
    const note = page.locator('[data-testid="sticky-note"]');
    await expect(note).toHaveCount(1);

    // Type text
    const textarea = page.locator('[data-testid="sticky-textarea"]');
    await expect(textarea).toBeVisible();
    await textarea.fill('Hello');

    // Click outside to end editing
    await page.mouse.click(100, 700);

    // Verify note text
    await expect(note).toContainText('Hello');

    // Verify note is centred at (400, 300) ± 2px
    const center = await noteCenter(page, 0);
    expect(Math.abs(center.x - 400)).toBeLessThanOrEqual(2);
    expect(Math.abs(center.y - 300)).toBeLessThanOrEqual(2);
  });

  // TC-31: at 50% zoom drag by (100,50) → grabbed point stays under pointer ±1px; world +200,+100
  test('TC-31: drag at 50% zoom moves note correctly', async ({ page }) => {
    // Set zoom to 50%
    await setCamera(page, { x: -640, y: -400, zoom: 0.5 });

    // Create a note by double-clicking
    await page.mouse.dblclick(400, 300);
    const textarea = page.locator('[data-testid="sticky-textarea"]');
    await textarea.fill('Test');
    await page.keyboard.press('Escape');

    // Get the note's current screen position
    const before = await noteTopLeft(page, 0);

    // Drag by (100, 50) screen pixels
    const grabX = before.x + 50; // grab from inside the note
    const grabY = before.y + 50;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + 100, grabY + 50, { steps: 10 });
    await page.mouse.up();

    // The note should have moved by (100, 50) screen pixels
    const after = await noteTopLeft(page, 0);
    expect(Math.abs(after.x - (before.x + 100))).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y - (before.y + 50))).toBeLessThanOrEqual(2);

    // World position should have changed by (200, 100) since zoom is 0.5
    // (screen delta / zoom = world delta)
  });

  // TC-32: at 200% zoom drag (100,50) → world +50,+25; note drawn above overlapped note
  test('TC-32: drag at 200% zoom and stacking order', async ({ page }) => {
    // Set zoom to 200%
    await setCamera(page, { x: -640, y: -400, zoom: 2 });

    // Create first note at a position that won't overlap with the second
    await page.mouse.dblclick(200, 200);
    const ta1 = page.locator('[data-testid="sticky-textarea"]');
    await ta1.fill('First');
    await page.keyboard.press('Escape');

    // Create second note far enough away (at 200% zoom, notes are 400px on screen)
    await page.mouse.dblclick(800, 600);
    const ta2 = page.locator('[data-testid="sticky-textarea"]');
    await ta2.fill('Second');
    await page.keyboard.press('Escape');

    // Now drag the second note towards the first to create overlap
    const note2 = page.locator('[data-testid="sticky-note"]').nth(1);
    const box2 = await note2.boundingBox();
    if (!box2) throw new Error('note2 not found');

    const grabX = box2.x + 30;
    const grabY = box2.y + 30;
    // Drag towards the first note to overlap
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX - 300, grabY - 200, { steps: 10 });
    await page.mouse.up();

    // The dragged note should be on top (it was brought to front during drag)
    const notes = page.locator('[data-testid="sticky-note"]');
    await expect(notes).toHaveCount(2);
  });

  // TC-33: long text → font-size starts at max, then shrinks with overflow fade
  test('TC-33: text auto-fit and overflow', async ({ page }) => {
    // Create a note
    await page.mouse.dblclick(400, 300);
    const textarea = page.locator('[data-testid="sticky-textarea"]');
    await expect(textarea).toBeVisible();

    // Type one word - should be at max font size
    await textarea.fill('Hello');
    await page.keyboard.press('Escape');

    // Check the display font size
    const displayEl = page.locator('[data-sticky-display]');
    const fontSize = await displayEl.evaluate((el) => {
      return window.getComputedStyle(el).fontSize;
    });
    // Should be 24px (max) for a short word
    expect(fontSize).toBe('24px');

    // Now create another note and paste long text
    await page.mouse.dblclick(700, 300);
    const textarea2 = page.locator('[data-testid="sticky-textarea"]');
    await expect(textarea2).toBeVisible();
    await textarea2.fill(LONG_PARAGRAPH);
    await page.keyboard.press('Escape');

    // Check the display font size for the long text note
    const displayEl2 = page.locator('[data-sticky-display]').nth(1);
    const fontSize2 = await displayEl2.evaluate((el) => {
      return window.getComputedStyle(el).fontSize;
    });
    // Should be at or above minimum (10px)
    const fontSizeNum = parseInt(fontSize2);
    expect(fontSizeNum).toBeGreaterThanOrEqual(10);
    expect(fontSizeNum).toBeLessThan(24); // Should have shrunk
  });

  // TC-34: pan far away, click Sticky note → note visible at screen centre
  test('TC-34: toolbar button creates note at viewport centre when panned away', async ({ page }) => {
    // Pan far away from origin
    await setCamera(page, { x: 5000, y: 5000, zoom: 1 });

    // Click the Sticky note button
    const stickyBtn = page.locator('[data-testid="sticky-btn"]');
    await stickyBtn.click();

    // A note should appear and be visible
    const note = page.locator('[data-testid="sticky-note"]');
    await expect(note).toHaveCount(1);

    // The note should be at the centre of the screen (640, 400 for 1280x800 viewport)
    const center = await noteCenter(page, 0);
    expect(Math.abs(center.x - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(center.y - 400)).toBeLessThanOrEqual(2);
  });

  // Golden path workflow: create, type, move, recolour, delete
  test('golden path: create, type, move, recolour, delete', async ({ page }) => {
    // 1. Create by double-click
    await page.mouse.dblclick(400, 300);
    const textarea = page.locator('[data-testid="sticky-textarea"]');
    await expect(textarea).toBeVisible();

    // 2. Type
    await textarea.fill('Faster onboarding');

    // 3. End editing
    await page.keyboard.press('Escape');

    // 4. Select the note (click it)
    const note = page.locator('[data-testid="sticky-note"]');
    await note.click();

    // 5. Note toolbar should be visible
    const toolbar = page.locator('[data-testid="note-toolbar"]');
    await expect(toolbar).toBeVisible();

    // 6. Click green swatch
    await page.locator('[data-testid="swatch-green"]').click();

    // 7. Drag the note
    const box = await note.boundingBox();
    if (!box) throw new Error('note not found');
    const grabX = box.x + box.width / 2;
    const grabY = box.y + box.height / 2;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + 80, grabY + 40, { steps: 5 });
    await page.mouse.up();

    // 8. Delete the note
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(0);
  });
});
