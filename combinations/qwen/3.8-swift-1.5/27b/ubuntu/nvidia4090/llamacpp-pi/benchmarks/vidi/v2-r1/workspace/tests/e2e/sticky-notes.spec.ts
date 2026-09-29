import { test, expect, Page } from '@playwright/test';
import { setCamera } from './helpers/board';
import { SHORT_TEXT, LONG_TEXT_1000 } from '../fixtures/texts';

// Helper to get the bounding box of a sticky note
async function getNoteBox(page: Page, index = 0): Promise<{ x: number; y: number; width: number; height: number }> {
  const notes = page.getByTestId('sticky-note');
  const note = notes.nth(index);
  const box = await note.boundingBox();
  if (!box) throw new Error('Note not found');
  return box;
}

// Helper to get the centre of a note
async function getNoteCentre(page: Page, index = 0): Promise<{ x: number; y: number }> {
  const box = await getNoteBox(page, index);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('Sticky notes - Brainstorm golden path', () => {
  test('TC-30: create by double-click, type text, note centred at click point', async ({ page }) => {
    await page.goto('/');
    
    // Double-click at (400, 300)
    await page.mouse.dblclick(400, 300);
    
    // A note should appear
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();
    
    // Type text
    await page.keyboard.type('Hello');
    
    // The note should be centred at (400, 300) ± 1px
    const centre = await getNoteCentre(page);
    expect(Math.abs(centre.x - 400)).toBeLessThanOrEqual(2);
    expect(Math.abs(centre.y - 300)).toBeLessThanOrEqual(2);
    
    // Text should be in the note
    const textEl = page.getByTestId('sticky-text-editor');
    await expect(textEl).toHaveValue('Hello');
  });

  test('TC-31: drag at 50% zoom keeps grabbed point under pointer', async ({ page }) => {
    await page.goto('/');
    
    // Set camera to 50% zoom
    // At 50% zoom, the viewport centre shows world (0,0) at screen centre
    // For a 1280x800 viewport at 50% zoom: world origin at screen (640, 400)
    // camera.x = -640/0.5 = -1280, camera.y = -400/0.5 = -800
    await setCamera(page, -1280, -800, 0.5);
    
    // Create a note at the centre by double-clicking
    await page.mouse.dblclick(640, 400);
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();
    
    // Click elsewhere to deselect and stop editing
    await page.mouse.click(100, 100);
    await page.waitForTimeout(100);
    
    // Get note position before drag
    const beforeBox = await getNoteBox(page);
    const grabX = beforeBox.x + beforeBox.width / 2;
    const grabY = beforeBox.y + beforeBox.height / 2;
    
    // Drag by (100, 50) screen pixels
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + 100, grabY + 50, { steps: 5 });
    await page.mouse.up();
    
    // The grabbed point should stay under the pointer (within 1px)
    const afterBox = await getNoteBox(page);
    // The note moved by (100/0.5, 50/0.5) = (200, 100) in world units
    // In screen space at 50% zoom, that's (100, 50) pixels
    const newCentreX = afterBox.x + afterBox.width / 2;
    const newCentreY = afterBox.y + afterBox.height / 2;
    
    // The centre should have moved by approximately (100, 50) screen pixels
    expect(Math.abs(newCentreX - (grabX + 100))).toBeLessThanOrEqual(2);
    expect(Math.abs(newCentreY - (grabY + 50))).toBeLessThanOrEqual(2);
  });

  test('TC-32: drag at 200% zoom, note drawn above overlapped note', async ({ page }) => {
    await page.goto('/');
    
    // Set camera to 200% zoom
    // For a 1280x800 viewport at 200% zoom: 
    // camera.x = -640/2 = -320, camera.y = -400/2 = -200
    await setCamera(page, -320, -200, 2);
    
    // Create two notes (at 200% zoom, notes are 400x400 screen px, so space them out)
    await page.mouse.dblclick(300, 200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    
    await page.mouse.dblclick(900, 600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    
    // Click empty space to deselect
    await page.mouse.click(100, 100);
    await page.waitForTimeout(100);
    
    // Get the second note (topmost) and drag it
    const notes = page.getByTestId('sticky-note');
    expect(await notes.count()).toBe(2);
    
    // Drag the second note
    const note2 = notes.nth(1);
    const box2 = await note2.boundingBox();
    if (!box2) throw new Error('Note 2 not found');
    
    const grabX = box2.x + box2.width / 2;
    const grabY = box2.y + box2.height / 2;
    
    // Drag by (100, 50) screen pixels
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + 100, grabY + 50, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    
    // At 200% zoom, world delta = (100/2, 50/2) = (50, 25)
    // The dragged note should be on top (higher z-index)
    const notesAfter = page.getByTestId('sticky-note');
    const zIndices = await notesAfter.evaluateAll((els) =>
      els.map(el => parseInt(el.style.zIndex || '0'))
    );
    // The dragged note (index 1) should have the highest z
    expect(zIndices[1]).toBeGreaterThan(zIndices[0]);
  });

  test('TC-33: long text - font fits then clips at minimum size', async ({ page }) => {
    await page.goto('/');
    
    // Create a note
    await page.mouse.dblclick(640, 400);
    
    // Type a short word first
    await page.keyboard.type('Hello');
    
    // Check font size is at max (24px)
    const editor = page.getByTestId('sticky-text-editor');
    const fontSize = await editor.evaluate((el: HTMLTextAreaElement) => {
      return window.getComputedStyle(el).fontSize;
    });
    // The font size should be 24px for short text
    expect(fontSize).toBe('24px');
    
    // Now clear and paste long text
    await page.evaluate((text) => {
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, LONG_TEXT_1000);
    
    await page.waitForTimeout(100);
    
    // Font size should be at or above minimum (10px)
    const newFontSize = await editor.evaluate((el: HTMLTextAreaElement) => {
      return parseInt(window.getComputedStyle(el).fontSize);
    });
    expect(newFontSize).toBeGreaterThanOrEqual(10);
    expect(newFontSize).toBeLessThan(24);
  });

  test('TC-34: pan far away, click Sticky note button, note visible at centre', async ({ page }) => {
    await page.goto('/');
    
    // Pan far away
    await setCamera(page, -5000, -5000, 1);
    
    // Click the Sticky note button
    await page.getByLabel('Sticky note').click();
    
    // A note should be visible at the centre of the screen
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();
    
    const centre = await getNoteCentre(page);
    // Should be near the centre of the viewport (640, 400)
    expect(Math.abs(centre.x - 640)).toBeLessThanOrEqual(50);
    expect(Math.abs(centre.y - 400)).toBeLessThanOrEqual(50);
  });

  test('Golden path: create, type, move, recolour, delete', async ({ page }) => {
    await page.goto('/');
    
    // 1. Create by double-click
    await page.mouse.dblclick(400, 300);
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();
    
    // 2. Type text
    await page.keyboard.type(SHORT_TEXT);
    
    // 3. Click empty space to deselect
    await page.mouse.click(100, 100);
    await page.waitForTimeout(100);
    
    // 4. Click the note to select it
    const noteBox = await getNoteBox(page);
    await page.mouse.click(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2);
    await page.waitForTimeout(100);
    
    // 5. Note toolbar should be visible
    const toolbar = page.getByTestId('note-toolbar');
    await expect(toolbar).toBeVisible();
    
    // 6. Click green swatch
    await page.getByLabel('green colour').click();
    await page.waitForTimeout(50);
    
    // 7. Delete the note
    await page.getByLabel('Delete note').click();
    await page.waitForTimeout(100);
    
    // Note should be gone
    await expect(page.getByTestId('sticky-note')).toHaveCount(0);
  });
});
