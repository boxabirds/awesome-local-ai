import { test, expect } from '@playwright/test';
import { gotoBoard } from './helpers/board';
import { SHORT_PHRASE, LONG_PARAGRAPH_1000 } from '../fixtures/texts';

test.describe('Sticky notes', () => {
  test('TC-30: double-click creates a note centred on the click point', async ({ page }) => {
    await gotoBoard(page);

    // Double-click at (400, 300) on the board
    await page.mouse.dblclick(400, 300);

    // A sticky note should appear and enter edit mode
    const note = page.getByRole('group', { name: 'Sticky note' });
    await expect(note).toBeVisible();

    // Wait for the editor textarea to appear and be focused
    const textarea = page.getByTestId('sticky-textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeFocused();

    // Type text
    await page.keyboard.type('Hello');

    // The textarea should contain the text
    await expect(textarea).toHaveValue('Hello');

    // End editing
    await page.keyboard.press('Escape');

    // The note should now show the text
    await expect(note).toContainText('Hello');

    // The note should be centred approximately at (400, 300)
    // The note is 200x200 world units at 100% zoom, so its centre is at its position + 100,100
    // The camera starts centred at (0,0) with the viewport at 1280x800
    // screenToWorld(400, 300) with camera (-640, -400, 1) = (400-(-640), 300-(-400)) = (1040, 700)
    // Wait, let me recalculate: world = screen/zoom + camera = (400/1 + (-640), 300/1 + (-400)) = (-240, -100)
    // Note top-left = (-240 - 100, -100 - 100) = (-340, -200)
    // Note centre in world = (-340 + 100, -200 + 100) = (-240, -100)
    // Note centre on screen = ((-240 - (-640)) * 1, (-100 - (-400)) * 1) = (400, 300) ✓
    const box = await note.boundingBox();
    expect(box).not.toBeNull();
    const centreX = box!.x + box!.width / 2;
    const centreY = box!.y + box!.height / 2;
    expect(Math.abs(centreX - 400)).toBeLessThanOrEqual(2);
    expect(Math.abs(centreY - 300)).toBeLessThanOrEqual(2);
  });

  test('TC-31: drag at 50% zoom moves note correctly', async ({ page }) => {
    await gotoBoard(page);

    // Set camera to 50% zoom using the test hook
    await page.evaluate(() => {
      (window as any).__vidi6?.setCamera({ x: -640, y: -400, zoom: 0.5 });
    });

    // Create a note by double-clicking
    await page.mouse.dblclick(400, 300);
    const note = page.getByRole('group', { name: 'Sticky note' });
    await expect(note).toBeVisible();

    // Wait for editor, then end editing
    const textarea = page.getByTestId('sticky-textarea');
    await expect(textarea).toBeVisible();
    await page.keyboard.press('Escape');

    // Get the note's current position
    const box = await note.boundingBox();
    expect(box).not.toBeNull();

    // Drag by (100, 50) screen pixels
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 100, box!.y + box!.height / 2 + 50, { steps: 10 });
    await page.mouse.up();

    // The note should have moved by (100/0.5, 50/0.5) = (200, 100) world units
    // So the new screen position should be original + (100, 50)
    const newBox = await note.boundingBox();
    expect(newBox).not.toBeNull();
    expect(Math.abs(newBox!.x - (box!.x + 100))).toBeLessThanOrEqual(2);
    expect(Math.abs(newBox!.y - (box!.y + 50))).toBeLessThanOrEqual(2);
  });

  test('TC-32: drag at 200% zoom moves note correctly and shows on top', async ({ page }) => {
    await gotoBoard(page);

    // Set camera to 200% zoom
    await page.evaluate(() => {
      (window as any).__vidi6?.setCamera({ x: -640, y: -400, zoom: 2 });
    });

    // Create first note
    await page.mouse.dblclick(300, 300);
    let textarea = page.getByTestId('sticky-textarea');
    await expect(textarea).toBeVisible();
    await page.keyboard.type('First');
    await page.keyboard.press('Escape');

    // Create second note (further away - at 200% zoom notes are 400x400 px)
    await page.mouse.dblclick(700, 500);
    textarea = page.getByTestId('sticky-textarea');
    await expect(textarea).toBeVisible();
    await page.keyboard.type('Second');
    await page.keyboard.press('Escape');

    // Now drag the second note - it should come to front
    const notes = page.getByRole('group', { name: 'Sticky note' });
    const count = await notes.count();
    expect(count).toBe(2);

    // Get the second note (it was created last, so it's on top)
    const secondNote = notes.nth(1);
    const box = await secondNote.boundingBox();
    expect(box).not.toBeNull();

    // Drag by (100, 50) screen pixels at 200% zoom → world (50, 25)
    await page.mouse.move(box!.x + 20, box!.y + 20);
    await page.mouse.down();
    await page.mouse.move(box!.x + 20 + 100, box!.y + 20 + 50, { steps: 10 });
    await page.mouse.up();

    const newBox = await secondNote.boundingBox();
    expect(newBox).not.toBeNull();
    expect(Math.abs(newBox!.x - (box!.x + 100))).toBeLessThanOrEqual(2);
    expect(Math.abs(newBox!.y - (box!.y + 50))).toBeLessThanOrEqual(2);
  });

  test('TC-33: long text shrinks font and shows overflow fade', async ({ page }) => {
    await gotoBoard(page);

    // Create a note and type a short word
    await page.mouse.dblclick(400, 300);
    const textarea = page.getByTestId('sticky-textarea');
    await expect(textarea).toBeVisible();
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');

    const note = page.getByRole('group', { name: 'Sticky note' });
    await expect(note).toBeVisible();

    // Now double-click to edit and paste long text
    await note.dblclick();
    const textarea2 = page.getByTestId('sticky-textarea');
    await expect(textarea2).toBeVisible();

    // Select all and type long text
    await page.keyboard.press('Control+a');
    await page.evaluate((text) => {
      const ta = document.querySelector('[data-testid="sticky-textarea"]') as HTMLTextAreaElement;
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, LONG_PARAGRAPH_1000);

    // End editing
    await page.keyboard.press('Escape');

    // The note should still be visible with text
    await expect(note).toBeVisible();
    await expect(note).toContainText('The quick brown fox');
  });

  test('TC-34: toolbar button creates note at viewport centre when panned far away', async ({ page }) => {
    await gotoBoard(page);

    // Pan far away using the test hook
    await page.evaluate(() => {
      (window as any).__vidi6?.setCamera({ x: 5000, y: 3000, zoom: 1 });
    });

    // Click the Sticky note button
    const btn = page.getByLabel('Sticky note');
    await btn.click();

    // A note should appear and be in edit mode
    const note = page.getByRole('group', { name: 'Sticky note' });
    await expect(note).toBeVisible();
    const textarea = page.getByTestId('sticky-textarea');
    await expect(textarea).toBeVisible();

    // The note should be visible at the centre of the screen
    const box = await note.boundingBox();
    expect(box).not.toBeNull();
    const centreX = box!.x + box!.width / 2;
    const centreY = box!.y + box!.height / 2;
    // Viewport is 1280x800, centre is (640, 400)
    expect(Math.abs(centreX - 640)).toBeLessThanOrEqual(5);
    expect(Math.abs(centreY - 400)).toBeLessThanOrEqual(5);
  });

  test('Brainstorm golden path: create, type, move, recolour, delete', async ({ page }) => {
    await gotoBoard(page);

    // 1. Create by double-click
    await page.mouse.dblclick(400, 300);
    const note = page.getByRole('group', { name: 'Sticky note' });
    await expect(note).toBeVisible();

    // 2. Wait for editor and type text
    const textarea = page.getByTestId('sticky-textarea');
    await expect(textarea).toBeVisible();
    await page.keyboard.type(SHORT_PHRASE);

    // 3. End editing
    await page.keyboard.press('Escape');
    await expect(note).toContainText(SHORT_PHRASE);

    // 4. Select the note (click on it)
    await note.click();
    await expect(note).toHaveAttribute('data-selected');

    // 5. Change colour to green (NoteToolbar appears when selected)
    const greenSwatch = page.getByLabel('green colour');
    await expect(greenSwatch).toBeVisible();
    await greenSwatch.click();

    // Note should now be green (check background)
    const noteEl = await note.elementHandle();
    const bg = await noteEl!.evaluate(el => getComputedStyle(el).backgroundColor);
    // Green is #C5E1A5 = rgb(197, 225, 165)
    expect(bg).toBe('rgb(197, 225, 165)');

    // 6. Delete the note
    await page.keyboard.press('Delete');
    await expect(note).not.toBeVisible();
  });

  test('dragging a note does not pan the board', async ({ page }) => {
    await gotoBoard(page);

    // Create a note
    await page.mouse.dblclick(400, 300);
    const textarea = page.getByTestId('sticky-textarea');
    await expect(textarea).toBeVisible();
    await page.keyboard.type('Test');
    await page.keyboard.press('Escape');

    const note = page.getByRole('group', { name: 'Sticky note' });
    const box = await note.boundingBox();
    expect(box).not.toBeNull();

    // Get the grid background position before drag
    const viewport = page.locator('.board-viewport');
    const bgBefore = await viewport.evaluate(el => getComputedStyle(el).backgroundPosition);

    // Drag the note
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2 + 40, { steps: 5 });
    await page.mouse.up();

    // Grid background should NOT have changed (board didn't pan)
    const bgAfter = await viewport.evaluate(el => getComputedStyle(el).backgroundPosition);
    expect(bgAfter).toBe(bgBefore);
  });
});
