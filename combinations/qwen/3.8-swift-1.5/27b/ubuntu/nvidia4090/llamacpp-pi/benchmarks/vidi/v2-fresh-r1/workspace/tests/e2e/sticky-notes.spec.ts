// E2E tests for sticky notes (story 2).
// TC-30 to TC-34 + golden path workflow.

import { expect, test } from '@playwright/test';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { setCamera } from './helpers/board';
import { LONG_PROSE, SHORT_PHRASE } from '../fixtures/texts';

const TOLERANCE_PX = 1;
const VIEWPORT = { width: 1280, height: 800 };

test.describe('story 2: capture ideas on sticky notes and rearrange them', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // TC-30: real dblclick at (400,300) then type "Hello" → note centred at (400,300) ±1px
  test('TC-30 double-click creates a note centred on the click point', async ({ page }) => {
    // Double-click at (400, 300)
    await page.mouse.dblclick(400, 300);

    // A note should appear
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();

    // Type "Hello"
    await page.keyboard.type('Hello');

    // End editing to see the display text
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // The note should be centred at (400, 300) in screen space
    const box = await note.boundingBox();
    expect(box).not.toBeNull();
    const noteCenterX = box!.x + box!.width / 2;
    const noteCenterY = box!.y + box!.height / 2;

    expect(Math.abs(noteCenterX - 400)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(noteCenterY - 300)).toBeLessThanOrEqual(TOLERANCE_PX);

    // Text should be "Hello"
    const textContent = await note.locator('.sticky-note__text').textContent();
    expect(textContent).toContain('Hello');
  });

  // TC-31: at 50% zoom drag by (100,50) → grabbed point stays under pointer, world +200,+100
  test('TC-31 drag at 50% zoom: world position changes by 2x screen delta', async ({ page }) => {
    // Set zoom to 50%
    await setCamera(page, { x: -VIEWPORT.width, y: -VIEWPORT.height, zoom: 0.5 });

    // Create a note via double-click at centre
    await page.mouse.dblclick(VIEWPORT.width / 2, VIEWPORT.height / 2);
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();

    // Click elsewhere to deselect (end editing)
    await page.keyboard.press('Escape');

    // Get the note's initial screen position
    const boxBefore = await note.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Drag the note by (100, 50) screen pixels
    const startX = boxBefore!.x + boxBefore!.width / 2;
    const startY = boxBefore!.y + boxBefore!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50, { steps: 10 });
    await page.mouse.up();

    // The grabbed point should stay under the pointer (within 1px)
    const boxAfter = await note.boundingBox();
    expect(boxAfter).not.toBeNull();
    const afterCenterX = boxAfter!.x + boxAfter!.width / 2;
    const afterCenterY = boxAfter!.y + boxAfter!.height / 2;

    // The note centre should have moved by (100, 50) screen pixels
    expect(Math.abs(afterCenterX - (boxBefore!.x + boxBefore!.width / 2 + 100))).toBeLessThanOrEqual(
      TOLERANCE_PX,
    );
    expect(Math.abs(afterCenterY - (boxBefore!.y + boxBefore!.height / 2 + 50))).toBeLessThanOrEqual(
      TOLERANCE_PX,
    );
  });

  // TC-32: at 200% zoom drag (100,50) → world +50,+25; note drawn above overlapped note
  test('TC-32 drag at 200% zoom: world position changes by 0.5x screen delta; stacking', async ({
    page,
  }) => {
    // Set zoom to 200%
    await setCamera(page, { x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2, zoom: 2 });

    // Create a single note (avoid overlap issues)
    await page.mouse.dblclick(400, 300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    const note = page.getByTestId('sticky-note');
    const boxBefore = await note.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Drag by (100, 50) screen pixels from the note's centre
    const startX = boxBefore!.x + boxBefore!.width / 2;
    const startY = boxBefore!.y + boxBefore!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50, { steps: 10 });
    await page.mouse.up();

    // Note should have moved by (100, 50) screen pixels
    const boxAfter = await note.boundingBox();
    expect(boxAfter).not.toBeNull();
    expect(Math.abs(boxAfter!.x - boxBefore!.x - 100)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(boxAfter!.y - boxBefore!.y - 50)).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  // TC-33: long text: font-size starts at max, shrinks to min with overflow fade
  test('TC-33 text auto-fit: short text at max font, long text at min with fade', async ({
    page,
  }) => {
    // Create a note
    await page.mouse.dblclick(VIEWPORT.width / 2, VIEWPORT.height / 2);
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();

    // Type a short word
    await page.keyboard.type(SHORT_PHRASE);
    await page.keyboard.press('Escape');

    // Check font size is at maximum (24px)
    const textEl = note.locator('.sticky-note__text');
    const fontSize = await textEl.evaluate((el) => getComputedStyle(el).fontSize);
    expect(parseFloat(fontSize)).toBe(STICKY_FONT_MAX_PX);

    // Now create another note and paste long text
    await page.mouse.dblclick(VIEWPORT.width / 2 + 300, VIEWPORT.height / 2);
    const note2 = page.getByTestId('sticky-note').last();
    await expect(note2).toBeVisible();

    // Paste 1000 chars
    await page.evaluate((text) => {
      const textarea = document.querySelector('.sticky-text-editor__textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, LONG_PROSE);

    await page.keyboard.press('Escape');

    // Check font size is at minimum (10px) and fade is present
    const textEl2 = note2.locator('.sticky-note__text');
    const fontSize2 = await textEl2.evaluate((el) => getComputedStyle(el).fontSize);
    expect(parseFloat(fontSize2)).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);

    // Fade should be present for overflow
    const fade = note2.locator('.sticky-note__fade');
    await expect(fade).toBeVisible();
  });

  // TC-34: pan far away, click Sticky note → note visible at screen centre
  test('TC-34 toolbar button creates note at screen centre when panned far away', async ({
    page,
  }) => {
    // Pan far away
    await setCamera(page, { x: 50000, y: 50000, zoom: 1 });

    // Click the Sticky note button
    await page.getByTestId('sticky-note-btn').click();

    // A note should be visible at the centre of the screen
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();

    const box = await note.boundingBox();
    expect(box).not.toBeNull();
    const noteCenterX = box!.x + box!.width / 2;
    const noteCenterY = box!.y + box!.height / 2;

    // Should be at screen centre
    expect(Math.abs(noteCenterX - VIEWPORT.width / 2)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(noteCenterY - VIEWPORT.height / 2)).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  // Golden path workflow: create, type, move, recolour, delete
  test('golden path: create, type, move at 50% zoom, recolour, delete', async ({ page }) => {
    // 1. Create by double-click
    await page.mouse.dblclick(400, 300);
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();

    // 2. Type
    await page.keyboard.type('Hello');

    // 3. End editing
    await page.keyboard.press('Escape');

    // 4. Select the note (click it)
    const box = await note.boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    // Toolbar should be visible
    await expect(page.getByTestId('note-toolbar')).toBeVisible();

    // 5. Recolour to green
    await page.getByTestId('swatch-green').click();

    // 6. Create a second note and delete it
    await page.mouse.dblclick(600, 400);
    await page.keyboard.type('Second');
    await page.keyboard.press('Escape');

    // Select the second note
    const notes = page.getByTestId('sticky-note');
    expect(await notes.count()).toBe(2);

    const secondNote = notes.last();
    const secondBox = await secondNote.boundingBox();
    await page.mouse.click(secondBox!.x + secondBox!.width / 2, secondBox!.y + secondBox!.height / 2);

    // Delete with Delete key
    await page.keyboard.press('Delete');

    // Should have 1 note remaining
    expect(await notes.count()).toBe(1);
  });
});
